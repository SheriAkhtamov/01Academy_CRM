import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn(), updateRow: vi.fn(), insertRow: vi.fn() }));
vi.mock('../server/modules/academy/academy-core', async (original) => ({
  ...await original<typeof import('../server/modules/academy/academy-core')>(), ...mocks,
  transactionContext: { getStore: () => ({}) }, withTransaction: async (callback: () => Promise<unknown>) => callback(),
}));
vi.mock('../server/modules/academy/academy-analytics', () => ({ resolveTeacherId: vi.fn() }));
import { assertRoomScheduleAvailable, assertTeacherCanLeadGroupSchedule, findTeacherForGroupSchedule } from '../server/modules/academy/academy-scheduling';
import { reconcileAutomaticTeacherAssignments } from '../server/modules/academy/academy-route-support';
const group = { id: 10, name: 'Group', courseId: 1, schoolId: 2, roomId: 3, teacherId: 4, status: 'open', startDate: new Date('2030-07-15'), endDate: new Date('2030-07-22'), lessonCount: 2, lessonDurationMinutes: 60, durationDays: 8, maxStudents: 12, schedule: [{ dayOfWeek: 1, startTime: '10:00', endTime: '11:00' }] };
const teacher = { id: 4, status: 'active', courseIds: [1], schoolIds: [2], availability: [{ dayOfWeek: 1, startTime: '08:00', endTime: '18:00', schoolId: 2 }] };
const lesson = { id: 21, groupId: 10, courseId: 1, schoolId: 2, roomId: 3, teacherId: 4, lessonNumber: 1, durationMinutes: 60, scheduledAt: new Date('2030-07-15T05:00:00Z'), status: 'scheduled' };
let lessons: typeof lesson[];
let candidates: typeof teacher[];
beforeEach(() => {
  vi.clearAllMocks(); lessons = [{ ...lesson }]; candidates = [{ ...teacher }];
  mocks.queryOne.mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.includes('FROM academy_groups WHERE id')) return group;
    if (sql.includes('FROM academy_courses')) return { id: 1, isActive: true, lessonCount: 2, lessonDurationMinutes: 60, durationDays: 8 };
    if (sql.includes('FROM academy_rooms room')) return { id: 3, schoolId: 2, isActive: true };
    if (sql.includes('current_students')) return { currentStudents: 1, reservedStudents: 0 };
    if (sql.includes('FROM academy_teachers WHERE id')) return candidates.find((candidate) => candidate.id === params[0]);
    if (sql.includes('FROM academy_lessons') && sql.includes('WHERE teacher_id = $1')) {
      return lessons.find((item) => item.teacherId === params[0] && item.status !== 'cancelled'
        && !(params[4] as number[]).includes(item.id) && item.scheduledAt < (params[2] as Date)
        && new Date(item.scheduledAt.getTime() + item.durationMinutes * 60_000) > (params[1] as Date)) ?? null;
    }
    return null;
  });
  mocks.query.mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.includes('SELECT t.*')) return candidates;
    if (sql.includes('SELECT id') && sql.includes('FROM academy_groups')) return [{ id: 10 }];
    if (sql.includes('FROM academy_lessons')) {
      if (sql.includes('teacher_id = ANY')) return lessons.filter((item) => (params[0] as number[]).includes(item.teacherId)
        && (!sql.includes('group_id <> $4') || item.groupId !== params[3]));
      if (sql.includes('WHERE room_id = $1')) return lessons.filter((item) => item.roomId === params[0]
        && (!sql.includes('group_id <> $4') || item.groupId !== params[3]));
      if (sql.includes('WHERE teacher_id = $1')) return lessons.filter((item) => item.teacherId === params[0]
        && (!sql.includes('group_id <> $4') || item.groupId !== params[3]));
      if (sql.includes('scheduled_at >= NOW()')) return lessons.filter((item) => item.groupId === params[0] && item.status === 'scheduled' && item.scheduledAt > new Date());
      if (sql.includes('SELECT id FROM academy_lessons WHERE group_id')) return lessons.map((item) => ({ id: item.id }));
    }
    return [];
  });
  mocks.updateRow.mockImplementation(async (_table, id, values) => ({ id, ...values }));
});
const scheduleOptions = () => ({ courseId: 1, schoolId: 2, roomId: 3, schedule: group.schedule, startDate: group.startDate, endDate: group.endDate, excludeGroupId: 10 });

describe('group reconciliation ignores own materialized bookings', () => {
  it('keeps the current teacher and accepts own-room lessons', async () => {
    await expect(assertRoomScheduleAvailable(scheduleOptions())).resolves.toBeUndefined();
    await expect(assertTeacherCanLeadGroupSchedule({ ...scheduleOptions(), teacherId: 4 })).resolves.toMatchObject({ id: 4 });
    expect(await findTeacherForGroupSchedule(scheduleOptions())).toMatchObject({ id: 4 });
    expect(await reconcileAutomaticTeacherAssignments(4)).toBe(0);
    expect(mocks.updateRow).not.toHaveBeenCalled();
  });
  it('also keeps the current teacher when an own lesson uses another room', async () => {
    lessons[0].roomId = 30;
    expect(await reconcileAutomaticTeacherAssignments(4)).toBe(0);
    expect(mocks.updateRow).not.toHaveBeenCalled();
  });
  it('still rejects an overlapping lesson of another group', async () => {
    lessons.push({ ...lesson, id: 22, groupId: 20 });
    await expect(assertRoomScheduleAvailable(scheduleOptions())).rejects.toMatchObject({ message: 'roomOccupied' });
    await expect(assertTeacherCanLeadGroupSchedule({ ...scheduleOptions(), teacherId: 4 })).rejects.toMatchObject({ message: 'teacherUnavailableForGroup' });
    expect(await findTeacherForGroupSchedule(scheduleOptions())).toBeNull();
  });
  it('synchronizes future lesson assignments with a replacement and leaves conducted history intact', async () => {
    candidates = [{ ...teacher, id: 5 }];
    lessons.push({ ...lesson, id: 23, status: 'conducted', scheduledAt: new Date('2025-07-15T05:00:00Z') });
    expect(await reconcileAutomaticTeacherAssignments(4)).toBe(1);
    expect(mocks.updateRow).toHaveBeenCalledWith('academy_groups', 10, { teacherId: 5 });
    expect(mocks.updateRow).toHaveBeenCalledWith('academy_lessons', 21, { teacherId: 5 });
    expect(mocks.updateRow.mock.calls.some(([table, id]) => table === 'academy_lessons' && id === 23)).toBe(false);
    const sql = mocks.query.mock.calls.find(([sql]) => sql.includes('scheduled_at >= NOW()'))?.[0];
    expect(sql).toContain("status = 'scheduled'"); expect(sql).toContain('NOT EXISTS (SELECT 1 FROM academy_attendance');
  });
  it('also clears future lesson assignments when no replacement is available', async () => {
    candidates = [];
    expect(await reconcileAutomaticTeacherAssignments(4)).toBe(1);
    expect(mocks.updateRow).toHaveBeenCalledWith('academy_groups', 10, { teacherId: null });
    expect(mocks.updateRow).toHaveBeenCalledWith('academy_lessons', 21, { teacherId: null });
  });
  it('validates actual moved lesson times before changing teacher assignment', async () => {
    candidates = [{ ...teacher, id: 5 }];
    lessons[0].scheduledAt = new Date('2030-07-15T15:00:00Z'); // 20:00 academy, outside availability.
    await expect(reconcileAutomaticTeacherAssignments(4)).rejects.toMatchObject({ message: 'teacherUnavailableForLesson' });
    expect(mocks.updateRow).not.toHaveBeenCalled();
  });
});
