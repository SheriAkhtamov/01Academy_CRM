import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock('../server/modules/academy/academy-core', () => ({
  ACADEMY_TIME_ZONE: 'Asia/Tashkent',
  parseTimeToMinutes: (value: string) => {
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  },
  query: mocks.query,
  queryOne: mocks.queryOne,
  updateRow: vi.fn(),
}));

import { getDemoResourceAvailability } from '../server/modules/academy/demo-resource-availability';

describe('demo resource availability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryOne.mockResolvedValue({ id: 1 });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM academy_teachers')) {
        return [
          { id: 1, fullName: 'Lesson teacher', status: 'active' },
          { id: 2, fullName: 'Demo teacher', status: 'active' },
          { id: 3, fullName: 'Group teacher', status: 'active' },
          { id: 4, fullName: 'Free teacher', status: 'active' },
          { id: 5, fullName: 'Inactive teacher', status: 'inactive' },
        ];
      }
      if (sql.includes('FROM academy_rooms')) {
        return [
          { id: 11, name: 'Lesson room', schoolId: 2, isActive: true },
          { id: 12, name: 'Demo room', schoolId: 2, isActive: true },
          { id: 13, name: 'Group room', schoolId: 2, isActive: true },
          { id: 14, name: 'Free room', schoolId: 2, isActive: true },
          { id: 15, name: 'Small room', schoolId: 2, isActive: true },
        ];
      }
      if (sql.includes('FROM academy_lessons')) return [{ teacherId: 1, roomId: 11 }];
      if (sql.includes('FROM academy_demo_lessons')) return [{ teacherId: 2, roomId: 12 }];
      if (sql.includes('FROM academy_groups')) {
        return [{
          teacherId: 3,
          roomId: 13,
          startDate: new Date('2030-01-01T00:00:00.000Z'),
          endDate: new Date('2030-12-31T00:00:00.000Z'),
          schedule: [{ dayOfWeek: 1, startTime: '10:00', endTime: '11:00' }],
        }];
      }
      return [];
    });
  });

  it('disables teachers and rooms occupied by lessons, demos or recurring groups, whatever their size', async () => {
    const result = await getDemoResourceAvailability({
      courseId: 1,
      schoolId: 2,
      scheduledAt: '2030-07-15T10:00:00+05:00',
      durationMinutes: 60,
      format: 'offline',
      participantIds: [101, 102],
    });

    expect(result.teachers.map(({ id, available, reason }) => ({ id, available, reason }))).toEqual([
      { id: 1, available: false, reason: 'busy' },
      { id: 2, available: false, reason: 'busy' },
      { id: 3, available: false, reason: 'busy' },
      { id: 4, available: true, reason: null },
      { id: 5, available: false, reason: 'inactive' },
    ]);
    expect(result.rooms.map(({ id, available, reason }) => ({ id, available, reason }))).toEqual([
      { id: 11, available: false, reason: 'busy' },
      { id: 12, available: false, reason: 'busy' },
      { id: 13, available: false, reason: 'busy' },
      { id: 14, available: true, reason: null },
      { id: 15, available: true, reason: null },
    ]);
  });
});
