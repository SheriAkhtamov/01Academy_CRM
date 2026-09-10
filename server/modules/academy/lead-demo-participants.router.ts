import type { Router } from 'express';
import type { LeadDemoParticipant } from '@shared/contracts/demo-lessons';
import { sendHttpError } from '../../lib/http-errors';
import { getLead } from './academy-leads';
import { ensureLeadRowAccess, ensureSalesAccess, parseId, query } from './academy-core';
import { canManageDemoParticipant, demoAttendanceManagerSql, demoFunnelRoleSql } from './demo-participant-access';

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
          demo.scheduled_at, participant.status, demo.status AS lesson_status,
          COALESCE(student.manager_id, lead.manager_id) AS manager_id,
          ${demoAttendanceManagerSql()} AS attendance_manager_id,
          ${demoFunnelRoleSql()} AS funnel_role
         FROM academy_demo_lesson_participants participant
         JOIN academy_demo_lessons demo ON demo.id = participant.demo_lesson_id
         JOIN academy_students student ON student.id = participant.student_id
         JOIN academy_leads lead ON lead.id = student.lead_id
         JOIN academy_courses course ON course.id = demo.course_id
         WHERE student.lead_id = $1 AND participant.status <> 'cancelled'
           AND demo.status IN ('scheduled', 'completed')
         ORDER BY demo.scheduled_at DESC, participant.id`, [id],
      );
      res.json(participants.map((participant) => ({ ...participant,
        canManage: !lead.isArchived && canManageDemoParticipant(req, participant),
      })));
    } catch (error) {
      sendHttpError(res, error, 'failedToLoadDemoLessons');
    }
  });
}
