import { describe, expect, it } from 'vitest';
import { buildDemoAttendanceLessons, parseDemoAttendanceId, sortAttendanceLessons } from '../client/src/lib/attendance';
import type { DemoLesson } from '../client/src/features/demo-lessons/api';

describe('attendance lesson ordering', () => {
  it('merges demo lessons without colliding with regular ids and includes completed demo history', () => {
    const demo: DemoLesson = {
      id: 10, courseId: 1, courseName: 'Frontend', schoolId: 2, teacherId: 4,
      scheduledAt: '2026-07-08T05:00:00Z', durationMinutes: 60, format: 'online',
      status: 'scheduled', participants: [],
    };
    const demos = buildDemoAttendanceLessons([
      demo,
      { ...demo, id: 11, status: 'completed' },
      { ...demo, id: 12, status: 'cancelled' },
      { ...demo, id: 13, status: 'not_conducted' },
      { ...demo, id: 14, scheduledAt: '2026-08-08T05:00:00Z' },
    ], 'Демо-урок', 'Без курса');
    const merged = sortAttendanceLessons([
      { id: 10, groupName: 'Group', topic: 'Regular', status: 'scheduled', scheduledAt: '2026-07-09T05:00:00Z' },
      ...demos,
    ], new Date('2026-07-12T00:00:00Z').getTime());
    expect(merged.map((lesson) => lesson.id)).toEqual(['demo:10', 10, 'demo:11', 'demo:14']);
    expect(merged[0]).toMatchObject({ topic: 'Frontend', groupName: 'Демо-урок' });
    expect(merged[2].status).toBe('conducted');
  });

  it('parses only valid namespaced demo ids', () => {
    expect(parseDemoAttendanceId('demo:10')).toBe(10);
    for (const id of [null, '', '10', 'demo:0', 'demo:-1', 'demo:1.5', 'demo:01', 'demo:9007199254740992']) {
      expect(parseDemoAttendanceId(id)).toBeNull();
    }
  });

  it('shows unfinished past lessons before completed history and future lessons', () => {
    const lessons = sortAttendanceLessons([
      { id: 1, status: 'scheduled', scheduledAt: '2026-08-01T05:00:00.000Z' },
      { id: 2, status: 'conducted', scheduledAt: '2026-07-10T15:00:00.000Z' },
      { id: 3, status: 'scheduled', scheduledAt: '2026-07-08T15:00:00.000Z' },
      { id: 4, status: 'scheduled', scheduledAt: '2026-07-11T07:00:00.000Z' },
      { id: 5, status: 'cancelled', scheduledAt: '2026-07-09T15:00:00.000Z' },
      { id: 6, status: 'scheduled', scheduledAt: '2026-07-13T05:00:00.000Z' },
    ], new Date('2026-07-12T00:00:00.000Z').getTime());

    expect(lessons.map((lesson) => lesson.id)).toEqual([3, 4, 2, 6, 1]);
  });
});
