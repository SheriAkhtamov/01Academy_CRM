import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { qualifiesManualLeadStageMove, summarizeLeadQualifications } from '../shared/lead-qualification';
const a = { funnelId: 1, statusCode: 'intake_a', isArchived: false };
describe('per-funnel manual qualification', () => {
  it.each(['custom', 'not_now', 'paid', 'stage_with_any_name'])('qualifies the first manual move to ordinary label %s within the same funnel', (statusCode) => {
    expect(qualifiesManualLeadStageMove(a, { ...a, statusCode }, 'intake_a')).toBe(true);
  });
  it('does not qualify creation, a no-op, archive or transfer to a different funnel', () => {
    expect(qualifiesManualLeadStageMove({ funnelId: null }, a, 'intake_a')).toBe(false);
    expect(qualifiesManualLeadStageMove(a, a, 'intake_a')).toBe(false);
    expect(qualifiesManualLeadStageMove(a, { ...a, isArchived: true }, 'intake_a')).toBe(false);
    expect(qualifiesManualLeadStageMove(a, { funnelId: 2, statusCode: 'intake_b' }, 'intake_b')).toBe(false);
  });
  it('qualifies explicit restoration from intake to an ordinary stage inside the same funnel', () => {
    expect(qualifiesManualLeadStageMove({ ...a, isArchived: true }, { ...a, statusCode: 'ordinary' }, 'intake_a')).toBe(true);
    expect(qualifiesManualLeadStageMove({ ...a, statusCode: 'ordinary', isArchived: true }, { ...a, statusCode: 'ordinary' }, 'intake_a')).toBe(false);
    expect(qualifiesManualLeadStageMove({ ...a, isArchived: true }, a, 'intake_a')).toBe(false);
  });
  it('keeps qualification in A, leaves B unqualified on initial archive, and deduplicates the overall lead', () => {
    const ledger = new Map<string, { leadId: number; funnelId: number }>();
    const record = (leadId: number, previous: typeof a, updated: typeof a, initial: string) => {
      if (qualifiesManualLeadStageMove(previous, updated, initial)) ledger.set(`${leadId}:${updated.funnelId}`, { leadId, funnelId: updated.funnelId });
    };
    record(9, a, { ...a, statusCode: 'ordinary' }, 'intake_a');
    const b = { funnelId: 2, statusCode: 'intake_b', isArchived: false };
    record(9, { ...a, statusCode: 'ordinary' }, b, 'intake_b');
    record(9, b, { ...b, isArchived: true }, 'intake_b');
    expect(summarizeLeadQualifications([...ledger.values()], [1, 2])).toEqual({ total: 1, byFunnel: { '1': 1, '2': 0 } });
    record(9, b, { ...b, statusCode: 'anything' }, 'intake_b');
    expect([...ledger.values()].filter(fact => fact.funnelId === 2)).toHaveLength(1);
    expect(summarizeLeadQualifications([...ledger.values(), ...ledger.values()])).toEqual({ total: 1, byFunnel: { '1': 1, '2': 1 } });
  });
  it('stores one durable pair and preserves the earliest fact on lead merge', () => {
    const migration = readFileSync(new URL('../migrations/0128_generic_funnel_stages_and_qualification.sql', import.meta.url), 'utf8');
    const repository = readFileSync(new URL('../server/modules/academy/academy-leads.ts', import.meta.url), 'utf8');
    expect(migration).toContain('PRIMARY KEY(lead_id, funnel_id)');
    expect(repository).toContain('ON CONFLICT (lead_id, funnel_id) DO NOTHING');
    expect(repository).toContain('WHERE EXCLUDED.qualified_at < academy_lead_funnel_qualifications.qualified_at');
    expect(repository).toContain('DELETE FROM academy_lead_funnel_qualifications WHERE lead_id = $1');
  });
  it('uses the same explicit PostgreSQL type for stage parameters in the qualification projection and filters', () => {
    const repository = readFileSync(new URL('../server/modules/academy/academy-leads.ts', import.meta.url), 'utf8');
    const qualificationInsert = repository.slice(repository.indexOf('export const recordManualLeadStageMove'));
    // INSERT SELECT otherwise infers text for its projection and varchar for the
    // repeated filter parameter, causing PostgreSQL 42P08 on the first exit.
    for (const parameter of ['$3', '$4']) {
      expect(qualificationInsert.match(new RegExp(`\\${parameter}::varchar\\(80\\)`, 'g'))).toHaveLength(2);
      expect(qualificationInsert).not.toMatch(new RegExp(`\\${parameter}(?!::varchar\\(80\\))`));
    }
  });
});
