import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn(), updateRow: vi.fn(), insertRow: vi.fn(), createAudit: vi.fn(), validateEnrollmentGroup: vi.fn(), recalculateStudentMetrics: vi.fn(), getLead: vi.fn() }));
vi.mock('../server/modules/academy/academy-core', async (original) => ({
  ...await original<typeof import('../server/modules/academy/academy-core')>(),
  ...mocks, withTransaction: async (callback: () => Promise<unknown>) => callback(),
}));
vi.mock('../server/modules/academy/academy-leads', () => ({ ...mocks }));
vi.mock('../server/modules/academy/academy-analytics', () => ({ resolveTeacherId: vi.fn().mockResolvedValue(4) }));
vi.mock('../server/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
import { registerAcademyLearningRoutes } from '../server/modules/academy/learning.router';
import { createAcademyCrudRegistrar } from '../server/modules/academy/crud-router';
import { assertLessonHistoryUpdateAllowed } from '../server/modules/academy/academy-route-support';

let student: Record<string, unknown>;
let attendance = false;
let memberships: number[];
const lesson = { id: 21, groupId: 10, courseId: 1, schoolId: 2, roomId: 3, teacherId: 4, lessonNumber: 1, status: 'conducted', scheduledAt: '2030-07-15T05:00:00Z', durationMinutes: 60 };
function app(module = 'administration') {
  const application = express(); application.use(express.json());
  application.use((req: any, _res, next) => { req.user = { id: 7, module, modules: [module], role: 'user' }; next(); });
  const router = express.Router(); registerAcademyLearningRoutes(router);
  createAcademyCrudRegistrar(router)('lessons', 'academy_lessons', ['groupId', 'scheduledAt', 'roomId', 'teacherId', 'lessonNumber', 'topic', 'durationMinutes'], { requireOperations: true });
  application.use(router); return application;
}
beforeEach(() => {
  vi.clearAllMocks(); attendance = false; memberships = [20, 10];
  student = { id: 321, managerId: 7, status: 'paused', groupId: 10, leadId: 42 };
  mocks.query.mockImplementation(async (sql: string) => sql.includes('FROM academy_student_group_enrollments') ? memberships.map((groupId) => ({ groupId })) : []);
  mocks.queryOne.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM academy_students')) return student;
    if (sql.includes('FROM academy_leads')) return { id: 42, managerId: 7, statusCode: 'new' };
    if (sql.includes('FROM academy_attendance')) return attendance ? { id: 1 } : null;
    if (sql.includes('FROM "academy_lessons"') || sql.includes('FROM academy_lessons WHERE id')) return lesson;
    if (sql.includes('FROM academy_groups WHERE id')) return { id: 10 };
    return null;
  });
  mocks.getLead.mockResolvedValue({ id: 42, managerId: 7, statusCode: 'new' });
  mocks.updateRow.mockImplementation(async (_table, id, values) => ({ ...student, id, ...values }));
  mocks.validateEnrollmentGroup.mockImplementation(async (id: number) => ({ id }));
});

describe('student status ownership and all memberships', () => {
  it('rejects resume when a secondary active group is full before writing status', async () => {
    mocks.validateEnrollmentGroup.mockImplementation(async (id: number) => { if (id === 20) throw Object.assign(new Error('groupIsFull'), { statusCode: 409 }); return { id }; });
    const response = await request(app()).patch('/students/321/status').send({ status: 'studying' });
    expect(response.status).toBe(409); expect(response.body.error).toBe('groupIsFull');
    expect(mocks.validateEnrollmentGroup.mock.calls).toEqual([[10, null, 321], [20, null, 321]]);
    expect(mocks.updateRow).not.toHaveBeenCalled();
  });
  it.each(['groupNotOpen', 'groupHasInactiveResources'])('rejects invalid secondary membership: %s', async (error) => {
    mocks.validateEnrollmentGroup.mockImplementation(async (id: number) => { if (id === 20) throw Object.assign(new Error(error), { statusCode: 409 }); return { id }; });
    expect((await request(app()).patch('/students/321/status').send({ status: 'studying' })).status).toBe(409);
    expect(mocks.updateRow).not.toHaveBeenCalled();
  });
  it('locks and validates all groups once in stable order before restoring studying', async () => {
    memberships = [20, 10, 20];
    const response = await request(app()).patch('/students/321/status').send({ status: 'studying' });
    expect(response.status).toBe(200);
    expect(mocks.validateEnrollmentGroup.mock.calls).toEqual([[10, null, 321], [20, null, 321]]);
    const locks = mocks.queryOne.mock.calls.filter(([sql]) => sql.includes('SELECT id FROM academy_groups')).map(([, params]) => params[0]);
    expect(locks).toEqual([10, 20]);
    expect(mocks.recalculateStudentMetrics).toHaveBeenCalledWith(321);
  });
  it('allows a sales manager to update their own student after lead authorization', async () => {
    const response = await request(app('sales')).patch('/students/321/status').send({ status: 'completed' });
    expect(response.status).toBe(200); expect(response.body.status).toBe('completed');
    expect(mocks.getLead).toHaveBeenCalledWith(42);
  });
  it('rejects another manager student and rejects access withdrawn during the transaction', async () => {
    student.managerId = 8;
    expect((await request(app('sales')).patch('/students/321/status').send({ status: 'completed' })).status).toBe(403);
    student.managerId = 7;
    const original = mocks.queryOne.getMockImplementation()!;
    mocks.queryOne.mockImplementation(async (sql, params) => sql.includes('FROM academy_leads') ? { id: 42, managerId: 8 } : original(sql, params));
    expect((await request(app('sales')).patch('/students/321/status').send({ status: 'completed' })).status).toBe(403);
    expect(mocks.updateRow).not.toHaveBeenCalled();
  });
});

describe('generic lesson history changes', () => {
  it.each([{ scheduledAt: '2030-07-22T05:00:00Z' }, { groupId: 20 }, { roomId: 30 }, { teacherId: 5 }, { lessonNumber: 2 }, { durationMinutes: 120 }])('rejects conducted history mutation through actual CRUD: %j', async (payload) => {
    const response = await request(app()).patch('/lessons/21').send(payload);
    expect(response.status).toBe(409); expect(response.body.error).toBe('lessonHistoryLocked');
    expect(mocks.updateRow).not.toHaveBeenCalled();
  });
  it('also protects attendance-backed scheduled lessons', async () => {
    attendance = true;
    await expect(assertLessonHistoryUpdateAllowed(21, { scheduledAt: '2030-07-22T05:00:00Z' }, { ...lesson, status: 'scheduled' })).rejects.toMatchObject({ message: 'lessonHistoryLocked', statusCode: 409 });
  });
  it('accepts unchanged schedule values and text-only edits', async () => {
    await expect(assertLessonHistoryUpdateAllowed(21, { scheduledAt: new Date(lesson.scheduledAt), teacherId: 4, topic: 'Revised topic' }, lesson)).resolves.toBeUndefined();
  });
});
