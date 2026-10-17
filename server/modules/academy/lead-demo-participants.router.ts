import type { Router } from 'express';
import type { LeadDemoParticipant } from '@shared/contracts/demo-lessons';
import { sendHttpError } from '../../lib/http-errors';
import { getLead } from './academy-leads';
import { ensureLeadRowAccess, ensureSalesAccess, parseId, query } from './academy-core';
import { canManageDemoParticipant, demoAttendanceManagerSql, demoFunnelRoleSql } from './demo-participant-access';
import { demoReminderProgressJoinSql } from './demo-reminder-progress';

export function registerLeadDemoParticipantRoutes(router: Router) {
  router.get('/leads/:id/demo-participants', async (req, res) => {
    if (!ensureSalesAccess(req, res)) return;
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: 'invalidData' });
      const lead = await getLead(id);
      if (!lead) return res.status(404).json({ error: 'resourceNotFound' });
      if (!ensureLeadRowAccess(req, res, lead)) return;
      const participants = await query<LeadDemoParticipant>(
        `SELECT participant.id AS participant_id, demo.id AS demo_lesson_id,
          student.id AS student_id, student.student_name, course.name AS course_name,
          demo.scheduled_at, participant.status,reminder_response.response AS reminder_response,
          reminder_response.response_at AS reminder_responded_at,reminder_delivery.delivery_status AS reminder_delivery_status,
          reminder_delivery.delivered_at AS reminder_delivered_at,reminder_progress.progress_status AS reminder_progress_status,
          demo.status AS lesson_status,
          COALESCE(student.manager_id, lead.manager_id) AS manager_id,
          ${demoAttendanceManagerSql()} AS attendance_manager_id,
          ${demoFunnelRoleSql()} AS funnel_role
         FROM academy_demo_lesson_participants participant
         JOIN academy_demo_lessons demo ON demo.id = participant.demo_lesson_id
         LEFT JOIN LATERAL (SELECT * FROM voice_reminder_participant_response(participant.id) LIMIT 1) reminder_response ON true
         LEFT JOIN LATERAL (SELECT * FROM voice_reminder_participant_delivery(participant.id) LIMIT 1) reminder_delivery ON true
         ${demoReminderProgressJoinSql()}
         JOIN academy_students student ON student.id = participant.student_id
         JOIN academy_leads lead ON lead.id = student.lead_id
         JOIN academy_courses course ON course.id = demo.course_id
         WHERE student.lead_id = $1 AND participant.status <> 'cancelled'
           AND demo.status IN ('scheduled', 'completed')
         ORDER BY demo.scheduled_at DESC, participant.id`, [id],
      );
      res.json(participants.map((participant) => ({ ...participant,
        reminderResponse: !lead.isArchived && canManageDemoParticipant(req, participant) ? participant.reminderResponse : null,
        reminderRespondedAt: !lead.isArchived && canManageDemoParticipant(req, participant) ? participant.reminderRespondedAt : null,
        reminderDeliveryStatus: !lead.isArchived && canManageDemoParticipant(req, participant) ? participant.reminderDeliveryStatus : null,
        reminderDeliveredAt: !lead.isArchived && canManageDemoParticipant(req, participant) ? participant.reminderDeliveredAt : null,
        reminderProgressStatus: !lead.isArchived && canManageDemoParticipant(req, participant) ? participant.reminderProgressStatus : null,
        canManage: !lead.isArchived && canManageDemoParticipant(req, participant),
      })));
    } catch (error) {
      sendHttpError(res, error, 'failedToLoadDemoLessons');
    }
  });
}
