import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

// Plans contain reviewed, source-backed changes. Raw workbooks and plans with
// personal data belong outside the repository.
const tables = [
  'academy_groups',
  'academy_leads',
  'academy_lead_phones',
  'academy_students',
  'academy_student_group_enrollments',
  'academy_student_status_history',
  'academy_lessons',
  'academy_lesson_status_history',
  'academy_demo_lesson_participants',
  'academy_attendance',
  'academy_payments',
  'academy_student_contracts',
] as const;

const sourceSchema = z.object({
  sheet: z.string().min(1),
  cells: z.string().min(1),
});
const valuesSchema = z.record(z.string(), z.unknown()).refine(
  (value) => Object.keys(value).length > 0
    && Object.keys(value).every((key) => /^[a-z][a-z0-9_]*$/.test(key)),
  'Values must use nonempty SQL column names',
);
const actionBase = {
  key: z.string().min(1),
  table: z.enum(tables),
  source: z.array(sourceSchema).min(1),
};
const actionSchema = z.discriminatedUnion('kind', [
  z.object({
    ...actionBase,
    kind: z.literal('insert'),
    values: valuesSchema,
    absent: valuesSchema,
  }).strict(),
  z.object({
    ...actionBase,
    kind: z.literal('update'),
    id: z.number().int().positive(),
    expected: valuesSchema,
    values: valuesSchema,
  }).strict(),
]);
export const operationalImportPlanSchema = z.object({
  version: z.literal(1),
  batchId: z.string().min(1).max(120),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  actions: z.array(actionSchema).min(1),
}).strict();
export type OperationalImportPlan = z.infer<typeof operationalImportPlanSchema>;

const jsonColumns = new Set([
  'schedule', 'risk_flags', 'payload', 'selected_course_lesson_ids', 'material_file_ids',
]);
const immutableColumns = new Set(['id', 'created_at']);
const noUpdatedAt = new Set([
  'academy_student_status_history',
  'academy_lesson_status_history',
]);
const completionAction = 'OPERATIONAL_WORKBOOK_IMPORTED';
const importLock = 7_315_020;
const schedulingLock = 7_315_001;

function identifier(value: string) {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Invalid SQL identifier');
  return `"${value}"`;
}

export function resolveImportValues(
  values: Record<string, unknown>,
  ids: Map<string, number | string>,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).map(([column, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && '$ref' in value) {
      const reference = value as Record<string, unknown>;
      if (Object.keys(reference).length !== 1 || typeof reference.$ref !== 'string') {
        throw new Error('Invalid import reference');
      }
      const id = ids.get(reference.$ref);
      if (!id) throw new Error(`Unresolved import reference: ${reference.$ref}`);
      return [column, id];
    }
    return [column, value];
  }));
}

function bindValue(column: string, value: unknown) {
  // node-postgres otherwise converts arrays to PostgreSQL arrays, including
  // schedule/risk_flags, whose actual storage type is JSONB.
  return value !== null && value !== undefined && jsonColumns.has(column)
    ? JSON.stringify(value)
    : value;
}

async function selectMatching(
  client: PoolClient,
  table: string,
  expected: Record<string, unknown>,
) {
  const columns = Object.keys(expected);
  const predicates = columns.map((column, index) =>
    `${identifier(column)} IS NOT DISTINCT FROM $${index + 1}`);
  const result = await client.query(
    `SELECT to_jsonb(record) AS row FROM ${identifier(table)} record
     WHERE ${predicates.join(' AND ')} FOR UPDATE`,
    columns.map((column) => bindValue(column, expected[column])),
  );
  return result.rows.map((entry) => entry.row as Record<string, unknown>);
}

async function assertNextGroupCode(client: PoolClient, name: unknown) {
  const code = /^([A-Z0-9]+)-([A-Z0-9]+)-(GRP|IND)-\d{2}-(\d{4,})(?:$| — )/.exec(String(name));
  if (!code) throw new Error('New groups require an approved canonical group code');
  const { rows } = await client.query<{ maximum: number }>(`
    WITH names AS (
      SELECT name FROM academy_groups
      UNION ALL
      SELECT record->>'name'
      FROM audit_logs audit
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE jsonb_typeof(audit.new_values) WHEN 'array' THEN audit.new_values
          WHEN 'object' THEN jsonb_build_array(audit.new_values) ELSE '[]'::jsonb END
        || CASE jsonb_typeof(audit.old_values) WHEN 'array' THEN audit.old_values
          WHEN 'object' THEN jsonb_build_array(audit.old_values) ELSE '[]'::jsonb END
      ) record
      WHERE audit.entity_type IN ('academy_group', 'academy_groups')
    ), numbers AS (
      SELECT (regexp_match(name,
        '^[A-Z0-9]+-[A-Z0-9]+-(?:GRP|IND)-[0-9]{2}-([0-9]+)(?:$|[[:space:]])'))[1]::numeric AS value
      FROM names
      UNION ALL
      SELECT (new_values->>'highWaterNumber')::numeric FROM audit_logs
      WHERE entity_type = 'academy_group_code_state' AND action = 'SAVE_GROUP_CODE_STATE'
        AND new_values->>'highWaterNumber' ~ '^[0-9]+$'
    )
    SELECT COALESCE(MAX(value), 0)::int AS maximum FROM numbers
  `);
  if (Number(code[4]) !== rows[0].maximum + 1) {
    throw new Error(`Group sequence changed; next suffix is ${rows[0].maximum + 1}`);
  }
}

export async function executeOperationalImport(
  pool: Pool,
  input: unknown,
  options: { apply: boolean },
) {
  const plan = operationalImportPlanSchema.parse(input);
  const seen = new Set<string>();
  for (const action of plan.actions) {
    if (seen.has(action.key)) throw new Error(`Duplicate import action: ${action.key}`);
    seen.add(action.key);
    if (Object.keys(action.values).some((column) => immutableColumns.has(column)
      && !(column === 'created_at' && action.kind === 'insert' && noUpdatedAt.has(action.table)))) {
      throw new Error(`Import cannot set immutable columns: ${action.key}`);
    }
    if (action.kind === 'update' && 'id' in action.expected) {
      throw new Error(`Expected values cannot override the target id: ${action.key}`);
    }
    if (action.kind === 'insert' && action.table === 'academy_payments'
      && !(typeof action.values.amount_uzs === 'number' && action.values.amount_uzs > 0)) {
      throw new Error(`Payment must contain an explicit positive source amount: ${action.key}`);
    }
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
  const client = await pool.connect();
  const ids = new Map<string, number | string>();
  const counts: Record<string, { inserted: number; updated: number }> = {};
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query('SELECT pg_advisory_xact_lock($1)', [importLock]);
    await client.query('SELECT pg_advisory_xact_lock($1)', [schedulingLock]);
    const previous = await client.query<{ new_values: { fingerprint: string } }>(
      `SELECT new_values FROM audit_logs WHERE action = $1
       AND new_values->>'batchId' = $2 ORDER BY id DESC LIMIT 1`,
      [completionAction, plan.batchId],
    );
    if (previous.rows.length) {
      if (previous.rows[0].new_values.fingerprint !== fingerprint) {
        throw new Error('This batch was already applied with a different plan');
      }
      await client.query('ROLLBACK');
      return { batchId: plan.batchId, alreadyApplied: true, applied: false, counts: {} };
    }
    // Imports are short and reviewed. Serialize writes on the affected tables
    // so stale matching cannot race a normal CRM insertion during the rehearsal
    // or commit. PostgreSQL keeps ordinary reads available.
    const affected = [...new Set(plan.actions.map((action) => action.table))].sort();
    for (const table of affected) {
      await client.query(`LOCK TABLE ${identifier(table)} IN SHARE ROW EXCLUSIVE MODE`);
    }
    for (const action of plan.actions) {
      const values = resolveImportValues(action.values, ids);
      if (action.kind === 'insert' && action.table === 'academy_student_contracts') {
        values.id = randomUUID();
      }
      const columns = Object.keys(values);
      let before: Record<string, unknown> | null = null;
      let after: Record<string, unknown>;
      if (action.kind === 'insert') {
        const absent = resolveImportValues(action.absent, ids);
        const matches = await selectMatching(client, action.table, absent);
        if (matches.length) {
          throw new Error(`Unexpected existing row; reconcile again: ${action.key}`);
        }
        if (action.table === 'academy_groups') await assertNextGroupCode(client, values.name);
        const result = await client.query(
          `INSERT INTO ${identifier(action.table)} (${columns.map(identifier).join(', ')})
           VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})
           RETURNING to_jsonb(${identifier(action.table)}) AS row`,
          columns.map((column) => bindValue(column, values[column])),
        );
        after = result.rows[0].row;
      } else {
        const expected = resolveImportValues(action.expected, ids);
        const matches = await selectMatching(client, action.table, { ...expected, id: action.id });
        if (matches.length !== 1) {
          throw new Error(`Existing row changed; reconcile again: ${action.key}`);
        }
        before = matches[0];
        const assignments = columns.map((column, index) => `${identifier(column)} = $${index + 1}`);
        if (!noUpdatedAt.has(action.table) && !columns.includes('updated_at')) {
          assignments.push('updated_at = now()');
        }
        const result = await client.query(
          `UPDATE ${identifier(action.table)} SET ${assignments.join(', ')}
           WHERE id = $${columns.length + 1} RETURNING to_jsonb(${identifier(action.table)}) AS row`,
          [...columns.map((column) => bindValue(column, values[column])), action.id],
        );
        after = result.rows[0].row;
      }
      const rowId = after.id as number | string;
      ids.set(action.key, rowId);
      const count = counts[action.table] ??= { inserted: 0, updated: 0 };
      if (action.kind === 'insert') count.inserted += 1;
      else count.updated += 1;
      await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, old_values, new_values)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
        [
          'OPERATIONAL_WORKBOOK_ROW', action.table,
          typeof rowId === 'number' ? rowId : Number(after.student_id),
          before ? JSON.stringify(before) : null,
          JSON.stringify({
            batchId: plan.batchId, sourceSha256: plan.sourceSha256,
            key: action.key, source: action.source, row: after,
          }),
        ],
      );
    }
    await client.query(
      `INSERT INTO audit_logs (action, entity_type, new_values)
       VALUES ($1, 'operational_import', $2::jsonb)`,
      [completionAction, JSON.stringify({
        batchId: plan.batchId, fingerprint, sourceSha256: plan.sourceSha256, counts,
      })],
    );
    await client.query(options.apply ? 'COMMIT' : 'ROLLBACK');
    return {
      batchId: plan.batchId, fingerprint, alreadyApplied: false,
      applied: options.apply, counts, ids: Object.fromEntries(ids),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
