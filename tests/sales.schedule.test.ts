import { describe, expect, it } from 'vitest';
import {
  buildSalesScheduleFilterTree,
  buildSalesScheduleEvents,
  getGroupSelectionState,
  positionOverlappingScheduleEvents,
  type SalesScheduleEvent,
} from '../client/src/lib/salesSchedule';

describe('sales schedule calendar', () => {
  const weekStart = new Date(2026, 5, 15);
  const groups = [{
    id: 1,
    name: 'AI Kids A1',
    courseId: 10,
    courseName: 'AI Kids',
    teacherName: 'Teacher One',
    schoolName: 'Main school',
    schedule: [
      { dayOfWeek: 1, startTime: '10:00', endTime: '11:30' },
      { dayOfWeek: 3, startTime: '15:00', endTime: '16:30' },
    ],
    lessonDurationMinutes: 90,
    status: 'in_progress',
  }];

  it('projects the recurring group timetable into the selected week', () => {
    const events = buildSalesScheduleEvents({
      groups,
      lessons: [],
      weekStart,
    });

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.dayIndex)).toEqual([0, 2]);
    expect(events[0].startMinutes).toBe(600);
    expect(events[0].endMinutes).toBe(690);
  });

  it('uses the real lesson instead of duplicating the recurring slot', () => {
    const events = buildSalesScheduleEvents({
      groups,
      lessons: [{
        id: 7,
        groupId: 1,
        groupName: 'AI Kids A1',
        courseId: 10,
        scheduledAt: '2026-06-15T12:00:00',
        durationMinutes: 90,
        status: 'scheduled',
      }],
      weekStart,
    });

    expect(events).toHaveLength(2);
    expect(events.find((event) => event.dayIndex === 0)?.source).toBe('lesson');
    expect(events.find((event) => event.dayIndex === 0)?.startMinutes).toBe(720);
  });

  it('places overlapping events into separate lanes', () => {
    const event = (id: string, startMinutes: number, endMinutes: number): SalesScheduleEvent => ({
      id,
      source: 'recurring',
      groupId: Number(id),
      groupName: id,
      startsAt: new Date(),
      endsAt: new Date(),
      dayIndex: 0,
      startMinutes,
      endMinutes,
    });

    const positioned = positionOverlappingScheduleEvents([
      event('1', 600, 690),
      event('2', 630, 720),
      event('3', 780, 840),
    ]);

    expect(positioned[0]).toMatchObject({ lane: 0, laneCount: 2 });
    expect(positioned[1]).toMatchObject({ lane: 1, laneCount: 2 });
    expect(positioned[2]).toMatchObject({ lane: 0, laneCount: 1 });
  });

  it('organizes group filters by school and course', () => {
    const tree = buildSalesScheduleFilterTree([
      { id: 1, name: 'A1', schoolId: 5, courseId: 10 },
      { id: 2, name: 'A2', schoolId: 5, courseId: 11 },
      { id: 3, name: 'B1', schoolId: 6, courseId: 10 },
    ], [
      { id: 5, name: 'Chilanzar' },
      { id: 6, name: 'Yunusabad' },
    ], [
      { id: 10, name: 'AI Kids' },
      { id: 11, name: 'Robotics' },
    ]);

    expect(tree).toHaveLength(2);
    expect(tree[0]).toMatchObject({
      name: 'Chilanzar',
      courses: [
        { name: 'AI Kids', groups: [{ id: 1 }] },
        { name: 'Robotics', groups: [{ id: 2 }] },
      ],
    });
    expect(tree[1].courses[0].groups[0].id).toBe(3);
  });

  it('returns an indeterminate state for partially selected branches', () => {
    expect(getGroupSelectionState([1, 2], new Set([1]))).toBe('indeterminate');
    expect(getGroupSelectionState([1, 2], new Set([1, 2]))).toBe(true);
    expect(getGroupSelectionState([1, 2], new Set())).toBe(false);
  });
});
