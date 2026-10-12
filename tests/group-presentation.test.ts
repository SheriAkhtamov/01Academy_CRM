import { describe, expect, it } from 'vitest';
import {
  countFacet,
  countScope,
  daysBetween,
  formatDayRuns,
  formatGroupPeriod,
  groupNameParts,
  groupScheduleSlots,
  groupSeats,
  groupTimeline,
  summarizeSchedule,
} from '../client/src/features/groups/presentation';
import { findTeacherConflict, findRoomClashes } from '../client/src/features/groups/editorInsights';
import { filterGroups } from '../client/src/features/groups/filters';
import type { Group, GroupTeacher } from '../client/src/features/groups/types';

const SHORT_DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const makeGroup = (overrides: Partial<Group> = {}): Group => ({
  id: 1, name: 'Python morning', courseId: 1, schoolId: 1, roomId: 1, teacherId: 2,
  schedule: [{ dayOfWeek: 1, startTime: '18:00', endTime: '20:00' }],
  lessonCount: 10, lessonDurationMinutes: 120, durationDays: 70, maxStudents: 12,
  currentStudents: 6, reservedStudents: 2, status: 'open', isArchived: false,
  startDate: '2026-10-12', endDate: '2026-12-14',
  ...overrides,
});

describe('group seats', () => {
  it('counts reservations as taken and grades what is left', () => {
    expect(groupSeats(makeGroup())).toMatchObject({ current: 6, reserved: 2, occupied: 8, free: 4, tone: 'available' });
    expect(groupSeats(makeGroup({ currentStudents: 9, reservedStudents: 1 })).tone).toBe('few');
    expect(groupSeats(makeGroup({ currentStudents: 10, reservedStudents: 2 }))).toMatchObject({ free: 0, tone: 'full' });
  });

  it('does not call a single free individual seat "almost full"', () => {
    expect(groupSeats(makeGroup({ maxStudents: 1, currentStudents: 0, reservedStudents: 0 })).tone).toBe('available');
  });

  it('treats frozen, completed and archived groups as not selling', () => {
    expect(groupSeats(makeGroup({ status: 'frozen' })).tone).toBe('closed');
    expect(groupSeats(makeGroup({ status: 'completed' })).sellable).toBe(false);
    expect(groupSeats(makeGroup({ isArchived: true })).tone).toBe('closed');
  });
});

describe('group names', () => {
  it('leads with the addition and keeps the generated code underneath', () => {
    expect(groupNameParts('CYP-PY-GRP-26-0043 — Morning')).toEqual({
      title: 'Morning', code: 'CYP-PY-GRP-26-0043', shortLabel: 'Morning',
    });
  });

  it('shows a bare code as the title and shortens its schedule conflict label', () => {
    expect(groupNameParts('ONL-VC-IND-26-0007')).toEqual({ title: 'ONL-VC-IND-26-0007', code: null, shortLabel: 'VC-0007' });
  });

  it('leaves names from before the codes untouched', () => {
    expect(groupNameParts('AI Kids — Амина (10:00)')).toEqual({
      title: 'AI Kids — Амина (10:00)', code: null, shortLabel: 'AI Kids — Амина (10:00)',
    });
  });
});

describe('schedule summary', () => {
  it('merges days that share a time and collapses runs into ranges', () => {
    const slots = groupScheduleSlots(makeGroup({ schedule: [
      { dayOfWeek: 5, startTime: '18:00', endTime: '20:00' },
      { dayOfWeek: 1, startTime: '18:00', endTime: '20:00' },
      { dayOfWeek: 3, startTime: '18:00', endTime: '20:00' },
      { dayOfWeek: 6, startTime: '10:00', endTime: '13:00' },
    ] }));
    expect(summarizeSchedule(slots, SHORT_DAYS)).toEqual([
      { days: 'Пн, Ср, Пт', time: '18:00–20:00' },
      { days: 'Сб', time: '10:00–13:00' },
    ]);
    expect(formatDayRuns([1, 2, 3, 4, 5], SHORT_DAYS)).toBe('Пн–Пт');
    expect(formatDayRuns([6, 7], SHORT_DAYS)).toBe('Сб, Вс');
  });

  it('fills a missing end time from the lesson length', () => {
    expect(groupScheduleSlots(makeGroup({ schedule: [{ dayOfWeek: 2, startTime: '09:00' } as never] })))
      .toEqual([{ dayOfWeek: 2, startMinutes: 540, endMinutes: 660 }]);
  });
});

describe('group timeline', () => {
  it('counts calendar days to the start in academy dates', () => {
    expect(daysBetween('2026-10-07', '2026-10-12')).toBe(5);
    expect(groupTimeline(makeGroup(), '2026-10-15').daysToStart).toBe(-3);
    expect(groupTimeline(makeGroup({ startDate: null }), '2026-10-15').daysToStart).toBeNull();
  });

  it('adds the year to the period only when it is not the current one', () => {
    expect(formatGroupPeriod(groupTimeline(makeGroup(), '2026-10-01'), 'en', '2026-10-01')).toBe('Oct 12 – Dec 14');
    expect(formatGroupPeriod(groupTimeline(makeGroup({ endDate: '2027-02-01' }), '2026-10-01'), 'en', '2026-10-01'))
      .toBe('Oct 12, 2026 – Feb 1, 2027');
  });
});

describe('filter counts', () => {
  const groups = [
    makeGroup({ id: 1, courseId: 1 }),
    makeGroup({ id: 2, courseId: 2, currentStudents: 12, reservedStudents: 0 }),
    makeGroup({ id: 3, courseId: 1, teacherId: null }),
    makeGroup({ id: 4, courseId: 1, isArchived: true }),
  ];

  it('counts an option against every other active filter but not its own', () => {
    const params = new URLSearchParams('course=2&teacher=unassigned');
    const course = countFacet(groups, params, 'course');
    expect(course.counts.get('1')).toBe(1);
    expect(course.counts.get('2')).toBeUndefined();
    expect(countFacet(groups, new URLSearchParams('course=1'), 'teacher').counts.get('unassigned')).toBe(1);
  });

  it.each(['available', 'full', 'invalid'])('ignores obsolete seats=%s without hiding full, frozen or completed groups', (seats) => {
    const withClosedGroups = [
      ...groups,
      makeGroup({ id: 5, status: 'frozen' }),
      makeGroup({ id: 6, status: 'completed' }),
    ];
    const params = new URLSearchParams(`view=week&seats=${seats}`);
    expect(filterGroups(withClosedGroups, params).map((group) => group.id)).toEqual([1, 2, 3, 5, 6]);
    expect(countScope(withClosedGroups, params, false)).toBe(5);
    expect(countFacet(withClosedGroups, params, 'course').counts.get('2')).toBe(1);
  });

  it('counts the other half of the list with the same filters', () => {
    const params = new URLSearchParams('course=1');
    expect(countScope(groups, params, false)).toBe(2);
    expect(countScope(groups, params, true)).toBe(1);
    expect(countScope(groups, new URLSearchParams('filter=without-teacher'), false)).toBe(1);
  });
});

describe('editor insights', () => {
  const plan = {
    schedule: [{ dayOfWeek: 1, startTime: '19:00', endTime: '21:00' }],
    startDate: '2026-11-02', endDate: '2027-01-11', editingGroupId: null,
  };

  it('finds the groups that already hold the room at those hours', () => {
    const groups = [
      makeGroup({ id: 1 }),
      makeGroup({ id: 2, roomId: 2 }),
      makeGroup({ id: 3, status: 'frozen' }),
      makeGroup({ id: 4, startDate: '2027-02-01', endDate: '2027-04-01' }),
    ];
    expect(findRoomClashes(1, plan, groups).map((clash) => clash.group.id)).toEqual([1]);
    expect(findRoomClashes(1, { ...plan, editingGroupId: 1 }, groups)).toEqual([]);
    expect(findRoomClashes(1, { ...plan, schedule: [{ dayOfWeek: 2, startTime: '19:00', endTime: '21:00' }] }, groups)).toEqual([]);
  });

  it('reports only concrete conflicts for the manually chosen teacher', () => {
    const base = { status: 'active', availability: [{ dayOfWeek: 1, startTime: '09:00', endTime: '22:00' }] };
    const teachers: GroupTeacher[] = [
      { ...base, id: 2, fullName: 'Busy', courseIds: [1], schoolIds: [1] },
      { ...base, id: 3, fullName: 'Fits', courseIds: [1], schoolIds: [1] },
      { ...base, id: 4, fullName: 'New course', courseIds: [], schoolIds: [] },
      { ...base, id: 5, fullName: 'Other branch', courseIds: [1], schoolIds: [7] },
      { ...base, id: 6, fullName: 'Mornings', courseIds: [1], schoolIds: [1], availability: [{ dayOfWeek: 1, startTime: '09:00', endTime: '13:00' }] },
    ];
    const input = { ...plan, schoolId: 1 };
    const fits = new Map(teachers.map((teacher) => [teacher.id, findTeacherConflict(teacher, input, [makeGroup()])]));
    expect(fits.get(2)).toMatchObject({ issue: 'busy' });
    expect(fits.get(3)).toEqual({ issue: null, clash: null });
    expect(fits.get(4)).toEqual({ issue: null, clash: null });
    expect(fits.get(5)).toMatchObject({ issue: 'otherBranch' });
    expect(fits.get(6)).toMatchObject({ issue: 'offHours' });
  });
});
