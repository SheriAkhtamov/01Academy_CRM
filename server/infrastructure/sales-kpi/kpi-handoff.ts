import { pool } from '../../db';
import { kpiError, type KpiActor } from './kpi-repository';
import type { KpiLeadOwnership } from '@shared/sales-kpi';
import type { ActorSource } from '../../modules/leads/domain/actor-context';
import { createAudit, insertRow, query, queryOne, updateRow, withTransaction } from '../../modules/academy/academy-core';
import {
  createStageHistory,
  getActiveSalesManager,
  handleLeadStatusEffects,
  reassignLead,
  syncLeadManagerRelations,
} from '../../modules/academy/academy-leads';

export async function readKpiLeadOwnership(actor: KpiActor, leadId: number): Promise<KpiLeadOwnership> {
  const { rows: [lead] } = await pool.query<{
    manager_id: number | null; hunter_id: number | null; hunter_name: string | null;
    closer_id: number | null; closer_name: string | null; is_archived: boolean;
    offer_at: Date | null; workflow_role: string | null; actor_role: string | null;
  }>(`SELECT lead.manager_id, lead.is_archived, tracked.hunter_id, hunter.full_name AS hunter_name,
      tracked.closer_id, closer.full_name AS closer_name, tracked.offer_at,
      funnel.workflow_role, academy_kpi_employee_role($2) AS actor_role
     FROM academy_leads lead LEFT JOIN academy_sales_kpi_leads tracked ON tracked.lead_id = lead.id
     JOIN academy_sales_funnels funnel ON funnel.id = lead.funnel_id
     LEFT JOIN users hunter ON hunter.id = tracked.hunter_id LEFT JOIN users closer ON closer.id = tracked.closer_id
     WHERE lead.id = $1`, [leadId, actor.id]);
  if (!lead) throw kpiError(new Error('resourceNotFound'), 404);
  // A past owner sees their own KPI details, but does not retain lead access.
  if (!actor.isAdministration && lead.manager_id !== null && lead.manager_id !== actor.id) throw kpiError(new Error('accessDenied'), 403);
  if (!actor.isAdministration && lead.manager_id === null && lead.workflow_role === 'closer'
    && lead.actor_role !== 'closer') throw kpiError(new Error('accessDenied'), 403);
  const inCloserQueue = !lead.is_archived && lead.workflow_role === 'closer' && lead.manager_id === null;
  return {
    hunter: lead.hunter_id ? { id: lead.hunter_id, name: lead.hunter_name ?? '' } : null,
    closer: lead.closer_id ? { id: lead.closer_id, name: lead.closer_name ?? '' } : null,
    inCloserQueue, canClaim: inCloserQueue && lead.actor_role === 'closer', offerAt: lead.offer_at?.toISOString() ?? null,
    canRecordOffer: !lead.is_archived && !lead.offer_at && Boolean(lead.closer_id)
      && !inCloserQueue && (actor.isAdministration || lead.closer_id === actor.id),
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
      WHERE student.lead_id = $1 AND participant.status = 'attended' AND lesson.status IN ('scheduled', 'completed')
        AND lesson.scheduled_at <= timezone('UTC', now()) LIMIT 1`, [leadId]);
    if (!trial) throw kpiError(new Error('kpiAttendedTrialRequired'));
    await query('UPDATE academy_leads SET offer_at = COALESCE(offer_at, timezone(\'UTC\', now())), updated_at = timezone(\'UTC\', now()) WHERE id = $1', [leadId]);
    // A legacy offer timestamp may already exist in CRM. The explicit action
    // records the current event once without pretending it happened earlier.
    await query('UPDATE academy_sales_kpi_leads SET offer_at = COALESCE(offer_at, timezone(\'UTC\', now())) WHERE lead_id = $1', [leadId]);
    await createAudit(source, 'RECORD_SALES_KPI_OFFER', 'academy_lead', leadId, { sent: true });
  });
}

export async function handoffKpiLead(actor: KpiActor, source: ActorSource, leadId: number) {
  return withTransaction(async () => {
    const role = await queryOne<{ role: string | null }>('SELECT academy_kpi_employee_role($1) AS role', [actor.id]);
    if (!actor.isAdministration && !['hunter', 'full_cycle'].includes(role?.role ?? '')) {
      throw kpiError(new Error('salesFunnelHunterOnly'), 403);
    }

    const lead = await queryOne(`SELECT lead.*, funnel.workflow_role
      FROM academy_leads lead
      JOIN academy_sales_funnels funnel ON funnel.id = lead.funnel_id
      WHERE lead.id = $1 FOR UPDATE OF lead`, [leadId]);
    if (!lead) throw kpiError(new Error('resourceNotFound'), 404);
    if (lead.isArchived || lead.workflowRole !== 'hunter'
      || (!actor.isAdministration && Number(lead.managerId) !== actor.id)) {
      throw kpiError(new Error('accessDenied'), 403);
    }

    const closerFunnel = await queryOne<{ id: number }>(
      `SELECT id FROM academy_sales_funnels
       WHERE workflow_role = 'closer' AND is_active = true FOR SHARE`,
    );
    if (!closerFunnel) throw kpiError(new Error('salesFunnelRequired'), 409);

    // Freeze hunter attribution before the operational owner is released.
    await query('SELECT academy_kpi_touch_lead($1)', [leadId]);
    await query(
      `INSERT INTO academy_lead_funnel_handoffs(lead_id, from_funnel_id, from_manager_id, demo_lesson_id)
       VALUES ($1, $2, $3, NULL)
       ON CONFLICT (lead_id) DO UPDATE SET from_funnel_id = EXCLUDED.from_funnel_id,
         from_manager_id = EXCLUDED.from_manager_id, demo_lesson_id = NULL,
         handed_off_at = timezone('UTC', now()), returned_at = NULL`,
      [leadId, lead.funnelId, lead.managerId ?? null],
    );

    const retainsOwner = role?.role === 'full_cycle' && !actor.isAdministration;
    const nextManagerId = retainsOwner ? actor.id : null;
    const historyComment = retainsOwner
      ? 'Продолжил работу с лидом после пробного'
      : 'Передан в очередь клозеров вручную';
    const updated = await updateRow('academy_leads', leadId, {
      funnelId: closerFunnel.id,
      managerId: nextManagerId,
      statusCode: 'demo_attended',
      firstViewedAt: null,
      firstViewedBy: null,
    });
    if (!updated) throw kpiError(new Error('resourceNotFound'), 404);

    await syncLeadManagerRelations(leadId, nextManagerId);
    await insertRow('academy_lead_assignment_history', {
      leadId,
      fromManagerId: lead.managerId ?? null,
      toManagerId: nextManagerId,
      changedBy: actor.id,
      comment: historyComment,
    });
    if (String(lead.statusCode) !== 'demo_attended') {
      await createStageHistory(
        leadId,
        String(lead.statusCode),
        'demo_attended',
        actor.id,
        historyComment,
      );
      await handleLeadStatusEffects(source, updated, String(lead.statusCode));
    }
    await createAudit(
      source,
      retainsOwner ? 'CONTINUE_FULL_CYCLE_LEAD' : 'QUEUE_ACADEMY_CLOSER_LEAD',
      'academy_lead',
      leadId,
      { funnelId: closerFunnel.id, managerId: nextManagerId },
      { funnelId: lead.funnelId, managerId: lead.managerId },
    );
    return { id: Number(updated.id), mode: retainsOwner ? 'continue' : 'queue' };
  });
}

export async function claimKpiLead(actor: KpiActor, source: ActorSource, leadId: number) {
  return withTransaction(async () => {
    const manager = await getActiveSalesManager(actor.id, true);
    const role = await queryOne('SELECT academy_kpi_employee_role($1) AS role', [actor.id]);
    if (role?.role !== 'closer') throw kpiError(new Error('salesFunnelCloserOnly'), 403);
    const lead = await queryOne(`SELECT lead.*, funnel.workflow_role FROM academy_leads lead
      JOIN academy_sales_funnels funnel ON funnel.id = lead.funnel_id
      WHERE lead.id = $1 FOR UPDATE OF lead`, [leadId]);
    if (!lead) throw kpiError(new Error('resourceNotFound'), 404);
    if (lead.isArchived || lead.workflowRole !== 'closer') throw kpiError(new Error('accessDenied'), 403);
    if (Number(lead.managerId) === actor.id) return { id: leadId };
    if (lead.managerId != null) throw kpiError(new Error('closerLeadAlreadyClaimed'), 409);
    const updated = await reassignLead(source, lead, manager, 'Клозер взял лида в работу после демо');
    await query('SELECT academy_kpi_touch_lead($1)', [leadId]);
    await createAudit(source, 'CLAIM_SALES_KPI_LEAD', 'academy_lead', leadId, { closerId: actor.id }, { managerId: null });
    return { id: updated.id };
  });
}
