import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MAX_LEAD_TAG_NAME_LENGTH,
  leadTagNameKey,
  normalizeLeadTagName,
} from '../shared/lead-tags';
import { readAcademyModuleSource } from './helpers/read-academy-module';

const migration = readFileSync(
  new URL('../migrations/0068_add_lead_tags.sql', import.meta.url),
  'utf8',
);
const schema = readFileSync(new URL('../server/db/schema/index.ts', import.meta.url), 'utf8');
const routes = readAcademyModuleSource();
const leadSheet = readFileSync(
  new URL('../client/src/components/ux/LeadDetailSheet.tsx', import.meta.url),
  'utf8',
);
const leadTagsEditor = leadSheet.slice(
  leadSheet.indexOf('function LeadTagsEditor'),
  leadSheet.indexOf('export function LeadDetailSheet'),
);
const kanban = readFileSync(
  new URL('../client/src/components/ux/KanbanBoard.tsx', import.meta.url),
  'utf8',
);
const journal = JSON.parse(readFileSync(
  new URL('../migrations/meta/_journal.json', import.meta.url),
  'utf8',
)) as { entries: Array<{ idx: number; tag: string }> };
const compactSql = migration.replace(/\s+/g, ' ').trim();

describe('lead tags', () => {
  it('normalizes reusable names and rejects unsafe or oversized values', () => {
    expect(normalizeLeadTagName('  Летний   лагерь  ')).toEqual({
      name: 'Летний лагерь',
      normalizedName: 'летний лагерь',
    });
    expect(leadTagNameKey('ＩＮＳＴＡＧＲＡＭ')).toBe('instagram');
    expect(normalizeLeadTagName('')).toBeNull();
    expect(normalizeLeadTagName('tag\u0000name')).toBeNull();
    expect(normalizeLeadTagName('я'.repeat(MAX_LEAD_TAG_NAME_LENGTH + 1))).toBeNull();
  });

  it('stores a global tag catalog and unique per-lead assignments', () => {
    expect(compactSql).toContain('CREATE TABLE IF NOT EXISTS "academy_lead_tags"');
    expect(compactSql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "academy_lead_tags_normalized_unique"');
    expect(compactSql).toContain('CREATE TABLE IF NOT EXISTS "academy_lead_tag_assignments"');
    expect(compactSql).toContain('REFERENCES "academy_leads"("id") ON DELETE CASCADE');
    expect(compactSql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "academy_lead_tag_assignments_lead_tag_unique"');
    expect(schema).toContain('export const academyLeadTags');
    expect(schema).toContain('export const academyLeadTagAssignments');
  });

  it('keeps source tags automatic while manual tags have separate API operations', () => {
    expect(routes).toContain("router.get('/lead-tags'");
    expect(routes).toContain("router.post('/leads/:id/tags'");
    expect(routes).toContain("router.delete('/leads/:id/tags/:assignmentId'");
    expect(routes).toContain('Automatic tags are derived from academy_leads.source_id');
    expect(routes).toContain('DELETE FROM academy_lead_tag_assignments');
    expect(routes).not.toMatch(/DELETE FROM academy_lead_sources[\s\S]*REMOVE_ACADEMY_LEAD_TAG/);
    expect(routes).toContain('ON CONFLICT (lead_id, tag_id) DO NOTHING');
    expect(routes).toContain('(SELECT COUNT(*) FROM academy_lead_tag_assignments WHERE lead_id = $1)');
  });

  it('uses one compact tag input and protects the automatic source tag', () => {
    expect(leadSheet).toContain('<Sheet');
    expect(leadSheet).toContain('open={open}');
    expect(leadSheet).toContain('<LeadTagsEditor');
    expect(leadTagsEditor).toContain("queryKey: ['/api/academy/lead-tags']");
    expect(leadTagsEditor).toContain('role="combobox"');
    expect(leadTagsEditor).toContain('role="listbox"');
    expect(leadTagsEditor).toContain('customTagName');
    expect(leadTagsEditor).toContain('<LockKeyhole');
    expect(leadTagsEditor).toContain('const manualTags = tags');
    expect(leadTagsEditor).toContain('onDropdownOpenChange');
    expect(leadTagsEditor).toContain("event.key === 'Escape' && isOpen");
    expect(leadTagsEditor).not.toContain('<section');
    expect(leadTagsEditor).not.toContain('<Select');
    expect(leadTagsEditor).not.toContain('<AlertDialog');
    expect(leadSheet).toContain('onEscapeKeyDown={(event)');
    expect(leadSheet).toContain('if (tagDropdownOpen) event.preventDefault()');
    expect(kanban).toContain('(lead.tags ?? [])');
  });

  it('registers migration 0068 once after migration 0067', () => {
    expect(journal.entries.find((entry) => entry.idx === 67)?.tag).toBe('0067_add_onlinepbx_manager_routing');
    expect(journal.entries.find((entry) => entry.idx === 68)?.tag).toBe('0068_add_lead_tags');
    expect(journal.entries.filter((entry) => entry.idx === 68)).toHaveLength(1);
  });
});
