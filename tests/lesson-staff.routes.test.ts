import express from 'express';
import request from 'supertest';
import { beforeEach, expect, it, vi } from 'vitest';
import { registerLessonStaffRoutes } from '../server/modules/academy/lesson-staff.router';
import { LessonStaffError } from '../server/modules/academy/lesson-staff';
import { actorContextFrom } from '../server/modules/leads/domain/actor-context';

vi.mock('../server/modules/academy/academy-core', () => ({ query: vi.fn(), queryOne: vi.fn(), createAudit: vi.fn(), withTransaction: vi.fn() }));
vi.mock('../server/lib/logger', () => ({ logger: { error: vi.fn() } }));
const service = { get: vi.fn(), add: vi.fn(), remove: vi.fn() };
const staff = { teacher: { id: 4, fullName: 'Main teacher' }, assistants: [], teachers: [{ id: 5, fullName: 'Assistant' }] };
const actor = actorContextFrom({ id: 7, modules: ['teacher'] });
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.actor = actor; next(); });
const router = express.Router();
registerLessonStaffRoutes(router, service);
app.use('/api/academy', router);
const base = '/api/academy/lessons/17';
beforeEach(() => { Object.values(service).forEach(mock => mock.mockReset().mockResolvedValue(staff)); });

it('returns private lesson staff and active teacher choices', async () => {
  const response = await request(app).get(`${base}/staff`).expect(200);
  expect(response.body).toEqual(staff);
  expect(response.headers['cache-control']).toBe('private, no-store');
  expect(service.get).toHaveBeenCalledWith(actor, 17);
});
it('validates identifiers and strict assignment bodies before calling the service', async () => {
  await request(app).get('/api/academy/lessons/no/staff').expect(404);
  for (const body of [{ teacherId: 0 }, { teacherId: '5' }, { teacherId: 5, userId: 1 }, {}]) {
    await request(app).post(`${base}/assistants`).send(body).expect(400);
  }
  expect(service.get).not.toHaveBeenCalled();
  expect(service.add).not.toHaveBeenCalled();
});
it('passes targeted add and remove commands with the authenticated actor', async () => {
  await request(app).post(`${base}/assistants`).send({ teacherId: 5 }).expect(200);
  await request(app).delete(`${base}/assistants/5`).expect(200);
  expect(service.add).toHaveBeenCalledWith(actor, 17, 5);
  expect(service.remove).toHaveBeenCalledWith(actor, 17, 5);
});
it('preserves public denial and validation errors while hiding internal failures', async () => {
  service.get.mockRejectedValueOnce(new LessonStaffError('teacherOwnLessonRosterOnly', 403));
  expect((await request(app).get(`${base}/staff`).expect(403)).body).toEqual({ error: 'teacherOwnLessonRosterOnly' });
  service.add.mockRejectedValueOnce(new LessonStaffError('lessonAssistantIsTeacher'));
  expect((await request(app).post(`${base}/assistants`).send({ teacherId: 4 }).expect(400)).body).toEqual({ error: 'lessonAssistantIsTeacher' });
  service.remove.mockRejectedValueOnce(new Error('private database detail'));
  expect((await request(app).delete(`${base}/assistants/5`).expect(500)).body).toEqual({ error: 'lessonStaffSaveFailed' });
});
