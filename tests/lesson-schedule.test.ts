import { describe, expect, it } from 'vitest';
import { buildRecurringLessonSchedule } from '../server/lib/lesson-schedule';

describe('recurring academy lesson materialization', () => {
  it('turns a Monday/Wednesday/Friday group schedule into dated lessons in Tashkent', () => {
    const lessons = buildRecurringLessonSchedule({
      startDate: { year: 2026, month: 7, day: 8 },
      lessonCount: 5,
      fallbackDurationMinutes: 120,
      timeZone: 'Asia/Tashkent',
      schedule: [
        { dayOfWeek: 1, startTime: '20:00', endTime: '22:00' },
        { dayOfWeek: 3, startTime: '20:00', endTime: '22:00' },
        { dayOfWeek: 5, startTime: '20:00', endTime: '22:00' },
      ],
    });

    expect(lessons.map((lesson) => lesson.scheduledAt.toISOString())).toEqual([
      '2026-07-08T15:00:00.000Z',
      '2026-07-10T15:00:00.000Z',
      '2026-07-13T15:00:00.000Z',
      '2026-07-15T15:00:00.000Z',
      '2026-07-17T15:00:00.000Z',
    ]);
    expect(lessons.map((lesson) => lesson.lessonNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(lessons.every((lesson) => lesson.durationMinutes === 120)).toBe(true);
  });

  it('uses the explicit schedule interval as the lesson duration', () => {
    const [lesson] = buildRecurringLessonSchedule({
      startDate: { year: 2026, month: 7, day: 13 },
      lessonCount: 1,
      fallbackDurationMinutes: 120,
      timeZone: 'Asia/Tashkent',
      schedule: [{ dayOfWeek: 1, startTime: '10:00', endTime: '17:00' }],
    });

    expect(lesson.scheduledAt.toISOString()).toBe('2026-07-13T05:00:00.000Z');
    expect(lesson.durationMinutes).toBe(420);
  });

  it('returns no lessons for an invalid or empty timetable', () => {
    expect(buildRecurringLessonSchedule({
      startDate: { year: 2026, month: 7, day: 1 },
      lessonCount: 10,
      fallbackDurationMinutes: 120,
      timeZone: 'Asia/Tashkent',
      schedule: [],
    })).toEqual([]);
  });
});
