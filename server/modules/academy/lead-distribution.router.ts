import { Router } from 'express';
import type { LeadDistributionManager, LeadDistributionSettings } from '@shared/contracts/lead-distribution';
import { updateLeadDistributionRequestSchema } from '@shared/contracts/lead-distribution';
import { getPublicErrorMessage } from '../../lib/http-errors';
import { logger } from '../../lib/logger';
import { publishRealtimeEvent } from '../../realtime/realtime-hub';
import {
  createAudit,
  ensureAdministrationModuleAccess,
  query,
  queryOne,
  withTransaction,
} from './academy-core';

type DistributionSettingsRow = {
  enabled: boolean;
  defaultFunnelId: number | null;
  defaultFunnelName: string | null;
  unassignedNewLeadCount: number;
};

const eligibleManagersSql = `
  SELECT employee.id,
         employee.full_name
  FROM academy_sales_funnels funnel
  JOIN academy_sales_funnel_users assignment ON assignment.funnel_id = funnel.id
  JOIN users employee ON employee.id = assignment.user_id
  WHERE funnel.is_default = true
    AND funnel.is_active = true
    AND funnel.workflow_role = 'hunter'
    AND employee.is_active = true
    AND employee.is_archived = false
    AND (
      employee.module = 'sales'
      OR EXISTS (
        SELECT 1
        FROM user_modules access
        WHERE access.user_id = employee.id
          AND access.module = 'sales'
      )
    )
    AND academy_kpi_employee_role(employee.id) IS DISTINCT FROM 'closer'
  ORDER BY employee.id`;

export const readLeadDistributionSettings = async (): Promise<LeadDistributionSettings> => {
  const settings = await queryOne<DistributionSettingsRow>(
    `SELECT COALESCE(company.auto_lead_distribution_enabled, false) AS enabled,
            funnel.id AS default_funnel_id,
            funnel.name AS default_funnel_name,
            COUNT(lead.id)::int AS unassigned_new_lead_count
     FROM (SELECT * FROM academy_company_settings ORDER BY id LIMIT 1) company
     LEFT JOIN academy_sales_funnels funnel
       ON funnel.is_default = true
      AND funnel.is_active = true
      AND funnel.workflow_role = 'hunter'
     LEFT JOIN academy_leads lead
       ON lead.funnel_id = funnel.id
      AND lead.manager_id IS NULL
      AND lead.status_code = 'new_request'
      AND lead.is_archived = false
     GROUP BY company.auto_lead_distribution_enabled, funnel.id, funnel.name`,
  );
  const managers = await query<LeadDistributionManager>(eligibleManagersSql);

  return {
    enabled: settings?.enabled ?? false,
    defaultFunnelId: settings?.defaultFunnelId ?? null,
    defaultFunnelName: settings?.defaultFunnelName ?? null,
    eligibleManagers: managers,
    unassignedNewLeadCount: settings?.unassignedNewLeadCount ?? 0,
  };
};

export const registerAcademyLeadDistributionRoutes = (router: ReturnType<typeof Router>) => {
  router.get('/sales-lead-distribution', async (req, res) => {
    if (!ensureAdministrationModuleAccess(req, res)) return;
    try {
      res.json(await readLeadDistributionSettings());
    } catch (error) {
      logger.error('Failed to load automatic lead distribution settings', { error });
      res.status(500).json({ error: 'failedToLoadData' });
    }
  });

  router.patch('/sales-lead-distribution', async (req, res) => {
    if (!ensureAdministrationModuleAccess(req, res)) return;
    const input = updateLeadDistributionRequestSchema.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ error: 'invalidData' });
      return;
    }

    try {
      const result = await withTransaction(async () => {
        await query(`SELECT pg_advisory_xact_lock(hashtext('academy-auto-lead-distribution'))`);
        const current = await queryOne<{ id: number; enabled: boolean }>(
          `SELECT id, auto_lead_distribution_enabled AS enabled
           FROM academy_company_settings
           ORDER BY id
           LIMIT 1
           FOR UPDATE`,
        );
        if (!current) throw new Error('Company settings are unavailable');

        const before = await readLeadDistributionSettings();
        if (input.data.enabled && !before.defaultFunnelId) {
          throw Object.assign(new Error('autoLeadDistributionDefaultFunnelRequired'), { statusCode: 409 });
        }
        if (input.data.enabled && before.eligibleManagers.length === 0) {
          throw Object.assign(new Error('autoLeadDistributionNoManagers'), { statusCode: 409 });
        }

        await query(
          `UPDATE academy_company_settings
           SET auto_lead_distribution_enabled = $1,
               updated_by = $2,
               updated_at = timezone('UTC', now())
           WHERE id = $3`,
          [input.data.enabled, req.user!.id, current.id],
        );

        let distributedLeadCount = 0;
        if (input.data.enabled) {
          const assigned = await query<{ id: number }>(
            `WITH candidates AS MATERIALIZED (
               SELECT lead.id
               FROM academy_leads lead
               JOIN academy_sales_funnels funnel ON funnel.id = lead.funnel_id
               WHERE lead.manager_id IS NULL
                 AND lead.status_code = 'new_request'
                 AND lead.is_archived = false
                 AND funnel.is_default = true
                 AND funnel.is_active = true
                 AND funnel.workflow_role = 'hunter'
               ORDER BY lead.created_at, lead.id
               FOR UPDATE OF lead
             ), assigned AS (
               UPDATE academy_leads lead
               SET manager_id = academy_next_auto_lead_manager(lead.funnel_id),
                   first_viewed_at = NULL,
                   first_viewed_by = NULL,
                   updated_at = timezone('UTC', now())
               FROM candidates
               WHERE lead.id = candidates.id
               RETURNING lead.id, lead.manager_id
             ), history AS (
               INSERT INTO academy_lead_assignment_history
                 (lead_id, from_manager_id, to_manager_id, changed_by, comment)
               SELECT id, NULL, manager_id, $1, 'Автоматическое распределение'
               FROM assigned
               WHERE manager_id IS NOT NULL
               RETURNING lead_id
             )
             SELECT lead_id AS id FROM history`,
            [req.user!.id],
          );
          distributedLeadCount = assigned.length;
        }

        const after = await readLeadDistributionSettings();
        await createAudit(
          req.actor!,
          'UPDATE_AUTO_LEAD_DISTRIBUTION',
          'academy_company_settings',
          current.id,
          { ...after, distributedLeadCount },
          before,
        );
        return { ...after, distributedLeadCount };
      });

      publishRealtimeEvent({
        type: 'ACADEMY_LEAD_UPDATED',
        data: {
          autoDistributionEnabled: result.enabled,
          count: result.distributedLeadCount,
        },
      });
      res.json(result);
    } catch (error: any) {
      logger.error('Failed to update automatic lead distribution settings', { error });
      res.status(error.statusCode || 500).json({
        error: getPublicErrorMessage(error, 'Failed to update automatic lead distribution settings'),
      });
    }
  });
};
