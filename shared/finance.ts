export const FINANCE_EXPENSE_CATEGORIES = [
  "rent",
  "equipment",
  "supplies",
  "utilities",
  "software",
  "taxes",
  "marketing",
  "transport",
  "maintenance",
  "other",
] as const;

export type FinanceExpenseCategory = (typeof FINANCE_EXPENSE_CATEGORIES)[number];

export const FINANCE_PAYMENT_METHODS = ["cash", "transfer", "card"] as const;
export type FinancePaymentMethod = (typeof FINANCE_PAYMENT_METHODS)[number];

export const FINANCE_EXPENSE_STATUSES = ["planned", "paid", "cancelled"] as const;
export type FinanceExpenseStatus = (typeof FINANCE_EXPENSE_STATUSES)[number];

export const FINANCE_PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
export const FINANCE_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const isFinancePeriod = (value: unknown): value is string =>
  typeof value === "string" && FINANCE_PERIOD_PATTERN.test(value);

export const isFinanceDate = (value: unknown): value is string =>
  typeof value === "string" && FINANCE_DATE_PATTERN.test(value);

const safeMoney = (value: unknown) => {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : 0;
};

const financeDateKey = (value: unknown) => value instanceof Date
  ? value.toISOString().slice(0, 10)
  : String(value ?? '').slice(0, 10);

export const calculatePayrollAmount = (
  baseSalaryUzs: unknown,
  bonusUzs: unknown = 0,
  deductionUzs: unknown = 0,
) => Math.max(0, safeMoney(baseSalaryUzs) + safeMoney(bonusUzs) - safeMoney(deductionUzs));

export const calculateFinanceSummary = ({
  revenue,
  operatingExpenses,
  marketingExpenses,
  payrollExpenses,
}: {
  revenue: unknown;
  operatingExpenses: unknown;
  marketingExpenses: unknown;
  payrollExpenses: unknown;
}) => {
  const normalizedRevenue = safeMoney(revenue);
  const normalizedOperatingExpenses = safeMoney(operatingExpenses);
  const normalizedMarketingExpenses = safeMoney(marketingExpenses);
  const normalizedPayrollExpenses = safeMoney(payrollExpenses);
  const totalExpenses = normalizedOperatingExpenses
    + normalizedMarketingExpenses
    + normalizedPayrollExpenses;
  const netProfit = normalizedRevenue - totalExpenses;
  const marginPercent = normalizedRevenue > 0
    ? Math.round((netProfit / normalizedRevenue) * 1_000) / 10
    : 0;

  return {
    revenue: normalizedRevenue,
    operatingExpenses: normalizedOperatingExpenses,
    marketingExpenses: normalizedMarketingExpenses,
    payrollExpenses: normalizedPayrollExpenses,
    totalExpenses,
    netProfit,
    marginPercent,
  };
};

export const calculatePercentageChange = (current: unknown, previous: unknown) => {
  const currentValue = Number(current);
  const previousValue = Number(previous);
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) return 0;
  if (previousValue === 0) return currentValue === 0 ? 0 : 100;
  return Math.round(((currentValue - previousValue) / Math.abs(previousValue)) * 1_000) / 10;
};

export const calculateAccruedPayrollExpense = ({
  period,
  payouts,
  salaryRates,
}: {
  period: string;
  payouts: Array<{ employeeUserId?: unknown; amountUzs?: unknown }>;
  salaryRates: Array<{
    employeeUserId?: unknown;
    amountUzs?: unknown;
    effectiveFrom?: unknown;
    effectiveTo?: unknown;
  }>;
}) => {
  if (!isFinancePeriod(period)) return 0;
  const paidEmployeeIds = new Set(
    payouts
      .map((payout) => Number(payout.employeeUserId))
      .filter((employeeId) => Number.isSafeInteger(employeeId) && employeeId > 0),
  );
  const periodStart = `${period}-01`;
  const accruedRates = new Map<number, { effectiveFrom: string; amountUzs: number }>();

  for (const rate of salaryRates) {
    const employeeId = Number(rate.employeeUserId);
    const effectiveFrom = financeDateKey(rate.effectiveFrom);
    const effectiveTo = rate.effectiveTo === null || rate.effectiveTo === undefined
      ? null
      : financeDateKey(rate.effectiveTo);
    if (
      !Number.isSafeInteger(employeeId)
      || employeeId <= 0
      || paidEmployeeIds.has(employeeId)
      || !isFinanceDate(effectiveFrom)
      || effectiveFrom > periodStart
      || (effectiveTo !== null && effectiveTo < periodStart)
    ) continue;
    const current = accruedRates.get(employeeId);
    if (!current || effectiveFrom > current.effectiveFrom) {
      accruedRates.set(employeeId, { effectiveFrom, amountUzs: safeMoney(rate.amountUzs) });
    }
  }

  return payouts.reduce((sum, payout) => sum + safeMoney(payout.amountUzs), 0)
    + [...accruedRates.values()].reduce((sum, rate) => sum + rate.amountUzs, 0);
};
