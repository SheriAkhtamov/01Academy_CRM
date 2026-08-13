import type { Router } from 'express';
import {
  validateLeadForStatusChange,
  validateLeadStatusTransition,
} from '@shared/academy';
import {
  bulkArchiveLeadsRequestSchema,
  bulkUpdateLeadStatusRequestSchema,
} from '@shared/contracts/academy-leads';
import { getPublicErrorMessage } from '../../lib/http-errors';
import { logger } from '../../lib/logger';
import {
  LEAD_MODULES,
  canMutateLeadRow,
  createAudit,
  ensureModuleAccess,
  getActiveLeadStatus,
  isValidLeadArchiveReason,
  nullableText,
  query,
  withTransaction,
} from './academy-core';
import {
  createStageHistory,
  getActiveSalesManager,
  handleLeadStatusEffects,
  reassignLead,
} from './academy-leads';

export const registerAcademyBulkLeadActionRoutes = (router: Router) => {
  router.post('/leads/bulk-archive', async (req, res) => {
    if (!ensureModuleAccess(req, res, LEAD_MODULES, 'Lead write access required')) return;
    const input = bulkArchiveLeadsRequestSchema.safeParse(req.body);
    if (!input.success) {
      return res.status(400).json({ error: 'invalidData' });
    }

    try {
      const leadIds = [...new Set(input.data.leadIds)];
      const archiveReasonCode = nullableText(input.data.reason);
      if (!isValidLeadArchiveReason(archiveReasonCode)) {
        return res.status(400).json({ error: 'archiveReasonRequired' });
      }
      const customArchiveReason = nullableText(input.data.customReason);
      if (archiveReasonCode === 'other' && !customArchiveReason) {
        return res.status(400).json({ error: 'archiveCustomReasonRequired' });
      }
      if (customArchiveReason && customArchiveReason.length > 80) {
        return res.status(400).json({ error: 'archiveCustomReasonTooLong' });
      }
      const archiveReason = archiveReasonCode === 'other'
        ? customArchiveReason!
        : archiveReasonCode!;

      const result = await withTransaction(async () => {
        // Match the regular assignment flow's lock order (manager, then leads)
        // so a bulk archive cannot deadlock with a concurrent reassignment.
        const currentManager = input.data.assignToSelf === true
          ? await getActiveSalesManager(req.user!.id, true)
          : null;
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

        const activeLeads = leads.filter((lead) => !lead.isArchived);
        if (activeLeads.some((lead) => lead.statusCode === 'paid')) {
          throw Object.assign(new Error('paidLeadCannotArchive'), { statusCode: 409 });
        }
        const unassignedLeads = activeLeads.filter((lead) => !lead.managerId);
        if (unassignedLeads.length > 0 && input.data.assignToSelf !== true) {
          throw Object.assign(new Error('leadRequiresResponsibleManager'), { statusCode: 409 });
        }

        const beforeArchive = new Map<number, Record<string, unknown>>();
        let assignedCount = 0;
        for (const lead of activeLeads) {
          let leadBeforeArchive = lead;
          if (!lead.managerId && currentManager) {
            const assignedLead = await reassignLead(
              req.actor!,
              lead,
              currentManager,
              'Присвоено себе перед массовым архивированием',
            );
            await createAudit(
              req.actor!,
              'ASSIGN_ACADEMY_LEAD',
              'academy_lead',
              Number(assignedLead.id),
              assignedLead,
              lead,
            );
            leadBeforeArchive = assignedLead;
            assignedCount += 1;
          }
          beforeArchive.set(Number(lead.id), leadBeforeArchive);
        }

        if (activeLeads.length === 0) return { archivedCount: 0, assignedCount };
        const archivedLeads = await query(
          `UPDATE academy_leads
           SET is_archived = true,
               archive_reason = $1,
               archived_at = NOW(),
               archived_by = $2,
               updated_at = NOW()
           WHERE id = ANY($3::int[]) AND is_archived = false
           RETURNING *`,
          [archiveReason, req.user!.id, activeLeads.map((lead) => Number(lead.id))],
        );
        for (const archivedLead of archivedLeads) {
          await createAudit(
            req.actor!,
            'BULK_ARCHIVE_ACADEMY_LEAD',
            'academy_lead',
            Number(archivedLead.id),
            archivedLead,
            beforeArchive.get(Number(archivedLead.id)),
          );
        }
        return { archivedCount: archivedLeads.length, assignedCount };
      });

      res.json(result);
    } catch (error: any) {
      logger.error('Failed to bulk archive leads', { error });
      res.status(error.statusCode || 500).json({
        error: getPublicErrorMessage(error, 'Failed to archive leads'),
      });
    }
  });

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
