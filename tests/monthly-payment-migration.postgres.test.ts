import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `monthly_payments_${randomBytes(8).toString('hex')}`;
const migration = readFileSync(new URL('../migrations/0148_normalize_monthly_payments.sql', import.meta.url), 'utf8');
const kpiMigration = readFileSync(new URL('../migrations/0111_full_cycle_salary_variants.sql', import.meta.url), 'utf8');
const captureSale = kpiMigration.match(/CREATE OR REPLACE FUNCTION academy_kpi_capture_sale\(\)[\s\S]*?(?=\n--> statement-breakpoint)/)?.[0];
let admin: Pool;
let pool: Pool;

describe.skipIf(!databaseUrl)('monthly payment data migration against isolated PostgreSQL', () => {
  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(target.hostname) || !/test/.test(target.pathname)) {
      throw new Error('ISOLATED_TEST_DATABASE_REQUIRED');
    }
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema} -c timezone=UTC` });
    await pool.query(`
      CREATE TABLE academy_payments (
        id integer PRIMARY KEY,
        type text NOT NULL,
        amount_uzs integer NOT NULL,
        status text NOT NULL,
        lead_id integer,
        student_id integer,
        group_id integer,
        method text NOT NULL DEFAULT 'transfer',
        paid_at timestamp,
        paid_until timestamp,
        due_at timestamp,
        comment text,
        allocation_version integer NOT NULL DEFAULT 0,
        updated_at timestamp NOT NULL DEFAULT '2026-10-01'
      );
      CREATE TABLE academy_sales_kpi_sales (payment_id integer PRIMARY KEY, closer_id integer, kind text NOT NULL);
      INSERT INTO academy_payments (id,type,amount_uzs,status,lead_id,student_id,group_id,paid_at,paid_until,due_at,comment,allocation_version) VALUES
        (1,'installment_1_2',400000,'paid',10,20,30,'2026-09-01','2026-10-01',NULL,'First payment',3),
        (2,'installment_2_2',500000,'paid',10,20,30,'2026-10-01','2026-11-01',NULL,'Second payment',4),
        (3,'installment_1_2',600000,'paid',11,21,31,'2026-10-02','2026-11-02',NULL,'Legacy payment without KPI',5),
        (4,'installment_2_2',700000,'pending',12,22,32,NULL,NULL,'2026-11-01','Pending payment',6),
        (5,'installment_1_2',800000,'refunded',13,23,33,'2026-10-03','2026-11-03',NULL,'Refunded payment',7),
        (6,'installment_2_2',900000,'overdue',14,24,34,NULL,NULL,'2026-10-01','Overdue payment',8),
        (7,'full',1000000,'paid',15,25,35,'2026-10-04','2026-11-04',NULL,'Full payment',9),
        (8,'prepayment',1100000,'paid',16,26,36,'2026-10-05',NULL,NULL,'Prepayment',10),
        (9,'monthly',1200000,'paid',17,27,37,'2026-10-06','2026-11-06',NULL,'Monthly payment',11);
      INSERT INTO academy_sales_kpi_sales VALUES (1,40,'new'),(2,40,'installment'),(7,41,'new');
    `);
    if (!captureSale) throw new Error('SALES_KPI_CAPTURE_FUNCTION_MISSING');
    await pool.query(captureSale);
    await pool.query(`CREATE TRIGGER academy_kpi_sale_capture AFTER INSERT OR UPDATE ON academy_payments
      FOR EACH ROW EXECUTE FUNCTION academy_kpi_capture_sale()`);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });

  it('converts both installments once and preserves all other payment fields and historical KPI facts', async () => {
    const paymentsBefore = (await pool.query('SELECT * FROM academy_payments ORDER BY id')).rows;
    const kpiBefore = (await pool.query('SELECT * FROM academy_sales_kpi_sales ORDER BY payment_id')).rows;

    expect((await pool.query(migration)).rowCount).toBe(6);
    const paymentsAfter = (await pool.query('SELECT * FROM academy_payments ORDER BY id')).rows;
    expect(paymentsAfter).toEqual(paymentsBefore.map((payment) => ({
      ...payment,
      type: payment.type.startsWith('installment_') ? 'monthly' : payment.type,
    })));
    expect((await pool.query('SELECT * FROM academy_sales_kpi_sales ORDER BY payment_id')).rows).toEqual(kpiBefore);
    expect((await pool.query(migration)).rowCount).toBe(0);
    expect((await pool.query('SELECT * FROM academy_payments ORDER BY id')).rows).toEqual(paymentsAfter);
    expect((await pool.query('SELECT * FROM academy_sales_kpi_sales ORDER BY payment_id')).rows).toEqual(kpiBefore);
  });
});
