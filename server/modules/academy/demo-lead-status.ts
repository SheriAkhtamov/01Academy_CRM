import type { ActorSource } from '../leads/domain/actor-context';
import { createAudit, query, type Row } from './academy-core';
import { recordDemoLeadAttendance } from './demo-lead-transition';

// Call inside the demo transaction, BEFORE locking students. Payments and lead
// lifecycle commands also lock parents before their children.
export const lockDemoParticipantLeads = (demoLessonId: number, addedStudentIds: number[] = []) => query(
  `SELECT lead.* FROM academy_leads lead
   WHERE lead.id IN (
     SELECT student.lead_id FROM academy_students student
     WHERE student.id IN (
       SELECT student_id FROM academy_demo_lesson_participants WHERE demo_lesson_id = $1
     ) OR student.id = ANY($2::int[])
   )
   ORDER BY lead.id FOR UPDATE OF lead`,
  [demoLessonId, addedStudentIds],
);

export const syncDemoLeadStatuses = async (
  source: ActorSource,
  changedDemoId: number,
  lockedLeads: Row[],
  includePendingChangedDemo = false,
) => {
  for (const lead of lockedLeads) {

    const demos = await query<{ id: number; status: string; statuses: string[] }>(
      `SELECT demo.id, demo.status, array_agg(participant.status ORDER BY participant.id) AS statuses
       FROM academy_demo_lessons demo
       JOIN academy_demo_lesson_participants participant ON participant.demo_lesson_id = demo.id
       JOIN academy_students student ON student.id = participant.student_id
       WHERE student.lead_id = $1
         AND demo.status IN ('scheduled', 'completed', 'not_conducted')
         AND participant.status <> 'cancelled'
       GROUP BY demo.id
       HAVING bool_or(participant.status = 'no_show'
         OR (participant.status = 'attended' AND demo.status <> 'not_conducted'))
         OR (demo.id = $2 AND $3::boolean)
       ORDER BY demo.scheduled_at DESC, demo.id DESC`,
      [lead.id, changedDemoId, includePendingChangedDemo],
    );
    // A later booking with no marks does not erase an earlier result. A reset
    // of the changed demo does, and an old edit cannot overrule a newer result.
    const latest = demos[0];
    const demoAttended = Boolean(latest && latest.status !== 'not_conducted' && latest.statuses.includes('attended'));
    if (lead.demoAttended === demoAttended) continue;
    const updated = await recordDemoLeadAttendance(source, lead, demoAttended);
    if (lead.statusCode === updated.statusCode && lead.funnelId === updated.funnelId
      && lead.demoAttended === updated.demoAttended) continue;
    await createAudit(source, 'SYNC_ACADEMY_DEMO_LEAD_STATUS', 'academy_lead', Number(lead.id),
      { demoLessonId: changedDemoId, statusCode: updated.statusCode, funnelId: updated.funnelId, demoAttended: updated.demoAttended },
      { statusCode: lead.statusCode, funnelId: lead.funnelId, demoAttended: lead.demoAttended });
  }
};
