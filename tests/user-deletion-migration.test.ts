import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../migrations/0088_allow_deleted_assignment_managers.sql', import.meta.url),
  'utf8',
);
const schema = readFileSync(
  new URL('../server/db/schema/index.ts', import.meta.url),
  'utf8',
);
const journal = JSON.parse(readFileSync(
  new URL('../migrations/meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };

describe('0088 deleted assignment manager migration', () => {
  it('makes assignment targets compatible with the existing ON DELETE SET NULL foreign key', () => {
    expect(migration).toContain('ALTER TABLE "academy_lead_assignment_history"');
    expect(migration).toContain('ALTER COLUMN "to_manager_id" DROP NOT NULL');
  });

  it('keeps the Drizzle schema nullable as well', () => {
    const assignmentHistorySchema = schema.slice(
      schema.indexOf('export const academyLeadAssignmentHistory'),
      schema.indexOf('export const academyLeadComments'),
    );

    expect(assignmentHistorySchema).toContain(
      'toManagerId: integer("to_manager_id").references(() => users.id, { onDelete: "set null" })',
    );
    expect(assignmentHistorySchema).not.toContain(
      'toManagerId: integer("to_manager_id").references(() => users.id, { onDelete: "set null" }).notNull()',
    );
  });

  it('is registered once as migration 0088', () => {
    expect(journal.entries
      .filter(({ tag }) => tag === '0088_allow_deleted_assignment_managers')
      .map(({ idx, tag }) => ({ idx, tag })))
      .toEqual([{ idx: 88, tag: '0088_allow_deleted_assignment_managers' }]);
  });
});
