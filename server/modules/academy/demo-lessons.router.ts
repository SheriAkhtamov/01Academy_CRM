import { Router } from 'express';
import {
  demoLessonAttendanceSchema,
  demoLessonCancelSchema,
  demoLessonEnrollmentSchema,
  demoLessonMutationSchema,
  demoLessonOutcomeSchema,
  demoLessonRescheduleSchema,
  demoLessonResourceAvailabilitySchema,
  demoLessonTeacherChangeSchema,
  type DemoLessonMutation,
} from '@shared/contracts/demo-lessons';
import { hasLeadershipAccess } from '@shared/academy';
import { logger } from '../../lib/logger';
import { getPublicErrorMessage } from '../../lib/http-errors';
import {
  ACADEMY_SCHEDULING_ADVISORY_LOCK,
  Row,
  createAudit,
  ensureSalesAccess,
  insertRow,
  query,
  queryOne,
  updateRow,
  withTransaction,
} from './academy-core';
import {
  assertActiveRoomInSchool,
  assertLessonRoomAvailable,
  assertTeacherCanLeadLesson,
} from './academy-scheduling';
import { getDemoResourceAvailability } from './demo-resource-availability';
import { lockDemoParticipantLeads, syncDemoLeadStatuses } from './demo-lead-status';

const getDemoLesson = async (id: number) => queryOne(
  `SELECT demo.*,
      course.name AS course_name,
      school.name AS school_name,
      room.name AS room_name,
      teacher.full_name AS teacher_name,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', participant.id,
            'studentId', participant.student_id,
            'leadId', student.lead_id,
            'status', participant.status,
            'result', participant.result,
            'noShowReasonCode', participant.no_show_reason_code,
            'noShowReasonNote', participant.no_show_reason_note,
            'contactName', COALESCE(student.contact_name, lead.contact_name),
            'studentName', student.student_name,
            'managerId', COALESCE(student.manager_id, lead.manager_id)
          ) ORDER BY participant.id
        ) FILTER (WHERE participant.id IS NOT NULL),
        '[]'::jsonb
      ) AS participants
   FROM academy_demo_lessons demo
   JOIN academy_courses course ON course.id = demo.course_id
   JOIN academy_schools school ON school.id = demo.school_id
   LEFT JOIN academy_rooms room ON room.id = demo.room_id
   JOIN academy_teachers teacher ON teacher.id = demo.teacher_id
   LEFT JOIN academy_demo_lesson_participants participant ON participant.demo_lesson_id = demo.id
   LEFT JOIN academy_students student ON student.id = participant.student_id
   LEFT JOIN academy_leads lead ON lead.id = student.lead_id
   WHERE demo.id = $1
   GROUP BY demo.id, course.name, school.name, room.name, teacher.full_name`,
  [id],
);

const canManageParticipant = (req: any, participant: Row) => (
  hasLeadershipAccess(req.user)
  || !participant.managerId
  || Number(participant.managerId) === Number(req.user?.id)
);

const presentDemoLesson = (req: any, demo: Row) => {
  const participants = Array.isArray(demo.participants) ? demo.participants as Row[] : [];
  const canManage = hasLeadershipAccess(req.user)
    || participants.every((participant) => canManageParticipant(req, participant));
  return {
    ...demo,
    canManage,
    participants: participants.map((participant) => {
      const participantCanManage = canManageParticipant(req, participant);
      return participantCanManage
        ? { ...participant, canManage: true }
        : { ...participant, contactName: null, studentName: null, canManage: false };
    }),
  };
};

const assertCanManageDemoLesson = (req: any, demo: Row) => {
  const participants = Array.isArray(demo.participants) ? demo.participants as Row[] : [];
  if (!hasLeadershipAccess(req.user)
    && participants.some((participant) => !canManageParticipant(req, participant))) {
    throw Object.assign(new Error('Student mutation access required'), { statusCode: 403 });
  }
};

const parseDateRange = (value: unknown, fallback: Date) => {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  }
  return parsed;
};

const loadMutableStudents = async (req: any, studentIds: number[], lock = false) => {
  if (studentIds.length === 0) return [];
  const students = await query(
    `SELECT student.*,
            COALESCE(student.manager_id, lead.manager_id) AS effective_manager_id
     FROM academy_students student
     LEFT JOIN academy_leads lead ON lead.id = student.lead_id
     WHERE student.id = ANY($1::int[])
     ORDER BY student.id
     ${lock ? 'FOR UPDATE OF student' : ''}`,
    [studentIds],
  );
  if (students.length !== studentIds.length) {
    throw Object.assign(new Error('demoParticipantNotFound'), { statusCode: 404 });
  }
  for (const student of students) {
    if (!hasLeadershipAccess(req.user)
      && student.effectiveManagerId
      && Number(student.effectiveManagerId) !== Number(req.user?.id)) {
      throw Object.assign(new Error('Student mutation access required'), { statusCode: 403 });
    }
  }
  return students;
};

const assertParticipantAvailability = async (
  studentIds: number[],
  startsAt: Date,
  durationMinutes: number,
  excludeDemoLessonId?: number | null,
) => {
  if (studentIds.length === 0) return;
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
  const [eventConflict, lessonConflict] = await Promise.all([
    queryOne(
      `SELECT participant.student_id
       FROM academy_demo_lesson_participants participant
       JOIN academy_demo_lessons demo ON demo.id = participant.demo_lesson_id
       WHERE participant.student_id = ANY($1::int[])
         AND participant.status <> 'cancelled'
         AND demo.status = 'scheduled'
         AND demo.scheduled_at < $2
         AND demo.scheduled_at + (demo.duration_minutes * INTERVAL '1 minute') > $3
         AND ($4::int IS NULL OR demo.id <> $4)
       LIMIT 1`,
      [studentIds, endsAt, startsAt, excludeDemoLessonId ?? null],
    ),
    queryOne(
      `SELECT enrollment.student_id
       FROM academy_student_group_enrollments enrollment
       JOIN academy_lessons lesson ON lesson.group_id = enrollment.group_id
       WHERE enrollment.student_id = ANY($1::int[])
         AND enrollment.status = 'active'
         AND lesson.status <> 'cancelled'
         AND lesson.scheduled_at < $2
         AND lesson.scheduled_at + (lesson.duration_minutes * INTERVAL '1 minute') > $3
       LIMIT 1`,
      [studentIds, endsAt, startsAt],
    ),
  ]);
  if (eventConflict || lessonConflict) {
    throw Object.assign(new Error('demoParticipantBusy'), { statusCode: 409 });
  }
};

const hasParticipantConflict = async (
  studentIds: number[],
  startsAt: Date,
  durationMinutes: number,
) => {
  try {
    await assertParticipantAvailability(studentIds, startsAt, durationMinutes);
    return false;
  } catch (error: any) {
    if (error?.message === 'demoParticipantBusy') return true;
    throw error;
  }
};

const assertDemoResources = async (
  input: DemoLessonMutation,
  excludeDemoLessonId?: number | null,
) => {
  const startsAt = new Date(input.scheduledAt);
  if (startsAt.getTime() <= Date.now()) {
    throw Object.assign(new Error('demoTimeMustBeFuture'), { statusCode: 400 });
  }
  const [course, school] = await Promise.all([
    queryOne(`SELECT * FROM academy_courses WHERE id = $1 AND is_active = true`, [input.courseId]),
    queryOne(`SELECT * FROM academy_schools WHERE id = $1 AND is_active = true`, [input.schoolId]),
  ]);
  if (!course || !school) {
    throw Object.assign(new Error('schoolAndCourseRequired'), { statusCode: 404 });
  }

  await assertTeacherCanLeadLesson({
    teacherId: input.teacherId,
    courseId: input.courseId,
    schoolId: input.schoolId,
    scheduledAt: startsAt,
    durationMinutes: input.durationMinutes,
    excludeDemoLessonId,
    enforceAssignments: false,
    enforceAvailability: false,
    conflictError: 'demoTeacherBusy',
  });

  let room: Row | null = null;
  if (input.format === 'offline') {
    room = await assertActiveRoomInSchool(Number(input.roomId), input.schoolId);
    await assertLessonRoomAvailable({
      schoolId: input.schoolId,
      roomId: Number(input.roomId),
      scheduledAt: startsAt,
      durationMinutes: input.durationMinutes,
      excludeDemoLessonId,
    });
  }
  await assertParticipantAvailability(
    input.studentIds,
    startsAt,
    input.durationMinutes,
    excludeDemoLessonId,
  );
  return { course, school, room, startsAt };
};

export const registerAcademyDemoLessonRoutes = (router: ReturnType<typeof Router>) => {
  router.get('/demo-lessons', async (req, res) => {
    if (!ensureSalesAccess(req, res)) return;
    try {
      const upcomingOnly = req.query.upcoming === 'true';
      const from = parseDateRange(
        req.query.from,
        new Date(upcomingOnly ? Date.now() : Date.now() - 24 * 60 * 60 * 1_000),
      );
      const to = upcomingOnly
        ? null
        : parseDateRange(req.query.to, new Date(Date.now() + 31 * 24 * 60 * 60 * 1_000));
      if (to && to <= from) return res.status(400).json({ error: 'invalidData' });
      const schoolId = Number(req.query.schoolId) || null;
      const demos = await query(
        `SELECT demo.*,
            course.name AS course_name,
            school.name AS school_name,
            room.name AS room_name,
            teacher.full_name AS teacher_name,
            COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'id', participant.id,
                  'studentId', participant.student_id,
                  'leadId', student.lead_id,
                  'status', participant.status,
                  'result', participant.result,
                  'noShowReasonCode', participant.no_show_reason_code,
                  'noShowReasonNote', participant.no_show_reason_note,
                  'contactName', COALESCE(student.contact_name, lead.contact_name),
                  'studentName', student.student_name,
                  'managerId', COALESCE(student.manager_id, lead.manager_id)
                ) ORDER BY participant.id
              ) FILTER (WHERE participant.id IS NOT NULL),
              '[]'::jsonb
            ) AS participants
         FROM academy_demo_lessons demo
         JOIN academy_courses course ON course.id = demo.course_id
         JOIN academy_schools school ON school.id = demo.school_id
         LEFT JOIN academy_rooms room ON room.id = demo.room_id
         JOIN academy_teachers teacher ON teacher.id = demo.teacher_id
         LEFT JOIN academy_demo_lesson_participants participant ON participant.demo_lesson_id = demo.id
         LEFT JOIN academy_students student ON student.id = participant.student_id
         LEFT JOIN academy_leads lead ON lead.id = student.lead_id
         WHERE demo.scheduled_at + (demo.duration_minutes * INTERVAL '1 minute') > $1
           AND ($2::timestamptz IS NULL OR demo.scheduled_at < $2::timestamptz)
           AND ($3::int IS NULL OR demo.school_id = $3)
           AND ($4::boolean = false OR (demo.status = 'scheduled' AND demo.scheduled_at > $1))
         GROUP BY demo.id, course.name, school.name, room.name, teacher.full_name
         ORDER BY demo.scheduled_at, demo.id`,
        [from, to, schoolId, upcomingOnly],
      );
      res.json(demos.map((demo) => presentDemoLesson(req, demo)));
    } catch (error: any) {
      logger.error('Failed to fetch demo lessons', { error });
      res.status(error.statusCode || 500).json({
        error: getPublicErrorMessage(error, 'failedToLoadDemoLessons'),
      });
    }
  });

  router.post('/demo-lessons/resource-availability', async (req, res) => {
    if (!ensureSalesAccess(req, res)) return;
    const parsed = demoLessonResourceAvailabilitySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'invalidData' });
    }
    try {
      if (parsed.data.studentIds.length > 0) {
        await loadMutableStudents(req, parsed.data.studentIds);
      }
      const startsAt = new Date(parsed.data.scheduledAt);
      const [resources, participantConflict] = await Promise.all([
        getDemoResourceAvailability(parsed.data),
        parsed.data.studentIds.length > 0
          ? hasParticipantConflict(
            parsed.data.studentIds,
            startsAt,
            parsed.data.durationMinutes,
          )
          : Promise.resolve(false),
      ]);
      res.json({ ...resources, participantConflict });
    } catch (error: any) {
      logger.error('Failed to check demo resource availability', { error });
      res.status(error.statusCode || 500).json({
        error: getPublicErrorMessage(error, 'failedToCheckDemoAvailability'),
      });
    }
  });

  router.get('/demo-lessons/:id/teacher-options', async (req, res) => {
    if (!ensureSalesAccess(req, res)) return;
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ error: 'invalidData' });
    }
    try {
      const current = await getDemoLesson(id);
      if (!current) return res.status(404).json({ error: 'resourceNotFound' });
      assertCanManageDemoLesson(req, current);
      if (current.status !== 'scheduled') {
        return res.status(409).json({ error: 'demoCannotChangeTeacher' });
      }
      const resources = await getDemoResourceAvailability({
        courseId: Number(current.courseId),
        schoolId: Number(current.schoolId),
        scheduledAt: new Date(current.scheduledAt).toISOString(),
        durationMinutes: Number(current.durationMinutes),
        format: current.format === 'online' ? 'online' : 'offline',
        studentIds: [],
      }, {
        excludeDemoLessonId: id,
        allowPast: true,
      });
      res.json(resources.teachers);
    } catch (error: any) {
      logger.error('Failed to load demo teacher options', { error, demoLessonId: id });
      res.status(error.statusCode || 500).json({
        error: getPublicErrorMessage(error, 'failedToLoadDemoTeacherOptions'),
      });
    }
  });

  router.post('/demo-lessons/:id/teacher', async (req, res) => {
    if (!ensureSalesAccess(req, res)) return;
    const id = Number(req.params.id);
    const parsed = demoLessonTeacherChangeSchema.safeParse(req.body);
    if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) {
      return res.status(400).json({
        error: parsed.success ? 'invalidData' : parsed.error.issues[0]?.message || 'invalidData',
      });
    }
    try {
      const current = await getDemoLesson(id);
      if (!current) return res.status(404).json({ error: 'resourceNotFound' });
      assertCanManageDemoLesson(req, current);

      const changed = await withTransaction(async () => {
        await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
        const locked = await queryOne(
          `SELECT * FROM academy_demo_lessons WHERE id = $1 FOR UPDATE`,
          [id],
        );
        if (!locked) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
        if (locked.status !== 'scheduled') {
          throw Object.assign(new Error('demoCannotChangeTeacher'), { statusCode: 409 });
        }
        const lockedDemo = await getDemoLesson(id);
        if (!lockedDemo) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
        assertCanManageDemoLesson(req, lockedDemo);
        if (Number(locked.teacherId) === parsed.data.teacherId) return locked;

        await assertTeacherCanLeadLesson({
          teacherId: parsed.data.teacherId,
          courseId: Number(locked.courseId),
          schoolId: Number(locked.schoolId),
          scheduledAt: new Date(locked.scheduledAt),
          durationMinutes: Number(locked.durationMinutes),
          excludeDemoLessonId: id,
          enforceAssignments: false,
          enforceAvailability: false,
          conflictError: 'demoTeacherBusy',
        });
        const updated = await updateRow('academy_demo_lessons', id, {
          teacherId: parsed.data.teacherId,
          updatedBy: req.user!.id,
        });
        if (!updated) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
        await createAudit(
          req.actor!,
          'CHANGE_ACADEMY_DEMO_TEACHER',
          'academy_demo_lesson',
          id,
          updated,
          locked,
        );
        return updated;
      });
      const responseDemo = await getDemoLesson(id) ?? changed;
      res.json(presentDemoLesson(req, responseDemo));
    } catch (error: any) {
      logger.error('Failed to change demo teacher', { error, demoLessonId: id });
      res.status(error.statusCode || 500).json({
        error: getPublicErrorMessage(error, 'failedToChangeDemoTeacher'),
      });
    }
  });

  router.post('/demo-lessons', async (req, res) => {
    if (!ensureSalesAccess(req, res)) return;
    const parsed = demoLessonMutationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'invalidData' });
    }
    try {
      await loadMutableStudents(req, parsed.data.studentIds);
      const demo = await withTransaction(async () => {
        await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
        const students = await loadMutableStudents(req, parsed.data.studentIds, true);
        const resources = await assertDemoResources(parsed.data);
        const created = await insertRow('academy_demo_lessons', {
          courseId: parsed.data.courseId,
          schoolId: parsed.data.schoolId,
          roomId: parsed.data.format === 'offline' ? parsed.data.roomId : null,
          teacherId: parsed.data.teacherId,
          scheduledAt: resources.startsAt,
          durationMinutes: parsed.data.durationMinutes,
          format: parsed.data.format,
          status: 'scheduled',
          notes: parsed.data.notes ?? null,
          createdBy: req.user!.id,
          updatedBy: req.user!.id,
        });
        for (const student of students) {
          await insertRow('academy_demo_lesson_participants', {
            demoLessonId: created.id,
            studentId: student.id,
            status: 'invited',
          });
        }
        await createAudit(
          req.actor!,
          'CREATE_ACADEMY_DEMO_LESSON',
          'academy_demo_lesson',
          Number(created.id),
          created,
        );
        return created;
      });
      const enriched = await getDemoLesson(Number(demo.id));
      res.status(201).json(presentDemoLesson(req, enriched ?? demo));
    } catch (error: any) {
      logger.error('Failed to create demo lesson', { error });
      res.status(error.statusCode || 500).json({
        error: getPublicErrorMessage(error, 'failedToCreateDemoLesson'),
      });
    }
  });

  router.post('/demo-lessons/:id/participants', async (req, res) => {
    if (!ensureSalesAccess(req, res)) return;
    const id = Number(req.params.id);
    const parsed = demoLessonEnrollmentSchema.safeParse(req.body);
    if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) {
      return res.status(400).json({
        error: parsed.success ? 'invalidData' : parsed.error.issues[0]?.message || 'invalidData',
      });
    }
    try {
      await loadMutableStudents(req, parsed.data.studentIds);
      const enrolled = await withTransaction(async () => {
        await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
        const demo = await queryOne(
          `SELECT demo.*, school.name AS school_name, room.name AS room_name
           FROM academy_demo_lessons demo
           JOIN academy_schools school ON school.id = demo.school_id
           LEFT JOIN academy_rooms room ON room.id = demo.room_id
           WHERE demo.id = $1
           FOR UPDATE OF demo`,
          [id],
        );
        if (!demo) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
        if (demo.status !== 'scheduled' || new Date(demo.scheduledAt).getTime() <= Date.now()) {
          throw Object.assign(new Error('demoEnrollmentClosed'), { statusCode: 409 });
        }

        const leads = await lockDemoParticipantLeads(id, parsed.data.studentIds);
        const students = await loadMutableStudents(req, parsed.data.studentIds, true);
        const existingParticipants = await query(
          `SELECT * FROM academy_demo_lesson_participants
           WHERE demo_lesson_id = $1 AND student_id = ANY($2::int[])
           ORDER BY student_id
           FOR UPDATE`,
          [id, parsed.data.studentIds],
        );
        if (existingParticipants.some((participant) => participant.status !== 'cancelled')) {
          throw Object.assign(new Error('demoParticipantAlreadyEnrolled'), { statusCode: 409 });
        }
        await assertParticipantAvailability(
          parsed.data.studentIds,
          new Date(demo.scheduledAt),
          Number(demo.durationMinutes),
          id,
        );
        const existingByStudentId = new Map(
          existingParticipants.map((participant) => [Number(participant.studentId), participant]),
        );
        for (const student of students) {
          const existing = existingByStudentId.get(Number(student.id));
          if (existing) {
            await updateRow('academy_demo_lesson_participants', Number(existing.id), {
              status: 'invited',
              result: null,
              noShowReasonCode: null,
              noShowReasonNote: null,
            });
          } else {
            await insertRow('academy_demo_lesson_participants', {
              demoLessonId: id,
              studentId: student.id,
              status: 'invited',
            });
          }
        }
        await syncDemoLeadStatuses(req.actor!, id, leads.filter((lead) => (
          students.some((student) => Number(student.leadId) === Number(lead.id))
        )));
        await createAudit(
          req.actor!,
          'ADD_ACADEMY_DEMO_PARTICIPANTS',
          'academy_demo_lesson',
          id,
          { demoLessonId: id, studentIds: parsed.data.studentIds },
          demo,
        );
        return demo;
      });
      const responseDemo = await getDemoLesson(id) ?? enrolled;
      res.json(presentDemoLesson(req, responseDemo));
    } catch (error: any) {
      logger.error('Failed to enroll demo lesson participant', { error });
      res.status(error.statusCode || 500).json({
        error: getPublicErrorMessage(error, 'failedToEnrollDemoParticipant'),
      });
    }
  });

  router.delete('/demo-lessons/:id/participants/:participantId', async (req, res) => {
    if (!ensureSalesAccess(req, res)) return;
    const id = Number(req.params.id);
    const participantId = Number(req.params.participantId);
    if (!Number.isSafeInteger(id) || id < 1
      || !Number.isSafeInteger(participantId) || participantId < 1) {
      return res.status(400).json({ error: 'invalidData' });
    }
    try {
      const current = await getDemoLesson(id);
      if (!current) return res.status(404).json({ error: 'resourceNotFound' });
      const currentParticipant = (current.participants as Row[] | undefined)
        ?.find((participant) => Number(participant.id) === participantId);
      if (!currentParticipant) return res.status(404).json({ error: 'demoParticipantNotFound' });
      if (!canManageParticipant(req, currentParticipant)) {
        return res.status(403).json({ error: 'Student mutation access required' });
      }

      await withTransaction(async () => {
        await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
        const lockedDemo = await queryOne(
          `SELECT * FROM academy_demo_lessons WHERE id = $1 FOR UPDATE`,
          [id],
        );
        if (!lockedDemo) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
        if (lockedDemo.status !== 'scheduled') {
          throw Object.assign(new Error('demoParticipantRemovalClosed'), { statusCode: 409 });
        }
        const leads = await lockDemoParticipantLeads(id);
        const lockedParticipant = await queryOne(
          `SELECT participant.*, student.lead_id,
                  COALESCE(student.manager_id, lead.manager_id) AS manager_id
           FROM academy_demo_lesson_participants participant
           JOIN academy_students student ON student.id = participant.student_id
           LEFT JOIN academy_leads lead ON lead.id = student.lead_id
           WHERE participant.demo_lesson_id = $1 AND participant.id = $2
           FOR UPDATE OF participant`,
          [id, participantId],
        );
        if (!lockedParticipant) {
          throw Object.assign(new Error('demoParticipantNotFound'), { statusCode: 404 });
        }
        if (!canManageParticipant(req, lockedParticipant)) {
          throw Object.assign(new Error('Student mutation access required'), { statusCode: 403 });
        }
        if (!['invited', 'confirmed'].includes(String(lockedParticipant.status))) {
          throw Object.assign(new Error('demoParticipantAttendanceRecorded'), { statusCode: 409 });
        }
        await query(
          `DELETE FROM academy_demo_lesson_participants
           WHERE demo_lesson_id = $1 AND id = $2`,
          [id, participantId],
        );
        const updated = await updateRow('academy_demo_lessons', id, { updatedBy: req.user!.id });
        await syncDemoLeadStatuses(req.actor!, id, leads.filter((lead) => (
          Number(lead.id) === Number(lockedParticipant.leadId)
        )));
        await createAudit(
          req.actor!,
          'REMOVE_ACADEMY_DEMO_PARTICIPANT',
          'academy_demo_lesson',
          id,
          { demoLesson: updated, removedParticipantId: participantId },
          { demoLesson: lockedDemo, participant: lockedParticipant },
        );
      });

      const responseDemo = await getDemoLesson(id);
      if (!responseDemo) return res.status(404).json({ error: 'resourceNotFound' });
      res.json(presentDemoLesson(req, responseDemo));
    } catch (error: any) {
      logger.error('Failed to remove demo lesson participant', { error, demoLessonId: id, participantId });
      res.status(error.statusCode || 500).json({
        error: getPublicErrorMessage(error, 'failedToRemoveDemoParticipant'),
      });
    }
  });

  router.post('/demo-lessons/:id/cancel', async (req, res) => {
    if (!ensureSalesAccess(req, res)) return;
    const id = Number(req.params.id);
    const parsed = demoLessonCancelSchema.safeParse(req.body);
    if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) {
      return res.status(400).json({ error: 'invalidData' });
    }
    try {
      const current = await getDemoLesson(id);
      if (!current) return res.status(404).json({ error: 'resourceNotFound' });
      const participants = Array.isArray(current.participants) ? current.participants as Row[] : [];
      if (!hasLeadershipAccess(req.user) && participants.some((item) => !canManageParticipant(req, item))) {
        return res.status(403).json({ error: 'Student mutation access required' });
      }
      const cancelled = await withTransaction(async () => {
        await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
        const locked = await queryOne(`SELECT * FROM academy_demo_lessons WHERE id = $1 FOR UPDATE`, [id]);
        if (!locked) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
        if (locked.status !== 'scheduled') {
          throw Object.assign(new Error('demoCannotBeCancelled'), { statusCode: 409 });
        }
        const leads = await lockDemoParticipantLeads(id);
        const updated = await updateRow('academy_demo_lessons', id, {
          status: 'cancelled',
          cancellationReason: parsed.data.reason,
          updatedBy: req.user!.id,
        });
        await query(
          `UPDATE academy_demo_lesson_participants
           SET status = 'cancelled', updated_at = NOW()
           WHERE demo_lesson_id = $1 AND status NOT IN ('attended', 'no_show')`,
          [id],
        );
        await syncDemoLeadStatuses(req.actor!, id, leads);
        await createAudit(
          req.actor!,
          'CANCEL_ACADEMY_DEMO_LESSON',
          'academy_demo_lesson',
          id,
          updated,
          locked,
        );
        return updated;
      });
      const responseDemo = await getDemoLesson(id) ?? cancelled;
      if (!responseDemo) return res.status(404).json({ error: 'resourceNotFound' });
      res.json(presentDemoLesson(req, responseDemo));
    } catch (error: any) {
      logger.error('Failed to cancel demo lesson', { error });
      res.status(error.statusCode || 500).json({
        error: getPublicErrorMessage(error, 'failedToCancelDemoLesson'),
      });
    }
  });

  router.post('/demo-lessons/:id/outcome', async (req, res) => {
    if (!ensureSalesAccess(req, res)) return;
    const id = Number(req.params.id);
    const parsed = demoLessonOutcomeSchema.safeParse(req.body);
    if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) {
      return res.status(400).json({
        error: parsed.success ? 'invalidData' : parsed.error.issues[0]?.message || 'invalidData',
      });
    }
    try {
      const current = await getDemoLesson(id);
      if (!current) return res.status(404).json({ error: 'resourceNotFound' });
      const participants = Array.isArray(current.participants) ? current.participants as Row[] : [];
      if (!hasLeadershipAccess(req.user) && participants.some((item) => !canManageParticipant(req, item))) {
        return res.status(403).json({ error: 'Student mutation access required' });
      }

      const finalized = await withTransaction(async () => {
        await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
        const locked = await queryOne(`SELECT * FROM academy_demo_lessons WHERE id = $1 FOR UPDATE`, [id]);
        if (!locked) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
        if (locked.status !== 'scheduled') {
          throw Object.assign(new Error('demoOutcomeAlreadyFinal'), { statusCode: 409 });
        }
        const leads = await lockDemoParticipantLeads(id);
        if (parsed.data.status === 'completed') {
          const pending = await queryOne<{ count: number }>(
            `SELECT COUNT(*)::int AS count
             FROM academy_demo_lesson_participants
             WHERE demo_lesson_id = $1 AND status IN ('invited', 'confirmed')`,
            [id],
          );
          if (Number(pending?.count ?? 0) > 0) {
            throw Object.assign(new Error('demoAttendanceIncomplete'), { statusCode: 409 });
          }
        }
        const updated = await updateRow('academy_demo_lessons', id, {
          status: parsed.data.status,
          notConductedReasonCode: parsed.data.status === 'not_conducted'
            ? parsed.data.reasonCode
            : null,
          notConductedReasonNote: parsed.data.status === 'not_conducted'
            ? parsed.data.reasonNote?.trim() || null
            : null,
          finalizedAt: new Date(),
          finalizedBy: req.user!.id,
          updatedBy: req.user!.id,
        });
        if (!updated) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
        await syncDemoLeadStatuses(req.actor!, id, leads);
        await createAudit(
          req.actor!,
          'FINALIZE_ACADEMY_DEMO_LESSON',
          'academy_demo_lesson',
          id,
          updated,
          locked,
        );
        return updated;
      });
      const responseDemo = await getDemoLesson(id) ?? finalized;
      res.json(presentDemoLesson(req, responseDemo));
    } catch (error: any) {
      logger.error('Failed to finalize demo lesson', { error });
      res.status(error.statusCode || 500).json({
        error: getPublicErrorMessage(error, 'failedToFinalizeDemoLesson'),
      });
    }
  });

  router.post('/demo-lessons/:id/reschedule', async (req, res) => {
    if (!ensureSalesAccess(req, res)) return;
    const id = Number(req.params.id);
    const parsed = demoLessonRescheduleSchema.safeParse(req.body);
    if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) {
      return res.status(400).json({
        error: parsed.success ? 'invalidData' : parsed.error.issues[0]?.message || 'invalidData',
      });
    }
    try {
      const current = await getDemoLesson(id);
      if (!current) return res.status(404).json({ error: 'resourceNotFound' });
      const currentParticipants = Array.isArray(current.participants)
        ? current.participants as Row[]
        : [];
      if (!hasLeadershipAccess(req.user)
        && currentParticipants.some((item) => !canManageParticipant(req, item))) {
        return res.status(403).json({ error: 'Student mutation access required' });
      }

      const rescheduled = await withTransaction(async () => {
        await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
        const locked = await queryOne(`SELECT * FROM academy_demo_lessons WHERE id = $1 FOR UPDATE`, [id]);
        if (!locked) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
        if (locked.status !== 'scheduled') {
          throw Object.assign(new Error('demoCannotBeRescheduled'), { statusCode: 409 });
        }
        const leads = await lockDemoParticipantLeads(id);
        const activeParticipants = await query(
          `SELECT participant.*
           FROM academy_demo_lesson_participants participant
           WHERE participant.demo_lesson_id = $1 AND participant.status <> 'cancelled'
           ORDER BY participant.student_id
           FOR UPDATE OF participant`,
          [id],
        );
        const studentIds = activeParticipants.map((participant) => Number(participant.studentId));
        const input: DemoLessonMutation = {
          courseId: Number(locked.courseId),
          schoolId: Number(locked.schoolId),
          roomId: locked.roomId ? Number(locked.roomId) : null,
          teacherId: Number(locked.teacherId),
          scheduledAt: parsed.data.scheduledAt,
          durationMinutes: Number(locked.durationMinutes),
          format: locked.format === 'online' ? 'online' : 'offline',
          studentIds,
          notes: locked.notes ?? null,
        };
        const resources = await assertDemoResources(input, id);
        const rescheduledAt = new Date();
        const updated = await updateRow('academy_demo_lessons', id, {
          scheduledAt: resources.startsAt,
          lastRescheduledFrom: locked.scheduledAt,
          lastRescheduleReason: parsed.data.reason,
          lastRescheduledAt: rescheduledAt,
          lastRescheduledBy: req.user!.id,
          updatedBy: req.user!.id,
        });
        if (!updated) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
        await syncDemoLeadStatuses(req.actor!, id, leads);
        await createAudit(
          req.actor!,
          'RESCHEDULE_ACADEMY_DEMO_LESSON',
          'academy_demo_lesson',
          id,
          { demoLesson: updated, reason: parsed.data.reason },
          locked,
        );
        return updated;
      });
      const responseDemo = await getDemoLesson(id) ?? rescheduled;
      res.json(presentDemoLesson(req, responseDemo));
    } catch (error: any) {
      logger.error('Failed to reschedule demo lesson', { error });
      res.status(error.statusCode || 500).json({
        error: getPublicErrorMessage(error, 'failedToRescheduleDemoLesson'),
      });
    }
  });

  router.post('/demo-lessons/:id/attendance', async (req, res) => {
    if (!ensureSalesAccess(req, res)) return;
    const id = Number(req.params.id);
    const parsed = demoLessonAttendanceSchema.safeParse(req.body);
    if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) {
      return res.status(400).json({ error: parsed.success ? 'invalidData' : parsed.error.issues[0]?.message || 'invalidData' });
    }
    try {
      const current = await getDemoLesson(id);
      if (!current) return res.status(404).json({ error: 'resourceNotFound' });
      const participants = Array.isArray(current.participants) ? current.participants as Row[] : [];
      const requestedParticipantIds = new Set(
        parsed.data.participants.map((item) => item.participantId),
      );
      if (!hasLeadershipAccess(req.user) && participants.some((item) => (
        requestedParticipantIds.has(Number(item.id)) && !canManageParticipant(req, item)
      ))) {
        return res.status(403).json({ error: 'Student mutation access required' });
      }
      const participantIds = new Set(participants.map((item) => Number(item.id)));
      if (parsed.data.participants.some((item) => !participantIds.has(item.participantId))) {
        return res.status(400).json({ error: 'demoParticipantNotFound' });
      }
      const result = await withTransaction(async () => {
        await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
        const locked = await queryOne(`SELECT * FROM academy_demo_lessons WHERE id = $1 FOR UPDATE`, [id]);
        if (!locked) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
        if (locked.status === 'cancelled' || locked.status === 'not_conducted') {
          throw Object.assign(new Error('demoAttendanceNotAllowed'), { statusCode: 409 });
        }
        const leads = await lockDemoParticipantLeads(id);
        const lockedParticipants = await query(
          `SELECT participant.*, student.lead_id,
                  COALESCE(student.manager_id, lead.manager_id) AS manager_id
           FROM academy_demo_lesson_participants participant
           JOIN academy_students student ON student.id = participant.student_id
           LEFT JOIN academy_leads lead ON lead.id = student.lead_id
           WHERE participant.demo_lesson_id = $1
           ORDER BY participant.id
           FOR UPDATE OF participant, student`,
          [id],
        );
        const lockedParticipantById = new Map(
          lockedParticipants.map((participant) => [Number(participant.id), participant]),
        );
        for (const item of parsed.data.participants) {
          const lockedParticipant = lockedParticipantById.get(item.participantId);
          if (!lockedParticipant) {
            throw Object.assign(new Error('demoParticipantNotFound'), { statusCode: 404 });
          }
          if (!canManageParticipant(req, lockedParticipant)) {
            throw Object.assign(new Error('Student mutation access required'), { statusCode: 403 });
          }
          const noShowReasonCode = item.status === 'no_show'
            ? item.noShowReasonCode ?? null
            : null;
          const noShowReasonNote = item.status === 'no_show'
            ? item.noShowReasonNote?.trim() || null
            : null;
          await query(
            `UPDATE academy_demo_lesson_participants
             SET status = $3,
                 result = $4,
                 no_show_reason_code = $5,
                 no_show_reason_note = $6,
                 updated_at = NOW()
             WHERE demo_lesson_id = $1 AND id = $2`,
            [
              id,
              item.participantId,
              item.status,
              item.result ?? null,
              noShowReasonCode,
              noShowReasonNote,
            ],
          );
        }
        const updated = await updateRow('academy_demo_lessons', id, {
          updatedBy: req.user!.id,
        });
        if (!updated) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
        const updatedParticipants = await query(
          `SELECT *
           FROM academy_demo_lesson_participants
           WHERE demo_lesson_id = $1
           ORDER BY id`,
          [id],
        );
        await syncDemoLeadStatuses(req.actor!, id, leads.filter((lead) => (
          lockedParticipants.some((participant) => (
            requestedParticipantIds.has(Number(participant.id))
            && Number(participant.leadId) === Number(lead.id)
          ))
        )), true);
        await createAudit(
          req.actor!,
          'UPDATE_ACADEMY_DEMO_ATTENDANCE',
          'academy_demo_lesson',
          id,
          { demoLesson: updated, participants: updatedParticipants },
          { demoLesson: locked, participants: lockedParticipants },
        );
        return updated;
      });
      const responseDemo = await getDemoLesson(id) ?? result;
      if (!responseDemo) return res.status(404).json({ error: 'resourceNotFound' });
      res.json(presentDemoLesson(req, responseDemo));
    } catch (error: any) {
      logger.error('Failed to update demo attendance', { error });
      res.status(error.statusCode || 500).json({
        error: getPublicErrorMessage(error, 'failedToUpdateDemoAttendance'),
      });
    }
  });
};
