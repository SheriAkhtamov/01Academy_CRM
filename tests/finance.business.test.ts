import { describe, expect, it } from 'vitest';
import {
  calculateFinanceSummary,
  calculateAccruedPayrollExpense,
  calculatePayrollAmount,
  calculatePercentageChange,
  financeDateKey,
  isFinanceDate,
  isFinancePeriod,
} from '../shared/finance';

describe('financial center business rules', () => {
  it('calculates management profit and margin from traceable cost groups', () => {
    expect(calculateFinanceSummary({
      revenue: 86_300_000,
      operatingExpenses: 11_720_000,
      marketingExpenses: 7_560_000,
      payrollExpenses: 18_600_000,
    })).toEqual({
      revenue: 86_300_000,
      operatingExpenses: 11_720_000,
      marketingExpenses: 7_560_000,
      payrollExpenses: 18_600_000,
      totalExpenses: 37_880_000,
      netProfit: 48_420_000,
      marginPercent: 56.1,
    });
  });

  it('calculates a payout snapshot from salary, bonus, and deduction', () => {
    expect(calculatePayrollAmount(6_000_000, 800_000, 200_000)).toBe(6_600_000);
    expect(calculatePayrollAmount(4_000_000, 0, 5_000_000)).toBe(0);
    expect(calculatePayrollAmount('not-money', 100, 0)).toBe(100);
  });

  it('accrues assigned salaries and replaces the base with the actual payout snapshot', () => {
    expect(calculateAccruedPayrollExpense({
      period: '2026-07',
      payouts: [{ employeeUserId: 1, amountUzs: 6_600_000 }],
      salaryRates: [
        { employeeUserId: 1, amountUzs: 6_000_000, effectiveFrom: '2026-01-01' },
        { employeeUserId: 2, amountUzs: 4_500_000, effectiveFrom: '2026-01-01', effectiveTo: '2026-05-31' },
        { employeeUserId: 2, amountUzs: 5_000_000, effectiveFrom: '2026-06-01' },
        { employeeUserId: 3, amountUzs: 3_000_000, effectiveFrom: '2026-08-01' },
      ],
    })).toBe(11_600_000);
  });

  it('handles zero baselines in profit change without infinities', () => {
    expect(calculatePercentageChange(10, 0)).toBe(100);
    expect(calculatePercentageChange(0, 0)).toBe(0);
    expect(calculatePercentageChange(112.4, 100)).toBe(12.4);
  });

  it('accepts stable month and date keys and rejects malformed inputs', () => {
    expect(isFinancePeriod('2026-07')).toBe(true);
    expect(isFinancePeriod('2026-13')).toBe(false);
    expect(isFinanceDate('2026-07-01')).toBe(true);
    expect(isFinanceDate('2026-7-1')).toBe(false);
    expect(isFinanceDate('2026-02-29')).toBe(false);
    expect(isFinanceDate('2024-02-29')).toBe(true);
    expect(isFinanceDate('2026-04-31')).toBe(false);
    expect(financeDateKey(new Date('invalid'))).toBe('');
  });

  it('counts deleted salary snapshots separately and replaces only their matching paid rate', () => {
    const salaryRates = [
      { id: 10, employeeUserId: null, amountUzs: 2_000_000, effectiveFrom: '2026-07-01', effectiveTo: '2026-10-08' },
      { id: 11, employeeUserId: null, amountUzs: 3_000_000, effectiveFrom: '2026-07-01', effectiveTo: '2026-10-08' },
      { id: 12, employeeUserId: 8, amountUzs: 4_000_000, effectiveFrom: '2026-07-01', effectiveTo: '2026-10-08' },
      { id: 13, employeeUserId: null, amountUzs: 9_000_000, effectiveFrom: '2026-12-01', effectiveTo: '2026-10-08' },
    ];
    expect(calculateAccruedPayrollExpense({
      period: '2026-07', payouts: [{ employeeUserId: null, salaryRateId: 10, amountUzs: 2_200_000 }], salaryRates,
    })).toBe(9_200_000);
    expect(calculateAccruedPayrollExpense({ period: '2026-11', payouts: [], salaryRates })).toBe(0);
    expect(calculateAccruedPayrollExpense({ period: '2026-12', payouts: [], salaryRates })).toBe(0);
  });
});
