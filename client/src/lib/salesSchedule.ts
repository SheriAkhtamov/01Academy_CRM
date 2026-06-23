import { addDays, addMinutes, differenceInCalendarDays, startOfDay } from 'date-fns';
import type { AcademyScheduleItem } from '@shared/schema';

export interface SalesScheduleGroup {
  id: number;
  name: string;
  courseId?: number | null;
  courseName?: string | null;
  schoolId?: number | null;
  teacherName?: string | null;
  schoolName?: string | null;
  maxStudents?: number | null;
  currentStudents?: number | null;
  reservedStudents?: number | null;
  schedule?: AcademyScheduleItem[] | null;
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
  lessonDurationMinutes?: number | null;
}

export interface SalesScheduleSchool {
  id: number;
  name: string;
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
  source: 'lesson' | 'recurring';
  groupId: number;
  groupName: string;
  courseName?: string | null;
  teacherName?: string | null;
  schoolName?: string | null;
  topic?: string | null;
  availableSeats?: number | null;
  maxStudents?: number | null;
  startsAt: Date;
  endsAt: Date;
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
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
  courses,
  weekStart,
}: {
  groups: SalesScheduleGroup[];
  lessons: SalesScheduleLesson[];
  courses: SalesScheduleCourse[];
  weekStart: Date;
}): SalesScheduleEvent[] {
  const normalizedWeekStart = startOfDay(weekStart);
  const weekEnd = addDays(normalizedWeekStart, 7);
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const durationByCourseId = new Map(
    courses.map((course) => [course.id, Math.max(15, Number(course.lessonDurationMinutes || 60))]),
  );

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
    const durationMinutes = durationByCourseId.get(Number(group.courseId)) ?? 60;

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

const eventsOverlap = (left: SalesScheduleEvent, right: SalesScheduleEvent) => (
  left.startMinutes < right.endMinutes && left.endMinutes > right.startMinutes
);

export function positionOverlappingScheduleEvents(
  events: SalesScheduleEvent[],
): PositionedScheduleEvent[] {
  const sorted = [...events].sort((left, right) => (
    left.startMinutes - right.startMinutes || left.endMinutes - right.endMinutes
  ));
  const positioned: PositionedScheduleEvent[] = [];

  for (let index = 0; index < sorted.length;) {
    const cluster: SalesScheduleEvent[] = [sorted[index]];
    let clusterEnd = sorted[index].endMinutes;
    let cursor = index + 1;

    while (cursor < sorted.length && sorted[cursor].startMinutes < clusterEnd) {
      cluster.push(sorted[cursor]);
      clusterEnd = Math.max(clusterEnd, sorted[cursor].endMinutes);
      cursor += 1;
    }

    const laneEnds: number[] = [];
    const clusterPositioned = cluster.map((event) => {
      let lane = laneEnds.findIndex((endMinutes) => endMinutes <= event.startMinutes);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = event.endMinutes;
      return { event, lane };
    });
    const laneCount = Math.max(1, laneEnds.length);

    positioned.push(...clusterPositioned.map(({ event, lane }) => ({
      ...event,
      lane,
      laneCount,
    })));
    index = cursor;
  }

  return positioned;
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
