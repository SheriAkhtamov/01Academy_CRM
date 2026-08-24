import type { Router } from 'express';
import { getAssignedModules, hasLeadershipAccess } from '@shared/academy';
import {
  leadSocialAccountDeleteRequestSchema,
  leadSocialAccountRequestSchema,
} from '@shared/contracts/academy-leads';
import { normalizeLeadSocialAccountValue } from '@shared/lead-channels';
import { getPublicErrorMessage } from '../../lib/http-errors';
import { logger } from '../../lib/logger';
import {
  LEAD_MODULES,
  type Row,
  canAccessLeadRow,
  canMutateLeadRow,
  createAudit,
  ensureModuleAccess,
  insertRow,
  parseId,
  query,
  queryOne,
  updateRow,
  withTransaction,
} from './academy-core';
import {
  getActiveSalesManager,
  getLead,
  reassignLead,
} from './academy-leads';

const prepareLeadForSocialAccountMutation = async (
  req: any,
  leadId: number,
  assignToSelf: boolean,
) => {
  const isScopedSalesUser = getAssignedModules(req.user).includes('sales')
    && !hasLeadershipAccess(req.user);
  // Keep the same lock order as regular lead reassignment: manager, then lead.
  const selfAssignmentManager = isScopedSalesUser && assignToSelf
    ? await getActiveSalesManager(Number(req.user!.id), true)
    : null;
  const lockedLead = await queryOne(
    `SELECT * FROM academy_leads WHERE id = $1 FOR UPDATE`,
    [leadId],
  );
  if (!lockedLead) {
    throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
  }
  if (!canAccessLeadRow(req.actor!, lockedLead)) {
    throw Object.assign(new Error('Lead access required'), { statusCode: 403 });
  }
  if (isScopedSalesUser && !lockedLead.managerId) {
    if (!assignToSelf) {
      throw Object.assign(new Error('leadAssignmentRequired'), { statusCode: 409 });
    }
    const assignedLead = await reassignLead(
      req.actor!,
      lockedLead,
      selfAssignmentManager!,
      'Присвоено себе перед изменением социальных аккаунтов',
    );
    await createAudit(
      req.actor!,
      'ASSIGN_ACADEMY_LEAD',
      'academy_lead',
      leadId,
      assignedLead,
      lockedLead,
    );
    return assignedLead;
  }
  if (!canMutateLeadRow(req.actor!, lockedLead)) {
    throw Object.assign(new Error('Lead mutation access required'), { statusCode: 403 });
  }
  return lockedLead;
};

const assertManualSocialAccount = (account: Row | null | undefined) => {
  if (!account) {
    throw Object.assign(new Error('leadSocialAccountNotFound'), { statusCode: 404 });
  }
  if (account.metadata?.source !== 'manual') {
    throw Object.assign(new Error('leadSocialAccountSystemManaged'), { statusCode: 409 });
  }
  return account;
};

const findDuplicateSocialAccount = (
  leadId: number,
  accountId: number | null,
  channel: string,
  handle: string,
) => queryOne(
  `SELECT id
   FROM academy_lead_channels
   WHERE lead_id = $1
     AND ($2::int IS NULL OR id <> $2)
     AND channel = $3
     AND (
       LOWER(REGEXP_REPLACE(COALESCE(handle, ''), '^@+', '')) = LOWER($4)
       OR (
         $3 = 'whatsapp'
         AND REGEXP_REPLACE(COALESCE(external_id, ''), '[^0-9]', '', 'g') = $4
       )
     )
   LIMIT 1`,
  [leadId, accountId, channel, handle],
);

export const registerAcademyLeadSocialAccountRoutes = (router: Router) => {
  router.post('/leads/:id/social-accounts', async (req, res) => {
    if (!ensureModuleAccess(req, res, LEAD_MODULES, 'Lead write access required')) return;
    const leadId = parseId(req.params.id);
    const input = leadSocialAccountRequestSchema.safeParse(req.body);
    if (!leadId || !input.success) {
      return res.status(400).json({ error: 'leadSocialAccountInvalid' });
    }
    const normalized = normalizeLeadSocialAccountValue(input.data.channel, input.data.value);
    if (!normalized) return res.status(400).json({ error: 'leadSocialAccountInvalid' });

    try {
      await withTransaction(async () => {
        await prepareLeadForSocialAccountMutation(req, leadId, input.data.assignToSelf === true);
        const manualAccountCount = await queryOne<{ count: number }>(
          `SELECT COUNT(*)::int AS count
           FROM academy_lead_channels
           WHERE lead_id = $1 AND metadata ->> 'source' = 'manual'`,
          [leadId],
        );
        if (Number(manualAccountCount?.count ?? 0) >= 20) {
          throw Object.assign(new Error('leadSocialAccountLimitReached'), { statusCode: 409 });
        }
        if (await findDuplicateSocialAccount(
          leadId,
          null,
          normalized.channel,
          normalized.handle,
        )) {
          throw Object.assign(new Error('leadSocialAccountDuplicate'), { statusCode: 409 });
        }
        const created = await insertRow('academy_lead_channels', {
          leadId,
          channel: normalized.channel,
          providerAccountId: '',
          externalId: null,
          handle: normalized.handle,
          displayName: null,
          profileUrl: normalized.profileUrl,
          metadata: {
            source: 'manual',
            createdBy: req.user!.id,
          },
        });
        await createAudit(
          req.actor!,
          'ADD_ACADEMY_LEAD_SOCIAL_ACCOUNT',
          'academy_lead',
          leadId,
          created,
        );
      });
      res.status(201).json(await getLead(leadId));
    } catch (error: any) {
      logger.error('Failed to add lead social account', { error, leadId });
      res.status(error.statusCode || 500).json({
        error: getPublicErrorMessage(error, 'leadSocialAccountAddFailed'),
      });
    }
  });

  router.patch('/leads/:id/social-accounts/:accountId', async (req, res) => {
    if (!ensureModuleAccess(req, res, LEAD_MODULES, 'Lead write access required')) return;
    const leadId = parseId(req.params.id);
    const accountId = parseId(req.params.accountId);
    const input = leadSocialAccountRequestSchema.safeParse(req.body);
    if (!leadId || !accountId || !input.success) {
      return res.status(400).json({ error: 'leadSocialAccountInvalid' });
    }
    const normalized = normalizeLeadSocialAccountValue(input.data.channel, input.data.value);
    if (!normalized) return res.status(400).json({ error: 'leadSocialAccountInvalid' });

    try {
      await withTransaction(async () => {
        await prepareLeadForSocialAccountMutation(req, leadId, input.data.assignToSelf === true);
        const oldAccount = assertManualSocialAccount(await queryOne(
          `SELECT *
           FROM academy_lead_channels
           WHERE id = $1 AND lead_id = $2
           FOR UPDATE`,
          [accountId, leadId],
        ));
        if (await findDuplicateSocialAccount(
          leadId,
          accountId,
          normalized.channel,
          normalized.handle,
        )) {
          throw Object.assign(new Error('leadSocialAccountDuplicate'), { statusCode: 409 });
        }
        const updated = await updateRow('academy_lead_channels', accountId, {
          channel: normalized.channel,
          handle: normalized.handle,
          profileUrl: normalized.profileUrl,
          metadata: {
            ...oldAccount.metadata,
            source: 'manual',
            updatedBy: req.user!.id,
          },
        });
        await createAudit(
          req.actor!,
          'UPDATE_ACADEMY_LEAD_SOCIAL_ACCOUNT',
          'academy_lead',
          leadId,
          updated,
          oldAccount,
        );
      });
      res.json(await getLead(leadId));
    } catch (error: any) {
      logger.error('Failed to update lead social account', { error, leadId, accountId });
      res.status(error.statusCode || 500).json({
        error: getPublicErrorMessage(error, 'leadSocialAccountUpdateFailed'),
      });
    }
  });

  router.delete('/leads/:id/social-accounts/:accountId', async (req, res) => {
    if (!ensureModuleAccess(req, res, LEAD_MODULES, 'Lead write access required')) return;
    const leadId = parseId(req.params.id);
    const accountId = parseId(req.params.accountId);
    const input = leadSocialAccountDeleteRequestSchema.safeParse(req.body ?? {});
    if (!leadId || !accountId || !input.success) {
      return res.status(400).json({ error: 'invalidData' });
    }

    try {
      await withTransaction(async () => {
        await prepareLeadForSocialAccountMutation(req, leadId, input.data.assignToSelf === true);
        const oldAccount = assertManualSocialAccount(await queryOne(
          `SELECT *
           FROM academy_lead_channels
           WHERE id = $1 AND lead_id = $2
           FOR UPDATE`,
          [accountId, leadId],
        ));
        await query(`DELETE FROM academy_lead_channels WHERE id = $1`, [accountId]);
        await createAudit(
          req.actor!,
          'DELETE_ACADEMY_LEAD_SOCIAL_ACCOUNT',
          'academy_lead',
          leadId,
          null,
          oldAccount,
        );
      });
      res.json(await getLead(leadId));
    } catch (error: any) {
      logger.error('Failed to delete lead social account', { error, leadId, accountId });
      res.status(error.statusCode || 500).json({
        error: getPublicErrorMessage(error, 'leadSocialAccountDeleteFailed'),
      });
    }
  });
};
