import { pool } from '../../db';
import { kpiError, type KpiActor } from './kpi-repository';
import { isFullCycleKpiRole, type KpiLeadOwnership } from '@shared/sales-kpi';
import type { ActorSource } from '../../modules/leads/domain/actor-context';
import { createAudit, query, queryOne, withTransaction } from '../../modules/academy/academy-core';
import { transitionDemoLead } from '../../modules/academy/demo-lead-transition';
import {
  getActiveSalesManager,
  reassignLead,
} from '../../modules/academy/academy-leads';
import { assertSalesFunnelAssignment, assertSalesFunnelStage } from '../../modules/academy/sales-funnel-policy';

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
    && lead.actor_role !== 'closer' && !isFullCycleKpiRole(lead.actor_role)) throw kpiError(new Error('accessDenied'), 403);
  const inCloserQueue = !lead.is_archived && lead.workflow_role === 'closer' && lead.manager_id === null;
  return {
    hunter: lead.hunter_id ? { id: lead.hunter_id, name: lead.hunter_name ?? '' } : null,
    closer: lead.closer_id ? { id: lead.closer_id, name: lead.closer_name ?? '' } : null,
    inCloserQueue, canClaim: inCloserQueue && (lead.actor_role === 'closer' || isFullCycleKpiRole(lead.actor_role)), offerAt: lead.offer_at?.toISOString() ?? null,
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

export async function handoffKpiLead(
  actor: KpiActor,
  source: ActorSource,
  leadId: number,
  targetFunnelId?: number,
) {
  return withTransaction(async () => {
    const role = await queryOne<{ role: string | null }>('SELECT academy_kpi_employee_role($1) AS role', [actor.id]);
    if (!targetFunnelId && !actor.isAdministration
      && role?.role !== 'hunter' && !isFullCycleKpiRole(role?.role)) {
      throw kpiError(new Error('salesFunnelHunterOnly'), 403);
    }
    const lead = await queryOne(`SELECT lead.*, funnel.workflow_role
      FROM academy_leads lead
      JOIN academy_sales_funnels funnel ON funnel.id = lead.funnel_id
      WHERE lead.id = $1 FOR UPDATE OF lead`, [leadId]);
    if (!lead) throw kpiError(new Error('resourceNotFound'), 404);
    if (lead.isArchived || (!actor.isAdministration && Number(lead.managerId) !== actor.id)) {
      throw kpiError(new Error('accessDenied'), 403);
    }

    const targetFunnel = targetFunnelId
      ? await queryOne<{ id: number; workflowRole: string | null }>(
        `SELECT id, workflow_role
         FROM academy_sales_funnels
         WHERE id = $1 AND is_active = true
         FOR SHARE`,
        [targetFunnelId],
      )
      : null;
    if (targetFunnelId && !targetFunnel) throw kpiError(new Error('salesFunnelRequired'));
    if (targetFunnel && Number(targetFunnel.id) === Number(lead.funnelId)) {
      throw kpiError(new Error('invalidData'), 409);
    }
    const continuesToCloser = lead.workflowRole === 'hunter'
      && (!targetFunnel || targetFunnel.workflowRole === 'closer');
    if (continuesToCloser) {
      if (!actor.isAdministration && role?.role !== 'hunter' && !isFullCycleKpiRole(role?.role)) {
        throw kpiError(new Error('salesFunnelHunterOnly'), 403);
      }
      const updated = await transitionDemoLead(source, lead, 'demo_attended', null, null,
        'Продолжил работу с лидом после пробного');
      await createAudit(
        source,
        'CONTINUE_FULL_CYCLE_LEAD',
        'academy_lead',
        leadId,
        { funnelId: updated.funnelId, managerId: updated.managerId },
        { funnelId: lead.funnelId, managerId: lead.managerId },
      );
      return { id: Number(updated.id), mode: 'continue' };
    }

    if (targetFunnel) {
      if (lead.managerId) await assertSalesFunnelAssignment(targetFunnel.id, Number(lead.managerId));
      await assertSalesFunnelStage(targetFunnel.id, String(lead.statusCode));
      const updated = await queryOne(
        `UPDATE academy_leads
         SET funnel_id = $2, first_viewed_at = NULL, first_viewed_by = NULL,
             updated_at = timezone('UTC', now())
         WHERE id = $1
         RETURNING *`,
        [leadId, targetFunnel.id],
      );
      if (!updated) throw kpiError(new Error('resourceNotFound'), 404);
      await createAudit(
        source,
        'TRANSFER_LEAD_FUNNEL',
        'academy_lead',
        leadId,
        { funnelId: Number(targetFunnel.id), managerId: updated.managerId },
        { funnelId: lead.funnelId, managerId: lead.managerId },
      );
      return { id: Number(updated.id), mode: 'transfer', funnelId: Number(targetFunnel.id) };
    }
    throw kpiError(new Error('salesFunnelRequired'));
  });
}

export async function claimKpiLead(actor: KpiActor, source: ActorSource, leadId: number) {
  return withTransaction(async () => {
    const manager = await getActiveSalesManager(actor.id, true);
    const role = await queryOne('SELECT academy_kpi_employee_role($1) AS role', [actor.id]);
    if (role?.role !== 'closer' && !isFullCycleKpiRole(role?.role)) throw kpiError(new Error('salesFunnelCloserOnly'), 403);
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
