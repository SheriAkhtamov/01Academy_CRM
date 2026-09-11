import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../migrations/0110_full_cycle_sales_kpi.sql', import.meta.url),
  'utf8',
);
const salaryVariantsMigration = readFileSync(
  new URL('../migrations/0111_full_cycle_salary_variants.sql', import.meta.url),
  'utf8',
);
const journal = JSON.parse(readFileSync(
  new URL('../migrations/meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };
const schema = readFileSync(
  new URL('../server/db/schema/sales-kpi.ts', import.meta.url),
  'utf8',
);

describe('full-cycle sales KPI migration', () => {
  it('adds the third role without changing historical hunter or closer plans', () => {
    expect(migration).toContain("CHECK (role IN ('hunter', 'closer', 'full_cycle'))");
    expect(migration).toContain("jsonb_build_object('hunter', hunter.config, 'closer', closer.config)");
    expect(migration).not.toMatch(/UPDATE academy_sales_kpi_plans SET/);
    expect(migration).not.toMatch(/DELETE FROM academy_sales_kpi_(plans|assignments|leads)/);
    expect(schema).toContain("IN ('hunter', 'closer', 'full_cycle', 'full_cycle_3500')");
  });

  it('attributes both KPI phases and permits the same owner in both workflow funnels', () => {
    expect(migration).toContain("assigned_role IN ('hunter', 'full_cycle')");
    expect(migration).toContain("assigned_role IN ('closer', 'full_cycle')");
    expect(migration).toContain("assigned_role IS DISTINCT FROM 'full_cycle'");
    expect(migration).toContain("academy_kpi_employee_role(assigned_manager) IN ('closer', 'full_cycle')");
  });

  it('registers the migration after the company-target removal', () => {
    expect(journal.entries.find((entry) => entry.idx === 110)).toEqual(expect.objectContaining({
      idx: 110,
      tag: '0110_full_cycle_sales_kpi',
    }));
  });

  it('adds two full-cycle salary variants while preserving their shared rules', () => {
    expect(salaryVariantsMigration).toContain("CHECK (role IN ('hunter', 'closer', 'full_cycle', 'full_cycle_3500'))");
    expect(salaryVariantsMigration).toContain("SELECT 'full_cycle',");
    expect(salaryVariantsMigration).toContain("'baseSalaryUzs', 3000000");
    expect(salaryVariantsMigration).toContain("SELECT 'full_cycle_3500',");
    expect(salaryVariantsMigration).toContain("'baseSalaryUzs', 3500000");
    expect(salaryVariantsMigration).not.toMatch(/UPDATE academy_sales_kpi_plans SET/);
    expect(salaryVariantsMigration).not.toMatch(/DELETE FROM academy_sales_kpi_(plans|assignments|leads)/);
    expect(journal.entries.find((entry) => entry.idx === 111)).toEqual(expect.objectContaining({
      idx: 111,
      tag: '0111_full_cycle_salary_variants',
    }));
  });

  it('gives both full-cycle variants the same workflow permissions and attribution', () => {
    expect(salaryVariantsMigration).toContain("assigned_role IN ('hunter', 'full_cycle', 'full_cycle_3500')");
    expect(salaryVariantsMigration).toContain("assigned_role IN ('closer', 'full_cycle', 'full_cycle_3500')");
    expect(salaryVariantsMigration).toContain("assigned_role IS DISTINCT FROM 'full_cycle_3500'");
    expect(salaryVariantsMigration).toContain("academy_kpi_employee_role(assigned_manager) IN ('closer', 'full_cycle', 'full_cycle_3500')");
  });
});
