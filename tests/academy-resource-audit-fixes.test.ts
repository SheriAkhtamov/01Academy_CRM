import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn(), updateRow: vi.fn(), createAudit: vi.fn(), registry: {} as Record<string, { beforeUpdate: (context: any) => Promise<unknown> }> }));
vi.mock('../server/modules/academy/academy-core', async (original) => ({
  ...await original<typeof import('../server/modules/academy/academy-core')>(), ...mocks,
  withTransaction: async (callback: () => Promise<unknown>) => callback(),
}));
vi.mock('../server/modules/academy/crud-router', () => ({ createAcademyCrudRegistrar: () => (path: string, _table: string, _columns: string[], options: any) => { mocks.registry[path] = options; } }));
vi.mock('../server/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
import { registerSchoolArchiveRoutes } from '../server/modules/academy/school-archive.router';
import { registerResourceArchiveRoutes } from '../server/modules/academy/resource-archive.router';
import { registerAcademyResourceRoutes } from '../server/modules/academy/resources.router';
type Demo = { id: number; roomId: number; schoolId: number; courseId: number; status: string; scheduledAt: Date; durationMinutes: number };
let demos: Demo[];
const room = { id: 3, schoolId: 2, isActive: true, isArchived: false };
function app() {
  const application = express(); application.use(express.json());
  application.use((req: any, _res, next) => { req.user = { id: 7, module: 'administration', modules: ['administration'] }; next(); });
  const router = express.Router(); registerSchoolArchiveRoutes(router); registerResourceArchiveRoutes(router); application.use(router); return application;
}
beforeEach(() => {
  vi.clearAllMocks(); demos = [{ id: 99, roomId: 3, schoolId: 2, courseId: 1, status: 'scheduled', scheduledAt: new Date(Date.now() + 3600_000), durationMinutes: 60 }];
  mocks.query.mockResolvedValue([]);
  mocks.updateRow.mockImplementation(async (_table, id, values) => ({ id, ...values }));
  mocks.queryOne.mockImplementation(async (sql: string, params: number[]) => {
    if (sql.includes('AS in_use')) return { inUse: sql.includes('academy_demo_lessons') && demos.some((demo) => demo.roomId === params[0]) };
    if (sql.includes('FROM academy_demo_lessons')) {
      const column = sql.match(/WHERE (room|school|course)_id/)?.[1] as 'room' | 'school' | 'course';
      return demos.find((demo) => demo[`${column}Id`] === params[0] && demo.status === 'scheduled'
        && demo.scheduledAt.getTime() + demo.durationMinutes * 60_000 > Date.now()) ?? null;
    }
    if (sql.includes('FROM academy_groups')) return null;
    if (sql.includes('FROM academy_rooms')) return room;
    if (sql.includes('FROM academy_schools')) return { id: 2, isActive: true, isArchived: false };
    if (sql.includes('FROM academy_courses')) return { id: 1, isActive: true, isArchived: false };
    return null;
  });
  registerAcademyResourceRoutes(express.Router());
});

describe('demo bookings protect resources', () => {
  it.each([['rooms', 3], ['courses', 1], ['schools', 2]])('rejects archiving %s used by a future scheduled demo', async (resource, id) => {
    const response = await request(app()).post(`/${resource}/${id}/archive`);
    expect(response.status).toBe(409); expect(response.body.error).toBe('resourceHasScheduledDemos');
    expect(mocks.updateRow).not.toHaveBeenCalled();
  });
  it.each([['rooms', 3], ['courses', 1], ['schools', 2]])('allows archiving %s after a booking ends or is cancelled', async (resource, id) => {
    demos[0].scheduledAt = new Date(Date.now() - 2 * 3600_000);
    demos.push({ ...demos[0], id: 100, status: 'cancelled', scheduledAt: new Date(Date.now() + 3600_000) });
    const response = await request(app()).post(`/${resource}/${id}/archive`);
    expect(response.status).toBe(200); expect(response.body).toMatchObject({ isArchived: true, isActive: false });
  });
  it('protects a demo currently in progress until its end', async () => {
    demos[0].scheduledAt = new Date(Date.now() - 30 * 60_000);
    expect((await request(app()).post('/rooms/3/archive')).status).toBe(409);
  });
  it.each([['rooms', 3, room], ['schools', 2, { id: 2, isActive: true, isArchived: false }]])('rejects deactivating %s with a scheduled demo', async (resource, id, row) => {
    await expect(mocks.registry[resource].beforeUpdate({ id, row, values: { isActive: false } })).rejects.toMatchObject({ message: 'resourceHasScheduledDemos', statusCode: 409 });
  });
  it.each(['scheduled', 'completed', 'cancelled'])('blocks moving a room with %s demo history to another school', async (status) => {
    demos[0].status = status; demos[0].scheduledAt = new Date('2025-01-01');
    await expect(mocks.registry.rooms.beforeUpdate({ id: 3, row: room, values: { schoolId: 4 } })).rejects.toMatchObject({ message: 'roomSchoolCannotChangeWhileInUse', statusCode: 409 });
  });
  it('allows moving a never-booked room', async () => {
    demos = [];
    await expect(mocks.registry.rooms.beforeUpdate({ id: 3, row: room, values: { schoolId: 4 } })).resolves.toBeUndefined();
  });
});
