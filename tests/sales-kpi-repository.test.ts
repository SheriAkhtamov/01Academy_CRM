import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultKpiConfig, fullCycleKpiConfigSchema } from '../shared/sales-kpi';
const db = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), release: vi.fn() }));
vi.mock('../server/db', () => ({ pool: { query: db.query, connect: db.connect } }));
import { listKpiPlans, saveKpiPlan } from '../server/infrastructure/sales-kpi/kpi-repository';
import { setEmployeeKpiAssignment } from '../server/infrastructure/sales-kpi/employee-assignments';

const current = { id: 2, role: 'hunter', effective_month: '2026-09', config: defaultKpiConfig('hunter'), created_at: new Date('2026-09-01'), created_by: 1 };
describe('sales KPI version and employee transactions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-08T10:00:00+05:00'));
    db.connect.mockResolvedValue({ query: db.query, release: db.release });
    db.query.mockResolvedValue({ rows: [] });
  });
  afterEach(() => vi.useRealTimers());

  it('rolls back a conflicting plan version before writing anything', async () => {
    db.query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith('SELECT * FROM academy_sales_kpi_plans') ? [current] : [] }));
    await expect(saveKpiPlan(1, 'hunter', current.config, '2026-10', 1)).rejects.toMatchObject({ message: 'kpiVersionConflict', statusCode: 409 });
    expect(db.query).toHaveBeenCalledWith('ROLLBACK');
    expect(db.query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT'))).toBe(false);
    expect(db.release).toHaveBeenCalledOnce();
  });
  it('rejects current-month rule changes after any historical assignment, even when no one currently uses the role', async () => {
    db.query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith('SELECT * FROM academy_sales_kpi_plans') ? [current]
      : sql.includes('FROM academy_sales_kpi_assignments') ? [{ exists: 1 }] : [] }));
    await expect(saveKpiPlan(1, 'hunter', current.config, '2026-09', 2)).rejects.toThrow('kpiFutureRulesRequired');
    expect(db.query).toHaveBeenCalledWith('ROLLBACK');
  });
  it('appends a future version, records its audit and commits with a shared role lock', async () => {
    db.query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith('SELECT * FROM academy_sales_kpi_plans') ? [current]
      : sql.startsWith('INSERT INTO academy_sales_kpi_plans') ? [{ ...current, id: 3, effective_month: '2026-10' }] : [] }));
    expect(await saveKpiPlan(1, 'hunter', current.config, '2026-10', 2)).toMatchObject({ id: 3, effectiveMonth: '2026-10' });
    expect(db.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(10402, $1)', [1]);
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE_SALES_KPI_PLAN'))).toBe(true);
    expect(db.query).toHaveBeenLastCalledWith('COMMIT');
  });
  it('reports the same minimum month enforced by the plan writer', async () => {
    db.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('FROM academy_sales_kpi_plans') ? [current] : [{ role: 'hunter' }] }));
    expect((await listKpiPlans()).minimumEffectiveMonth).toEqual({ hunter: '2026-10', closer: '2026-09', full_cycle: '2026-09' });
  });
  it('assigns a first role this month and captures attribution in the supplied employee transaction', async () => {
    const executor = { query: db.query };
    await setEmployeeKpiAssignment(executor, 7, 'hunter', ['sales'], 1);
    expect(db.connect).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(10402, $1)', [1]);
    const insert = db.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO academy_sales_kpi_assignments'));
    expect(insert?.[1]).toEqual([7, '2026-09', 'hunter', 1]);
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes('academy_kpi_touch_lead'))).toBe(true);
  });
  it('schedules a role change next month and preserves current attribution', async () => {
    db.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('SELECT role, effective_month') ? [{ role: 'hunter', effective_month: '2026-09' }] : [] }));
    await setEmployeeKpiAssignment({ query: db.query }, 7, 'closer', ['sales'], 1);
    const insert = db.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO academy_sales_kpi_assignments'));
    expect(insert?.[1]).toEqual([7, '2026-10', 'closer', 1]);
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes('academy_kpi_touch_lead'))).toBe(false);
  });
  it('uses an independent plan lock for the full-cycle role', async () => {
    const executor = { query: db.query };
    await setEmployeeKpiAssignment(executor, 7, 'full_cycle', ['sales'], 1);
    expect(db.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(10402, $1)', [3]);
  });
  it('parses a full-cycle plan as two complete role configurations', async () => {
    const fullCycle = { hunter: defaultKpiConfig('hunter'), closer: defaultKpiConfig('closer') };
    db.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('FROM academy_sales_kpi_plans')
      ? [{ ...current, id: 4, role: 'full_cycle', config: fullCycle }] : [] }));
    const plans = await listKpiPlans();
    expect(fullCycleKpiConfigSchema.safeParse(plans.versions[0].config).success).toBe(true);
  });
  it('schedules removal when sales access is removed and rejects assigning KPI without sales access', async () => {
    db.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('SELECT role, effective_month') ? [{ role: 'hunter', effective_month: '2026-09' }] : [] }));
    await setEmployeeKpiAssignment({ query: db.query }, 7, undefined, ['teacher'], 1);
    const insert = db.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO academy_sales_kpi_assignments'));
    expect(insert?.[1]).toEqual([7, '2026-10', null, 1]);
    await expect(setEmployeeKpiAssignment({ query: db.query }, 7, 'hunter', ['teacher'], 1)).rejects.toThrow('kpiSalesModuleRequired');
  });
});
