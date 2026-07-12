import { describe, expect, it } from 'vitest';
import { buildTeacherScheduleDays } from '../client/src/lib/teacherSchedule';

describe('teacher schedule window', () => {
  it('starts with the current academy day and excludes past days', () => {
    const days = buildTeacherScheduleDays(
      new Date('2026-07-12T16:00:00.000Z'),
      'Asia/Tashkent',
    );

    expect(days.map((day) => day.dateKey)).toEqual([
      '2026-07-12',
      '2026-07-13',
      '2026-07-14',
      '2026-07-15',
      '2026-07-16',
      '2026-07-17',
      '2026-07-18',
    ]);
    expect(days[0].weekdayIndex).toBe(6);
    expect(days[1].weekdayIndex).toBe(0);
  });

  it('advances to the next academy day when UTC is still on the prior day', () => {
    const days = buildTeacherScheduleDays(
      new Date('2026-07-12T21:30:00.000Z'),
      'Asia/Tashkent',
    );

    expect(days[0].dateKey).toBe('2026-07-13');
  });
});
