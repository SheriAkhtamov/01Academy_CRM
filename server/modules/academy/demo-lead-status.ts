import {
  canAdvanceLeadFromDemo,
  demoAttendanceStage,
  isDemoPipelineStage,
} from '@shared/demo-pipeline';
import { actorContextFrom, type ActorSource } from '../leads/domain/actor-context';
import { createAudit, query, updateRow, type Row } from './academy-core';
import { createStageHistory, handleLeadStatusEffects } from './academy-leads';

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
  const actor = actorContextFrom(source);
  for (const lead of lockedLeads) {
    if (!canAdvanceLeadFromDemo({ isArchived: lead.isArchived, statusCode: String(lead.statusCode) })) continue;

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
    const resultStage = latest ? demoAttendanceStage(latest.statuses, latest.status) : null;
    const nextStatus = resultStage ?? (isDemoPipelineStage(lead.statusCode) ? 'demo_invited' : null);
    if (!nextStatus) continue;
    const demoAttended = resultStage === 'demo_attended';
    if (lead.statusCode === nextStatus && lead.demoAttended === demoAttended) continue;

    // Protected stages cannot disappear after migration. Check explicitly so a
    // misconfigured deployment rolls back attendance instead of orphaning leads.
    const statuses = await query(
      `SELECT code FROM academy_lead_statuses
       WHERE code = $1 AND is_active = true AND is_pipeline = true`,
      [nextStatus],
    );
    if (statuses.length === 0) {
      throw Object.assign(new Error('invalidLeadStatus'), { statusCode: 409 });
    }
    const updated = await updateRow('academy_leads', Number(lead.id), {
      statusCode: nextStatus,
      demoAttended,
    });
    if (!updated) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
    if (lead.statusCode !== nextStatus) {
      await createStageHistory(
        Number(lead.id), String(lead.statusCode), nextStatus, actor.userId,
        `Автоматически по посещаемости учеников на демо #${latest?.id ?? changedDemoId}`,
      );
      await handleLeadStatusEffects(source, updated, String(lead.statusCode));
    }
    await createAudit(source, 'SYNC_ACADEMY_DEMO_LEAD_STATUS', 'academy_lead', Number(lead.id),
      { demoLessonId: changedDemoId, statusCode: nextStatus, demoAttended },
      { statusCode: lead.statusCode, demoAttended: lead.demoAttended });
  }
};
