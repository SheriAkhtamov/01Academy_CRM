import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  executeOperationalImport,
  type OperationalImportPlan,
} from '../scripts/lib/operational-import';

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const source = [{ sheet: 'Synthetic import fixture', cells: 'B3:N3' }];
const sourceSha256 = 'a'.repeat(64);
const tables = [
  'academy_groups',
  'academy_students',
  'academy_lessons',
  'academy_attendance',
  'academy_payments',
  'academy_student_contracts',
  'audit_logs',
] as const;

function reviewedPlan(batchId = 'synthetic-reviewed-batch'): OperationalImportPlan {
  return {
    version: 1,
    batchId,
    sourceSha256,
    actions: [
      {
        kind: 'insert',
        key: 'new-group',
        table: 'academy_groups',
        source,
        absent: { name: 'CYP-AI-GRP-26-0041 — Imported fixture' },
        values: {
          name: 'CYP-AI-GRP-26-0041 — Imported fixture',
          schedule: [{ dayOfWeek: 6, startTime: '15:00', endTime: '17:00' }],
          selected_course_lesson_ids: ['lesson-a', 'lesson-b'],
        },
      },
      {
        kind: 'update',
        key: 'enroll-existing-student',
        table: 'academy_students',
        source,
        id: 1,
        expected: { status: 'trial', group_id: null, risk_flags: [] },
        values: {
          status: 'studying',
          group_id: { $ref: 'new-group' },
          risk_flags: ['source-attendance-imported'],
        },
      },
      {
        kind: 'insert',
        key: 'recorded-lesson',
        table: 'academy_lessons',
        source,
        absent: { group_id: { $ref: 'new-group' }, lesson_number: 1 },
        values: {
          group_id: { $ref: 'new-group' },
          lesson_number: 1,
          scheduled_at: '2026-10-17T10:00:00',
          status: 'conducted',
          material_file_ids: [11, 12],
        },
      },
      {
        kind: 'insert',
        key: 'recorded-attendance',
        table: 'academy_attendance',
        source,
        absent: { student_id: 1, lesson_id: { $ref: 'recorded-lesson' } },
        values: {
          student_id: 1,
          lesson_id: { $ref: 'recorded-lesson' },
          status: 'present',
        },
      },
      {
        kind: 'insert',
        key: 'recorded-payment',
        table: 'academy_payments',
        source,
        absent: { student_id: 1, paid_at: '2026-10-17T10:00:00', amount_uzs: 100_000 },
        values: {
          student_id: 1,
          group_id: { $ref: 'new-group' },
          paid_at: '2026-10-17T10:00:00',
          amount_uzs: 100_000,
          status: 'paid',
        },
      },
      {
        kind: 'insert',
        key: 'recorded-contract',
        table: 'academy_student_contracts',
        source,
        absent: { student_id: 1 },
        values: { student_id: 1, created_by: 1, number: 'A-07/01' },
      },
    ],
  };
}

describe.skipIf(!databaseUrl)('reviewed operational import against PostgreSQL', () => {
  const schema = `operational_import_${randomBytes(6).toString('hex')}`;
  let admin: Pool | undefined;
  let pool: Pool;

  async function rowCounts() {
    const { rows } = await pool.query(tables.map((table) =>
      `SELECT '${table}' AS table_name, count(*)::int AS count FROM "${table}"`,
    ).join(' UNION ALL '));
    return Object.fromEntries(rows.map((row) => [row.table_name, row.count]));
  }

  async function expectOriginalState() {
    expect(await rowCounts()).toEqual({
      academy_groups: 1,
      academy_students: 1,
      academy_lessons: 0,
      academy_attendance: 0,
      academy_payments: 0,
      academy_student_contracts: 0,
      audit_logs: 0,
    });
    expect((await pool.query('SELECT status, group_id, risk_flags FROM academy_students WHERE id = 1')).rows[0])
      .toEqual({ status: 'trial', group_id: null, risk_flags: [] });
  }

  beforeAll(async () => {
    if (!databaseUrl || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(databaseUrl).hostname)) {
      throw new Error('Local isolated PostgreSQL required');
    }
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema} -c timezone=UTC`,
      max: 6,
    });
    await pool.query(`
      CREATE TABLE academy_groups (
        id serial PRIMARY KEY,
        name text NOT NULL,
        schedule jsonb NOT NULL DEFAULT '[]',
        selected_course_lesson_ids jsonb,
        is_archived boolean NOT NULL DEFAULT false,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE academy_students (
        id serial PRIMARY KEY,
        student_name text NOT NULL,
        status text NOT NULL DEFAULT 'trial',
        group_id integer REFERENCES academy_groups(id),
        risk_flags jsonb NOT NULL DEFAULT '[]',
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE academy_lessons (
        id serial PRIMARY KEY,
        group_id integer NOT NULL REFERENCES academy_groups(id),
        lesson_number integer NOT NULL,
        scheduled_at timestamp NOT NULL,
        status text NOT NULL,
        material_file_ids jsonb NOT NULL DEFAULT '[]',
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now(),
        UNIQUE (group_id, lesson_number)
      );
      CREATE TABLE academy_attendance (
        id serial PRIMARY KEY,
        lesson_id integer NOT NULL REFERENCES academy_lessons(id),
        student_id integer NOT NULL REFERENCES academy_students(id),
        status text NOT NULL CHECK (status IN ('present', 'absent')),
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now(),
        UNIQUE (lesson_id, student_id)
      );
      CREATE TABLE academy_payments (
        id serial PRIMARY KEY,
        student_id integer REFERENCES academy_students(id),
        group_id integer REFERENCES academy_groups(id),
        amount_uzs integer NOT NULL CHECK (amount_uzs > 0),
        paid_at timestamp,
        status text NOT NULL,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE academy_student_contracts (
        id uuid PRIMARY KEY,
        student_id integer NOT NULL UNIQUE REFERENCES academy_students(id),
        created_by integer NOT NULL,
        number text NOT NULL,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX contract_number_unique ON academy_student_contracts(lower(number));
      CREATE TABLE audit_logs (
        id serial PRIMARY KEY,
        action varchar(255) NOT NULL,
        entity_type varchar(50) NOT NULL,
        entity_id integer,
        old_values jsonb,
        new_values jsonb,
        created_at timestamp NOT NULL DEFAULT now()
      );
    `);
  });

  beforeEach(async () => {
    await pool.query(`
      TRUNCATE ${tables.map((table) => `"${table}"`).join(', ')} RESTART IDENTITY;
      INSERT INTO academy_groups (name, is_archived) VALUES ('CYP-AI-GRP-25-0040 — Archived fixture', true);
      INSERT INTO academy_students (student_name) VALUES ('Existing fixture student');
    `);
  });

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  it('rehearses all source-backed changes and rolls back rows, updates and audit records', async () => {
    const plan = reviewedPlan();
    const result = await executeOperationalImport(pool, plan, { apply: false });
    expect(result).toMatchObject({
      applied: false,
      alreadyApplied: false,
      counts: {
        academy_groups: { inserted: 1, updated: 0 },
        academy_students: { inserted: 0, updated: 1 },
        academy_lessons: { inserted: 1, updated: 0 },
        academy_attendance: { inserted: 1, updated: 0 },
        academy_payments: { inserted: 1, updated: 0 },
        academy_student_contracts: { inserted: 1, updated: 0 },
      },
    });
    await expectOriginalState();
    // Rehearsal must not mark the batch complete or mutate the reviewed plan.
    expect(plan).toEqual(reviewedPlan());
    expect((await executeOperationalImport(pool, plan, { apply: true })).applied).toBe(true);
  });

  it('applies a reviewed batch once and preserves the committed fingerprint on retries', async () => {
    const plan = reviewedPlan();
    const first = await executeOperationalImport(pool, plan, { apply: true });
    const beforeRetry = await rowCounts();
    const second = await executeOperationalImport(pool, JSON.parse(JSON.stringify(plan)), { apply: true });
    expect(first.applied).toBe(true);
    expect(second).toMatchObject({ alreadyApplied: true, applied: false, counts: {} });
    expect(await rowCounts()).toEqual(beforeRetry);
    expect(beforeRetry).toEqual({
      academy_groups: 2,
      academy_students: 1,
      academy_lessons: 1,
      academy_attendance: 1,
      academy_payments: 1,
      academy_student_contracts: 1,
      audit_logs: 7,
    });
    const completed = await pool.query(
      "SELECT new_values FROM audit_logs WHERE action = 'OPERATIONAL_WORKBOOK_IMPORTED'",
    );
    expect(completed.rows).toHaveLength(1);
    expect(completed.rows[0].new_values).toMatchObject({
      batchId: plan.batchId, sourceSha256, fingerprint: first.fingerprint,
    });
  });

  it('rejects a changed plan under an already committed batch without changing the payment', async () => {
    const plan = reviewedPlan();
    await executeOperationalImport(pool, plan, { apply: true });
    const payment = plan.actions.find((action) => action.key === 'recorded-payment')!;
    payment.values.amount_uzs = 200_000;
    await expect(executeOperationalImport(pool, plan, { apply: true }))
      .rejects.toThrow('already applied with a different plan');
    expect((await pool.query('SELECT amount_uzs FROM academy_payments')).rows).toEqual([{ amount_uzs: 100_000 }]);
    expect((await rowCounts()).audit_logs).toBe(7);
  });

  it('rolls back every earlier change when a final expected row has become stale', async () => {
    await pool.query("INSERT INTO academy_students(student_name, status) VALUES ('Changed fixture student', 'studying')");
    const plan = reviewedPlan();
    plan.actions.push({
      kind: 'update',
      key: 'late-stale-update',
      table: 'academy_students',
      source,
      id: 2,
      expected: { status: 'trial' },
      values: { status: 'completed' },
    });
    await expect(executeOperationalImport(pool, plan, { apply: true }))
      .rejects.toThrow('Existing row changed; reconcile again: late-stale-update');
    expect(await rowCounts()).toMatchObject({
      academy_groups: 1, academy_students: 2, academy_lessons: 0,
      academy_attendance: 0, academy_payments: 0, academy_student_contracts: 0, audit_logs: 0,
    });
    expect((await pool.query('SELECT id, status, group_id FROM academy_students ORDER BY id')).rows)
      .toEqual([
        { id: 1, status: 'trial', group_id: null },
        { id: 2, status: 'studying', group_id: null },
      ]);
  });

  it('resolves generated references through inserts, absence checks and update expectations', async () => {
    const plan = reviewedPlan();
    plan.actions.push({
      kind: 'update',
      key: 'verify-resolved-enrollment',
      table: 'academy_students',
      source,
      id: 1,
      expected: { group_id: { $ref: 'new-group' }, status: 'studying' },
      values: { student_name: 'Confirmed fixture student' },
    });
    const result = await executeOperationalImport(pool, plan, { apply: true });
    const linked = await pool.query(`
      SELECT student.group_id, attendance.lesson_id, lesson.group_id AS lesson_group_id,
             payment.group_id AS payment_group_id, student.student_name
      FROM academy_students student
      JOIN academy_attendance attendance ON attendance.student_id = student.id
      JOIN academy_lessons lesson ON lesson.id = attendance.lesson_id
      JOIN academy_payments payment ON payment.student_id = student.id
    `);
    expect(linked.rows).toEqual([{
      group_id: result.ids?.['new-group'],
      lesson_id: result.ids?.['recorded-lesson'],
      lesson_group_id: result.ids?.['new-group'],
      payment_group_id: result.ids?.['new-group'],
      student_name: 'Confirmed fixture student',
    }]);
  });

  it('generates UUID contracts without a database default and audits their student and source', async () => {
    const result = await executeOperationalImport(pool, reviewedPlan(), { apply: true });
    const contract = (await pool.query('SELECT id, student_id, number FROM academy_student_contracts')).rows[0];
    expect(contract).toMatchObject({ student_id: 1, number: 'A-07/01' });
    expect(contract.id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(result.ids?.['recorded-contract']).toBe(contract.id);
    const audit = (await pool.query(
      "SELECT entity_id, old_values, new_values FROM audit_logs WHERE entity_type = 'academy_student_contracts'",
    )).rows[0];
    expect(audit).toMatchObject({
      entity_id: 1,
      old_values: null,
      new_values: { sourceSha256, source, row: { id: contract.id, student_id: 1, number: 'A-07/01' } },
    });
  });

  it('stores JSONB arrays as arrays and distinguishes SQL NULL in expected values', async () => {
    const plan = reviewedPlan();
    plan.actions.push({
      kind: 'update',
      key: 'nullable-json',
      table: 'academy_groups',
      source,
      id: 1,
      expected: { selected_course_lesson_ids: null },
      values: { selected_course_lesson_ids: null },
    });
    await executeOperationalImport(pool, plan, { apply: true });
    const group = (await pool.query('SELECT schedule, selected_course_lesson_ids FROM academy_groups WHERE id <> 1')).rows[0];
    expect(group).toEqual({
      schedule: [{ dayOfWeek: 6, startTime: '15:00', endTime: '17:00' }],
      selected_course_lesson_ids: ['lesson-a', 'lesson-b'],
    });
    expect((await pool.query('SELECT material_file_ids FROM academy_lessons')).rows[0].material_file_ids).toEqual([11, 12]);
    expect((await pool.query('SELECT selected_course_lesson_ids IS NULL AS sql_null FROM academy_groups WHERE id = 1')).rows[0].sql_null).toBe(true);
  });

  it('serializes concurrent attempts so only one complete batch is committed', async () => {
    const plan = reviewedPlan();
    const results = await Promise.all(Array.from({ length: 4 }, () =>
      executeOperationalImport(pool, structuredClone(plan), { apply: true }),
    ));
    expect(results.filter((result) => result.applied)).toHaveLength(1);
    expect(results.filter((result) => result.alreadyApplied)).toHaveLength(3);
    expect(await rowCounts()).toMatchObject({
      academy_groups: 2, academy_payments: 1, academy_attendance: 1,
      academy_student_contracts: 1, audit_logs: 7,
    });
  });

  it('rejects an existing matching source row even when a caller changes the batch id', async () => {
    await executeOperationalImport(pool, reviewedPlan(), { apply: true });
    await expect(executeOperationalImport(pool, reviewedPlan('different-batch'), { apply: true }))
      .rejects.toThrow('Unexpected existing row; reconcile again: new-group');
    expect((await rowCounts()).audit_logs).toBe(7);
  });

  it('rolls back a duplicate attendance detected after creating its referenced lesson', async () => {
    const plan = reviewedPlan();
    const attendance = plan.actions.find((action) => action.key === 'recorded-attendance')!;
    plan.actions.push({ ...structuredClone(attendance), key: 'duplicate-attendance' });
    await expect(executeOperationalImport(pool, plan, { apply: true }))
      .rejects.toThrow('Unexpected existing row; reconcile again: duplicate-attendance');
    await expectOriginalState();
  });

  it('rolls back previous operations when a reference cannot be resolved', async () => {
    const plan = reviewedPlan();
    plan.actions.at(-1)!.values.student_id = { $ref: 'missing-student' };
    await expect(executeOperationalImport(pool, plan, { apply: true }))
      .rejects.toThrow('Unresolved import reference: missing-student');
    await expectOriginalState();
  });

  it.each([0, -100_000, '100000', null])('rejects nonpositive or nonnumeric payment amount %j before recording data', async (amount) => {
    const plan = reviewedPlan();
    plan.actions.find((action) => action.key === 'recorded-payment')!.values.amount_uzs = amount;
    await expect(executeOperationalImport(pool, plan, { apply: true }))
      .rejects.toThrow('Payment must contain an explicit positive source amount');
    await expectOriginalState();
  });

  it('rejects actions without source provenance', async () => {
    const plan = reviewedPlan();
    plan.actions[0].source = [];
    await expect(executeOperationalImport(pool, plan, { apply: true })).rejects.toThrow();
    await expectOriginalState();
  });

  it('rejects a malformed workbook digest before recording data', async () => {
    await expect(executeOperationalImport(pool, { ...reviewedPlan(), sourceSha256: 'not-a-digest' }, { apply: true }))
      .rejects.toThrow();
    await expectOriginalState();
  });

  it('prevents expected.id from selecting a different row than the update target', async () => {
    const plan = reviewedPlan();
    const studentAction = plan.actions.find((action) => action.key === 'enroll-existing-student')!;
    if (studentAction.kind !== 'update') throw new Error('Expected a student update fixture');
    studentAction.expected.id = 2;
    await expect(executeOperationalImport(pool, plan, { apply: true }))
      .rejects.toThrow('Expected values cannot override the target id');
    await expectOriginalState();
  });
});
