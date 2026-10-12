import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn(), updateRow: vi.fn(), insertRow: vi.fn() }));
vi.mock('../server/modules/academy/academy-core', async (original) => ({
  ...await original<typeof import('../server/modules/academy/academy-core')>(), ...mocks,
  transactionContext: { getStore: () => ({}) }, withTransaction: async (callback: () => Promise<unknown>) => callback(),
}));
vi.mock('../server/modules/academy/academy-analytics', () => ({ resolveTeacherId: vi.fn() }));
import { assertRoomScheduleAvailable, assertTeacherCanLeadGroupSchedule } from '../server/modules/academy/academy-scheduling';
import { assertLessonHistoryUpdateAllowed, prepareGroupMutation, prepareLessonMutation } from '../server/modules/academy/academy-route-support';
const group = { id: 10, name: 'Group', courseId: 1, schoolId: 2, roomId: 3, teacherId: 4, status: 'open', startDate: new Date('2030-07-15'), endDate: new Date('2030-07-22'), lessonCount: 2, lessonDurationMinutes: 60, durationDays: 8, maxStudents: 12, schedule: [{ dayOfWeek: 1, startTime: '10:00', endTime: '11:00' }] };
const teacher = { id: 4, status: 'active', courseIds: [1], schoolIds: [2], availability: [{ dayOfWeek: 1, startTime: '08:00', endTime: '18:00', schoolId: 2 }] };
const lesson = { id: 21, groupId: 10, courseId: 1, schoolId: 2, roomId: 3, teacherId: 4, lessonNumber: 1, durationMinutes: 60, scheduledAt: new Date('2030-07-15T05:00:00Z'), status: 'scheduled' };
let lessons: typeof lesson[];
let candidates: typeof teacher[];
let currentGroup: Record<string, unknown>;
beforeEach(() => {
  vi.clearAllMocks(); lessons = [{ ...lesson }]; candidates = [{ ...teacher }]; currentGroup = { ...group };
  mocks.queryOne.mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.includes('FROM academy_groups WHERE id')) return currentGroup;
    if (sql.includes('FROM academy_courses')) return { id: 1, isActive: true, lessonCount: 2, lessonDurationMinutes: 60, durationDays: 8 };
    if (sql.includes('FROM academy_rooms room')) return { id: 3, schoolId: 2, isActive: true };
    if (sql.includes('current_students')) return { currentStudents: 1, reservedStudents: 0 };
    if (sql.includes('FROM academy_teachers WHERE id')) return candidates.find((candidate) => candidate.id === params[0]);
    if (sql.includes('FROM academy_teachers t') && sql.includes('employee.is_archived = false')) {
      return candidates.find((candidate) => candidate.id === params[0]);
    }
    if (sql.includes('FROM academy_lessons') && sql.includes('WHERE teacher_id = $1')) {
      return lessons.find((item) => item.teacherId === params[0] && item.status !== 'cancelled'
        && !(params[4] as number[]).includes(item.id) && item.id !== params[3] && item.scheduledAt < (params[2] as Date)
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

describe('manual group assignment ignores own materialized bookings', () => {
  it('keeps the selected teacher and accepts own-room lessons', async () => {
    await expect(assertRoomScheduleAvailable(scheduleOptions())).resolves.toBeUndefined();
    await expect(assertTeacherCanLeadGroupSchedule({ ...scheduleOptions(), teacherId: 4 })).resolves.toMatchObject({ id: 4 });
    expect(mocks.updateRow).not.toHaveBeenCalled();
  });

  it('keeps the selected teacher when an own lesson uses another room', async () => {
    lessons[0].roomId = 30;
    await expect(assertTeacherCanLeadGroupSchedule({ ...scheduleOptions(), teacherId: 4 })).resolves.toMatchObject({ id: 4 });
    expect(mocks.updateRow).not.toHaveBeenCalled();
  });

  it('still rejects an overlapping lesson of another group', async () => {
    lessons.push({ ...lesson, id: 22, groupId: 20 });
    await expect(assertRoomScheduleAvailable(scheduleOptions())).rejects.toMatchObject({ message: 'roomOccupied' });
    await expect(assertTeacherCanLeadGroupSchedule({ ...scheduleOptions(), teacherId: 4 })).rejects.toMatchObject({ message: 'teacherUnavailableForGroup' });
  });

  it.each(['open', 'in_progress', 'frozen', 'completed'])('requires a manual teacher for a new %s group', async (status) => {
    await expect(prepareGroupMutation({ values: { courseId: 1, schoolId: 2, roomId: 3, status, teacherId: null } })).rejects.toMatchObject({ message: 'teacherRequired', statusCode: 400 });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.updateRow).not.toHaveBeenCalled();
  });

  it('rejects explicit missing assignment instead of retaining the previous teacher', async () => {
    await expect(prepareGroupMutation({ values: { teacherId: null }, oldRow: group, excludeGroupId: 10 })).rejects.toMatchObject({ message: 'teacherRequired', statusCode: 400 });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('requires a teacher before changing the schedule of an unassigned legacy group', async () => {
    await expect(prepareGroupMutation({
      values: { schedule: [{ dayOfWeek: 1, startTime: '11:00', endTime: '12:00' }] },
      oldRow: { ...group, teacherId: null }, excludeGroupId: 10,
    })).rejects.toMatchObject({ message: 'teacherRequired', statusCode: 400 });
    expect(mocks.updateRow).not.toHaveBeenCalled();
  });
});

const lessonValues = () => ({ groupId: 10, lessonNumber: 2, scheduledAt: new Date('2030-07-22T05:00:00Z'), durationMinutes: 60 });

describe('manual and inherited lesson assignment', () => {
  it('inherits only the teacher explicitly assigned to its group for a new lesson', async () => {
    const values: Record<string, unknown> = lessonValues();
    await expect(prepareLessonMutation({ values })).resolves.toBeUndefined();
    expect(values.teacherId).toBe(4);
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes('SELECT t.*'))).toBe(false);
  });

  it('honors an explicit manual teacher instead of choosing the group teacher', async () => {
    candidates.push({ ...teacher, id: 5 });
    const values = { ...lessonValues(), teacherId: 5 };
    await expect(prepareLessonMutation({ values })).resolves.toBeUndefined();
    expect(values.teacherId).toBe(5);
    expect(mocks.queryOne).toHaveBeenCalledWith(expect.stringContaining('FROM academy_teachers WHERE id'), [5]);
  });

  it.each([null, ''])('rejects explicit missing teacher %j instead of inheriting a group assignment', async (teacherId) => {
    await expect(prepareLessonMutation({ values: { ...lessonValues(), teacherId } })).rejects.toMatchObject({ message: 'teacherRequired', statusCode: 400 });
    expect(mocks.queryOne.mock.calls.some(([sql]) => sql.includes('FROM academy_teachers'))).toBe(false);
  });

  it.each(['scheduled', 'cancelled'])('requires a teacher on a new %s lesson in an unassigned group', async (status) => {
    currentGroup.teacherId = null;
    await expect(prepareLessonMutation({ values: { ...lessonValues(), status } })).rejects.toMatchObject({ message: 'teacherRequired', statusCode: 400 });
    expect(mocks.updateRow).not.toHaveBeenCalled();
  });

  it('keeps an existing null teacher when only lesson metadata changes', async () => {
    const values: Record<string, unknown> = { topic: 'Updated topic' };
    await expect(prepareLessonMutation({ values, oldRow: { ...lesson, teacherId: null }, excludeLessonId: 21 })).resolves.toBeUndefined();
    expect(values.teacherId).toBeNull();
    expect(mocks.queryOne.mock.calls.some(([sql]) => sql.includes('FROM academy_teachers'))).toBe(false);
  });

  it('allows cancellation of an existing unassigned legacy lesson without finding a teacher', async () => {
    const values: Record<string, unknown> = { status: 'cancelled' };
    await expect(prepareLessonMutation({ values, oldRow: { ...lesson, teacherId: null }, excludeLessonId: 21 })).resolves.toBeUndefined();
    expect(values.teacherId).toBeNull();
    expect(mocks.queryOne.mock.calls.some(([sql]) => sql.includes('FROM academy_teachers'))).toBe(false);
  });

  it('requires assignment when moving a legacy lesson whose group has no teacher', async () => {
    currentGroup.teacherId = null;
    await expect(prepareLessonMutation({
      values: { scheduledAt: new Date('2030-07-22T05:00:00Z') }, oldRow: { ...lesson, teacherId: null }, excludeLessonId: 21,
    })).rejects.toMatchObject({ message: 'teacherRequired', statusCode: 400 });
  });

  it('validates the actual manual lesson time against teacher availability', async () => {
    await expect(prepareLessonMutation({
      values: { ...lessonValues(), teacherId: 4, scheduledAt: new Date('2030-07-22T15:00:00Z') },
    })).rejects.toMatchObject({ message: 'teacherUnavailableForLesson', statusCode: 409 });
    expect(mocks.updateRow).not.toHaveBeenCalled();
  });

  it('keeps conducted teacher history locked during explicit reassignment', async () => {
    await expect(assertLessonHistoryUpdateAllowed(21, { teacherId: 5 }, { ...lesson, status: 'conducted' })).rejects.toMatchObject({ message: 'lessonHistoryLocked', statusCode: 409 });
  });
});
