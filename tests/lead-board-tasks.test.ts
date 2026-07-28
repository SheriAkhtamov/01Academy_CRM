import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readAcademyModuleSource } from './helpers/read-academy-module';

const migration = readFileSync(
  new URL('../migrations/0064_link_lead_tasks_to_board.sql', import.meta.url),
  'utf8',
);
const schema = readFileSync(new URL('../shared/schema.ts', import.meta.url), 'utf8');
const academyRoutes = readAcademyModuleSource();
const leadSheet = readFileSync(
  new URL('../client/src/components/ux/LeadDetailSheet.tsx', import.meta.url),
  'utf8',
);
const journal = JSON.parse(readFileSync(
  new URL('../migrations/meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };
const compactSql = migration.replace(/\s+/g, ' ').trim();

describe('lead tasks on the shared board', () => {
  it('adds an indexed, recoverable lead relation to board tasks', () => {
    expect(compactSql).toContain('ADD COLUMN IF NOT EXISTS "lead_id" integer');
    expect(compactSql).toContain('FOREIGN KEY ("lead_id") REFERENCES "public"."academy_leads"("id") ON DELETE set null');
    expect(compactSql).toContain('CREATE INDEX IF NOT EXISTS "board_tasks_lead_idx"');
    expect(schema).toContain('leadId: integer("lead_id").references(() => academyLeads.id, { onDelete: "set null" })');
  });

  it('migrates each legacy lead task once and preserves its owner and deadline', () => {
    expect(compactSql).toContain('INSERT INTO "board_tasks"');
    expect(compactSql).toContain('"legacy_academy_task_id"');
    expect(compactSql).toContain('task."responsible_id", task."responsible_id", task."entity_id", task."id", task."deadline_at"');
    expect(compactSql).toContain('WHERE existing."legacy_academy_task_id" = task."id"');
  });

  it('creates and completes lead tasks through the shared board API', () => {
    expect(leadSheet).toContain("apiRequest('POST', '/api/board/tasks'");
    expect(leadSheet).toContain("apiRequest('PATCH', `/api/board/tasks/${taskId}/status`");
    expect(academyRoutes).toContain('FROM board_tasks task');
    expect(academyRoutes).toContain('WHERE task.lead_id = $1');
  });

  it('keeps board ownership aligned when leads are merged or reassigned', () => {
    expect(academyRoutes).toContain('UPDATE board_tasks');
    expect(academyRoutes).toContain('SET lead_id = $1, updated_at = NOW()');
    expect(academyRoutes).toContain('SET assignee_id = $1, updated_at = NOW()');
  });

  it('registers migration 0064 exactly once after comment history', () => {
    expect(journal.entries.find((entry) => entry.idx === 63)?.tag).toBe('0063_add_lead_comment_history');
    expect(journal.entries.find((entry) => entry.idx === 64)?.tag).toBe('0064_link_lead_tasks_to_board');
    expect(journal.entries.filter((entry) => entry.idx === 64)).toHaveLength(1);
  });
});
