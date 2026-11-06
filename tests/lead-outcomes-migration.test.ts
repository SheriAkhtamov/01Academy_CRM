import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const compact = (sql: string) => sql.replace(/\s+/g, ' ');
const contract = compact(read('migrations/0171_platform_cleanup_contract.sql'));
const outcomes = compact(read('migrations/0172_lead_outcomes.sql'));
const schema = read('server/db/schema/index.ts');
const journal = JSON.parse(read('migrations/meta/_journal.json')) as { entries: Array<{ idx: number; tag: string; when: number }> };

describe('stage 2 migrations', () => {
  it('follow the stage 1 cleanup in the journal with increasing timestamps', () => {
    const start = journal.entries.findIndex((entry) => entry.tag === '0170_platform_cleanup');
    const entries = journal.entries.slice(start, start + 3);
    expect(entries.map((entry) => [entry.idx, entry.tag])).toEqual([
      [170, '0170_platform_cleanup'], [171, '0171_platform_cleanup_contract'], [172, '0172_lead_outcomes']]);
    const times = journal.entries.map((entry) => entry.when);
    expect([...times].sort((left, right) => left - right)).toEqual(times);
  });

  it('drop what the stage 1 release stopped using', () => {
    for (const table of ['academy_referral_benefits', 'academy_referral_rewards', 'academy_tasks']) {
      expect(contract).toContain(`DROP TABLE IF EXISTS "${table}"`);
    }
    for (const column of ['due_at', 'paid_until', 'discount', 'period', 'balance_uzs', 'next_payment_at',
      'referral_code', 'referrer_student_id', 'referral_level', 'base_price_uzs', 'discounted_price_uzs',
      'ltv_target_min_uzs', 'ltv_target_max_uzs', 'referral_initiated']) {
      expect(contract).toContain(`DROP COLUMN IF EXISTS "${column}"`);
    }
    expect(contract).not.toContain('expected_payment_uzs');
  });

  it('add the qualification and won facts without dropping what this release stops using', () => {
    for (const column of ['is_qualified', 'qualified_at', 'qualified_by', 'is_won', 'won_at', 'won_by']) {
      expect(outcomes).toContain(`ADD COLUMN IF NOT EXISTS "${column}"`);
    }
    // Reservations, funnel qualifications and the lead's group go one release later.
    expect(outcomes).not.toMatch(/DROP (TABLE|COLUMN)/);
    expect(schema).toContain('isQualified: boolean("is_qualified").notNull().default(false)');
    expect(schema).toContain('isWon: boolean("is_won").notNull().default(false)');
  });

  it('keeps every remaining lead booking visible as a comment on the lead', () => {
    expect(outcomes).toContain('INSERT INTO "academy_lead_comments" ("lead_id", "author_id", "body")');
    expect(outcomes).toContain('FROM "academy_lead_group_reservations" reservation');
    expect(outcomes).toContain('AND NOT EXISTS (SELECT 1 FROM "academy_students" student WHERE student.lead_id = reservation.lead_id)');
  });

  it('backfills qualification only from the criteria button, never from stage moves', () => {
    expect(outcomes).toContain(`fact.action IN ('QUALIFY_ACADEMY_LEAD_BY_CRITERIA', 'REVOKE_ACADEMY_LEAD_QUALIFICATION')`);
    expect(outcomes).toContain(`WHERE action = 'QUALIFY_ACADEMY_LEAD_BY_CRITERIA'`);
    expect(outcomes).not.toContain('academy_lead_funnel_qualifications');
  });
});
