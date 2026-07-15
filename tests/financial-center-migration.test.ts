import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../migrations/0046_add_financial_center.sql', import.meta.url),
  'utf8',
);
const schema = readFileSync(new URL('../shared/schema.ts', import.meta.url), 'utf8');
const journal = JSON.parse(readFileSync(
  new URL('../migrations/meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };
const compactSql = migration.replace(/\s+/g, ' ').trim();

describe('0046 financial center migration', () => {
  it('creates separate operating expense, salary rate, and payout ledgers', () => {
    expect(compactSql).toContain('CREATE TABLE "academy_operating_expenses"');
    expect(compactSql).toContain('CREATE TABLE "academy_salary_rates"');
    expect(compactSql).toContain('CREATE TABLE "academy_payroll_payouts"');
    expect(schema).toContain('export const academyOperatingExpenses');
    expect(schema).toContain('export const academySalaryRates');
    expect(schema).toContain('export const academyPayrollPayouts');
  });

  it('prevents duplicate monthly payouts and invalid financial amounts', () => {
    expect(compactSql).toContain('CREATE UNIQUE INDEX "academy_payroll_payouts_employee_period_unique"');
    expect(compactSql).toContain('"amount_uzs" = "academy_payroll_payouts"."base_salary_uzs" + "academy_payroll_payouts"."bonus_uzs" - "academy_payroll_payouts"."deduction_uzs"');
    expect(compactSql).toContain('CONSTRAINT "academy_operating_expenses_amount_check"');
    expect(compactSql).toContain('CONSTRAINT "academy_salary_rates_amount_check" CHECK ("academy_salary_rates"."amount_uzs" > 0)');
    expect(compactSql).toContain("IN ('planned', 'paid', 'cancelled')");
  });

  it('versions salaries by employee and effective date', () => {
    expect(compactSql).toContain('CREATE UNIQUE INDEX "academy_salary_rates_employee_date_unique"');
    expect(compactSql).toContain('CONSTRAINT "academy_salary_rates_date_check"');
    expect(schema).toContain('effectiveFrom: date("effective_from").notNull()');
    expect(schema).toContain('effectiveTo: date("effective_to")');
  });

  it('is registered once immediately after migration 0045', () => {
    expect(journal.entries.find((entry) => entry.idx === 45)?.tag).toBe('0045_isolate_owned_notifications');
    expect(journal.entries.find((entry) => entry.idx === 46)?.tag).toBe('0046_add_financial_center');
    expect(journal.entries.filter((entry) => entry.idx === 46)).toHaveLength(1);
  });
});
