import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REFERRAL_BENEFIT_TYPES } from '../shared/academy';

const migration = readFileSync(
  new URL('../migrations/0041_add_referral_benefits.sql', import.meta.url),
  'utf8',
);
const schema = readFileSync(new URL('../shared/schema.ts', import.meta.url), 'utf8');
const journal = JSON.parse(readFileSync(
  new URL('../migrations/meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };
const compactSql = migration.replace(/\s+/g, ' ').trim();

describe('0041 referral benefits migration', () => {
  it('adds traceable payment qualification and a one-time benefit ledger', () => {
    expect(compactSql).toContain('ADD COLUMN "qualified_by_payment_id" integer');
    expect(compactSql).toContain(
      'FOREIGN KEY ("qualified_by_payment_id") REFERENCES "academy_payments"("id") ON DELETE set null',
    );
    expect(compactSql).toContain('CREATE INDEX "academy_referral_rewards_qualified_payment_idx"');
    expect(compactSql).toContain('CREATE TABLE "academy_referral_benefits"');
    expect(compactSql).toContain(
      'CREATE UNIQUE INDEX "academy_referral_benefits_student_type_unique" ON "academy_referral_benefits" USING btree ("student_id", "benefit_type")',
    );
    expect(compactSql.match(/ON CONFLICT \("student_id", "benefit_type"\) DO NOTHING/g)).toHaveLength(3);
  });

  it('keeps benefit types and their exact milestones aligned with the application schema', () => {
    for (const benefitType of REFERRAL_BENEFIT_TYPES) {
      expect(compactSql).toContain(`'${benefitType}'`);
      expect(schema).toContain(`'${benefitType}'`);
    }

    expect(compactSql).toContain('CONSTRAINT "academy_referral_benefits_type_milestone_check"');
    expect(compactSql).toContain('"milestone" IS NOT NULL');
    expect(compactSql).toContain("\"benefit_type\" = 'next_payment_discount_15' AND \"milestone\" = 1");
    expect(compactSql).toContain("\"benefit_type\" = 'free_month' AND \"milestone\" = 3");
    expect(compactSql).toContain("\"benefit_type\" = 'ai_ambassador_free_training' AND \"milestone\" = 5");
    expect(schema).toContain('academy_referral_benefits_type_milestone_check');
  });

  it('backfills each historical milestone once with a valid 30-day free payment', () => {
    expect(compactSql).toContain('COUNT(DISTINCT rewards."referred_student_id")::integer AS referral_count');
    expect(compactSql).toContain("WHERE paid_referrals.referral_count >= 1");
    expect(compactSql).toContain("WHERE paid_referrals.referral_count >= 3");
    expect(compactSql).toContain("WHERE paid_referrals.referral_count >= 5");
    expect(compactSql).toContain(
      "0, 'full', 'transfer', NOW(), 'referral_bonus', 'referral_15', 'paid', GREATEST(COALESCE(students.\"next_payment_at\", NOW()), NOW()) + INTERVAL '30 days'",
    );
    expect(compactSql).toContain('AND payments."status" = \'paid\'');
    expect(compactSql).toContain('AND payments."paid_until" IS NULL');
    expect(compactSql).toContain('SET "paid_until" = GREATEST(');
    expect(compactSql).toContain('JOIN paid_referrals ON paid_referrals.student_id = free_coverage.student_id');

    expect(compactSql).not.toMatch(/'benefit'\s*,\s*NOW\(\)/);
    expect(compactSql).not.toContain("'referral_free_month'");
    expect(compactSql).not.toContain("INTERVAL '1 month'");
  });

  it('matches the Drizzle declarations and occupies exactly journal position 41', () => {
    expect(schema).toContain('qualifiedByPaymentId: integer("qualified_by_payment_id")');
    expect(schema).toContain('qualifiedPaymentIdx: index("academy_referral_rewards_qualified_payment_idx")');
    expect(schema).toContain('export const academyReferralBenefits = pgTable("academy_referral_benefits"');
    expect(schema).toContain('uniqueIndex("academy_referral_benefits_student_type_unique")');

    expect(journal.entries.find((entry) => entry.idx === 40)?.tag).toBe('0040_enforce_lead_referrers');
    expect(journal.entries.find((entry) => entry.idx === 41)?.tag).toBe('0041_add_referral_benefits');
    expect(journal.entries.find((entry) => entry.idx === 42)?.tag).toBe('0042_enforce_unique_student_leads');
    expect(journal.entries.filter((entry) => entry.idx === 41)).toHaveLength(1);
  });
});
