import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { summarizeLeadQualifications } from '../shared/lead-qualification';

const serverFiles = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? serverFiles(path) : path.endsWith('.ts') ? [path] : [];
});
const serverRoot = new URL('../server', import.meta.url).pathname;

describe('lead qualification is only the criteria button', () => {
  it('never records a qualification when a card moves between stages', () => {
    const repository = readFileSync(new URL('../server/modules/academy/academy-leads.ts', import.meta.url), 'utf8');
    expect(repository).not.toContain('recordManualLeadStageMove');
    for (const file of serverFiles(serverRoot).filter((path) => !path.includes('/db/schema/'))) {
      expect(readFileSync(file, 'utf8'), file).not.toContain('academy_lead_funnel_qualifications');
    }
  });

  it('keeps the current qualification on the lead and its history in audit facts', () => {
    const repository = readFileSync(new URL('../server/modules/leads/infrastructure/qualification-repository.ts', import.meta.url), 'utf8');
    expect(repository).toContain('SET is_qualified = $2, qualified_at = $3, qualified_by = $4');
    expect(repository).toContain('INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values)');
  });

  it('keeps the earliest qualification when duplicate leads are merged', () => {
    const repository = readFileSync(new URL('../server/modules/academy/academy-leads.ts', import.meta.url), 'utf8');
    expect(repository).toContain('AND (NOT retained.is_qualified OR duplicate.qualified_at < retained.qualified_at)');
  });

  it('counts one lead once in the total and once per funnel', () => {
    const facts = [{ leadId: 9, funnelId: 1 }, { leadId: 9, funnelId: 1 }, { leadId: 10, funnelId: 2 }];
    expect(summarizeLeadQualifications(facts, [1, 2, 3])).toEqual({ total: 2, byFunnel: { '1': 1, '2': 1, '3': 0 } });
    expect(summarizeLeadQualifications([{ leadId: 0, funnelId: 1 }])).toEqual({ total: 0, byFunnel: {} });
  });
});
