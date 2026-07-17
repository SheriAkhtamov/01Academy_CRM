import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveInstagramLeadContactName } from '../server/lib/instagram-lead';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

describe('Instagram lead identity', () => {
  it('uses a real profile name and removes surrounding whitespace', () => {
    expect(resolveInstagramLeadContactName({
      name: '  Aziza\nKarimova  ',
      username: 'aziza',
    })).toBe('Aziza Karimova');
  });

  it('replaces the integration placeholder with the Instagram handle', () => {
    expect(resolveInstagramLeadContactName({
      name: 'Instagram lead\n',
      messenger: ' https://instagram.com/aziza.crm/ ',
    })).toBe('@aziza.crm');
  });

  it('uses a stable participant identity when Meta does not return a profile', () => {
    expect(resolveInstagramLeadContactName({ participantId: '17841400000000123' }))
      .toBe('Instagram #17841400000000123');
  });

  it('registers the legacy-name cleanup without changing lead ownership', () => {
    const journal = JSON.parse(fs.readFileSync(
      path.join(repositoryRoot, 'migrations/meta/_journal.json'),
      'utf8',
    ));
    const migration = fs.readFileSync(
      path.join(repositoryRoot, 'migrations/0048_clean_instagram_lead_names.sql'),
      'utf8',
    );

    expect(journal.entries.find((entry: { idx: number }) => entry.idx === 48)?.tag)
      .toBe('0048_clean_instagram_lead_names');
    expect(migration).toContain("LOWER(BTRIM(lead.contact_name)) = 'instagram lead'");
    expect(migration).not.toMatch(/SET\s+manager_id/i);
  });
});
