import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../migrations/0109_remove_company_kpi_targets.sql', import.meta.url),
  'utf8',
);
const journal = JSON.parse(readFileSync(
  new URL('../migrations/meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };

describe('company KPI target removal', () => {
  it('drops every legacy company target while preserving operational settings', () => {
    for (const column of [
      'target_revenue_monthly_uzs',
      'target_new_leads_monthly',
      'max_cac_uzs',
      'max_cpl_uzs',
      'target_roas',
      'target_attendance_percent',
      'target_nps',
    ]) {
      expect(migration).toContain(`DROP COLUMN IF EXISTS ${column}`);
    }
    expect(migration).not.toMatch(/DROP COLUMN IF EXISTS (sales_phone_visibility|workday_|online_pbx_)/);
  });

  it('registers the removal as the latest migration', () => {
    expect(journal.entries.at(-1)).toEqual(expect.objectContaining({
      idx: 109,
      tag: '0109_remove_company_kpi_targets',
    }));
  });
});
