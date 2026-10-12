import {
  normalizeWeeklySchedule,
  scheduleDateRangesOverlap,
  scheduleIntervalsOverlap,
  type NormalizedWeeklyScheduleItem,
} from '@shared/scheduling';
import { academyDateInputValue } from '@/lib/localeFormat';
import type { Group, GroupTeacher } from './types';

/**
 * Early answers to the questions the server asks when a group is saved — is
 * the room free, can this teacher take these hours — computed from the groups
 * already on screen, so the editor can say so next to the field instead of in
 * a toast after "Save". The server stays the authority: it also sees lessons
 * and demo bookings, which this page does not load.
 */

const BLOCKING_STATUSES = new Set(['open', 'in_progress']);

export interface PlannedGroup {
  schedule: unknown;
  startDate: string;
  endDate: string;
  editingGroupId: number | null;
}

export interface ScheduleClash {
  group: Group;
  dayOfWeek: number;
  startMinutes: number;
  endMinutes: number;
}

/** Date keys as local midnights: the shared range check compares local calendar days. */
const keyToDate = (key: string) => (key ? new Date(`${key}T00:00:00`) : null);

const plannedSlots = (plan: PlannedGroup) => normalizeWeeklySchedule(plan.schedule, 60);

function clashesWith(slots: NormalizedWeeklyScheduleItem[], plan: PlannedGroup, other: Group): ScheduleClash[] {
  if (other.id === plan.editingGroupId || other.isArchived || !BLOCKING_STATUSES.has(other.status)) return [];
  const rangesOverlap = scheduleDateRangesOverlap(
    keyToDate(plan.startDate),
    keyToDate(plan.endDate),
    keyToDate(academyDateInputValue(other.startDate)),
    keyToDate(academyDateInputValue(other.endDate)),
  );
  if (!rangesOverlap) return [];
  const theirs = normalizeWeeklySchedule(other.schedule, Number(other.lessonDurationMinutes) || 60);
  return theirs
    .filter((item) => slots.some((mine) => (
      mine.dayOfWeek === item.dayOfWeek
      && scheduleIntervalsOverlap(mine.startMinutes, mine.endMinutes, item.startMinutes, item.endMinutes)
    )))
    .map((item) => ({ group: other, dayOfWeek: item.dayOfWeek, startMinutes: item.startMinutes, endMinutes: item.endMinutes }));
}

export function findRoomClashes(roomId: number, plan: PlannedGroup, groups: Group[]): ScheduleClash[] {
  const slots = plannedSlots(plan);
  if (!roomId || slots.length === 0) return [];
  return groups
    .filter((group) => Number(group.roomId) === roomId)
    .flatMap((group) => clashesWith(slots, plan, group));
}

export type TeacherFitIssue = 'otherBranch' | 'offHours' | 'busy';

export interface TeacherFit {
  issue: TeacherFitIssue | null;
  clash: ScheduleClash | null;
  teachesCourse: boolean;
}

const idList = (value: unknown) => (Array.isArray(value) ? value.map(Number).filter((id) => id > 0) : []);

/** Same source as the server: weekly availability, or the legacy schedule field when that is empty. */
const availabilityOf = (teacher: GroupTeacher) => {
  const availability = normalizeWeeklySchedule(teacher.availability, 60);
  return availability.length > 0
    ? availability
    : normalizeWeeklySchedule((teacher as GroupTeacher & { schedule?: unknown }).schedule, 60);
};

export function assessTeacher(
  teacher: GroupTeacher,
  plan: PlannedGroup & { schoolId: number; courseId: number },
  groups: Group[],
): TeacherFit {
  const teachesCourse = idList(teacher.courseIds).includes(plan.courseId);
  const schoolIds = idList(teacher.schoolIds);
  if (plan.schoolId && schoolIds.length > 0 && !schoolIds.includes(plan.schoolId)) {
    return { issue: 'otherBranch', clash: null, teachesCourse };
  }
  const slots = plannedSlots(plan);
  if (slots.length === 0) return { issue: null, clash: null, teachesCourse };
  const availability = availabilityOf(teacher);
  const covered = slots.every((item) => availability.some((slot) => (
    slot.dayOfWeek === item.dayOfWeek
    && (!plan.schoolId || !slot.schoolId || slot.schoolId === plan.schoolId)
    && item.startMinutes >= slot.startMinutes
    && item.endMinutes <= slot.endMinutes
  )));
  if (!covered) return { issue: 'offHours', clash: null, teachesCourse };
  const clash = groups
    .filter((group) => Number(group.teacherId) === teacher.id)
    .flatMap((group) => clashesWith(slots, plan, group))[0] ?? null;
  return { issue: clash ? 'busy' : null, clash, teachesCourse };
}

/** Teachers who can take the group first, then those who could after a change, by name within each. */
export function rankTeachers(teachers: GroupTeacher[], fits: Map<number, TeacherFit>) {
  const rank = (teacher: GroupTeacher) => {
    const fit = fits.get(teacher.id);
    if (!fit) return 0;
    if (fit.issue) return 2;
    return fit.teachesCourse ? 0 : 1;
  };
  return [...teachers].sort((left, right) => (
    rank(left) - rank(right) || left.fullName.localeCompare(right.fullName, 'ru')
  ));
}
