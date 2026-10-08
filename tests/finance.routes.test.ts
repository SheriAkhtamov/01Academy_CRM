import express from 'express';
import request from 'supertest';
import { types } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), release: vi.fn() }));
vi.mock('../server/db', () => ({ pool: { query: mocks.query, connect: mocks.connect } }));
vi.mock('../server/middleware/auth.middleware', () => ({
  requireFinanceAccess: (req: any, _res: any, next: () => void) => { req.user = { id: 1 }; next(); },
}));
vi.mock('../server/lib/logger', () => ({ logger: { error: vi.fn() } }));

const result = (rows: unknown[] = []) => ({ rows });
const originalTimezone = process.env.TZ;
const app = express();
app.use(express.json());
const { default: financeRoutes } = await import('../server/routes/finance.routes');
app.use('/api/finance', financeRoutes);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue(result());
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
});
afterEach(() => {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
});

describe('salary calendar dates', () => {
  it.each(['UTC', 'Asia/Tashkent', 'America/Los_Angeles', 'Asia/Tokyo'])(
    'accepts a future salary and returns unchanged DATE keys on host %s', async (timezone) => {
      process.env.TZ = timezone;
      const parsedDate = types.getTypeParser(1082)('2026-07-01');
      const statements: string[] = [];
      mocks.query.mockImplementation(async (sql: string, values: unknown[]) => {
        statements.push(sql);
        if (sql.includes('SELECT id, full_name, is_active')) return result([{ id: 7, full_name: 'Employee', is_active: true }]);
        if (sql.includes('SELECT * FROM academy_salary_rates')) return result([{ id: 10, effective_from: parsedDate, effective_to: null }]);
        if (sql.includes('INSERT INTO academy_salary_rates')) return result([{ id: 11, effective_from: types.getTypeParser(1082)(String(values[3])), effective_to: null }]);
        return result();
      });
      const response = await request(app).post('/api/finance/salary-rates').send({
        employeeUserId: 7, amountUzs: 6_000_000, effectiveFrom: '2026-08-01',
      });
      expect(response.status).toBe(201);
      expect(response.body.effectiveFrom).toBe('2026-08-01');
      expect(statements.some((sql) => sql.includes('SET effective_to'))).toBe(true);
      expect(statements.at(-1)).toBe('COMMIT');
    },
  );

  it('corrects an existing same-day rate instead of inserting a duplicate', async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id, full_name, is_active')) return result([{ id: 7, full_name: 'Employee', is_active: true }]);
      if (sql.includes('SELECT * FROM academy_salary_rates')) return result([{ id: 10, effective_from: types.getTypeParser(1082)('2026-07-01'), effective_to: null }]);
      if (sql.includes('UPDATE academy_salary_rates')) return result([{ id: 10, amount_uzs: 6_000_000, effective_from: '2026-07-01' }]);
      return result();
    });
    const response = await request(app).post('/api/finance/salary-rates').send({ employeeUserId: 7, amountUzs: 6_000_000, effectiveFrom: '2026-07-01' });
    expect(response.status).toBe(201);
    expect(response.body.id).toBe(10);
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO academy_salary_rates'))).toBe(false);
  });

  it('rejects invalid calendar dates and backdated rates', async () => {
    const invalid = await request(app).get('/api/finance/dashboard?from=2026-02-30&to=2026-03-01');
    expect(invalid.status).toBe(400);
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id, full_name, is_active')) return result([{ id: 7, full_name: 'Employee', is_active: true }]);
      if (sql.includes('SELECT * FROM academy_salary_rates')) return result([{ id: 10, effective_from: types.getTypeParser(1082)('2026-08-01') }]);
      return result();
    });
    const backdated = await request(app).post('/api/finance/salary-rates').send({ employeeUserId: 7, amountUzs: 6_000_000, effectiveFrom: '2026-07-01' });
    expect(backdated.status).toBe(409);
    expect(backdated.body.error).toBe('salaryRateCannotBeBackdated');
  });
});

describe('expense edit transaction', () => {
  const expense = () => ({ id: 5, category: 'other', title: 'Supplies', amount_uzs: 100_000, expense_date: new Date('2026-07-01T00:00:00Z'), method: 'cash', status: 'planned' });

  it('a PATCH waiting behind payment rejects the now-paid row without changing its amount', async () => {
    let state = expense();
    let owner: number | null = null;
    let count = 0;
    let releasePayment = () => {};
    let paymentAtUpdate = () => {};
    let patchAtSelect = () => {};
    const reachedPayment = new Promise<void>((resolve) => { paymentAtUpdate = resolve; });
    const reachedPatch = new Promise<void>((resolve) => { patchAtSelect = resolve; });
    const paymentGate = new Promise<void>((resolve) => { releasePayment = resolve; });
    const waiters: Array<() => void> = [];
    mocks.connect.mockImplementation(async () => {
      const id = ++count;
      const query = async (sql: string, values: any[] = []) => {
        if (sql.startsWith('SELECT * FROM academy_operating_expenses')) {
          if (id === 2) patchAtSelect();
          if (sql.includes('FOR UPDATE')) {
            while (owner !== null && owner !== id) await new Promise<void>((resolve) => waiters.push(resolve));
            owner = id;
          }
          return result([{ ...state }]);
        }
        if (sql.includes("SET status = 'paid'")) {
          paymentAtUpdate();
          await paymentGate;
          state = { ...state, status: 'paid' };
          return result([{ ...state }]);
        }
        if (sql.includes('SET category')) {
          if (sql.includes("status = 'planned'") && state.status !== 'planned') return result();
          state = { ...state, amount_uzs: values[5] };
          return result([{ ...state }]);
        }
        if (sql === 'COMMIT' || sql === 'ROLLBACK') {
          if (owner === id) owner = null;
          waiters.splice(0).forEach((wake) => wake());
        }
        return result();
      };
      return { query, release: mocks.release };
    });
    // The original non-transactional edit reads planned before the payment,
    // then updates the now-paid amount through pool.query.
    mocks.query.mockImplementation(async (sql: string, values: any[] = []) => {
      if (sql.startsWith('SELECT *')) { patchAtSelect(); return result([{ ...state }]); }
      if (sql.includes('SET category')) { await paymentGate; state = { ...state, amount_uzs: values[5] }; return result([{ ...state }]); }
      return result();
    });
    const payment = request(app).post('/api/finance/expenses/5/pay').send({ method: 'cash' }).then((response) => response);
    await reachedPayment;
    const patch = request(app).patch('/api/finance/expenses/5').send({ amountUzs: 2_000_000 }).then((response) => response);
    await reachedPatch;
    releasePayment();
    const [paidResponse, patchResponse] = await Promise.all([payment, patch]);
    expect(paidResponse.status).toBe(200);
    expect(patchResponse.status).toBe(409);
    expect(state).toMatchObject({ status: 'paid', amount_uzs: 100_000 });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('rolls back the edit when its audit insert fails', async () => {
    const original = expense();
    let state = { ...original };
    const statements: string[] = [];
    const query = vi.fn(async (sql: string, values: any[] = []) => {
      statements.push(sql);
      if (sql.startsWith('SELECT *')) return result([{ ...state }]);
      if (sql.includes('SET category')) { state = { ...state, amount_uzs: values[5] }; return result([{ ...state }]); }
      if (sql.includes('INSERT INTO audit_logs')) throw new Error('audit unavailable');
      if (sql === 'ROLLBACK') state = { ...original };
      return result();
    });
    mocks.connect.mockResolvedValue({ query, release: mocks.release });
    const response = await request(app).patch('/api/finance/expenses/5').send({ amountUzs: 200_000 });
    expect(response.status).toBe(500);
    expect(state.amount_uzs).toBe(100_000);
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('commits a valid planned expense edit together with its matching audit snapshot', async () => {
    const current = expense();
    mocks.query.mockImplementation(async (sql: string, values: any[]) => {
      if (sql.startsWith('SELECT *')) return result([current]);
      if (sql.includes('SET category')) return result([{ ...current, amount_uzs: values[5] }]);
      if (sql.includes('INSERT INTO audit_logs')) {
        expect(JSON.parse(values[4]).amountUzs).toBe(100_000);
        expect(JSON.parse(values[5]).amountUzs).toBe(200_000);
      }
      return result();
    });
    const response = await request(app).patch('/api/finance/expenses/5').send({ amountUzs: 200_000 });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'planned', amountUzs: 200_000 });
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });
});

describe('historical finance datasets', () => {
  it('keeps paid and pending employee history after archive and deleted employee snapshots distinct', async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM users u') && sql.includes('payout.id AS payout_id')) {
        expect(sql).toContain('OR payout.id IS NOT NULL');
        expect(sql).toContain('u.archived_at');
        return result([
          { employee_user_id: 7, employee_name: 'Archived paid', payout_id: 20, salary_rate_id: 10, base_salary_uzs: 4_000_000, amount_uzs: 5_000_000 },
          { employee_user_id: 8, employee_name: 'Archived unpaid', salary_rate_id: 11, base_salary_uzs: 3_000_000 },
        ]);
      }
      if (sql.includes('UNION ALL')) return result([
        { employee_user_id: null, employee_name: 'Deleted paid', payout_id: 21, salary_rate_id: 12, base_salary_uzs: 2_000_000, amount_uzs: 2_000_000 },
        { employee_user_id: null, employee_name: 'Deleted unpaid', salary_rate_id: 13, base_salary_uzs: 1_000_000 },
      ]);
      return result();
    });
    const response = await request(app).get('/api/finance/payroll?period=2026-07');
    expect(response.status).toBe(200);
    expect(response.body.entries.map((entry: any) => [entry.employeeKey, entry.status])).toEqual([
      ['user:7', 'paid'], ['user:8', 'pending'], ['rate:12', 'paid'], ['rate:13', 'pending'],
    ]);
    expect(response.body.summary).toMatchObject({ paidAmountUzs: 7_000_000, pendingAmountUzs: 4_000_000, payrollFundUzs: 11_000_000 });
  });

  it('includes archived and deleted unpaid accrual in the historical dashboard, without duplicating paid snapshots', async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT employee_user_id, salary_rate_id, amount_uzs, period')) return result([
        { employee_user_id: null, salary_rate_id: 12, amount_uzs: 2_000_000, period: '2026-07' },
      ]);
      if (sql.includes('CASE WHEN u.is_active = false')) {
        expect(sql).toContain('LEFT JOIN users u');
        expect(sql).toContain('employment_ended_on');
        return result([
          { id: 11, employee_user_id: 8, amount_uzs: 3_000_000, effective_from: '2026-07-01', effective_to: '2026-10-08' },
          { id: 12, employee_user_id: null, amount_uzs: 2_000_000, effective_from: '2026-07-01', effective_to: '2026-10-08' },
          { id: 13, employee_user_id: null, amount_uzs: 1_000_000, effective_from: '2026-07-01', effective_to: '2026-10-08' },
        ]);
      }
      return result();
    });
    const response = await request(app).get('/api/finance/dashboard?period=2026-07');
    expect(response.status).toBe(200);
    expect(response.body.summary.payrollExpenses).toBe(6_000_000);
    expect(response.body.summary.netProfit).toBe(-6_000_000);
  });

  it('can settle a deleted employee salary snapshot once and keeps the deleted employee FK null', async () => {
    let payout: any;
    mocks.query.mockImplementation(async (sql: string, values: unknown[]) => {
      if (sql.includes('SELECT * FROM academy_payroll_payouts')) return result(payout ? [payout] : []);
      if (sql.includes('SELECT NULL::integer AS id')) return result([{ id: null, full_name: 'Deleted employee', position: null, salary_rate_id: 13, amount_uzs: 1_000_000 }]);
      if (sql.includes('INSERT INTO academy_payroll_payouts')) {
        expect(values[1]).toBeNull();
        payout = { id: 50, employee_user_id: null, salary_rate_id: 13, amount_uzs: 1_100_000 };
        return result([payout]);
      }
      return result();
    });
    const body = { period: '2026-07', salaryRateId: 13, bonusUzs: 100_000, method: 'transfer' };
    const first = await request(app).post('/api/finance/payroll/payout').send(body);
    const second = await request(app).post('/api/finance/payroll/payout').send(body);
    expect(first.status).toBe(201);
    expect(second.body.id).toBe(50);
    expect(mocks.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO academy_payroll_payouts'))).toHaveLength(1);
  });

  it('settles archived and deleted historical debts through the same batch statement shown by the payroll summary', async () => {
    mocks.query.mockImplementation(async (sql: string, values: any[]) => {
      if (sql.includes('payout.id AS payout_id') && sql.includes('FROM users u')) return result([
        { employee_user_id: 8, employee_name: 'Archived unpaid', salary_rate_id: 11, base_salary_uzs: 3_000_000 },
      ]);
      if (sql.includes('UNION ALL')) return result([
        { employee_user_id: null, employee_name: 'Deleted unpaid', salary_rate_id: 13, base_salary_uzs: 1_000_000 },
      ]);
      if (sql.includes('SELECT u.id, u.full_name, u.position, rate.id')) {
        expect(sql).toContain('COALESCE(u.archived_at, u.updated_at)');
        return result([{ id: 8, full_name: 'Archived unpaid', salary_rate_id: 11, amount_uzs: 3_000_000 }]);
      }
      if (sql.includes('SELECT NULL::integer AS id')) return result([{ id: null, full_name: 'Deleted unpaid', salary_rate_id: 13, amount_uzs: 1_000_000 }]);
      if (sql.includes('INSERT INTO academy_payroll_payouts')) return result([{ id: values[4], employee_user_id: values[1], amount_uzs: values[8] }]);
      return result();
    });
    const response = await request(app).post('/api/finance/payroll/payout-all').send({ period: '2026-07', method: 'transfer' });
    expect(response.status).toBe(201);
    expect(response.body.count).toBe(2);
    expect(response.body.payouts.reduce((sum: number, payout: any) => sum + payout.amountUzs, 0)).toBe(4_000_000);
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });

  it('returns every monthly journal row so earlier expenses remain available to the client filter', async () => {
    const income = Array.from({ length: 301 }, (_, index) => ({ id: index + 1, amount_uzs: 100_000, occurred_at: new Date(2026, 6, 30, 12, index) }));
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM academy_payments p')) return result(income);
      if (sql.includes('FROM academy_operating_expenses e')) return result([{ id: 1, title: 'Earlier expense', amount_uzs: 50_000, occurred_at: '2026-07-01T06:00:00Z', category: 'rent' }]);
      return result();
    });
    const response = await request(app).get('/api/finance/transactions?period=2026-07');
    expect(response.status).toBe(200);
    expect(response.body.rows).toHaveLength(302);
    expect(response.body.rows.filter((row: any) => row.direction === 'out')).toMatchObject([{ id: 'expense-1', title: 'Earlier expense' }]);
    expect(response.body.rows.at(-1).id).toBe('expense-1');
  });
});
