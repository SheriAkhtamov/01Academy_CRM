import type { ActorSource } from '../leads/domain/actor-context';
import { actorContextFrom } from '../leads/domain/actor-context';
import { createAudit, insertRow, query, queryOne, type Row } from './academy-core';
import { getSalesFunnelRole } from './sales-funnel-policy';
import { syncLeadManagerRelations } from './academy-leads';

type DemoLeadChange = { statusCode: string; demoAttended: boolean; funnelId?: number; managerId?: number | null;
  firstViewedAt?: null; firstViewedBy?: null };

/** Runs with the parent lead locked, in the same transaction as attendance. */
export async function prepareDemoFunnelHandoff(
  source: ActorSource, lead: Row, statusCode: string, demoLessonId: number,
): Promise<DemoLeadChange> {
  const change: DemoLeadChange = { statusCode, demoAttended: statusCode === 'demo_attended' };
  const role = await getSalesFunnelRole(lead.funnelId);
  if (!role) return change;
  const actor = actorContextFrom(source);

  if (role === 'hunter' && change.demoAttended) {
    const closer = await queryOne<{ id: number }>(
      `SELECT id FROM academy_sales_funnels WHERE workflow_role = 'closer' AND is_active = true FOR SHARE`,
    );
    if (!closer) throw Object.assign(new Error('salesFunnelRequired'), { statusCode: 409 });
    // Capture the original hunter before the lead and all related students
    // become unassigned. The subsequent claim fills only the closer slot.
    await query('SELECT academy_kpi_touch_lead($1)', [Number(lead.id)]);
    await query(
      `INSERT INTO academy_lead_funnel_handoffs(lead_id, from_funnel_id, from_manager_id, demo_lesson_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (lead_id) DO UPDATE SET from_funnel_id = EXCLUDED.from_funnel_id,
         from_manager_id = EXCLUDED.from_manager_id, demo_lesson_id = EXCLUDED.demo_lesson_id,
         handed_off_at = timezone('UTC', now()), returned_at = NULL`,
      [lead.id, lead.funnelId, lead.managerId ?? null, demoLessonId],
    );
    await syncLeadManagerRelations(Number(lead.id), null);
    await insertRow('academy_lead_assignment_history', {
      leadId: lead.id, fromManagerId: lead.managerId ?? null, toManagerId: null,
      changedBy: actor.userId, comment: 'Передан в очередь клозеров после демо',
    });
    await createAudit(source, 'QUEUE_ACADEMY_CLOSER_LEAD', 'academy_lead', Number(lead.id),
      { funnelId: closer.id, managerId: null, demoLessonId },
      { funnelId: lead.funnelId, managerId: lead.managerId });
    return { ...change, funnelId: Number(closer.id), managerId: null, firstViewedAt: null, firstViewedBy: null };
  }

  if (role === 'closer' && !change.demoAttended) {
    // A later no-show does not undo a real earlier attendance. Return only if
    // all attendance was corrected/cancelled and the lead is still at entry.
    const attended = await queryOne(
      `SELECT participant.id FROM academy_demo_lesson_participants participant
       JOIN academy_students student ON student.id = participant.student_id
       JOIN academy_demo_lessons demo ON demo.id = participant.demo_lesson_id
       WHERE student.lead_id = $1 AND participant.status = 'attended'
         AND demo.status IN ('scheduled', 'completed') LIMIT 1`, [lead.id],
    );
    if (attended) return { statusCode: 'demo_attended', demoAttended: true };
    // Once claimed, attendance corrections must not revoke the closer's work
    // or silently reattribute their recorded KPI events to a second closer.
    if (lead.managerId) return { statusCode: String(lead.statusCode), demoAttended: false };
    const handoff = await queryOne<{ fromFunnelId: number; fromManagerId: number | null; activeManagerId: number | null }>(
      `SELECT handoff.from_funnel_id, handoff.from_manager_id,
         CASE WHEN employee.is_active AND NOT employee.is_archived
           AND (employee.module = 'sales' OR EXISTS (
             SELECT 1 FROM user_modules WHERE user_id = employee.id AND module = 'sales'))
           AND academy_kpi_employee_role(employee.id) IS DISTINCT FROM 'closer' THEN employee.id END AS active_manager_id
       FROM academy_lead_funnel_handoffs handoff
       LEFT JOIN users employee ON employee.id = handoff.from_manager_id
       WHERE handoff.lead_id = $1 AND handoff.returned_at IS NULL FOR UPDATE OF handoff`, [lead.id],
    );
    if (!handoff) return { statusCode: String(lead.statusCode), demoAttended: false };
    await query(`UPDATE academy_lead_funnel_handoffs SET returned_at = timezone('UTC', now()) WHERE lead_id = $1`, [lead.id]);
    await syncLeadManagerRelations(Number(lead.id), handoff.activeManagerId ?? null);
    await insertRow('academy_lead_assignment_history', {
      leadId: lead.id, fromManagerId: lead.managerId ?? null, toManagerId: handoff.activeManagerId ?? null,
      changedBy: actor.userId, comment: 'Возвращён после исправления посещаемости демо',
    });
    await createAudit(source, 'RETURN_ACADEMY_HUNTER_LEAD', 'academy_lead', Number(lead.id),
      { funnelId: handoff.fromFunnelId, managerId: handoff.activeManagerId, demoLessonId },
      { funnelId: lead.funnelId, managerId: lead.managerId });
    return { ...change, funnelId: handoff.fromFunnelId, managerId: handoff.activeManagerId ?? null,
      firstViewedAt: null, firstViewedBy: null };
  }
  return change;
}
