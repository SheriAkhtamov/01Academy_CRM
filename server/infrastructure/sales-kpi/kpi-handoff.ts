import { pool } from '../../db';
import { kpiError, type KpiActor } from './kpi-repository';
import type { KpiLeadOwnership } from '@shared/sales-kpi';
import type { ActorSource } from '../../modules/leads/domain/actor-context';
import { createAudit, query, queryOne, withTransaction } from '../../modules/academy/academy-core';
import { getActiveSalesManager, reassignLead } from '../../modules/academy/academy-leads';

export async function readKpiLeadOwnership(actor: KpiActor, leadId: number): Promise<KpiLeadOwnership> {
  const { rows: [lead] } = await pool.query<{
    manager_id: number | null; hunter_id: number | null; hunter_name: string | null;
    closer_id: number | null; closer_name: string | null; is_archived: boolean;
    offer_at: Date | null;
  }>(`SELECT lead.manager_id, lead.is_archived, tracked.hunter_id, hunter.full_name AS hunter_name,
      tracked.closer_id, closer.full_name AS closer_name, tracked.offer_at
     FROM academy_leads lead LEFT JOIN academy_sales_kpi_leads tracked ON tracked.lead_id = lead.id
     LEFT JOIN users hunter ON hunter.id = tracked.hunter_id LEFT JOIN users closer ON closer.id = tracked.closer_id
     WHERE lead.id = $1`, [leadId]);
  if (!lead) throw kpiError(new Error('resourceNotFound'), 404);
  // A past owner sees their own KPI details, but does not retain lead access.
  if (!actor.isAdministration && lead.manager_id !== actor.id) throw kpiError(new Error('accessDenied'), 403);
  const { rows: roles } = await pool.query<{ role: string }>('SELECT academy_kpi_employee_role($1) AS role', [actor.id]);
  const canHandoff = !lead.is_archived && !lead.closer_id
    && (actor.isAdministration || (roles[0]?.role === 'hunter' && lead.hunter_id === actor.id));
  const { rows: closers } = canHandoff ? await pool.query<{ id: number; name: string }>(
    `SELECT id, full_name AS name FROM users WHERE academy_kpi_employee_role(id) = 'closer'
     ORDER BY full_name, id`,
  ) : { rows: [] };
  return {
    hunter: lead.hunter_id ? { id: lead.hunter_id, name: lead.hunter_name ?? '' } : null,
    closer: lead.closer_id ? { id: lead.closer_id, name: lead.closer_name ?? '' } : null,
    canHandoff, closers, offerAt: lead.offer_at?.toISOString() ?? null,
    canRecordOffer: !lead.is_archived && !lead.offer_at && Boolean(lead.closer_id)
      && (actor.isAdministration || lead.closer_id === actor.id),
  };
}

export async function recordKpiOffer(actor: KpiActor, source: ActorSource, leadId: number) {
  return withTransaction(async () => {
    const lead = await queryOne(`SELECT lead.*, tracked.closer_id FROM academy_leads lead
      JOIN academy_sales_kpi_leads tracked ON tracked.lead_id = lead.id
      WHERE lead.id = $1 FOR UPDATE OF lead`, [leadId]);
    if (!lead) throw kpiError(new Error('resourceNotFound'), 404);
    if (lead.isArchived || !actor.isAdministration && (Number(lead.managerId) !== actor.id || Number(lead.closerId) !== actor.id)) throw kpiError(new Error('accessDenied'), 403);
    const trial = await queryOne(`SELECT 1 FROM academy_demo_lesson_participants participant
      JOIN academy_students student ON student.id = participant.student_id
      JOIN academy_demo_lessons lesson ON lesson.id = participant.demo_lesson_id
      WHERE student.lead_id = $1 AND participant.status = 'attended' AND lesson.status = 'completed'
        AND lesson.scheduled_at <= timezone('UTC', now()) LIMIT 1`, [leadId]);
    if (!trial) throw kpiError(new Error('kpiAttendedTrialRequired'));
    await query('UPDATE academy_leads SET offer_at = COALESCE(offer_at, timezone(\'UTC\', now())), updated_at = timezone(\'UTC\', now()) WHERE id = $1', [leadId]);
    // A legacy offer timestamp may already exist in CRM. The explicit action
    // records the current event once without pretending it happened earlier.
    await query('UPDATE academy_sales_kpi_leads SET offer_at = COALESCE(offer_at, timezone(\'UTC\', now())) WHERE lead_id = $1', [leadId]);
    await createAudit(source, 'RECORD_SALES_KPI_OFFER', 'academy_lead', leadId, { sent: true });
  });
}

export async function handoffKpiLead(actor: KpiActor, source: ActorSource, leadId: number, closerId: number) {
  return withTransaction(async () => {
    const manager = await getActiveSalesManager(closerId, true);
    const lead = await queryOne('SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE', [leadId]);
    if (!lead) throw kpiError(new Error('resourceNotFound'), 404);
    if (lead.isArchived) throw kpiError(new Error('accessDenied'), 403);
    if (!actor.isAdministration && Number(lead.managerId) !== actor.id) throw kpiError(new Error('accessDenied'), 403);
    const roles = await queryOne('SELECT academy_kpi_employee_role($1) AS actor, academy_kpi_employee_role($2) AS closer', [actor.id, closerId]);
    if (!actor.isAdministration && roles?.actor !== 'hunter') throw kpiError(new Error('accessDenied'), 403);
    if (roles?.closer !== 'closer') throw kpiError(new Error('kpiCloserRequired'));
    const ownership = await queryOne('SELECT * FROM academy_sales_kpi_leads WHERE lead_id = $1 FOR UPDATE', [leadId]);
    if (ownership?.closerId) throw kpiError(new Error('kpiAlreadyHandedOff'), 409);
    const trial = await queryOne(`SELECT 1 FROM academy_demo_lesson_participants participant
      JOIN academy_students student ON student.id = participant.student_id
      JOIN academy_demo_lessons lesson ON lesson.id = participant.demo_lesson_id
      WHERE student.lead_id = $1 AND participant.status IN ('confirmed', 'attended')
        AND lesson.status IN ('scheduled', 'completed') LIMIT 1`, [leadId]);
    if (!trial) throw kpiError(new Error('kpiConfirmedTrialRequired'));
    const updated = await reassignLead(source, lead, manager, 'KPI hunter-to-closer handoff');
    // reassignLead preserves the CRM's lead/student/task assignment history.
    // Its trigger fills only the still-empty closer attribution slot.
    await query('SELECT academy_kpi_touch_lead($1)', [leadId]);
    await createAudit(source, 'HANDOFF_SALES_KPI_LEAD', 'academy_lead', leadId, { closerId }, { managerId: lead.managerId });
    return { id: updated.id };
  });
}
