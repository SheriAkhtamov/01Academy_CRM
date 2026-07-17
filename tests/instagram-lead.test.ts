import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isGeneratedInstagramLeadName,
  resolveInstagramLeadContactName,
} from '../server/lib/instagram-lead';
import { shouldSkipImportedConversation } from '../server/services/instagram';

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

  it('refuses to expose a numeric Instagram-scoped id as a contact name', () => {
    expect(resolveInstagramLeadContactName({})).toBeNull();
    expect(isGeneratedInstagramLeadName('Instagram #17841400000000123')).toBe(true);
    expect(isGeneratedInstagramLeadName('@real_username')).toBe(false);
  });

  it('reimports current conversations when their lead identity still needs repair', () => {
    const currentSummary = { id: 'conversation-1', updated_time: '2026-07-17T12:00:00Z' };
    const baseState = {
      id: 1,
      participant_igsid: '17841400000000123',
      participant_username: 'real_username',
      participant_name: 'Real Name',
      contact_name: '@real_username',
      last_message_at: new Date('2026-07-17T12:00:01Z'),
    };

    expect(shouldSkipImportedConversation(baseState, currentSummary)).toBe(true);
    expect(shouldSkipImportedConversation({
      ...baseState,
      participant_username: null,
      participant_name: null,
      contact_name: 'Instagram #17841400000000123',
    }, currentSummary)).toBe(false);
    expect(shouldSkipImportedConversation({
      ...baseState,
      contact_name: null,
    }, currentSummary)).toBe(false);
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
