import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { getAssignedModules, hasLeadershipAccess } from '@shared/academy';
import { kpiConfigSchema, kpiMonthSchema, kpiRoleSchema, kpiSaleReviewSchema, type KpiOverviewEmployee } from '@shared/sales-kpi';
import { calculateSalesKpi } from '@shared/sales-kpi-calculation';
import { kpiMonth } from '@shared/sales-kpi-time';
import { sendHttpError } from '../../../lib/http-errors';
import { logger } from '../../../lib/logger';
import { getKpiReportingEmployees, kpiError, listKpiAssignments, listKpiPlans, saveKpiPlan } from '../../../infrastructure/sales-kpi/kpi-repository';
import { readKpiFacts } from '../../../infrastructure/sales-kpi/kpi-facts';
import { claimKpiLead, handoffKpiLead, readKpiLeadOwnership, recordKpiOffer } from '../../../infrastructure/sales-kpi/kpi-handoff';
import { reviewKpiSale } from '../../../infrastructure/sales-kpi/kpi-sales-review';

const idSchema = z.coerce.number().int().positive();
const actor = (req: Request) => ({ id: Number(req.user!.id), isAdministration: hasLeadershipAccess(req.user) });
const endpoint = (fn: RequestHandler): RequestHandler => async (req, res, next) => {
  try { await fn(req, res, next); } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'invalidData' });
    logger.error('Sales KPI request failed', { error, path: req.path });
    sendHttpError(res, error, 'kpiRequestFailed');
  }
};
const requireAdmin: RequestHandler = (req, res, next) => {
  if (!hasLeadershipAccess(req.user)) return res.status(403).json({ error: 'adminAccessRequired' });
  next();
};

export function createSalesKpiRouter() {
  const router = Router();
  router.use('/sales-kpi', (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'authenticationRequired' });
    if (!getAssignedModules(req.user).some((module) => module === 'sales' || module === 'administration')) {
      return res.status(403).json({ error: 'accessDenied' });
    }
    next();
  });
  router.get('/sales-kpi/plans', requireAdmin, endpoint(async (_req, res) => { res.json(await listKpiPlans()); }));
  router.post('/sales-kpi/plans/:role', requireAdmin, endpoint(async (req, res) => {
    const role = kpiRoleSchema.parse(req.params.role);
    const input = z.object({ config: kpiConfigSchema, effectiveMonth: kpiMonthSchema, expectedVersionId: idSchema }).strict().parse(req.body);
    res.status(201).json(await saveKpiPlan(req.user!.id, role, input.config, input.effectiveMonth, input.expectedVersionId));
  }));
  router.get('/sales-kpi/assignments', requireAdmin, endpoint(async (_req, res) => { res.json(await listKpiAssignments()); }));
  router.get('/sales-kpi/overview', endpoint(async (req, res) => {
    const month = kpiMonthSchema.parse(req.query.month ?? kpiMonth());
    if (month > kpiMonth()) throw kpiError(new Error('invalidReportingPeriod'));
    const requested = req.query.managerId === undefined ? null : idSchema.parse(req.query.managerId);
    const currentActor = actor(req);
    if (!currentActor.isAdministration && requested && requested !== currentActor.id) throw kpiError(new Error('accessDenied'), 403);
    const managerId = currentActor.isAdministration ? requested : currentActor.id;
    const [employees, settings] = await Promise.all([getKpiReportingEmployees(month, managerId), listKpiPlans()]);
    const asOf = new Date().toISOString();
    const facts = await readKpiFacts(employees.map((employee) => employee.id), month, asOf);
    const result: KpiOverviewEmployee[] = employees.flatMap((employee) => {
      const version = settings.versions.find((plan) => plan.role === employee.role && plan.effectiveMonth <= month);
      return version ? [{ ...employee, version, calculation: calculateSalesKpi(employee.role, employee.id, month, version.config, facts, asOf) }] : [];
    });
    res.json({ month, asOf, employees: result });
  }));
  router.patch('/sales-kpi/payments/:id', endpoint(async (req, res) => {
    await reviewKpiSale(actor(req), idSchema.parse(req.params.id), kpiSaleReviewSchema.parse(req.body));
    res.json({ success: true });
  }));
  router.get('/sales-kpi/leads/:id', endpoint(async (req, res) => {
    res.json(await readKpiLeadOwnership(actor(req), idSchema.parse(req.params.id)));
  }));
  router.post('/sales-kpi/leads/:id/handoff', endpoint(async (req, res) => {
    res.json(await handoffKpiLead(actor(req), req, idSchema.parse(req.params.id)));
  }));
  router.post('/sales-kpi/leads/:id/claim', endpoint(async (req, res) => {
    res.json(await claimKpiLead(actor(req), req, idSchema.parse(req.params.id)));
  }));
  router.post('/sales-kpi/leads/:id/offer', endpoint(async (req, res) => {
    await recordKpiOffer(actor(req), req, idSchema.parse(req.params.id));
    res.json({ success: true });
  }));
  return router;
}
