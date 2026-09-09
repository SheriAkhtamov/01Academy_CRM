import { Router } from 'express';
import { logger } from '../../lib/logger';
import { getPublicErrorMessage } from '../../lib/http-errors';
import {
  isLeadIntegrationProvider,
  type LeadIntegrationProvider,
} from '../../services/lead-funnels';
import {
  createAudit,
  ensureAdministrationModuleAccess,
  ensureSalesAccess,
  nullableText,
  parseId,
  query,
  queryOne,
  withTransaction,
} from './academy-core';

const funnelListSql = `
  SELECT funnel.*,
         COUNT(DISTINCT lead.id)::int AS lead_count,
         COUNT(DISTINCT setting.provider)::int AS integration_count,
         COALESCE(
           jsonb_agg(DISTINCT setting.provider)
             FILTER (WHERE setting.provider IS NOT NULL),
           '[]'::jsonb
         ) AS integrations
  FROM academy_sales_funnels funnel
  LEFT JOIN academy_leads lead ON lead.funnel_id = funnel.id
  LEFT JOIN academy_integration_funnel_settings setting ON setting.funnel_id = funnel.id
  GROUP BY funnel.id
  ORDER BY funnel.is_default DESC, funnel.is_active DESC, funnel.created_at, funnel.id`;

const validateFunnelName = (value: unknown) => {
  const name = nullableText(value);
  if (!name) throw Object.assign(new Error('salesFunnelNameRequired'), { statusCode: 400 });
  if (name.length > 120) throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  return name;
};

export const parseFunnelIntegrations = (value: unknown): LeadIntegrationProvider[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  }
  const integrations = [...new Set(value.map(String))];
  if (integrations.some((provider) => !isLeadIntegrationProvider(provider))) {
    throw Object.assign(new Error('invalidData'), { statusCode: 400 });
  }
  return integrations as LeadIntegrationProvider[];
};

const syncFunnelIntegrations = async (
  funnelId: number,
  integrations: LeadIntegrationProvider[] | undefined,
  updatedBy: number,
  fallbackFunnelId?: number,
) => {
  if (integrations === undefined) return;

  const current = await query<{ provider: LeadIntegrationProvider }>(
    `SELECT provider
     FROM academy_integration_funnel_settings
     WHERE funnel_id = $1
     ORDER BY provider
     FOR UPDATE`,
    [funnelId],
  );
  const desired = new Set(integrations);
  const removed = current
    .map((setting) => setting.provider)
    .filter((provider) => !desired.has(provider));

  if (removed.length > 0) {
    if (!fallbackFunnelId || fallbackFunnelId === funnelId) {
      throw Object.assign(new Error('salesFunnelTransferTargetRequired'), { statusCode: 409 });
    }
    await query(
      `UPDATE academy_integration_funnel_settings
       SET funnel_id = $2, updated_by = $3, updated_at = NOW()
       WHERE funnel_id = $1 AND provider = ANY($4::text[])`,
      [funnelId, fallbackFunnelId, updatedBy, removed],
    );
  }

  if (integrations.length > 0) {
    await query(
      `INSERT INTO academy_integration_funnel_settings (provider, funnel_id, updated_by)
       SELECT provider, $1, $2
       FROM unnest($3::text[]) AS requested(provider)
       ON CONFLICT (provider) DO UPDATE
       SET funnel_id = EXCLUDED.funnel_id,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
      [funnelId, updatedBy, integrations],
    );
  }
};

const getFunnelIntegrations = async (funnelId: number) => (
  await query<{ provider: LeadIntegrationProvider }>(
    `SELECT provider
     FROM academy_integration_funnel_settings
     WHERE funnel_id = $1
     ORDER BY provider`,
    [funnelId],
  )
).map((setting) => setting.provider);

const mapUniqueViolation = (error: any) => {
  if (error?.code === '23505') {
    return Object.assign(new Error('salesFunnelNameExists'), { statusCode: 409 });
  }
  return error;
};

export const registerAcademyFunnelRoutes = (router: ReturnType<typeof Router>) => {
  router.get('/sales-funnels', async (req, res) => {
    if (!ensureSalesAccess(req, res)) return;
    try {
      res.json(await query(funnelListSql));
    } catch (error) {
      logger.error('Failed to fetch sales funnels', { error });
      res.status(500).json({ error: 'failedToLoadData' });
    }
  });

  router.post('/sales-funnels', async (req, res) => {
    if (!ensureAdministrationModuleAccess(req, res)) return;
    try {
      const name = validateFunnelName(req.body.name);
      const integrations = parseFunnelIntegrations(req.body.integrations);
      const funnel = await withTransaction(async () => {
        await query(`SELECT pg_advisory_xact_lock(hashtext('academy-sales-funnels'))`);
        const current = await query(`SELECT id FROM academy_sales_funnels ORDER BY id FOR UPDATE`);
        const isDefault = current.length === 0 || req.body.isDefault === true;
        const isActive = isDefault || req.body.isActive !== false;
        if (!isActive && integrations && integrations.length > 0) {
          throw Object.assign(new Error('salesFunnelInUseMustRemainActive'), { statusCode: 409 });
        }
        if (isDefault) {
          await query(`UPDATE academy_sales_funnels SET is_default = false, updated_at = NOW() WHERE is_default = true`);
        }
        const created = await queryOne<{ id: number } & Record<string, unknown>>(
          `INSERT INTO academy_sales_funnels (name, is_active, is_default)
           VALUES ($1, $2, $3)
           RETURNING *`,
          [name, isActive, isDefault],
        );
        if (!created) return undefined;
        await syncFunnelIntegrations(Number(created.id), integrations, req.user!.id);
        const savedIntegrations = await getFunnelIntegrations(Number(created.id));
        return {
          ...created,
          leadCount: 0,
          integrationCount: savedIntegrations.length,
          integrations: savedIntegrations,
        };
      });
      if (!funnel) throw new Error('Failed to create sales funnel');
      await createAudit(req, 'CREATE_ACADEMY_SALES_FUNNEL', 'academy_sales_funnel', Number(funnel.id), funnel);
      res.status(201).json(funnel);
    } catch (rawError: any) {
      const error = mapUniqueViolation(rawError);
      logger.error('Failed to create sales funnel', { error });
      res.status(error.statusCode || 500).json({
        error: getPublicErrorMessage(error, 'Failed to create sales funnel'),
      });
    }
  });

  router.patch('/sales-funnels/:id', async (req, res) => {
    if (!ensureAdministrationModuleAccess(req, res)) return;
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: 'invalidData' });
      const integrations = parseFunnelIntegrations(req.body.integrations);
      const funnel = await withTransaction(async () => {
        await query(`SELECT pg_advisory_xact_lock(hashtext('academy-sales-funnels'))`);
        const current = await queryOne(
          `SELECT funnel.*,
                  (SELECT COUNT(*)::int FROM academy_leads WHERE funnel_id = funnel.id) AS lead_count,
                  (SELECT COUNT(*)::int FROM academy_integration_funnel_settings WHERE funnel_id = funnel.id) AS integration_count
           FROM academy_sales_funnels funnel
           WHERE funnel.id = $1
           FOR UPDATE`,
          [id],
        );
        if (!current) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });

        const name = req.body.name === undefined ? String(current.name) : validateFunnelName(req.body.name);
        const makeDefault = req.body.isDefault === true;
        const isActive = makeDefault
          || (req.body.isActive === undefined ? current.isActive === true : req.body.isActive === true);
        if (current.isDefault === true && !isActive) {
          throw Object.assign(new Error('salesFunnelDefaultMustRemainActive'), { statusCode: 409 });
        }
        const integrationCountAfterSave = integrations === undefined
          ? Number(current.integrationCount)
          : integrations.length;
        if (!isActive && (Number(current.leadCount) > 0 || integrationCountAfterSave > 0)) {
          throw Object.assign(new Error('salesFunnelInUseMustRemainActive'), { statusCode: 409 });
        }
        const fallback = integrations === undefined
          ? undefined
          : await queryOne<{ id: number }>(
            `SELECT id
             FROM academy_sales_funnels
             WHERE is_default = true AND is_active = true AND id <> $1
             FOR SHARE`,
            [id],
          );
        if (makeDefault) {
          await query(
            `UPDATE academy_sales_funnels
             SET is_default = false, updated_at = NOW()
             WHERE is_default = true AND id <> $1`,
            [id],
          );
        }
        const updated = await queryOne<{ id: number } & Record<string, unknown>>(
          `UPDATE academy_sales_funnels
           SET name = $2,
               is_active = $3,
               is_default = CASE WHEN $4 THEN true ELSE is_default END,
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [id, name, isActive, makeDefault],
        );
        if (!updated) return undefined;
        await syncFunnelIntegrations(id, integrations, req.user!.id, Number(fallback?.id) || undefined);
        const savedIntegrations = await getFunnelIntegrations(id);
        return {
          ...updated,
          leadCount: Number(current.leadCount),
          integrationCount: savedIntegrations.length,
          integrations: savedIntegrations,
        };
      });
      if (!funnel) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
      await createAudit(req, 'UPDATE_ACADEMY_SALES_FUNNEL', 'academy_sales_funnel', id, funnel);
      res.json(funnel);
    } catch (rawError: any) {
      const error = mapUniqueViolation(rawError);
      logger.error('Failed to update sales funnel', { error, funnelId: req.params.id });
      res.status(error.statusCode || 500).json({
        error: getPublicErrorMessage(error, 'Failed to update sales funnel'),
      });
    }
  });

  router.delete('/sales-funnels/:id', async (req, res) => {
    if (!ensureAdministrationModuleAccess(req, res)) return;
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: 'invalidData' });
      const deleted = await withTransaction(async () => {
        const funnel = await queryOne(
          `SELECT funnel.*,
                  (SELECT COUNT(*)::int FROM academy_leads WHERE funnel_id = funnel.id) AS lead_count,
                  (SELECT COUNT(*)::int FROM academy_integration_funnel_settings WHERE funnel_id = funnel.id) AS integration_count
           FROM academy_sales_funnels funnel
           WHERE funnel.id = $1
           FOR UPDATE`,
          [id],
        );
        if (!funnel) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
        if (funnel.isDefault === true || Number(funnel.leadCount) > 0 || Number(funnel.integrationCount) > 0) {
          throw Object.assign(new Error('salesFunnelTransferRequired'), { statusCode: 409 });
        }
        await query(`DELETE FROM academy_sales_funnels WHERE id = $1`, [id]);
        return funnel;
      });
      await createAudit(req, 'DELETE_ACADEMY_SALES_FUNNEL', 'academy_sales_funnel', id, undefined, deleted);
      res.json({ ok: true });
    } catch (error: any) {
      logger.error('Failed to delete sales funnel', { error, funnelId: req.params.id });
      res.status(error.statusCode || 500).json({
        error: getPublicErrorMessage(error, 'Failed to delete sales funnel'),
      });
    }
  });

  router.post('/sales-funnels/:id/transfer-and-delete', async (req, res) => {
    if (!ensureAdministrationModuleAccess(req, res)) return;
    try {
      const id = parseId(req.params.id);
      const targetFunnelId = parseId(req.body.targetFunnelId);
      if (!id || !targetFunnelId || id === targetFunnelId) {
        return res.status(400).json({ error: 'salesFunnelTransferTargetRequired' });
      }
      const result = await withTransaction(async () => {
        await query(`SELECT pg_advisory_xact_lock(hashtext('academy-sales-funnels'))`);
        const funnels = await query(
          `SELECT *
           FROM academy_sales_funnels
           WHERE id = ANY($1::int[])
           ORDER BY id
           FOR UPDATE`,
          [[id, targetFunnelId]],
        );
        const source = funnels.find((funnel) => Number(funnel.id) === id);
        const target = funnels.find((funnel) => Number(funnel.id) === targetFunnelId);
        if (!source) throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
        if (!target || target.isActive !== true) {
          throw Object.assign(new Error('salesFunnelTransferTargetRequired'), { statusCode: 400 });
        }

        const movedLeads = await queryOne<{ count: number }>(
          `WITH moved AS (
             UPDATE academy_leads
             SET funnel_id = $2, updated_at = NOW()
             WHERE funnel_id = $1
             RETURNING id
           )
           SELECT COUNT(*)::int AS count FROM moved`,
          [id, targetFunnelId],
        );
        const movedIntegrations = await queryOne<{ count: number }>(
          `WITH moved AS (
             UPDATE academy_integration_funnel_settings
             SET funnel_id = $2, updated_by = $3, updated_at = NOW()
             WHERE funnel_id = $1
             RETURNING provider
           )
           SELECT COUNT(*)::int AS count FROM moved`,
          [id, targetFunnelId, req.user!.id],
        );
        if (source.isDefault === true) {
          await query(
            `UPDATE academy_sales_funnels
             SET is_default = false, updated_at = NOW()
             WHERE id = $1`,
            [id],
          );
          await query(
            `UPDATE academy_sales_funnels
             SET is_default = true, updated_at = NOW()
             WHERE id = $1`,
            [targetFunnelId],
          );
        }
        await query(`DELETE FROM academy_sales_funnels WHERE id = $1`, [id]);
        return {
          source,
          target,
          movedLeadCount: Number(movedLeads?.count ?? 0),
          movedIntegrationCount: Number(movedIntegrations?.count ?? 0),
        };
      });
      await createAudit(req, 'TRANSFER_AND_DELETE_ACADEMY_SALES_FUNNEL', 'academy_sales_funnel', id, result);
      res.json(result);
    } catch (error: any) {
      logger.error('Failed to transfer and delete sales funnel', { error, funnelId: req.params.id });
      res.status(error.statusCode || 500).json({
        error: getPublicErrorMessage(error, 'Failed to transfer and delete sales funnel'),
      });
    }
  });

  router.put('/integrations/:provider/funnel', async (req, res) => {
    if (!ensureAdministrationModuleAccess(req, res)) return;
    try {
      const provider = String(req.params.provider);
      const funnelId = parseId(req.body.funnelId);
      if (!isLeadIntegrationProvider(provider) || !funnelId) {
        return res.status(400).json({ error: 'salesFunnelRequired' });
      }
      const setting = await withTransaction(async () => {
        const funnel = await queryOne(
          `SELECT id, name
           FROM academy_sales_funnels
           WHERE id = $1 AND is_active = true
           FOR SHARE`,
          [funnelId],
        );
        if (!funnel) throw Object.assign(new Error('salesFunnelRequired'), { statusCode: 400 });
        const saved = await queryOne(
          `INSERT INTO academy_integration_funnel_settings (provider, funnel_id, updated_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (provider) DO UPDATE
           SET funnel_id = EXCLUDED.funnel_id,
               updated_by = EXCLUDED.updated_by,
               updated_at = NOW()
           RETURNING *`,
          [provider, funnelId, req.user!.id],
        );
        return { ...saved, funnelName: funnel.name };
      });
      await createAudit(req, 'UPDATE_INTEGRATION_SALES_FUNNEL', 'academy_integration', 0, setting);
      res.json(setting);
    } catch (error: any) {
      logger.error('Failed to update integration sales funnel', { error, provider: req.params.provider });
      res.status(error.statusCode || 500).json({
        error: getPublicErrorMessage(error, 'Failed to update integration sales funnel'),
      });
    }
  });
};
