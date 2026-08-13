import type { Router } from 'express';
import {
  validateLeadForStatusChange,
  validateLeadStatusTransition,
} from '@shared/academy';
import { bulkUpdateLeadStatusRequestSchema } from '@shared/contracts/academy-leads';
import { getPublicErrorMessage } from '../../lib/http-errors';
import { logger } from '../../lib/logger';
import {
  LEAD_MODULES,
  canMutateLeadRow,
  createAudit,
  ensureModuleAccess,
  getActiveLeadStatus,
  query,
  withTransaction,
} from './academy-core';
import {
  createStageHistory,
  handleLeadStatusEffects,
} from './academy-leads';

export const registerAcademyBulkLeadActionRoutes = (router: Router) => {
  router.post('/leads/bulk-status', async (req, res) => {
    if (!ensureModuleAccess(req, res, LEAD_MODULES, 'Lead write access required')) return;
    const input = bulkUpdateLeadStatusRequestSchema.safeParse(req.body);
    if (!input.success) {
      return res.status(400).json({ error: 'invalidData' });
    }

    try {
      const leadIds = [...new Set(input.data.leadIds)];
      const statusCode = input.data.statusCode;
      if (statusCode === 'paid') {
        return res.status(409).json({ error: 'paymentRequiredBeforePaid' });
      }

      const changes = await withTransaction(async () => {
        const targetStatus = await getActiveLeadStatus(statusCode, true);
        if (!targetStatus) {
          throw Object.assign(new Error('invalidLeadStatus'), { statusCode: 400 });
        }

        const leads = await query(
          `SELECT *
           FROM academy_leads
           WHERE id = ANY($1::int[])
           ORDER BY id
           FOR UPDATE`,
          [leadIds],
        );
        if (leads.length !== leadIds.length) {
          throw Object.assign(new Error('One or more leads were not found'), { statusCode: 404 });
        }

        for (const lead of leads) {
          if (!canMutateLeadRow(req.actor!, lead)) {
            throw Object.assign(new Error('Lead mutation access required'), { statusCode: 403 });
          }
        }
        const changedLeads = leads.filter((lead) => String(lead.statusCode) !== statusCode);
        for (const lead of changedLeads) {
          if (lead.isArchived) {
            throw Object.assign(new Error('archivedLeadMustBeRestoredBeforeUpdate'), { statusCode: 409 });
          }
          if (!lead.managerId) {
            throw Object.assign(new Error('leadRequiresResponsibleManager'), { statusCode: 409 });
          }
          const transitionError = validateLeadStatusTransition(String(lead.statusCode), statusCode);
          if (transitionError) {
            throw Object.assign(new Error(transitionError), { statusCode: 409 });
          }
          const validationError = validateLeadForStatusChange({
            nextStatus: statusCode,
            studentName: lead.studentName,
            studentAge: lead.studentAge,
            courseId: lead.courseId,
            enrolledGroupId: lead.enrolledGroupId,
          });
          if (validationError) {
            throw Object.assign(new Error(validationError), { statusCode: 409 });
          }
        }
        if (changedLeads.length === 0) return [];

        const changedIds = changedLeads.map((lead) => Number(lead.id));
        const updatedLeads = await query(
          `UPDATE academy_leads
           SET status_code = $1, updated_at = NOW()
           WHERE id = ANY($2::int[])
           RETURNING *`,
          [statusCode, changedIds],
        );
        const updatedById = new Map(updatedLeads.map((lead) => [Number(lead.id), lead]));
        for (const lead of changedLeads) {
          await createStageHistory(
            Number(lead.id),
            String(lead.statusCode),
            statusCode,
            req.user!.id,
            'Массовый перенос в воронке',
          );
        }
        return changedLeads.map((previous) => ({
          previous,
          updated: updatedById.get(Number(previous.id))!,
        }));
      });

      for (const change of changes) {
        await handleLeadStatusEffects(req.actor!, change.updated, String(change.previous.statusCode));
        await createAudit(
          req.actor!,
          'BULK_UPDATE_ACADEMY_LEAD_STATUS',
          'academy_lead',
          Number(change.updated.id),
          change.updated,
          change.previous,
        );
      }

      res.json({ updatedCount: changes.length, statusCode });
    } catch (error: any) {
      logger.error('Failed to bulk update lead status', { error });
      res.status(error.statusCode || 500).json({
        error: getPublicErrorMessage(error, 'Failed to update lead status'),
      });
    }
  });
};
