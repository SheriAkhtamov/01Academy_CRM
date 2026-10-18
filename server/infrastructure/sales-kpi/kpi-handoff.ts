import { unassignedLeadVisibleToSalesSql } from '../../services/lead-distribution-visibility';
import { pool } from '../../db';
import { kpiError, type KpiActor } from './kpi-repository';
import { type KpiLeadOwnership } from '@shared/sales-kpi';
import type { ActorSource } from '../../modules/leads/domain/actor-context';
import { createAudit, insertRow, query, queryOne, withTransaction, resolveInitialLeadStatusCode } from '../../modules/academy/academy-core';
import {
  getActiveSalesManager,
  createStageHistory,
  reassignLead,
  syncLeadManagerRelations,
} from '../../modules/academy/academy-leads';
import { assertSalesFunnelAssignment } from '../../modules/academy/sales-funnel-policy';

export async function readKpiLeadOwnership(actor: KpiActor, leadId: number): Promise<KpiLeadOwnership> {
  const { rows: [lead] } = await pool.query<{
    manager_id: number | null; hunter_id: number | null; hunter_name: string | null;
    closer_id: number | null; closer_name: string | null; is_archived: boolean;
    offer_at: Date | null; is_assigned: boolean; is_unassigned_visible: boolean;
  }>(`SELECT lead.manager_id, lead.is_archived, tracked.hunter_id, hunter.full_name AS hunter_name,
      tracked.closer_id, closer.full_name AS closer_name, tracked.offer_at,
      EXISTS (SELECT 1 FROM academy_sales_funnel_users WHERE user_id = $2 AND funnel_id = lead.funnel_id) AS is_assigned,
      ${unassignedLeadVisibleToSalesSql('lead')} AS is_unassigned_visible
     FROM academy_leads lead LEFT JOIN academy_sales_kpi_leads tracked ON tracked.lead_id = lead.id
     LEFT JOIN users hunter ON hunter.id = tracked.hunter_id LEFT JOIN users closer ON closer.id = tracked.closer_id
     WHERE lead.id = $1`, [leadId, actor.id]);
  if (!lead) throw kpiError(new Error('resourceNotFound'), 404);
  // A past owner sees their own KPI details, but does not retain lead access.
  if (!actor.isAdministration && lead.manager_id !== null && lead.manager_id !== actor.id) throw kpiError(new Error('accessDenied'), 403);
  if (!actor.isAdministration && lead.manager_id === null && (!lead.is_assigned || !lead.is_unassigned_visible)) throw kpiError(new Error('accessDenied'), 403);
  const inCloserQueue = !lead.is_archived && lead.manager_id === null;
  return {
    hunter: lead.hunter_id ? { id: lead.hunter_id, name: lead.hunter_name ?? '' } : null,
    closer: lead.closer_id ? { id: lead.closer_id, name: lead.closer_name ?? '' } : null,
    inCloserQueue, canClaim: inCloserQueue, offerAt: lead.offer_at?.toISOString() ?? null,
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
  targetStageCode?: string,
) {
  return withTransaction(async () => {
    if (!targetFunnelId) throw kpiError(new Error('salesFunnelRequired'));
    // Funnel configuration changes take this lock before touching leads. Keep
    // the same order so a selected destination cannot disappear during transfer.
    await query(`SELECT pg_advisory_xact_lock(hashtext('academy-sales-funnels'))`);
    // Employee access changes and lead assignment lock the employee first.
    // Serializing here keeps the destination membership decision current.
    const owner = await queryOne<{ managerId: number | null }>(
      `SELECT (SELECT manager_id FROM academy_leads WHERE id = $1) AS manager_id
       FROM users employee
       WHERE employee.id = COALESCE((SELECT manager_id FROM academy_leads WHERE id = $1), $2)
       FOR UPDATE OF employee`,
      [leadId, actor.id],
    );
    const lead = await queryOne(`SELECT lead.*,
      EXISTS (SELECT 1 FROM academy_sales_funnel_users WHERE user_id = $2 AND funnel_id = lead.funnel_id) AS is_assigned
      FROM academy_leads lead WHERE lead.id = $1 FOR UPDATE OF lead`, [leadId, actor.id]);
    if (!lead) throw kpiError(new Error('resourceNotFound'), 404);
    if (lead.isArchived || (!actor.isAdministration && (
      lead.managerId == null ? !lead.isAssigned : Number(lead.managerId) !== actor.id
    ))) {
      throw kpiError(new Error('accessDenied'), 403);
    }
    if (Number(lead.managerId ?? 0) !== Number(owner?.managerId ?? 0)) {
      throw kpiError(new Error('invalidData'), 409);
    }

    const targetFunnel = await queryOne<{ id: number }>(
      `SELECT id
       FROM academy_sales_funnels
       WHERE id = $1 AND is_active = true
       FOR SHARE`,
      [targetFunnelId],
    );
    if (!targetFunnel) throw kpiError(new Error('salesFunnelRequired'));
    if (Number(targetFunnel.id) === Number(lead.funnelId)) {
      throw kpiError(new Error('invalidData'), 409);
    }
    const assignment = lead.managerId == null ? undefined : await queryOne(
      `SELECT user_id FROM academy_sales_funnel_users
       WHERE funnel_id = $1 AND user_id = $2 FOR SHARE`,
      [targetFunnel.id, Number(lead.managerId)],
    );
    let destinationStageCode: string;
    if (targetStageCode === undefined) {
      destinationStageCode = await resolveInitialLeadStatusCode(null, Number(targetFunnel.id));
    } else {
      const stage = await queryOne<{ code: string }>(
        `SELECT code FROM academy_lead_statuses
         WHERE code = $1 AND funnel_id = $2 AND is_active = true AND is_pipeline = true
         FOR SHARE`,
        [targetStageCode, Number(targetFunnel.id)],
      );
      if (!stage) throw kpiError(new Error('salesFunnelStageUnavailable'), 409);
      destinationStageCode = stage.code;
    }
    const updated = await queryOne(
      `UPDATE academy_leads
       SET funnel_id = $2, status_code = $3, manager_id = $4,
           first_viewed_at = NULL, first_viewed_by = NULL,
           updated_at = timezone('UTC', now())
       WHERE id = $1
       RETURNING *`,
      [leadId, targetFunnel.id, destinationStageCode, assignment ? Number(lead.managerId) : null],
    );
    if (!updated) throw kpiError(new Error('resourceNotFound'), 404);
    // Relations and history follow the persisted owner, including a free queue.
    const nextManagerId = updated.managerId == null ? null : Number(updated.managerId);
    await syncLeadManagerRelations(leadId, nextManagerId);
    if ((lead.managerId == null ? null : Number(lead.managerId)) !== nextManagerId) {
      await insertRow('academy_lead_assignment_history', {
        leadId,
        fromManagerId: lead.managerId ?? null,
        toManagerId: nextManagerId,
        changedBy: actor.id,
        comment: 'Перенос в другую воронку',
      });
    }
    await createStageHistory(leadId, String(lead.statusCode), destinationStageCode, actor.id, 'Перенос в другую воронку',
      { fromFunnelId: Number(lead.funnelId), toFunnelId: Number(targetFunnel.id) });
    await createAudit(
      source,
      'TRANSFER_LEAD_FUNNEL',
      'academy_lead',
      leadId,
      { funnelId: Number(targetFunnel.id), managerId: nextManagerId },
      { funnelId: lead.funnelId, managerId: lead.managerId },
    );
    return { id: Number(updated.id), mode: 'transfer', funnelId: Number(targetFunnel.id) };
  });
}

export async function claimKpiLead(actor: KpiActor, source: ActorSource, leadId: number) {
  return withTransaction(async () => {
    const manager = await getActiveSalesManager(actor.id, true);
    const lead = await queryOne(`SELECT lead.*, ${unassignedLeadVisibleToSalesSql('lead')} AS is_unassigned_visible FROM academy_leads lead
      WHERE lead.id = $1 FOR UPDATE OF lead`, [leadId]);
    if (!lead) throw kpiError(new Error('resourceNotFound'), 404);
    if (lead.isArchived) throw kpiError(new Error('accessDenied'), 403);
    if (Number(lead.managerId) === actor.id) return { id: leadId };
    if (lead.managerId != null) throw kpiError(new Error('closerLeadAlreadyClaimed'), 409);
    if (!lead.isUnassignedVisible) throw kpiError(new Error('accessDenied'), 403);
    await assertSalesFunnelAssignment(lead.funnelId, actor.id);
    const updated = await reassignLead(source, lead, manager, 'Лид взят в работу');
    await query('SELECT academy_kpi_touch_lead($1)', [leadId]);
    await createAudit(source, 'CLAIM_SALES_KPI_LEAD', 'academy_lead', leadId, { closerId: actor.id }, { managerId: null });
    return { id: updated.id };
  });
}
