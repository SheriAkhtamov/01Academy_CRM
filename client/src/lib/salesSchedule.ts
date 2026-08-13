import {
  addDays,
  addMinutes,
  differenceInCalendarDays,
  startOfDay,
  startOfWeek,
} from 'date-fns';
import type { AcademyScheduleItem } from '@shared/scheduling';
import { assignCalendarLanes } from '@/lib/calendarLanes';

export interface SalesScheduleGroup {
  id: number;
  name: string;
  courseId?: number | null;
  courseName?: string | null;
  schoolId?: number | null;
  teacherId?: number | null;
  teacherName?: string | null;
  schoolName?: string | null;
  maxStudents?: number | null;
  currentStudents?: number | null;
  reservedStudents?: number | null;
  schedule?: AcademyScheduleItem[] | null;
  lessonDurationMinutes?: number | null;
  status?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

export interface SalesScheduleLesson {
  id: number;
  groupId: number;
  groupName?: string | null;
  courseId?: number | null;
  courseName?: string | null;
  teacherId?: number | null;
  teacherName?: string | null;
  schoolName?: string | null;
  topic?: string | null;
  availableSeats?: number | null;
  maxStudents?: number | null;
  scheduledAt: string;
  durationMinutes?: number | null;
  status?: string | null;
}

export interface SalesScheduleCourse {
  id: number;
  name?: string | null;
}

export interface SalesScheduleSchool {
  id: number;
  name: string;
}

export interface SalesScheduleDemoLesson {
  id: number;
  courseName?: string | null;
  schoolName?: string | null;
  roomName?: string | null;
  teacherId?: number | null;
  teacherName?: string | null;
  scheduledAt: string;
  durationMinutes?: number | null;
  status?: string | null;
  participants?: Array<{ leadId: number }>;
}

export interface SalesScheduleFilterCourse {
  key: string;
  id: number | null;
  name: string | null;
  groups: SalesScheduleGroup[];
}

export interface SalesScheduleFilterSchool {
  key: string;
  id: number | null;
  name: string | null;
  courses: SalesScheduleFilterCourse[];
}

export interface SalesScheduleEvent {
  id: string;
  source: 'lesson' | 'recurring' | 'demo';
  groupId: number;
  groupName: string;
  courseName?: string | null;
  teacherId?: number | null;
  teacherName?: string | null;
  schoolName?: string | null;
  topic?: string | null;
  availableSeats?: number | null;
  maxStudents?: number | null;
  demoLessonId?: number | null;
  roomName?: string | null;
  participantCount?: number | null;
  startsAt: Date;
  endsAt: Date;
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
}

export function buildSalesDemoScheduleEvents(
  demos: SalesScheduleDemoLesson[],
  weekStart: Date,
): SalesScheduleEvent[] {
  const normalizedWeekStart = startOfDay(weekStart);
  const weekEnd = addDays(normalizedWeekStart, 7);
  return demos.flatMap((demo) => {
    if (demo.status === 'cancelled') return [];
    const startsAt = new Date(demo.scheduledAt);
    if (Number.isNaN(startsAt.getTime()) || startsAt < normalizedWeekStart || startsAt >= weekEnd) return [];
    const durationMinutes = Math.max(15, Number(demo.durationMinutes || 60));
    const startMinutes = startsAt.getHours() * 60 + startsAt.getMinutes();
    return [{
      id: `demo-${demo.id}`,
      source: 'demo' as const,
      groupId: 0,
      groupName: 'demoLesson',
      courseName: demo.courseName,
      teacherId: entityId(demo.teacherId),
      teacherName: demo.teacherName,
      schoolName: demo.schoolName,
      roomName: demo.roomName,
      participantCount: demo.participants?.length ?? 0,
      demoLessonId: demo.id,
      startsAt,
      endsAt: addMinutes(startsAt, durationMinutes),
      dayIndex: differenceInCalendarDays(startsAt, normalizedWeekStart),
      startMinutes,
      endMinutes: startMinutes + durationMinutes,
    }];
  });
}

export interface PositionedScheduleEvent extends SalesScheduleEvent {
  lane: number;
  laneCount: number;
}

const localDateKey = (date: Date) => (
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
);

const parseTimeToMinutes = (value: unknown): number | null => {
  const match = String(value ?? '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const isDateInsideGroupRange = (date: Date, group: SalesScheduleGroup) => {
  const value = startOfDay(date).getTime();
  const start = group.startDate ? startOfDay(new Date(group.startDate)).getTime() : Number.NEGATIVE_INFINITY;
  const end = group.endDate ? startOfDay(new Date(group.endDate)).getTime() : Number.POSITIVE_INFINITY;
  return value >= start && value <= end;
};

const toEvent = (
  lesson: SalesScheduleLesson,
  group?: SalesScheduleGroup,
): SalesScheduleEvent | null => {
  const startsAt = new Date(lesson.scheduledAt);
  if (Number.isNaN(startsAt.getTime())) return null;
  const durationMinutes = Math.max(15, Number(lesson.durationMinutes || 60));
  const endsAt = addMinutes(startsAt, durationMinutes);
  const startMinutes = startsAt.getHours() * 60 + startsAt.getMinutes();

  return {
    id: `lesson-${lesson.id}`,
    source: 'lesson',
    groupId: lesson.groupId,
    groupName: lesson.groupName || group?.name || `#${lesson.groupId}`,
    courseName: lesson.courseName || group?.courseName,
    teacherId: entityId(lesson.teacherId) ?? entityId(group?.teacherId),
    teacherName: lesson.teacherName || group?.teacherName,
    schoolName: lesson.schoolName || group?.schoolName,
    availableSeats: group
      ? Math.max(0, Number(group.maxStudents ?? 12) - Number(group.currentStudents ?? 0) - Number(group.reservedStudents ?? 0))
      : null,
    maxStudents: group?.maxStudents ?? null,
    topic: lesson.topic,
    startsAt,
    endsAt,
    dayIndex: 0,
    startMinutes,
    endMinutes: startMinutes + durationMinutes,
  };
};

export function buildSalesScheduleEvents({
  groups,
  lessons,
  weekStart,
}: {
  groups: SalesScheduleGroup[];
  lessons: SalesScheduleLesson[];
  weekStart: Date;
}): SalesScheduleEvent[] {
  const normalizedWeekStart = startOfDay(weekStart);
  const weekEnd = addDays(normalizedWeekStart, 7);
  const groupById = new Map(groups.map((group) => [group.id, group]));

  const actualEvents = lessons.flatMap((lesson) => {
    if (lesson.status === 'cancelled') return [];
    const event = toEvent(lesson, groupById.get(lesson.groupId));
    if (!event || event.startsAt < normalizedWeekStart || event.startsAt >= weekEnd) return [];
    return [{
      ...event,
      dayIndex: differenceInCalendarDays(event.startsAt, normalizedWeekStart),
    }];
  });

  const actualGroupDays = new Set(
    actualEvents.map((event) => `${event.groupId}:${localDateKey(event.startsAt)}`),
  );

  const recurringEvents = groups.flatMap((group) => {
    if (group.status === 'completed') return [];
    const durationMinutes = Math.max(15, Number(group.lessonDurationMinutes || 60));

    return (group.schedule ?? []).flatMap((item, scheduleIndex) => {
      const dayOfWeek = Number(item.dayOfWeek);
      const startMinutes = parseTimeToMinutes(item.startTime ?? item.time);
      if (dayOfWeek < 1 || dayOfWeek > 7 || startMinutes === null) return [];

      const date = addDays(normalizedWeekStart, dayOfWeek - 1);
      if (!isDateInsideGroupRange(date, group)) return [];
      if (actualGroupDays.has(`${group.id}:${localDateKey(date)}`)) return [];

      const parsedEnd = parseTimeToMinutes(item.endTime);
      const endMinutes = parsedEnd && parsedEnd > startMinutes
        ? parsedEnd
        : Math.min(24 * 60, startMinutes + durationMinutes);
      if (endMinutes <= startMinutes) return [];

      const startsAt = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        Math.floor(startMinutes / 60),
        startMinutes % 60,
      );
      const endsAt = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        Math.floor(endMinutes / 60),
        endMinutes % 60,
      );

      return [{
        id: `group-${group.id}-${localDateKey(date)}-${scheduleIndex}`,
        source: 'recurring' as const,
        groupId: group.id,
        groupName: group.name,
        courseName: group.courseName,
        teacherId: entityId(group.teacherId),
        teacherName: group.teacherName,
        schoolName: group.schoolName,
        availableSeats: Math.max(0, Number(group.maxStudents ?? 12) - Number(group.currentStudents ?? 0) - Number(group.reservedStudents ?? 0)),
        maxStudents: group.maxStudents ?? 12,
        startsAt,
        endsAt,
        dayIndex: dayOfWeek - 1,
        startMinutes,
        endMinutes,
      }];
    });
  });

  return [...actualEvents, ...recurringEvents].sort((left, right) => (
    left.startsAt.getTime() - right.startsAt.getTime()
    || left.groupName.localeCompare(right.groupName)
  ));
}

export const salesScheduleDateKey = (event: SalesScheduleEvent) => localDateKey(event.startsAt);

/**
 * Recurring lessons are expanded a week at a time because a weekly timetable is
 * what a group actually has. Day, month and agenda views still need one flat
 * list over an arbitrary span, so the week expansion is repeated and then
 * clipped — `dayIndex` comes back relative to the range, not to Monday.
 */
export function buildSalesScheduleRangeEvents({
  groups,
  lessons,
  demos,
  rangeStart,
  dayCount,
}: {
  groups: SalesScheduleGroup[];
  lessons: SalesScheduleLesson[];
  demos: SalesScheduleDemoLesson[];
  rangeStart: Date;
  dayCount: number;
}): SalesScheduleEvent[] {
  const start = startOfDay(rangeStart);
  const end = addDays(start, Math.max(1, dayCount));
  const gridStart = startOfWeek(start, { weekStartsOn: 1 });
  const weeks = Math.max(1, Math.ceil(differenceInCalendarDays(end, gridStart) / 7));

  const expanded: SalesScheduleEvent[] = [];
  for (let index = 0; index < weeks; index += 1) {
    const weekStart = addDays(gridStart, index * 7);
    expanded.push(
      ...buildSalesScheduleEvents({ groups, lessons, weekStart }),
      ...buildSalesDemoScheduleEvents(demos, weekStart),
    );
  }

  return expanded
    .filter((event) => event.startsAt >= start && event.startsAt < end)
    .map((event) => ({
      ...event,
      dayIndex: differenceInCalendarDays(event.startsAt, start),
    }))
    .sort((left, right) => (
      left.startsAt.getTime() - right.startsAt.getTime()
      || left.groupName.localeCompare(right.groupName)
    ));
}

export function groupSalesScheduleEventsByDate(events: SalesScheduleEvent[]) {
  const byDate = new Map<string, SalesScheduleEvent[]>();
  for (const event of events) {
    const key = salesScheduleDateKey(event);
    const bucket = byDate.get(key);
    if (bucket) bucket.push(event);
    else byDate.set(key, [event]);
  }
  return byDate;
}

/**
 * Keeps a branch when it matches or when anything under it does, so typing a
 * group name still shows which school and course it belongs to.
 */
export function searchSalesScheduleFilterTree(
  tree: SalesScheduleFilterSchool[],
  search: string,
): SalesScheduleFilterSchool[] {
  const needle = search.trim().toLocaleLowerCase();
  if (!needle) return tree;
  const matches = (value: string | null | undefined) => (
    Boolean(value && value.toLocaleLowerCase().includes(needle))
  );

  return tree.flatMap((school) => {
    if (matches(school.name)) return [school];
    const courses = school.courses.flatMap((course) => {
      if (matches(course.name)) return [course];
      const groups = course.groups.filter((group) => (
        matches(group.name) || matches(group.teacherName) || matches(group.courseName)
      ));
      return groups.length > 0 ? [{ ...course, groups }] : [];
    });
    return courses.length > 0 ? [{ ...school, courses }] : [];
  });
}

export function positionOverlappingScheduleEvents(
  events: SalesScheduleEvent[],
): PositionedScheduleEvent[] {
  return assignCalendarLanes(events);
}

export function getGroupsWithSchedule(
  groups: SalesScheduleGroup[],
  lessons: SalesScheduleLesson[],
): SalesScheduleGroup[] {
  const lessonGroupIds = new Set(lessons
    .filter((lesson) => lesson.status !== 'cancelled')
    .map((lesson) => lesson.groupId));

  return groups
    .filter((group) => (
      group.status !== 'completed'
      && ((group.schedule?.length ?? 0) > 0 || lessonGroupIds.has(group.id))
    ))
    .sort((left, right) => left.name.localeCompare(right.name));
}

const entityId = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export interface SalesScheduleTeacherOption {
  id: number;
  name: string;
}

export function buildSalesScheduleTeacherOptions(
  groups: SalesScheduleGroup[],
  lessons: SalesScheduleLesson[],
  demos: SalesScheduleDemoLesson[] = [],
): SalesScheduleTeacherOption[] {
  const teachersById = new Map<number, string>();
  const addTeacher = (idValue: unknown, nameValue: unknown) => {
    const id = entityId(idValue);
    const name = String(nameValue ?? '').trim();
    if (!id || !name) return;
    teachersById.set(id, name);
  };

  for (const group of groups) addTeacher(group.teacherId, group.teacherName);
  for (const lesson of lessons) addTeacher(lesson.teacherId, lesson.teacherName);
  for (const demo of demos) addTeacher(demo.teacherId, demo.teacherName);

  return [...teachersById]
    .map(([id, name]) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function filterSalesScheduleEventsByTeachers(
  events: SalesScheduleEvent[],
  selectedTeacherIds: Set<number>,
) {
  if (selectedTeacherIds.size === 0) return events;
  return events.filter((event) => (
    event.teacherId !== null
    && event.teacherId !== undefined
    && selectedTeacherIds.has(event.teacherId)
  ));
}

const entityKey = (prefix: string, id: number | null, name: string | null | undefined) => (
  id ? `${prefix}-${id}` : `${prefix}-name-${name?.trim().toLocaleLowerCase() || 'unassigned'}`
);

export function buildSalesScheduleFilterTree(
  groups: SalesScheduleGroup[],
  schools: SalesScheduleSchool[],
  courses: SalesScheduleCourse[],
): SalesScheduleFilterSchool[] {
  const schoolNames = new Map(schools.map((school) => [Number(school.id), school.name]));
  const courseNames = new Map(courses.map((course) => [Number(course.id), course.name ?? null]));
  const schoolsByKey = new Map<string, SalesScheduleFilterSchool>();

  for (const group of groups) {
    const schoolId = entityId(group.schoolId);
    const schoolName = group.schoolName || (schoolId ? schoolNames.get(schoolId) : null) || null;
    const schoolKey = entityKey('school', schoolId, schoolName);
    let school = schoolsByKey.get(schoolKey);

    if (!school) {
      school = { key: schoolKey, id: schoolId, name: schoolName, courses: [] };
      schoolsByKey.set(schoolKey, school);
    }

    const courseId = entityId(group.courseId);
    const courseName = group.courseName || (courseId ? courseNames.get(courseId) : null) || null;
    const courseKey = `${schoolKey}:${entityKey('course', courseId, courseName)}`;
    let course = school.courses.find((item) => item.key === courseKey);

    if (!course) {
      course = { key: courseKey, id: courseId, name: courseName, groups: [] };
      school.courses.push(course);
    }

    course.groups.push(group);
  }

  const compareNames = (
    left: { name: string | null },
    right: { name: string | null },
  ) => (left.name || '\uffff').localeCompare(right.name || '\uffff');

  return [...schoolsByKey.values()]
    .map((school) => ({
      ...school,
      courses: school.courses
        .map((course) => ({
          ...course,
          groups: [...course.groups].sort((left, right) => left.name.localeCompare(right.name)),
        }))
        .sort(compareNames),
    }))
    .sort(compareNames);
}

export function getGroupSelectionState(
  groupIds: number[],
  selectedGroupIds: Set<number>,
): boolean | 'indeterminate' {
  if (groupIds.length === 0) return false;
  const selectedCount = groupIds.reduce(
    (count, groupId) => count + (selectedGroupIds.has(groupId) ? 1 : 0),
    0,
  );
  if (selectedCount === 0) return false;
  if (selectedCount === groupIds.length) return true;
  return 'indeterminate';
}
