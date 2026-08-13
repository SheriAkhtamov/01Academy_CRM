import { describe, expect, it } from 'vitest';
import {
  buildSalesScheduleRangeEvents,
  groupSalesScheduleEventsByDate,
  searchSalesScheduleFilterTree,
  type SalesScheduleGroup,
} from '../client/src/lib/salesSchedule';
import { assignCalendarLanes } from '../client/src/lib/calendarLanes';
import {
  buildCalendarTimeScale,
  getCalendarMinuteAtPosition,
  getCalendarMinutePosition,
} from '../client/src/lib/calendarTimeScale';

const groups: SalesScheduleGroup[] = [
  {
    id: 1,
    name: 'AI Kids — Morning',
    schoolId: 1,
    schoolName: 'Cyberpark',
    courseId: 1,
    courseName: 'AI Kids',
    teacherId: 10,
    teacherName: 'Anna Karimova',
    status: 'in_progress',
    schedule: [{ dayOfWeek: 1, startTime: '10:00', endTime: '11:00' }],
  },
  {
    id: 2,
    name: 'Vibe Coding — Evening',
    schoolId: 1,
    schoolName: 'Cyberpark',
    courseId: 2,
    courseName: 'Vibe Coding',
    teacherId: 11,
    teacherName: 'Boris Saidov',
    status: 'in_progress',
    schedule: [{ dayOfWeek: 4, startTime: '18:00', endTime: '19:00' }],
  },
];

describe('sales schedule range events', () => {
  it('expands a single day without leaking the rest of the week', () => {
    // Monday 2026-06-15 — only the Monday group may appear.
    const events = buildSalesScheduleRangeEvents({
      groups,
      lessons: [],
      demos: [],
      rangeStart: new Date(2026, 5, 15),
      dayCount: 1,
    });

    expect(events.map((event) => event.groupName)).toEqual(['AI Kids — Morning']);
    expect(events[0].dayIndex).toBe(0);
  });

  it('numbers days relative to the range, not to Monday', () => {
    // A range that starts mid-week must still place Thursday correctly.
    const events = buildSalesScheduleRangeEvents({
      groups,
      lessons: [],
      demos: [],
      rangeStart: new Date(2026, 5, 17),
      dayCount: 3,
    });

    expect(events).toHaveLength(1);
    expect(events[0].groupName).toBe('Vibe Coding — Evening');
    expect(events[0].dayIndex).toBe(1);
  });

  it('covers a six week month grid in one pass', () => {
    const events = buildSalesScheduleRangeEvents({
      groups,
      lessons: [],
      demos: [],
      rangeStart: new Date(2026, 4, 25),
      dayCount: 42,
    });

    expect(events).toHaveLength(12);
    expect(new Set(events.map((event) => event.groupId))).toEqual(new Set([1, 2]));
  });

  it('drops recurring lessons replaced by a real lesson that week', () => {
    const events = buildSalesScheduleRangeEvents({
      groups,
      lessons: [{
        id: 500,
        groupId: 1,
        groupName: 'AI Kids — Morning',
        scheduledAt: new Date(2026, 5, 15, 12, 0).toISOString(),
        durationMinutes: 90,
      }],
      demos: [],
      rangeStart: new Date(2026, 5, 15),
      dayCount: 7,
    });

    const monday = events.filter((event) => event.groupId === 1);
    expect(monday).toHaveLength(1);
    expect(monday[0].source).toBe('lesson');
    expect(monday[0].startMinutes).toBe(12 * 60);
  });

  it('groups events by their own calendar date', () => {
    const events = buildSalesScheduleRangeEvents({
      groups,
      lessons: [],
      demos: [],
      rangeStart: new Date(2026, 5, 15),
      dayCount: 7,
    });

    expect([...groupSalesScheduleEventsByDate(events).keys()].sort())
      .toEqual(['2026-06-15', '2026-06-18']);
  });
});

describe('schedule filter search', () => {
  const tree = [
    {
      key: 'school-1',
      id: 1,
      name: 'Cyberpark',
      courses: [
        { key: 'course-1', id: 1, name: 'AI Kids', groups: [groups[0]] },
        { key: 'course-2', id: 2, name: 'Vibe Coding', groups: [groups[1]] },
      ],
    },
  ];

  it('keeps the branch that leads to a matching group', () => {
    const result = searchSalesScheduleFilterTree(tree, 'evening');
    expect(result).toHaveLength(1);
    expect(result[0].courses.map((course) => course.name)).toEqual(['Vibe Coding']);
  });

  it('matches teachers so a manager can find who teaches what', () => {
    const result = searchSalesScheduleFilterTree(tree, 'karimova');
    expect(result[0].courses[0].groups.map((group) => group.name)).toEqual(['AI Kids — Morning']);
  });

  it('returns the whole tree for an empty query', () => {
    expect(searchSalesScheduleFilterTree(tree, '   ')).toBe(tree);
  });
});

describe('calendar lanes', () => {
  it('places overlapping events side by side and leaves separate ones full width', () => {
    const lanes = assignCalendarLanes([
      { id: 'a', startMinutes: 600, endMinutes: 720 },
      { id: 'b', startMinutes: 660, endMinutes: 780 },
      { id: 'c', startMinutes: 900, endMinutes: 960 },
    ]);

    const byId = new Map(lanes.map((item) => [item.id, item]));
    expect(byId.get('a')?.lane).toBe(0);
    expect(byId.get('b')?.lane).toBe(1);
    expect(byId.get('a')?.laneCount).toBe(2);
    expect(byId.get('c')?.laneCount).toBe(1);
  });
});

describe('calendar time scale position round trip', () => {
  const scale = buildCalendarTimeScale(
    [
      { startMinutes: 600, endMinutes: 660 },
      { startMinutes: 1080, endMinutes: 1140 },
    ],
    { hourSize: 60 },
  );

  it('maps a pixel offset back to the minute it points at', () => {
    const offset = getCalendarMinutePosition(scale, 630);
    expect(getCalendarMinuteAtPosition(scale, offset)).toBe(630);
  });

  it('snaps to the requested step so a click books a round time', () => {
    const offset = getCalendarMinutePosition(scale, 637);
    expect(getCalendarMinuteAtPosition(scale, offset, 30)).toBe(630);
  });
});
