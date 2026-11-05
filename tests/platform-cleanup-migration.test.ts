import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('migrations/0170_platform_cleanup.sql').replace(/\s+/g, ' ');
const schema = read('server/db/schema/index.ts');
const journal = JSON.parse(read('migrations/meta/_journal.json')) as { entries: Array<{ idx: number; tag: string }> };

describe('0170 platform cleanup migration', () => {
  it('is registered after the previous migration', () => {
    const entry = journal.entries.find((item) => item.tag === '0170_platform_cleanup');
    expect(entry?.idx).toBe(170);
  });

  it('keeps the removed tables and columns for the previous image until the next release', () => {
    // The deploy rollback restores only the application image, so this release
    // must not drop anything the previous image still reads or writes.
    expect(migration).not.toMatch(/DROP TABLE/);
    expect(migration).not.toMatch(/DROP COLUMN/);
    expect(migration).toContain('ALTER TABLE "academy_students" ALTER COLUMN "referral_code" DROP NOT NULL');
    for (const table of ['academy_referral_benefits', 'academy_referral_rewards', 'academy_tasks']) {
      expect(schema).not.toContain(`pgTable("${table}"`);
    }
    for (const column of ['paid_until', 'balance_uzs', 'next_payment_at', 'referral_code',
      'referrer_student_id', 'referral_level', 'base_price_uzs', 'discounted_price_uzs', 'referral_initiated']) {
      expect(schema).not.toContain(`("${column}")`);
    }
  });

  it('cancels unpaid invoices without proof and stops payments from being overdue', () => {
    expect(migration).toContain(`SET "status" = 'cancelled', "updated_at" = NOW() WHERE payment."status" IN ('pending', 'overdue') AND payment."paid_at" IS NULL AND payment."receipt_url" IS NULL`);
    expect(migration).toContain('FROM "academy_payment_attachments" attachment');
    expect(migration).toContain(`UPDATE "academy_payments" SET "status" = 'pending', "updated_at" = NOW() WHERE "status" = 'overdue'`);
  });

  it('keeps the expected payment of pupils and leads', () => {
    expect(migration).not.toContain('expected_payment_uzs');
    expect(migration).not.toContain('offer_price_uzs');
    expect(schema.match(/expectedPaymentUzs: integer\("expected_payment_uzs"\)/g)).toHaveLength(2);
  });

  it('turns paused pupils into archived pupils that rosters no longer count as studying', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "is_archived" boolean DEFAULT false NOT NULL');
    expect(migration).toContain(`CHECK ("status" IN ('active', 'withdrawn', 'completed', 'suspended'))`);
    expect(migration).toContain(`WHERE "status" = 'paused'`);
    expect(migration).toContain(`SET "status" = 'suspended'`);
    expect(migration).toContain(`SELECT paused."id", 'paused', 'archived', 'Пауза заменена архивом'`);
    expect(schema).toContain(`isArchived: boolean("is_archived").notNull().default(false)`);
  });

  it('classifies repeat KPI sales automatically without touching closed months', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION academy_kpi_repeat_sale_kind(');
    // Only money that stayed paid is history, so a refunded mistake recorded again stays the first sale.
    expect(migration).not.toContain(`payment.status IN ('paid', 'refunded')`);
    expect(migration).toContain(`AND payment.amount_uzs > 0 AND payment.status = 'paid') INTO prior_sale;`);
    // The balance after a prepayment wins over a new group of the same course.
    expect(migration.indexOf(`= 'prepayment' THEN 'installment'`)).toBeLessThan(migration.indexOf(`THEN 'upsell'`));
    expect(migration).toContain('WHERE target.course_id IS NULL OR earlier.course_id IS NULL OR earlier.course_id = target.course_id');
    expect(migration).toContain(`WHERE tracked.kind = 'unclassified'`);
    expect(migration).toContain(`= to_char(NOW() AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM')`);
    expect(migration).toContain(`ELSE 'installment' END AS kind`);
    // A back-dated repeat sale cannot add a bonus to a closed month either.
    expect(migration).toContain(`WHEN academy_kpi_sale_month(NEW.paid_at, NEW.created_at) < to_char(NOW() AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM') THEN 'installment'`);
    expect(migration).toContain(`CHECK ("kind" IN ('new', 'renewal', 'upsell', 'installment'))`);
    expect(migration).toContain('ELSE academy_kpi_repeat_sale_kind(NEW.id, NEW.student_id, NEW.group_id, NEW.paid_at, NEW.created_at) END;');
    expect(migration).not.toContain(`ELSE 'unclassified' END`);
  });

  it('keeps one first sale when the wrong first payment is refunded after the correct one', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION academy_kpi_reclassify_after_refund()');
    expect(migration).toContain(`IF OLD.status <> 'paid' OR NEW.status <> 'refunded' OR NEW.student_id IS NULL THEN RETURN NEW; END IF;`);
    expect(migration).toContain(`UPDATE academy_sales_kpi_sales SET kind = 'new', cycle_key = NULL WHERE payment_id = successor_id;`);
    expect(migration).toContain(`AND payment.type IS DISTINCT FROM 'installment_2_2'`);
    // A successor in a closed KPI month keeps its classification.
    expect(migration).toContain(`successor_month <> to_char(NOW() AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM')`);
    expect(migration).toContain('AFTER UPDATE OF "status" ON "academy_payments" FOR EACH ROW EXECUTE FUNCTION academy_kpi_reclassify_after_refund();');
  });
});
