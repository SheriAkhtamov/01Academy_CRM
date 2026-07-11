import { describe, expect, it } from 'vitest';
import { sortAttendanceLessons } from '../client/src/lib/attendance';

describe('attendance lesson ordering', () => {
  it('shows unfinished past lessons before completed history and future lessons', () => {
    const lessons = sortAttendanceLessons([
      { id: 1, status: 'scheduled', scheduledAt: '2026-08-01T05:00:00.000Z' },
      { id: 2, status: 'conducted', scheduledAt: '2026-07-10T15:00:00.000Z' },
      { id: 3, status: 'scheduled', scheduledAt: '2026-07-08T15:00:00.000Z' },
      { id: 4, status: 'scheduled', scheduledAt: '2026-07-11T07:00:00.000Z' },
      { id: 5, status: 'cancelled', scheduledAt: '2026-07-09T15:00:00.000Z' },
      { id: 6, status: 'scheduled', scheduledAt: '2026-07-13T05:00:00.000Z' },
    ], new Date('2026-07-12T00:00:00.000Z').getTime());

    expect(lessons.map((lesson) => lesson.id)).toEqual([4, 3, 2, 6, 1]);
  });
});
