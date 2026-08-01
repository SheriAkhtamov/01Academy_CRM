import type { DemoLessonResourceAvailabilityRequest } from '@shared/contracts/demo-lessons';
import { addMinutes } from '@shared/academy';
import { Row, query, queryOne } from './academy-core';
import {
  getAcademySlotPosition,
  isDateInsideInclusiveDayRange,
  normalizeScheduleItems,
  scheduleConflictsWithSlot,
} from './academy-scheduling';

type ResourceReason = 'busy' | 'inactive' | 'too_small';

const resourceState = (inactive: boolean, busy: boolean, tooSmall = false): {
  available: boolean;
  reason: ResourceReason | null;
} => {
  if (inactive) return { available: false, reason: 'inactive' };
  if (tooSmall) return { available: false, reason: 'too_small' };
  if (busy) return { available: false, reason: 'busy' };
  return { available: true, reason: null };
};

export const getDemoResourceAvailability = async (
  input: DemoLessonResourceAvailabilityRequest,
) => {
  const startsAt = new Date(input.scheduledAt);
  if (startsAt.getTime() <= Date.now()) {
    throw Object.assign(new Error('demoTimeMustBeFuture'), { statusCode: 400 });
  }
  const endsAt = addMinutes(startsAt, input.durationMinutes);
  const { dayOfWeek, startMinutes, endMinutes } = getAcademySlotPosition(
    startsAt,
    input.durationMinutes,
  );
  const participantCount = Math.max(1, input.participantIds.length);

  const [course, school, teachers, rooms, lessons, demos, groups] = await Promise.all([
    queryOne(`SELECT id FROM academy_courses WHERE id = $1 AND is_active = true`, [input.courseId]),
    queryOne(`SELECT id FROM academy_schools WHERE id = $1 AND is_active = true`, [input.schoolId]),
    query(`SELECT id, full_name, status FROM academy_teachers ORDER BY full_name, id`),
    query(
      `SELECT id, name, school_id, capacity, is_active
       FROM academy_rooms
       WHERE school_id = $1
       ORDER BY is_active DESC, name, id`,
      [input.schoolId],
    ),
    query(
      `SELECT teacher_id, room_id
       FROM academy_lessons
       WHERE status <> 'cancelled'
         AND scheduled_at < $2
         AND scheduled_at + (duration_minutes * INTERVAL '1 minute') > $1`,
      [startsAt, endsAt],
    ),
    query(
      `SELECT teacher_id, room_id
       FROM academy_demo_lessons
       WHERE status = 'scheduled'
         AND scheduled_at < $2
         AND scheduled_at + (duration_minutes * INTERVAL '1 minute') > $1`,
      [startsAt, endsAt],
    ),
    query(`SELECT * FROM academy_groups WHERE status IN ('open', 'in_progress')`),
  ]);
  if (!course || !school) {
    throw Object.assign(new Error('schoolAndCourseRequired'), { statusCode: 404 });
  }

  const busyTeacherIds = new Set<number>();
  const busyRoomIds = new Set<number>();
  for (const event of [...lessons, ...demos]) {
    if (Number(event.teacherId) > 0) busyTeacherIds.add(Number(event.teacherId));
    if (Number(event.roomId) > 0) busyRoomIds.add(Number(event.roomId));
  }
  for (const group of groups) {
    if (!isDateInsideInclusiveDayRange(
      startsAt,
      group.startDate ? new Date(group.startDate) : null,
      group.endDate ? new Date(group.endDate) : null,
    )) continue;
    if (!scheduleConflictsWithSlot(
      normalizeScheduleItems(group.schedule),
      dayOfWeek,
      startMinutes,
      endMinutes,
    )) continue;
    if (Number(group.teacherId) > 0) busyTeacherIds.add(Number(group.teacherId));
    if (Number(group.roomId) > 0) busyRoomIds.add(Number(group.roomId));
  }

  return {
    teachers: teachers.map((teacher: Row) => ({
      id: Number(teacher.id),
      fullName: String(teacher.fullName),
      status: String(teacher.status),
      ...resourceState(
        teacher.status !== 'active',
        busyTeacherIds.has(Number(teacher.id)),
      ),
    })),
    rooms: rooms.map((room: Row) => ({
      id: Number(room.id),
      name: String(room.name),
      schoolId: Number(room.schoolId),
      capacity: Number(room.capacity),
      isActive: Boolean(room.isActive),
      ...resourceState(
        !room.isActive,
        busyRoomIds.has(Number(room.id)),
        Number(room.capacity) < participantCount,
      ),
    })),
  };
};
