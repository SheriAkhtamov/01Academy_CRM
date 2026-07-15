import { Router } from 'express';
import type { Pool, PoolClient } from 'pg';
import { pool } from '../db';
import { requireFinanceAccess } from '../middleware/auth.middleware';
import { logger } from '../lib/logger';
import {
  getTrailingZonedMonthRanges,
  getZonedDateOnlyRange,
  getZonedMonthRange,
  zonedWallClockToInstant,
  type ZonedMonthRange,
} from '../lib/academy-time';
import {
  FINANCE_EXPENSE_CATEGORIES,
  FINANCE_EXPENSE_STATUSES,
  FINANCE_PAYMENT_METHODS,
  calculateAccruedPayrollExpense,
  calculateFinanceSummary,
  calculatePayrollAmount,
  calculatePercentageChange,
  isFinanceDate,
  isFinancePeriod,
} from '@shared/finance';

const router = Router();
const ACADEMY_TIME_ZONE = process.env.ACADEMY_TIME_ZONE?.trim() || 'Asia/Tashkent';
const MAX_MONEY_UZS = 2_147_483_647;

type Executor = Pool | PoolClient;
type Row = Record<string, any>;

router.use(requireFinanceAccess);

const toCamel = (key: string) => key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
const camelize = (row: Row) => Object.fromEntries(
  Object.entries(row).map(([key, value]) => [toCamel(key), value]),
);

const query = async <T = Row>(executor: Executor, sql: string, values: unknown[] = []) => {
  const result = await executor.query(sql, values);
  return result.rows.map(camelize) as T[];
};

const queryOne = async <T = Row>(executor: Executor, sql: string, values: unknown[] = []) =>
  (await query<T>(executor, sql, values))[0];

const withTransaction = async <T>(callback: (client: PoolClient) => Promise<T>) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const httpError = (message: string, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

const parsePositiveId = (value: unknown) => {
  const normalized = String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const parseMoney = (value: unknown, field: string, { allowZero = true } = {}) => {
  const amount = Number(value);
  if (
    !Number.isSafeInteger(amount)
    || amount < (allowZero ? 0 : 1)
    || amount > MAX_MONEY_UZS
  ) {
    throw httpError(`Invalid ${field}`);
  }
  return amount;
};

const nullableText = (value: unknown, maxLength = 2_000) => {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) throw httpError('invalidData');
  return normalized;
};

const periodReference = (period: string) => {
  const [year, month] = period.split('-').map(Number);
  return zonedWallClockToInstant({ year, month, day: 15, hour: 12 }, ACADEMY_TIME_ZONE);
};

const parsePeriod = (value: unknown) => {
  const period = String(value ?? '');
  if (!isFinancePeriod(period)) throw httpError('invalidFinancePeriod');
  return { period, range: getZonedMonthRange(periodReference(period), ACADEMY_TIME_ZONE) };
};

const parseExpenseDate = (value: unknown) => {
  if (!isFinanceDate(value)) throw httpError('invalidExpenseDate');
  const [year, month, day] = value.split('-').map(Number);
  const marker = new Date(Date.UTC(year, month - 1, day));
  if (
    marker.getUTCFullYear() !== year
    || marker.getUTCMonth() + 1 !== month
    || marker.getUTCDate() !== day
  ) {
    throw httpError('invalidExpenseDate');
  }
  return zonedWallClockToInstant({ year, month, day }, ACADEMY_TIME_ZONE);
};

const inRange = (value: unknown, range: ZonedMonthRange) => {
  const date = value instanceof Date ? value : new Date(String(value ?? ''));
  return !Number.isNaN(date.getTime()) && date >= range.start && date < range.end;
};

const marketingExpenseInsideRange = (expense: Row, range: ZonedMonthRange) => {
  const startMarker = expense.periodStart instanceof Date
    ? expense.periodStart
    : new Date(String(expense.periodStart));
  const endMarker = expense.periodEnd instanceof Date
    ? expense.periodEnd
    : new Date(String(expense.periodEnd));
  if (Number.isNaN(startMarker.getTime()) || Number.isNaN(endMarker.getTime())) return 0;

  const expenseStart = getZonedDateOnlyRange(startMarker, ACADEMY_TIME_ZONE).start;
  const expenseEnd = getZonedDateOnlyRange(endMarker, ACADEMY_TIME_ZONE).end;
  const overlapStart = Math.max(expenseStart.getTime(), range.start.getTime());
  const overlapEnd = Math.min(expenseEnd.getTime(), range.end.getTime());
  if (overlapEnd <= overlapStart) return 0;
  const duration = expenseEnd.getTime() - expenseStart.getTime();
  if (duration <= 0) return 0;
  return Math.round(Number(expense.amountUzs || 0) * ((overlapEnd - overlapStart) / duration));
};

const createAudit = async (
  executor: Executor,
  userId: number,
  action: string,
  entityType: string,
  entityId: number,
  newValues: Row,
  oldValues?: Row,
) => {
  await executor.query(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW())`,
    [userId, action, entityType, entityId, JSON.stringify(oldValues ?? null), JSON.stringify(newValues)],
  );
};

const getPayrollDataset = async (executor: Executor, period: string) => {
  const periodDate = `${period}-01`;
  const [entries, salaryHistory] = await Promise.all([
    query<Row>(
      executor,
      `SELECT u.id AS employee_user_id, u.full_name AS employee_name, u.position, u.workspace,
              rate.id AS salary_rate_id, COALESCE(rate.amount_uzs, 0) AS base_salary_uzs,
              rate.effective_from, rate.effective_to, rate.note AS salary_note,
              payout.id AS payout_id, COALESCE(payout.bonus_uzs, 0) AS bonus_uzs,
              COALESCE(payout.deduction_uzs, 0) AS deduction_uzs,
              payout.amount_uzs, payout.method, payout.note AS payout_note,
              payout.status, payout.paid_at, payer.full_name AS paid_by_name
       FROM users u
       LEFT JOIN LATERAL (
         SELECT sr.*
         FROM academy_salary_rates sr
         WHERE sr.employee_user_id = u.id
           AND sr.effective_from <= $1::date
           AND (sr.effective_to IS NULL OR sr.effective_to >= $1::date)
         ORDER BY sr.effective_from DESC, sr.id DESC
         LIMIT 1
       ) rate ON TRUE
       LEFT JOIN academy_payroll_payouts payout
         ON payout.employee_user_id = u.id AND payout.period = $2
       LEFT JOIN users payer ON payer.id = payout.paid_by
       WHERE u.is_active = true
       ORDER BY u.full_name`,
      [periodDate, period],
    ),
    query<Row>(
      executor,
      `SELECT sr.*, creator.full_name AS created_by_name
       FROM academy_salary_rates sr
       LEFT JOIN users creator ON creator.id = sr.created_by
       ORDER BY sr.employee_user_id, sr.effective_from DESC, sr.id DESC`,
    ),
  ]);

  const normalizedEntries = entries.map((entry) => ({
    ...entry,
    baseSalaryUzs: Number(entry.baseSalaryUzs || 0),
    bonusUzs: Number(entry.bonusUzs || 0),
    deductionUzs: Number(entry.deductionUzs || 0),
    amountUzs: entry.amountUzs === null || entry.amountUzs === undefined
      ? null
      : Number(entry.amountUzs),
    status: entry.payoutId ? 'paid' : entry.salaryRateId ? 'pending' : 'unconfigured',
  }));
  const paidAmountUzs = normalizedEntries.reduce(
    (sum, entry) => sum + (entry.status === 'paid' ? Number(entry.amountUzs || 0) : 0),
    0,
  );
  const pendingAmountUzs = normalizedEntries.reduce(
    (sum, entry) => sum + (entry.status === 'pending' ? Number(entry.baseSalaryUzs || 0) : 0),
    0,
  );

  return {
    period,
    entries: normalizedEntries,
    salaryHistory,
    summary: {
      payrollFundUzs: paidAmountUzs + pendingAmountUzs,
      paidAmountUzs,
      pendingAmountUzs,
      paidCount: normalizedEntries.filter((entry) => entry.status === 'paid').length,
      pendingCount: normalizedEntries.filter((entry) => entry.status === 'pending').length,
      unconfiguredCount: normalizedEntries.filter((entry) => entry.status === 'unconfigured').length,
    },
  };
};

const getTransactions = async (
  executor: Executor,
  range: ZonedMonthRange,
  period: string,
  limit = 250,
) => {
  const [income, operating, marketing, payroll] = await Promise.all([
    query<Row>(
      executor,
      `SELECT p.id, p.amount_uzs, p.status, p.method, p.paid_at AS occurred_at,
              COALESCE(st.student_name, l.student_name, st.contact_name, l.contact_name, 'Оплата ученика') AS title,
              COALESCE(manager.full_name, confirmer.full_name) AS counterparty
       FROM academy_payments p
       LEFT JOIN academy_students st ON st.id = p.student_id
       LEFT JOIN academy_leads l ON l.id = p.lead_id
       LEFT JOIN users manager ON manager.id = COALESCE(st.manager_id, l.manager_id)
       LEFT JOIN users confirmer ON confirmer.id = p.confirmed_by
       WHERE p.status = 'paid' AND p.paid_at >= $1 AND p.paid_at < $2
       ORDER BY p.paid_at DESC, p.id DESC`,
      [range.start, range.end],
    ),
    query<Row>(
      executor,
      `SELECT e.id, e.amount_uzs, e.status, e.method,
              COALESCE(e.paid_at, e.expense_date) AS occurred_at,
              e.title, COALESCE(e.vendor, creator.full_name) AS counterparty, e.category
       FROM academy_operating_expenses e
       LEFT JOIN users creator ON creator.id = e.created_by
       WHERE e.status = 'paid'
         AND COALESCE(e.paid_at, e.expense_date) >= $1
         AND COALESCE(e.paid_at, e.expense_date) < $2
       ORDER BY COALESCE(e.paid_at, e.expense_date) DESC, e.id DESC`,
      [range.start, range.end],
    ),
    query<Row>(
      executor,
      `SELECT e.id, e.amount_uzs, e.status,
              COALESCE(e.approved_at, e.period_start) AS occurred_at,
              COALESCE(e.campaign_name, e.channel) AS title,
              COALESCE(source.name, e.channel) AS counterparty
       FROM academy_marketing_expenses e
       LEFT JOIN academy_lead_sources source ON source.id = e.source_id
       WHERE e.status = 'approved'
         AND COALESCE(e.approved_at, e.period_start) >= $1
         AND COALESCE(e.approved_at, e.period_start) < $2
       ORDER BY COALESCE(e.approved_at, e.period_start) DESC, e.id DESC`,
      [range.start, range.end],
    ),
    query<Row>(
      executor,
      `SELECT p.id, p.amount_uzs, p.status, p.method, p.paid_at AS occurred_at,
              ('Зарплата · ' || p.employee_name) AS title,
              p.employee_name AS counterparty
       FROM academy_payroll_payouts p
       WHERE p.period = $1 AND p.status = 'paid'
       ORDER BY p.paid_at DESC, p.id DESC`,
      [period],
    ),
  ]);

  const transactions: Row[] = [
    ...income.map((item) => ({ ...item, id: `income-${item.id}`, kind: 'income', category: 'student_payments', direction: 'in' })),
    ...operating.map((item) => ({ ...item, id: `expense-${item.id}`, kind: 'operating_expense', direction: 'out' })),
    ...marketing.map((item) => ({ ...item, id: `marketing-${item.id}`, kind: 'marketing_expense', category: 'marketing', direction: 'out', method: null })),
    ...payroll.map((item) => ({ ...item, id: `payroll-${item.id}`, kind: 'payroll', category: 'payroll', direction: 'out' })),
  ];
  return transactions
    .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime())
    .slice(0, limit);
};

const loadDashboardRows = async (executor: Executor, ranges: ZonedMonthRange[]) => {
  const first = ranges[0];
  const last = ranges[ranges.length - 1];
  return Promise.all([
    query<Row>(
      executor,
      `SELECT amount_uzs, paid_at
       FROM academy_payments
       WHERE status = 'paid' AND paid_at >= $1 AND paid_at < $2`,
      [first.start, last.end],
    ),
    query<Row>(
      executor,
      `SELECT amount_uzs, expense_date, category
       FROM academy_operating_expenses
       WHERE status = 'paid' AND expense_date >= $1 AND expense_date < $2`,
      [first.start, last.end],
    ),
    query<Row>(
      executor,
      `SELECT employee_user_id, amount_uzs, period
       FROM academy_payroll_payouts
       WHERE status = 'paid' AND period >= $1 AND period <= $2`,
      [first.key, last.key],
    ),
    query<Row>(
      executor,
      `SELECT sr.employee_user_id, sr.amount_uzs, sr.effective_from, sr.effective_to
       FROM academy_salary_rates sr
       JOIN users u ON u.id = sr.employee_user_id AND u.is_active = true
       WHERE sr.effective_from <= $2::date
         AND (sr.effective_to IS NULL OR sr.effective_to >= $1::date)
       ORDER BY sr.employee_user_id, sr.effective_from DESC`,
      [`${first.key}-01`, `${last.key}-01`],
    ),
    query<Row>(
      executor,
      `SELECT amount_uzs, period_start, period_end
       FROM academy_marketing_expenses
       WHERE status = 'approved' AND period_end >= $1 AND period_start < $2`,
      [first.start, last.end],
    ),
  ]);
};

const buildRangeSummary = (
  range: ZonedMonthRange,
  payments: Row[],
  operatingExpenses: Row[],
  payrollPayouts: Row[],
  salaryRates: Row[],
  marketingExpenses: Row[],
) => {
  const paidForPeriod = payrollPayouts.filter((payout) => payout.period === range.key);
  return calculateFinanceSummary({
    revenue: payments
      .filter((payment) => inRange(payment.paidAt, range))
      .reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0),
    operatingExpenses: operatingExpenses
      .filter((expense) => inRange(expense.expenseDate, range))
      .reduce((sum, expense) => sum + Number(expense.amountUzs || 0), 0),
    payrollExpenses: calculateAccruedPayrollExpense({
      period: range.key,
      payouts: paidForPeriod,
      salaryRates,
    }),
    marketingExpenses: marketingExpenses
      .reduce((sum, expense) => sum + marketingExpenseInsideRange(expense, range), 0),
  });
};

router.get('/dashboard', async (req, res) => {
  try {
    const { period } = parsePeriod(req.query.period);
    const reference = periodReference(period);
    const ranges = getTrailingZonedMonthRanges(reference, ACADEMY_TIME_ZONE, 7);
    const [payments, operatingExpenses, payrollPayouts, salaryRates, marketingExpenses] = await loadDashboardRows(pool, ranges);
    const summaries = ranges.map((range) => ({
      period: range.key,
      ...buildRangeSummary(range, payments, operatingExpenses, payrollPayouts, salaryRates, marketingExpenses),
    }));
    const current = summaries[summaries.length - 1];
    const previous = summaries[summaries.length - 2];
    const currentRange = ranges[ranges.length - 1];
    const payroll = await getPayrollDataset(pool, period);
    const breakdown = new Map<string, number>([
      ['payroll', current.payrollExpenses],
      ['marketing', current.marketingExpenses],
    ]);
    for (const expense of operatingExpenses.filter((item) => inRange(item.expenseDate, currentRange))) {
      const category = String(expense.category || 'other');
      breakdown.set(category, (breakdown.get(category) ?? 0) + Number(expense.amountUzs || 0));
    }
    const recentTransactions = await getTransactions(pool, currentRange, period, 8);

    res.json({
      period,
      summary: {
        ...current,
        previousNetProfit: previous.netProfit,
        profitChangePercent: calculatePercentageChange(current.netProfit, previous.netProfit),
        payrollDueUzs: payroll.summary.pendingAmountUzs,
      },
      trend: summaries.slice(-6),
      expenseBreakdown: [...breakdown.entries()]
        .filter(([, amount]) => amount > 0)
        .map(([category, amount]) => ({ category, amount }))
        .sort((left, right) => right.amount - left.amount),
      recentTransactions,
      methodology: {
        revenue: 'paid_at',
        operatingExpenses: 'expense_date',
        payroll: 'payroll_period',
        marketing: 'prorated_campaign_period',
      },
    });
  } catch (error: any) {
    logger.error('Failed to load finance dashboard', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to load finance dashboard' });
  }
});

router.get('/income', async (req, res) => {
  try {
    const { period, range } = parsePeriod(req.query.period);
    const rows = await query<Row>(
      pool,
      `SELECT p.*, COALESCE(st.student_name, l.student_name, st.contact_name, l.contact_name) AS customer_name,
              course.name AS course_name, manager.full_name AS manager_name,
              confirmer.full_name AS confirmed_by_name
       FROM academy_payments p
       LEFT JOIN academy_students st ON st.id = p.student_id
       LEFT JOIN academy_leads l ON l.id = p.lead_id
       LEFT JOIN academy_courses course ON course.id = COALESCE(st.course_id, l.course_id)
       LEFT JOIN users manager ON manager.id = COALESCE(st.manager_id, l.manager_id)
       LEFT JOIN users confirmer ON confirmer.id = p.confirmed_by
       WHERE COALESCE(p.paid_at, p.created_at) >= $1 AND COALESCE(p.paid_at, p.created_at) < $2
       ORDER BY COALESCE(p.paid_at, p.created_at) DESC, p.id DESC`,
      [range.start, range.end],
    );
    const paid = rows.filter((row) => row.status === 'paid');
    res.json({
      period,
      rows,
      summary: {
        revenueUzs: paid.reduce((sum, row) => sum + Number(row.amountUzs || 0), 0),
        paidCount: paid.length,
        averagePaymentUzs: paid.length
          ? Math.round(paid.reduce((sum, row) => sum + Number(row.amountUzs || 0), 0) / paid.length)
          : 0,
        refundedUzs: rows
          .filter((row) => row.status === 'refunded')
          .reduce((sum, row) => sum + Number(row.amountUzs || 0), 0),
      },
    });
  } catch (error: any) {
    logger.error('Failed to load finance income', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to load finance income' });
  }
});

router.get('/expenses', async (req, res) => {
  try {
    const { period, range } = parsePeriod(req.query.period);
    const [operating, marketing] = await Promise.all([
      query<Row>(
        pool,
        `SELECT e.*, creator.full_name AS created_by_name, canceller.full_name AS cancelled_by_name
         FROM academy_operating_expenses e
         LEFT JOIN users creator ON creator.id = e.created_by
         LEFT JOIN users canceller ON canceller.id = e.cancelled_by
         WHERE e.expense_date >= $1 AND e.expense_date < $2
         ORDER BY e.expense_date DESC, e.id DESC`,
        [range.start, range.end],
      ),
      query<Row>(
        pool,
        `SELECT e.*, source.name AS source_name, creator.full_name AS created_by_name,
                approver.full_name AS approved_by_name
         FROM academy_marketing_expenses e
         LEFT JOIN academy_lead_sources source ON source.id = e.source_id
         LEFT JOIN users creator ON creator.id = e.created_by
         LEFT JOIN users approver ON approver.id = e.approved_by
         WHERE e.period_end >= $1 AND e.period_start < $2
         ORDER BY e.period_start DESC, e.id DESC`,
        [range.start, range.end],
      ),
    ]);
    const paidOperatingUzs = operating
      .filter((row) => row.status === 'paid')
      .reduce((sum, row) => sum + Number(row.amountUzs || 0), 0);
    const plannedOperatingUzs = operating
      .filter((row) => row.status === 'planned')
      .reduce((sum, row) => sum + Number(row.amountUzs || 0), 0);
    const marketingUzs = marketing
      .filter((row) => row.status === 'approved')
      .reduce((sum, row) => sum + marketingExpenseInsideRange(row, range), 0);

    res.json({
      period,
      operating,
      marketing: marketing.map((row) => ({
        ...row,
        recognizedAmountUzs: row.status === 'approved' ? marketingExpenseInsideRange(row, range) : 0,
      })),
      summary: {
        paidOperatingUzs,
        plannedOperatingUzs,
        marketingUzs,
        totalRecognizedUzs: paidOperatingUzs + marketingUzs,
      },
    });
  } catch (error: any) {
    logger.error('Failed to load finance expenses', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to load finance expenses' });
  }
});

router.post('/expenses', async (req, res) => {
  try {
    const category = String(req.body.category ?? '');
    const status = String(req.body.status ?? 'paid');
    const method = String(req.body.method ?? 'transfer');
    const title = nullableText(req.body.title, 255);
    if (!FINANCE_EXPENSE_CATEGORIES.includes(category as any)) throw httpError('invalidExpenseCategory');
    if (!FINANCE_EXPENSE_STATUSES.includes(status as any) || status === 'cancelled') throw httpError('invalidExpenseStatus');
    if (!FINANCE_PAYMENT_METHODS.includes(method as any)) throw httpError('invalidPaymentMethod');
    if (!title) throw httpError('expenseTitleRequired');
    const amountUzs = parseMoney(req.body.amountUzs, 'amountUzs', { allowZero: false });
    const expenseDate = parseExpenseDate(req.body.expenseDate);
    const row = await queryOne<Row>(
      pool,
      `INSERT INTO academy_operating_expenses
         (category, title, vendor, description, amount_uzs, expense_date, status, method, paid_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        category,
        title,
        nullableText(req.body.vendor, 255),
        nullableText(req.body.description),
        amountUzs,
        expenseDate,
        status,
        method,
        status === 'paid' ? expenseDate : null,
        req.user!.id,
      ],
    );
    await createAudit(pool, req.user!.id, 'CREATE_FINANCE_EXPENSE', 'academy_operating_expense', row.id, row);
    res.status(201).json(row);
  } catch (error: any) {
    logger.error('Failed to create finance expense', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to create finance expense' });
  }
});

router.patch('/expenses/:id', async (req, res) => {
  try {
    const id = parsePositiveId(req.params.id);
    if (!id) throw httpError('invalidExpenseId');
    const current = await queryOne<Row>(pool, `SELECT * FROM academy_operating_expenses WHERE id = $1`, [id]);
    if (!current) throw httpError('expenseNotFound', 404);
    if (current.status !== 'planned') throw httpError('onlyPlannedExpenseEditable', 409);
    const category = String(req.body.category ?? current.category);
    const method = String(req.body.method ?? current.method);
    if (!FINANCE_EXPENSE_CATEGORIES.includes(category as any)) throw httpError('invalidExpenseCategory');
    if (!FINANCE_PAYMENT_METHODS.includes(method as any)) throw httpError('invalidPaymentMethod');
    const title = req.body.title === undefined ? current.title : nullableText(req.body.title, 255);
    if (!title) throw httpError('expenseTitleRequired');
    const amountUzs = req.body.amountUzs === undefined
      ? Number(current.amountUzs)
      : parseMoney(req.body.amountUzs, 'amountUzs', { allowZero: false });
    const expenseDate = req.body.expenseDate === undefined
      ? current.expenseDate
      : parseExpenseDate(req.body.expenseDate);
    const updated = await queryOne<Row>(
      pool,
      `UPDATE academy_operating_expenses
       SET category = $2, title = $3, vendor = $4, description = $5, amount_uzs = $6,
           expense_date = $7, method = $8, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        category,
        title,
        req.body.vendor === undefined ? current.vendor : nullableText(req.body.vendor, 255),
        req.body.description === undefined ? current.description : nullableText(req.body.description),
        amountUzs,
        expenseDate,
        method,
      ],
    );
    await createAudit(pool, req.user!.id, 'UPDATE_FINANCE_EXPENSE', 'academy_operating_expense', id, updated, current);
    res.json(updated);
  } catch (error: any) {
    logger.error('Failed to update finance expense', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to update finance expense' });
  }
});

router.post('/expenses/:id/pay', async (req, res) => {
  try {
    const id = parsePositiveId(req.params.id);
    if (!id) throw httpError('invalidExpenseId');
    const row = await withTransaction(async (client) => {
      const current = await queryOne<Row>(client, `SELECT * FROM academy_operating_expenses WHERE id = $1 FOR UPDATE`, [id]);
      if (!current) throw httpError('expenseNotFound', 404);
      if (current.status === 'paid') return current;
      if (current.status !== 'planned') throw httpError('cancelledExpenseCannotBePaid', 409);
      const method = String(req.body.method ?? current.method ?? 'transfer');
      if (!FINANCE_PAYMENT_METHODS.includes(method as any)) throw httpError('invalidPaymentMethod');
      const paidAt = req.body.paidAt ? parseExpenseDate(req.body.paidAt) : new Date();
      const updated = await queryOne<Row>(
        client,
        `UPDATE academy_operating_expenses
         SET status = 'paid', method = $2, paid_at = $3, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id, method, paidAt],
      );
      await createAudit(client, req.user!.id, 'PAY_FINANCE_EXPENSE', 'academy_operating_expense', id, updated, current);
      return updated;
    });
    res.json(row);
  } catch (error: any) {
    logger.error('Failed to pay finance expense', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to pay finance expense' });
  }
});

router.post('/expenses/:id/cancel', async (req, res) => {
  try {
    const id = parsePositiveId(req.params.id);
    if (!id) throw httpError('invalidExpenseId');
    const reason = nullableText(req.body.reason);
    if (!reason) throw httpError('cancellationReasonRequired');
    const row = await withTransaction(async (client) => {
      const current = await queryOne<Row>(client, `SELECT * FROM academy_operating_expenses WHERE id = $1 FOR UPDATE`, [id]);
      if (!current) throw httpError('expenseNotFound', 404);
      if (current.status === 'cancelled') return current;
      if (current.status === 'paid') throw httpError('paidExpenseCannotBeCancelled', 409);
      const updated = await queryOne<Row>(
        client,
        `UPDATE academy_operating_expenses
         SET status = 'cancelled', cancelled_by = $2, cancelled_at = NOW(),
             cancellation_reason = $3, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id, req.user!.id, reason],
      );
      await createAudit(client, req.user!.id, 'CANCEL_FINANCE_EXPENSE', 'academy_operating_expense', id, updated, current);
      return updated;
    });
    res.json(row);
  } catch (error: any) {
    logger.error('Failed to cancel finance expense', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to cancel finance expense' });
  }
});

router.get('/payroll', async (req, res) => {
  try {
    const { period } = parsePeriod(req.query.period);
    res.json(await getPayrollDataset(pool, period));
  } catch (error: any) {
    logger.error('Failed to load finance payroll', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to load finance payroll' });
  }
});

router.post('/salary-rates', async (req, res) => {
  try {
    const employeeUserId = parsePositiveId(req.body.employeeUserId);
    if (!employeeUserId) throw httpError('employeeRequired');
    const amountUzs = parseMoney(req.body.amountUzs, 'amountUzs', { allowZero: false });
    const effectiveFrom = String(req.body.effectiveFrom ?? '');
    if (!isFinanceDate(effectiveFrom) || !effectiveFrom.endsWith('-01')) {
      throw httpError('salaryMustStartOnFirstDay');
    }
    parseExpenseDate(effectiveFrom);
    const period = effectiveFrom.slice(0, 7);
    const row = await withTransaction(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`salary-rate:${employeeUserId}`]);
      const employee = await queryOne<Row>(
        client,
        `SELECT id, full_name, is_active FROM users WHERE id = $1 FOR UPDATE`,
        [employeeUserId],
      );
      if (!employee || !employee.isActive) throw httpError('employeeNotFound', 404);
      const lockedPayout = await queryOne<Row>(
        client,
        `SELECT id FROM academy_payroll_payouts
         WHERE employee_user_id = $1 AND period >= $2
         ORDER BY period LIMIT 1`,
        [employeeUserId, period],
      );
      if (lockedPayout) throw httpError('salaryPeriodLocked', 409);
      const latest = await queryOne<Row>(
        client,
        `SELECT * FROM academy_salary_rates
         WHERE employee_user_id = $1
         ORDER BY effective_from DESC, id DESC
         LIMIT 1 FOR UPDATE`,
        [employeeUserId],
      );
      if (latest && String(latest.effectiveFrom) > effectiveFrom) {
        throw httpError('salaryRateCannotBeBackdated', 409);
      }
      const note = nullableText(req.body.note);
      if (latest && String(latest.effectiveFrom) === effectiveFrom) {
        const updated = await queryOne<Row>(
          client,
          `UPDATE academy_salary_rates
           SET amount_uzs = $2, note = $3, employee_name = $4, updated_at = NOW()
           WHERE id = $1 RETURNING *`,
          [latest.id, amountUzs, note, employee.fullName],
        );
        await createAudit(client, req.user!.id, 'UPDATE_SALARY_RATE', 'academy_salary_rate', updated.id, updated, latest);
        return updated;
      }
      if (latest && latest.effectiveTo === null) {
        await client.query(
          `UPDATE academy_salary_rates
           SET effective_to = ($2::date - INTERVAL '1 day')::date, updated_at = NOW()
           WHERE id = $1`,
          [latest.id, effectiveFrom],
        );
      }
      const inserted = await queryOne<Row>(
        client,
        `INSERT INTO academy_salary_rates
           (employee_user_id, employee_name, amount_uzs, effective_from, note, created_by)
         VALUES ($1, $2, $3, $4::date, $5, $6)
         RETURNING *`,
        [employeeUserId, employee.fullName, amountUzs, effectiveFrom, note, req.user!.id],
      );
      await createAudit(client, req.user!.id, 'CREATE_SALARY_RATE', 'academy_salary_rate', inserted.id, inserted);
      return inserted;
    });
    res.status(201).json(row);
  } catch (error: any) {
    logger.error('Failed to save salary rate', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to save salary rate' });
  }
});

router.post('/payroll/payout', async (req, res) => {
  try {
    const { period } = parsePeriod(req.body.period);
    const employeeUserId = parsePositiveId(req.body.employeeUserId);
    if (!employeeUserId) throw httpError('employeeRequired');
    const bonusUzs = parseMoney(req.body.bonusUzs ?? 0, 'bonusUzs');
    const deductionUzs = parseMoney(req.body.deductionUzs ?? 0, 'deductionUzs');
    const method = String(req.body.method ?? 'transfer');
    if (!FINANCE_PAYMENT_METHODS.includes(method as any)) throw httpError('invalidPaymentMethod');
    const row = await withTransaction(async (client) => {
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`payroll-payout:${employeeUserId}:${period}`],
      );
      const existing = await queryOne<Row>(
        client,
        `SELECT * FROM academy_payroll_payouts WHERE employee_user_id = $1 AND period = $2`,
        [employeeUserId, period],
      );
      if (existing) return existing;
      const employee = await queryOne<Row>(
        client,
        `SELECT u.id, u.full_name, u.position, rate.id AS salary_rate_id, rate.amount_uzs
         FROM users u
         LEFT JOIN LATERAL (
           SELECT sr.id, sr.amount_uzs
           FROM academy_salary_rates sr
           WHERE sr.employee_user_id = u.id
             AND sr.effective_from <= $2::date
             AND (sr.effective_to IS NULL OR sr.effective_to >= $2::date)
           ORDER BY sr.effective_from DESC, sr.id DESC LIMIT 1
         ) rate ON TRUE
         WHERE u.id = $1 AND u.is_active = true
         FOR UPDATE OF u`,
        [employeeUserId, `${period}-01`],
      );
      if (!employee) throw httpError('employeeNotFound', 404);
      if (!employee.salaryRateId) throw httpError('salaryNotConfigured', 409);
      const baseSalaryUzs = Number(employee.amountUzs || 0);
      if (deductionUzs > baseSalaryUzs + bonusUzs) throw httpError('deductionExceedsPayroll', 409);
      const amountUzs = calculatePayrollAmount(baseSalaryUzs, bonusUzs, deductionUzs);
      const inserted = await queryOne<Row>(
        client,
        `INSERT INTO academy_payroll_payouts
           (period, employee_user_id, employee_name, position, salary_rate_id,
            base_salary_uzs, bonus_uzs, deduction_uzs, amount_uzs, method, note, paid_by, paid_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
         RETURNING *`,
        [
          period,
          employeeUserId,
          employee.fullName,
          employee.position,
          employee.salaryRateId,
          baseSalaryUzs,
          bonusUzs,
          deductionUzs,
          amountUzs,
          method,
          nullableText(req.body.note),
          req.user!.id,
        ],
      );
      await createAudit(client, req.user!.id, 'PAY_EMPLOYEE_SALARY', 'academy_payroll_payout', inserted.id, inserted);
      return inserted;
    });
    res.status(201).json(row);
  } catch (error: any) {
    logger.error('Failed to create payroll payout', { error });
    const statusCode = error?.code === '23505' ? 409 : error.statusCode || 500;
    res.status(statusCode).json({ error: error.message || 'Failed to create payroll payout' });
  }
});

router.post('/payroll/payout-all', async (req, res) => {
  try {
    const { period } = parsePeriod(req.body.period);
    const method = String(req.body.method ?? 'transfer');
    if (!FINANCE_PAYMENT_METHODS.includes(method as any)) throw httpError('invalidPaymentMethod');
    const result = await withTransaction(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`payroll-batch:${period}`]);
      const candidates = await query<Row>(
        client,
        `SELECT u.id AS employee_user_id, u.full_name AS employee_name, u.position,
                rate.id AS salary_rate_id, rate.amount_uzs AS base_salary_uzs
         FROM users u
         JOIN LATERAL (
           SELECT sr.id, sr.amount_uzs
           FROM academy_salary_rates sr
           WHERE sr.employee_user_id = u.id
             AND sr.effective_from <= $1::date
             AND (sr.effective_to IS NULL OR sr.effective_to >= $1::date)
           ORDER BY sr.effective_from DESC, sr.id DESC LIMIT 1
         ) rate ON TRUE
         WHERE u.is_active = true
           AND NOT EXISTS (
             SELECT 1 FROM academy_payroll_payouts payout
             WHERE payout.employee_user_id = u.id AND payout.period = $2
           )
         ORDER BY u.id
         FOR UPDATE OF u`,
        [`${period}-01`, period],
      );
      const payouts: Row[] = [];
      for (const candidate of candidates) {
        const amountUzs = Number(candidate.baseSalaryUzs || 0);
        const payout = await queryOne<Row>(
          client,
          `INSERT INTO academy_payroll_payouts
             (period, employee_user_id, employee_name, position, salary_rate_id,
              base_salary_uzs, bonus_uzs, deduction_uzs, amount_uzs, method, note, paid_by, paid_at)
           VALUES ($1, $2, $3, $4, $5, $6, 0, 0, $6, $7, $8, $9, NOW())
           RETURNING *`,
          [
            period,
            candidate.employeeUserId,
            candidate.employeeName,
            candidate.position,
            candidate.salaryRateId,
            amountUzs,
            method,
            nullableText(req.body.note),
            req.user!.id,
          ],
        );
        await createAudit(client, req.user!.id, 'PAY_EMPLOYEE_SALARY', 'academy_payroll_payout', payout.id, payout);
        payouts.push(payout);
      }
      return payouts;
    });
    res.status(201).json({ count: result.length, payouts: result });
  } catch (error: any) {
    logger.error('Failed to create payroll batch payout', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to create payroll batch payout' });
  }
});

router.get('/transactions', async (req, res) => {
  try {
    const { period, range } = parsePeriod(req.query.period);
    const rows = await getTransactions(pool, range, period);
    res.json({ period, rows });
  } catch (error: any) {
    logger.error('Failed to load finance transactions', { error });
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to load finance transactions' });
  }
});

export default router;
