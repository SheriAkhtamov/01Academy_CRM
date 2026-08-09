import { Router } from 'express';
import {
  DEMO_LESSON_MAX_CAPACITY,
  demoLessonAttendanceSchema,
  demoLessonCancelSchema,
  demoLessonEnrollmentSchema,
  demoLessonMutationSchema,
  demoLessonResourceAvailabilitySchema,
  type DemoLessonMutation,
} from '@shared/contracts/demo-lessons';
import { hasLeadershipAccess } from '@shared/academy';
import { logger } from '../../lib/logger';
import { getPublicErrorMessage } from '../../lib/http-errors';
import {
  ACADEMY_SCHEDULING_ADVISORY_LOCK,
  Row,
  canMutateLeadRow,
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
import {
  createStageHistory,
  handleLeadStatusEffects,
} from './academy-leads';
import { getDemoResourceAvailability } from './demo-resource-availability';

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
            'leadId', participant.lead_id,
            'status', participant.status,
            'result', participant.result,
            'contactName', lead.contact_name,
            'studentName', lead.student_name,
            'managerId', lead.manager_id
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
   LEFT JOIN academy_leads lead ON lead.id = participant.lead_id
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
    participants: participants.map((participant) => (
      canManageParticipant(req, participant)
        ? participant
        : { ...participant, contactName: null, studentName: null }
    )),
  };
};

const parseDateRange = (value: unknown, fallback: Date) => {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  }
  return parsed;
};

const loadMutableLeads = async (req: any, leadIds: number[], lock = false) => {
  if (leadIds.length === 0) return [];
  const leads = await query(
    `SELECT * FROM academy_leads
     WHERE id = ANY($1::int[])
     ORDER BY id
     ${lock ? 'FOR UPDATE' : ''}`,
    [leadIds],
  );
  if (leads.length !== leadIds.length) {
    throw Object.assign(new Error('demoParticipantNotFound'), { statusCode: 404 });
  }
  for (const lead of leads) {
    if (!canMutateLeadRow(req, lead)) {
      throw Object.assign(new Error('Lead mutation access required'), { statusCode: 403 });
    }
    if (lead.isArchived) {
      throw Object.assign(new Error('demoArchivedLeadNotAllowed'), { statusCode: 409 });
    }
    if (lead.statusCode === 'paid') {
      throw Object.assign(new Error('demoPaidLeadNotAllowed'), { statusCode: 409 });
    }
  }
  return leads;
};

const assertParticipantAvailability = async (
  leadIds: number[],
  startsAt: Date,
  durationMinutes: number,
  excludeDemoLessonId?: number | null,
) => {
  if (leadIds.length === 0) return;
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
  const [eventConflict, legacyConflict] = await Promise.all([
    queryOne(
      `SELECT participant.lead_id
       FROM academy_demo_lesson_participants participant
       JOIN academy_demo_lessons demo ON demo.id = participant.demo_lesson_id
       WHERE participant.lead_id = ANY($1::int[])
         AND participant.status <> 'cancelled'
         AND demo.status = 'scheduled'
         AND demo.scheduled_at < $3
         AND demo.scheduled_at + (demo.duration_minutes * INTERVAL '1 minute') > $2
         AND ($4::int IS NULL OR demo.id <> $4)
       LIMIT 1`,
      [leadIds, startsAt, endsAt, excludeDemoLessonId ?? null],
    ),
    queryOne(
      `SELECT lead.id
       FROM academy_leads lead
       LEFT JOIN academy_courses course ON course.id = COALESCE(lead.demo_course_id, lead.course_id)
       WHERE lead.id = ANY($1::int[])
         AND lead.demo_at IS NOT NULL
         AND COALESCE(lead.demo_attended, false) = false
         AND lead.demo_at < $3
         AND lead.demo_at
           + (COALESCE(course.lesson_duration_minutes, $4) * INTERVAL '1 minute') > $2
         AND NOT EXISTS (
           SELECT 1
           FROM academy_demo_lesson_participants participant
           JOIN academy_demo_lessons demo ON demo.id = participant.demo_lesson_id
           WHERE participant.lead_id = lead.id
             AND demo.status = 'scheduled'
             AND demo.scheduled_at = lead.demo_at
         )
       LIMIT 1`,
      [leadIds, startsAt, endsAt, durationMinutes],
    ),
  ]);
  if (eventConflict || legacyConflict) {
    throw Object.assign(new Error('demoParticipantBusy'), { statusCode: 409 });
  }
};

const hasParticipantConflict = async (
  leadIds: number[],
  startsAt: Date,
  durationMinutes: number,
) => {
  try {
    await assertParticipantAvailability(leadIds, startsAt, durationMinutes);
    return false;
  } catch (error: any) {
    if (error?.message === 'demoParticipantBusy') return true;
    throw error;
  }
};

// A demo can be created with no participants, so its seat count comes from the
// booked room (offline) or the maximum allowed capacity (online) unless the
// caller asked for a smaller number of seats.
const resolveDemoCapacity = (input: DemoLessonMutation, room: Row | null) => {
  if (input.capacity) return input.capacity;
  const seats = input.format === 'online'
    ? DEMO_LESSON_MAX_CAPACITY
    : Number(room?.capacity ?? 0);
  return Math.min(
    DEMO_LESSON_MAX_CAPACITY,
    Math.max(1, input.participantIds.length, seats),
  );
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
  const capacity = resolveDemoCapacity(input, room);
  if (room && capacity > Number(room.capacity)) {
    throw Object.assign(new Error('demoExceedsRoomCapacity'), { statusCode: 409 });
  }
  await assertParticipantAvailability(
    input.participantIds,
    startsAt,
    input.durationMinutes,
    excludeDemoLessonId,
  );
  return { course, school, room, startsAt, capacity };
};

const syncLeadInvitation = async (
  req: any,
  lead: Row,
  demo: Row,
  location: string,
) => {
  const nextStatus = lead.statusCode === 'paid' ? lead.statusCode : 'demo_invited';
  const updated = await updateRow('academy_leads', Number(lead.id), {
    demoAt: demo.scheduledAt,
    demoCourseId: demo.courseId,
    demoFormat: demo.format,
    demoLocation: location,
    demoAttended: false,
    demoResult: null,
    statusCode: nextStatus,
  });
  if (!updated) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
  if (lead.statusCode !== nextStatus) {
    await createStageHistory(
      Number(lead.id),
      String(lead.statusCode),
      nextStatus,
      Number(req.user.id),
      'Записан на демо-урок',
    );
    await handleLeadStatusEffects(req.actor!, updated, String(lead.statusCode));
  }
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
                  'leadId', participant.lead_id,
                  'status', participant.status,
                  'result', participant.result,
                  'contactName', lead.contact_name,
                  'studentName', lead.student_name,
                  'managerId', lead.manager_id
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
         LEFT JOIN academy_leads lead ON lead.id = participant.lead_id
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
      if (parsed.data.participantIds.length > 0) {
        await loadMutableLeads(req, parsed.data.participantIds);
      }
      const startsAt = new Date(parsed.data.scheduledAt);
      const [resources, participantConflict] = await Promise.all([
        getDemoResourceAvailability(parsed.data),
        parsed.data.participantIds.length > 0
          ? hasParticipantConflict(
            parsed.data.participantIds,
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

  router.post('/demo-lessons', async (req, res) => {
    if (!ensureSalesAccess(req, res)) return;
    const parsed = demoLessonMutationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'invalidData' });
    }
    try {
      await loadMutableLeads(req, parsed.data.participantIds);
      const demo = await withTransaction(async () => {
        await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
        const leads = await loadMutableLeads(req, parsed.data.participantIds, true);
        const resources = await assertDemoResources(parsed.data);
        const created = await insertRow('academy_demo_lessons', {
          courseId: parsed.data.courseId,
          schoolId: parsed.data.schoolId,
          roomId: parsed.data.format === 'offline' ? parsed.data.roomId : null,
          teacherId: parsed.data.teacherId,
          scheduledAt: resources.startsAt,
          durationMinutes: parsed.data.durationMinutes,
          format: parsed.data.format,
          capacity: resources.capacity,
          status: 'scheduled',
          notes: parsed.data.notes ?? null,
          createdBy: req.user!.id,
          updatedBy: req.user!.id,
        });
        for (const lead of leads) {
          await insertRow('academy_demo_lesson_participants', {
            demoLessonId: created.id,
            leadId: lead.id,
            status: 'invited',
          });
        }
        const location = parsed.data.format === 'online'
          ? 'online'
          : `${resources.school.name}, ${resources.room?.name ?? ''}`;
        for (const lead of leads) {
          await syncLeadInvitation(req, lead, created, location);
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
      await loadMutableLeads(req, parsed.data.leadIds);
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

        const leads = await loadMutableLeads(req, parsed.data.leadIds, true);
        const existingParticipants = await query(
          `SELECT * FROM academy_demo_lesson_participants
           WHERE demo_lesson_id = $1 AND lead_id = ANY($2::int[])
           ORDER BY lead_id
           FOR UPDATE`,
          [id, parsed.data.leadIds],
        );
        if (existingParticipants.some((participant) => participant.status !== 'cancelled')) {
          throw Object.assign(new Error('demoParticipantAlreadyEnrolled'), { statusCode: 409 });
        }
        const activeParticipants = await queryOne<{ count: number }>(
          `SELECT COUNT(*)::int AS count
           FROM academy_demo_lesson_participants
           WHERE demo_lesson_id = $1 AND status <> 'cancelled'`,
          [id],
        );
        if (Number(activeParticipants?.count ?? 0) + leads.length > Number(demo.capacity)) {
          throw Object.assign(new Error('demoCapacityExceeded'), { statusCode: 409 });
        }

        await assertParticipantAvailability(
          parsed.data.leadIds,
          new Date(demo.scheduledAt),
          Number(demo.durationMinutes),
          id,
        );
        const existingByLeadId = new Map(
          existingParticipants.map((participant) => [Number(participant.leadId), participant]),
        );
        for (const lead of leads) {
          const existing = existingByLeadId.get(Number(lead.id));
          if (existing) {
            await updateRow('academy_demo_lesson_participants', Number(existing.id), {
              status: 'invited',
              result: null,
            });
          } else {
            await insertRow('academy_demo_lesson_participants', {
              demoLessonId: id,
              leadId: lead.id,
              status: 'invited',
            });
          }
        }
        const location = demo.format === 'online'
          ? 'online'
          : `${demo.schoolName}, ${demo.roomName ?? ''}`;
        for (const lead of leads) {
          await syncLeadInvitation(req, lead, demo, location);
        }
        await createAudit(
          req.actor!,
          'ADD_ACADEMY_DEMO_PARTICIPANTS',
          'academy_demo_lesson',
          id,
          { demoLessonId: id, leadIds: parsed.data.leadIds },
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
        return res.status(403).json({ error: 'Lead mutation access required' });
      }
      const cancelled = await withTransaction(async () => {
        await query(`SELECT pg_advisory_xact_lock($1)`, [ACADEMY_SCHEDULING_ADVISORY_LOCK]);
        const locked = await queryOne(`SELECT * FROM academy_demo_lessons WHERE id = $1 FOR UPDATE`, [id]);
        if (!locked) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
        if (locked.status === 'completed') {
          throw Object.assign(new Error('completedDemoCannotBeCancelled'), { statusCode: 409 });
        }
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
        for (const participant of participants) {
          const lead = await queryOne(`SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE`, [participant.leadId]);
          if (!lead) continue;
          const ownsLegacyBooking = Boolean(
            lead.demoAt
            && new Date(lead.demoAt).getTime() === new Date(locked.scheduledAt).getTime(),
          );
          const shouldResetStatus = ownsLegacyBooking && lead.statusCode === 'demo_invited';
          const leadUpdate = await updateRow('academy_leads', Number(lead.id), {
            demoAt: ownsLegacyBooking ? null : undefined,
            demoCourseId: ownsLegacyBooking ? null : undefined,
            demoFormat: ownsLegacyBooking ? null : undefined,
            demoLocation: ownsLegacyBooking ? null : undefined,
            demoAttended: ownsLegacyBooking ? false : undefined,
            demoResult: ownsLegacyBooking ? parsed.data.reason : undefined,
            statusCode: shouldResetStatus ? 'qualified' : lead.statusCode,
          });
          if (!leadUpdate) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
          if (shouldResetStatus) {
            await createStageHistory(
              Number(lead.id),
              'demo_invited',
              'qualified',
              Number(req.user!.id),
              'Демо-урок отменён',
            );
            await handleLeadStatusEffects(req.actor!, leadUpdate, 'demo_invited');
          }
        }
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
      if (!hasLeadershipAccess(req.user) && participants.some((item) => !canManageParticipant(req, item))) {
        return res.status(403).json({ error: 'Lead mutation access required' });
      }
      const participantLeadIds = new Set(participants.map((item) => Number(item.leadId)));
      if (parsed.data.participants.some((item) => !participantLeadIds.has(item.leadId))) {
        return res.status(400).json({ error: 'demoParticipantNotFound' });
      }
      const result = await withTransaction(async () => {
        const locked = await queryOne(`SELECT * FROM academy_demo_lessons WHERE id = $1 FOR UPDATE`, [id]);
        if (!locked) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
        if (locked.status === 'cancelled') {
          throw Object.assign(new Error('cancelledDemoAttendanceNotAllowed'), { statusCode: 409 });
        }
        for (const item of parsed.data.participants) {
          await query(
            `UPDATE academy_demo_lesson_participants
             SET status = $3, result = $4, updated_at = NOW()
             WHERE demo_lesson_id = $1 AND lead_id = $2`,
            [id, item.leadId, item.status, item.result ?? null],
          );
          if (item.status === 'attended') {
            const lead = await queryOne(`SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE`, [item.leadId]);
            if (lead) {
              const updatedLead = await updateRow('academy_leads', item.leadId, {
                demoAttended: true,
                demoResult: item.result ?? null,
                statusCode: 'demo_attended',
              });
              if (!updatedLead) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
              if (lead.statusCode !== 'demo_attended') {
                await createStageHistory(
                  item.leadId,
                  String(lead.statusCode),
                  'demo_attended',
                  Number(req.user!.id),
                  'Посещение демо-урока отмечено',
                );
                await handleLeadStatusEffects(req.actor!, updatedLead, String(lead.statusCode));
              }
            }
          }
        }
        const pending = await queryOne<{ count: number }>(
          `SELECT COUNT(*)::int AS count
           FROM academy_demo_lesson_participants
           WHERE demo_lesson_id = $1 AND status IN ('invited', 'confirmed')`,
          [id],
        );
        const updated = Number(pending?.count ?? 0) === 0
          ? await updateRow('academy_demo_lessons', id, {
            status: 'completed',
            updatedBy: req.user!.id,
          })
          : locked;
        await createAudit(
          req.actor!,
          'UPDATE_ACADEMY_DEMO_ATTENDANCE',
          'academy_demo_lesson',
          id,
          parsed.data,
          locked,
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
