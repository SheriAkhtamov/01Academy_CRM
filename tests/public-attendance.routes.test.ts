import express from 'express';
import session from 'express-session';
import request from 'supertest';
import { scryptSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicAttendanceService, PublicAttendanceSettings } from '../server/services/public-attendance';

vi.mock('../server/modules/academy/academy-core', () => ({ query: vi.fn(), queryOne: vi.fn(), withTransaction: vi.fn(), ACADEMY_SCHEDULING_ADVISORY_LOCK: 7315001 }));
vi.mock('../server/modules/academy/academy-route-support', () => ({ getLessonRoster: vi.fn() }));
vi.mock('../server/modules/academy/academy-leads', () => ({ recalculateStudentMetrics: vi.fn() }));
vi.mock('../server/lib/logger', () => ({ logger: { error: vi.fn() } }));
import { createPublicAttendanceRouter } from '../server/routes/public-attendance.routes';
import { PublicAttendanceError, verifyAttendancePassword } from '../server/services/public-attendance';

const password = 'test-page-pass';
const salt = 'ab'.repeat(16);
const hash = `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
let settings: PublicAttendanceSettings | null;
let service: PublicAttendanceService;
const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'attendance-test-session-secret', resave: false, saveUninitialized: false }));
  app.get('/account', (req, res) => res.json({ userId: req.session.userId ?? null }));
  app.use('/api/public/attendance', createPublicAttendanceRouter({ settings: () => settings, service }));
  return app;
};
const enter = async (agent: ReturnType<typeof request.agent>) => {
  const result = await agent.post('/api/public/attendance/access').send({ password });
  expect(result.status).toBe(200);
  return result.body.csrfToken as string;
};
beforeEach(() => {
  settings = { passwordHash: hash, groupIds: [55, 56, 57] };
  service = {
    listGroups: vi.fn().mockResolvedValue([]), loadRoster: vi.fn().mockResolvedValue({ lesson: {}, students: [] }),
    mark: vi.fn().mockResolvedValue({ lesson: {}, students: [] }), markMany: vi.fn().mockResolvedValue({ lesson: {}, students: [] }),
  };
});
afterEach(() => vi.restoreAllMocks());

describe('public attendance access', () => {
  it('does not expose students before the page password is entered and does not create a CRM user', async () => {
    const agent = request.agent(createApp());
    const result = await agent.get('/api/public/attendance/session');
    expect(result.body).toEqual({ available: true, authenticated: false });
    expect(result.headers['cache-control']).toBe('no-store');
    expect((await agent.get('/api/public/attendance/groups')).status).toBe(401);
    await enter(agent);
    expect((await agent.get('/account')).body).toEqual({ userId: null });
    expect((await agent.get('/api/public/attendance/groups')).status).toBe(200);
    expect(service.listGroups).toHaveBeenCalledWith([55, 56, 57]);
  });
  it('rejects an incorrect password and throttles guessing', async () => {
    const agent = request.agent(createApp());
    for (let i = 0; i < 8; i++) expect((await agent.post('/api/public/attendance/access').send({ password: 'wrong' })).status).toBe(401);
    expect((await agent.post('/api/public/attendance/access').send({ password: 'wrong' })).status).toBe(429);
    expect(service.listGroups).not.toHaveBeenCalled();
  });
  it('requires a session-specific CSRF token for writes and explicit confirmation for clearing', async () => {
    const agent = request.agent(createApp());
    const token = await enter(agent);
    const url = '/api/public/attendance/lessons/455/attendance';
    const mark = { studentId: 328, status: 'present', expectedRevision: null };
    expect((await agent.patch(url).send(mark)).status).toBe(403);
    expect((await agent.patch(url).set('X-Attendance-CSRF', 'wrong').send(mark)).status).toBe(403);
    expect((await agent.patch(url).set('X-Attendance-CSRF', token).send({ ...mark, status: null })).status).toBe(400);
    expect(service.mark).not.toHaveBeenCalled();
    expect((await agent.patch(url).set('X-Attendance-CSRF', token).send(mark)).status).toBe(200);
    expect(service.mark).toHaveBeenCalledWith(455, [55, 56, 57], { ...mark, clearConfirmed: false });
    expect((await agent.patch(url).set('X-Attendance-CSRF', token).send({ ...mark, status: null, clearConfirmed: true })).status).toBe(200);
  });
  it('marks the rest of a lesson in one write only with a CSRF token and a valid, duplicate-free student list', async () => {
    const agent = request.agent(createApp());
    const token = await enter(agent);
    const url = '/api/public/attendance/lessons/455/attendance/bulk';
    const body = { studentIds: [328, 329], status: 'present' };
    expect((await agent.patch(url).send(body)).status).toBe(403);
    for (const invalid of [
      { ...body, studentIds: [] }, { ...body, studentIds: [328, 328] }, { ...body, studentIds: [0] }, { ...body, studentIds: ['328'] },
      { ...body, studentIds: Array.from({ length: 201 }, (_, index) => index + 1) }, { ...body, status: null }, { ...body, status: 'late' }, { status: 'present' },
    ]) {
      expect((await agent.patch(url).set('X-Attendance-CSRF', token).send(invalid)).status).toBe(400);
    }
    expect((await agent.patch('/api/public/attendance/lessons/0/attendance/bulk').set('X-Attendance-CSRF', token).send(body)).status).toBe(400);
    expect(service.markMany).not.toHaveBeenCalled();
    expect((await agent.patch(url).set('X-Attendance-CSRF', token).send(body)).status).toBe(200);
    expect(service.markMany).toHaveBeenCalledWith(455, [55, 56, 57], body);
    vi.mocked(service.markMany).mockRejectedValueOnce(new PublicAttendanceError('publicAttendanceLessonNotStarted', 409));
    const notStarted = await agent.patch(url).set('X-Attendance-CSRF', token).send(body);
    expect(notStarted.status).toBe(409);
    expect(notStarted.body).toEqual({ error: 'publicAttendanceLessonNotStarted' });
  });
  it('revokes access after expiration, config changes, or closing the temporary page', async () => {
    const agent = request.agent(createApp());
    await enter(agent);
    const current = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(current + 13 * 60 * 60 * 1000);
    expect((await agent.get('/api/public/attendance/groups')).status).toBe(401);
    clock.mockRestore();
    const token = await enter(agent);
    settings = { passwordHash: hash, groupIds: [55] };
    expect((await agent.get('/api/public/attendance/groups')).status).toBe(401);
    settings = null;
    expect((await agent.get('/api/public/attendance/session')).body).toEqual({ available: false, authenticated: false });
    expect((await agent.get('/api/public/attendance/groups')).status).toBe(404);
    settings = { passwordHash: hash, groupIds: [55, 56, 57] };
    expect((await agent.post('/api/public/attendance/exit').set('X-Attendance-CSRF', token)).status).toBe(200);
    expect((await agent.get('/api/public/attendance/groups')).status).toBe(401);
  });
  it('returns membership and revision errors without accepting invalid identifiers', async () => {
    const agent = request.agent(createApp());
    const token = await enter(agent);
    expect((await agent.get('/api/public/attendance/lessons/0')).status).toBe(400);
    vi.mocked(service.loadRoster).mockRejectedValueOnce(new PublicAttendanceError('publicAttendanceNotFound', 404));
    expect((await agent.get('/api/public/attendance/lessons/999')).status).toBe(404);
    expect(service.loadRoster).toHaveBeenCalledWith(999, [55, 56, 57]);
    vi.mocked(service.mark).mockRejectedValueOnce(new PublicAttendanceError('publicAttendanceConflict', 409));
    expect((await agent.patch('/api/public/attendance/lessons/455/attendance').set('X-Attendance-CSRF', token).send({ studentId: 328, status: 'absent', expectedRevision: 'old' })).status).toBe(409);
    expect((await agent.patch('/api/public/attendance/lessons/455/attendance').set('X-Attendance-CSRF', token).send({ studentId: 328, status: 'present' })).status).toBe(400);
  });
  it('checks a salted password hash without accepting malformed hashes', async () => {
    expect(await verifyAttendancePassword(password, hash)).toBe(true);
    expect(await verifyAttendancePassword('wrong', hash)).toBe(false);
    expect(await verifyAttendancePassword(password, 'bad')).toBe(false);
  });
});
