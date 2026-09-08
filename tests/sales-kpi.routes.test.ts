import express, { type Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultKpiConfig, type KpiPlanVersion } from '../shared/sales-kpi';

const mocks = vi.hoisted(() => ({ employees: vi.fn(), plans: vi.fn(), save: vi.fn(), assignments: vi.fn(), facts: vi.fn(),
  handoff: vi.fn(), ownership: vi.fn(), offer: vi.fn(), review: vi.fn() }));
vi.mock('../server/infrastructure/sales-kpi/kpi-repository', () => ({
  getKpiReportingEmployees: mocks.employees, listKpiPlans: mocks.plans, saveKpiPlan: mocks.save, listKpiAssignments: mocks.assignments,
  kpiError: (error: Error, statusCode = 400) => Object.assign(error, { statusCode }),
}));
vi.mock('../server/infrastructure/sales-kpi/kpi-facts', () => ({ readKpiFacts: mocks.facts }));
vi.mock('../server/infrastructure/sales-kpi/kpi-handoff', () => ({ handoffKpiLead: mocks.handoff, readKpiLeadOwnership: mocks.ownership, recordKpiOffer: mocks.offer }));
vi.mock('../server/infrastructure/sales-kpi/kpi-sales-review', () => ({ reviewKpiSale: mocks.review }));
vi.mock('../server/lib/logger', () => ({ logger: { error: vi.fn() } }));
import { createSalesKpiRouter } from '../server/modules/sales-kpi/http/kpi-router';

const appFor = (module: string | null = 'sales'): Express => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (module) req.user = { id: 7, fullName: 'Employee', module, modules: [module] } as typeof req.user;
    next();
  });
  app.use('/api/academy', createSalesKpiRouter());
  return app;
};
const path = '/api/academy/sales-kpi';
const version = (id: number, effectiveMonth: string, baseSalaryUzs: number): KpiPlanVersion => ({
  id, role: 'hunter', effectiveMonth, config: { ...defaultKpiConfig('hunter'), baseSalaryUzs },
  createdAt: '2026-09-01T00:00:00Z', createdBy: 1,
});

describe('sales KPI HTTP access and version selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-08T10:00:00+05:00'));
    mocks.employees.mockResolvedValue([{ id: 7, name: 'Employee', role: 'hunter', assignedAt: '2026-09-01T00:00:00Z' }]);
    mocks.plans.mockResolvedValue({ versions: [version(3, '2026-10', 5_000_000), version(2, '2026-09', 3_000_000), version(1, '2026-08', 2_000_000)] });
    mocks.facts.mockResolvedValue({ leads: [], trials: [], sales: [], surveys: [] });
  });
  afterEach(() => vi.useRealTimers());

  it.each([[null, 401], ['teacher', 403], ['marketing', 403]])('blocks overview for %s', async (module, status) => {
    expect((await request(appFor(module)).get(`${path}/overview`)).status).toBe(status);
    expect(mocks.facts).not.toHaveBeenCalled();
  });
  it('forces a sales employee to their own data and rejects a different requested employee', async () => {
    const app = appFor();
    const response = await request(app).get(`${path}/overview?month=2026-09`);
    expect(response.status).toBe(200);
    expect(mocks.employees).toHaveBeenCalledWith('2026-09', 7);
    expect(mocks.facts).toHaveBeenCalledWith([7], '2026-09', expect.any(String));
    expect(response.body.employees[0].version.id).toBe(2);
    expect(response.body.employees[0].calculation.totalUzs).toBe(3_000_000);
    expect((await request(app).get(`${path}/overview?managerId=8`)).status).toBe(403);
    expect(mocks.facts).toHaveBeenCalledTimes(1);
  });
  it('permits the administrator to view all employees or a selected employee', async () => {
    const app = appFor('administration');
    expect((await request(app).get(`${path}/overview`)).status).toBe(200);
    expect(mocks.employees).toHaveBeenLastCalledWith('2026-09', null);
    expect((await request(app).get(`${path}/overview?managerId=8`)).status).toBe(200);
    expect(mocks.employees).toHaveBeenLastCalledWith('2026-09', 8);
  });
  it('selects historical rules and rejects a future or malformed reporting month', async () => {
    const app = appFor();
    const response = await request(app).get(`${path}/overview?month=2026-08`);
    expect(response.body.employees[0].version.id).toBe(1);
    for (const month of ['2026-10', '2026-13', 'garbage']) expect((await request(app).get(`${path}/overview?month=${month}`)).status).toBe(400);
    expect(mocks.facts).toHaveBeenCalledTimes(1);
  });
  it('protects settings reads and writes from sales employees', async () => {
    const app = appFor();
    expect((await request(app).get(`${path}/plans`)).status).toBe(403);
    expect((await request(app).get(`${path}/assignments`)).status).toBe(403);
    expect((await request(app).post(`${path}/plans/hunter`).send({})).status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('validates a new version and passes its optimistic version token through unchanged', async () => {
    mocks.save.mockResolvedValue(version(4, '2026-10', 3_000_000));
    const app = appFor('administration');
    const body = { config: defaultKpiConfig('hunter'), effectiveMonth: '2026-10', expectedVersionId: 3 };
    expect((await request(app).post(`${path}/plans/hunter`).send(body)).status).toBe(201);
    expect(mocks.save).toHaveBeenCalledWith(7, 'hunter', body.config, '2026-10', 3);
    expect((await request(app).post(`${path}/plans/hunter`).send({ ...body, config: { ...body.config, baseSalaryUzs: -1 } })).status).toBe(400);
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });
  it('requires a cycle and an audit reason when classifying a renewal', async () => {
    const app = appFor();
    expect((await request(app).patch(`${path}/payments/10`).send({ kind: 'renewal', cycleKey: null, referralInitiated: false, reason: 'Renewal' })).status).toBe(400);
    expect(mocks.review).not.toHaveBeenCalled();
    const body = { kind: 'renewal', cycleKey: '2026-10', referralInitiated: false, reason: 'Confirmed renewal' };
    expect((await request(app).patch(`${path}/payments/10`).send(body)).status).toBe(200);
    expect(mocks.review).toHaveBeenCalledWith({ id: 7, isAdministration: false }, 10, body);
  });
});
