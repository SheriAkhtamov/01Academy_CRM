import { describe, expect, it } from 'vitest';
import {
  buildCalendarTimeScale,
  getCalendarMinutePosition,
  isCalendarMinuteCollapsed,
} from '../client/src/lib/calendarTimeScale';
import {
  buildSalesDemoScheduleEvents,
  buildSalesScheduleFilterTree,
  buildSalesScheduleEvents,
  buildSalesScheduleTeacherOptions,
  filterSalesScheduleEventsByTeachers,
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
        scheduledAt: '2026-06-15T12:00:00+05:00',
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

  it('collapses long week-wide gaps without shrinking lesson duration', () => {
    const scale = buildCalendarTimeScale([
      { startMinutes: 10 * 60, endMinutes: 11 * 60 },
      { startMinutes: 18 * 60, endMinutes: 19 * 60 },
    ]);

    expect(scale).toMatchObject({
      startMinutes: 9 * 60 + 30,
      endMinutes: 19 * 60 + 30,
      totalSize: 304,
      segments: [
        { kind: 'time', startMinutes: 570, endMinutes: 690, offset: 0, size: 136 },
        { kind: 'collapsed', startMinutes: 690, endMinutes: 1050, offset: 136, size: 32 },
        { kind: 'time', startMinutes: 1050, endMinutes: 1170, offset: 168, size: 136 },
      ],
    });
    expect(scale.markers.map((marker) => marker.minutes)).toEqual([600, 660, 1080, 1140]);
    expect(isCalendarMinuteCollapsed(scale, 14 * 60)).toBe(true);
    expect(
      getCalendarMinutePosition(scale, 11 * 60)
      - getCalendarMinutePosition(scale, 10 * 60),
    ).toBe(68);
  });

  it('keeps nearby lessons on a continuous scale', () => {
    const events = [
      { startMinutes: 10 * 60, endMinutes: 11 * 60 },
      { startMinutes: 13 * 60, endMinutes: 14 * 60 },
    ];
    const compactScale = buildCalendarTimeScale(events);

    expect(compactScale.segments.every((segment) => segment.kind === 'time')).toBe(true);
    expect(compactScale.totalSize).toBe(340);
  });

  it('uses a short canvas for an empty compact calendar', () => {
    const scale = buildCalendarTimeScale([]);

    expect(scale.totalSize).toBe(260);
    expect(scale.markers).toEqual([]);
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

  it('builds one stable teacher option per teacher id across groups and lessons', () => {
    const teachers = buildSalesScheduleTeacherOptions([
      { id: 1, name: 'A1', teacherId: 10, teacherName: 'Teacher One' },
      { id: 2, name: 'A2', teacherId: 10, teacherName: 'Teacher One' },
    ], [{
      id: 7,
      groupId: 1,
      teacherId: 11,
      teacherName: 'Substitute Teacher',
      scheduledAt: '2026-06-15T12:00:00+05:00',
    }], [{
      id: 3,
      teacherId: 12,
      teacherName: 'Demo Teacher',
      scheduledAt: '2026-06-15T09:00:00+05:00',
    }]);

    expect(teachers).toEqual([
      { id: 12, name: 'Demo Teacher' },
      { id: 11, name: 'Substitute Teacher' },
      { id: 10, name: 'Teacher One' },
    ]);
  });

  it('filters by the teacher assigned to each real lesson, including substitutes', () => {
    const events = buildSalesScheduleEvents({
      groups: [{
        ...groups[0],
        teacherId: 10,
      }],
      lessons: [{
        id: 7,
        groupId: 1,
        groupName: 'AI Kids A1',
        teacherId: 11,
        teacherName: 'Substitute Teacher',
        scheduledAt: '2026-06-15T12:00:00+05:00',
        durationMinutes: 90,
        status: 'scheduled',
      }],
      weekStart,
    });

    expect(filterSalesScheduleEventsByTeachers(events, new Set([10])))
      .toHaveLength(1);
    expect(filterSalesScheduleEventsByTeachers(events, new Set([10]))[0].source)
      .toBe('recurring');
    expect(filterSalesScheduleEventsByTeachers(events, new Set([11])))
      .toMatchObject([{ source: 'lesson', teacherId: 11 }]);
    expect(filterSalesScheduleEventsByTeachers(events, new Set([10, 11])))
      .toHaveLength(2);
    expect(filterSalesScheduleEventsByTeachers(events, new Set())).toBe(events);
  });

  it('uses the same teacher filter for demo lessons', () => {
    const demoEvents = buildSalesDemoScheduleEvents([{
      id: 3,
      teacherId: 12,
      teacherName: 'Demo Teacher',
      scheduledAt: '2026-06-15T09:00:00+05:00',
      status: 'scheduled',
    }], weekStart);

    expect(filterSalesScheduleEventsByTeachers(demoEvents, new Set([12])))
      .toMatchObject([{ source: 'demo', teacherId: 12 }]);
    expect(filterSalesScheduleEventsByTeachers(demoEvents, new Set([10])))
      .toEqual([]);
  });
});
