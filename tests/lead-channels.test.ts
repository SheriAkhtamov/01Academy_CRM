import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildLeadChannelProfileUrl,
  dedupeLeadChannelsForDisplay,
  leadChannelDisplayKey,
  normalizeLeadChannelHandle,
  safeLeadChannelProfileUrl,
} from '../shared/lead-channels';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

describe('lead communication channels', () => {
  it('normalizes social handles and builds provider profile links', () => {
    expect(normalizeLeadChannelHandle('@@zero.one')).toBe('zero.one');
    expect(normalizeLeadChannelHandle('https://www.instagram.com/zero.one/?hl=ru')).toBe('zero.one');
    expect(buildLeadChannelProfileUrl('instagram', '@zero.one'))
      .toBe('https://www.instagram.com/zero.one/');
    expect(buildLeadChannelProfileUrl('telegram', '@zero_one'))
      .toBe('https://t.me/zero_one');
    expect(buildLeadChannelProfileUrl('whatsapp', null, '+998 90 123-45-67'))
      .toBe('https://wa.me/998901234567');
  });

  it('allows only the official host for each external channel', () => {
    expect(safeLeadChannelProfileUrl('instagram', 'https://www.instagram.com/zero.one/'))
      .toBe('https://www.instagram.com/zero.one/');
    expect(safeLeadChannelProfileUrl('instagram', 'javascript:alert(1)')).toBeNull();
    expect(safeLeadChannelProfileUrl('instagram', 'https://example.com/zero.one')).toBeNull();
    expect(safeLeadChannelProfileUrl('telegram', 'https://t.me/zero_one'))
      .toBe('https://t.me/zero_one');
  });

  it('treats legacy and provider-backed rows for the same handle as one displayed channel', () => {
    const providerChannel = {
      id: 10,
      channel: 'instagram',
      providerAccountId: 'business-account',
      externalId: 'participant-id',
      handle: 'Zero.One',
    };
    const legacyMessengerChannel = {
      id: 11,
      channel: 'instagram',
      providerAccountId: '',
      handle: '@zero.one',
    };

    expect(leadChannelDisplayKey(providerChannel))
      .toBe(leadChannelDisplayKey(legacyMessengerChannel));
    expect(dedupeLeadChannelsForDisplay([legacyMessengerChannel, providerChannel]))
      .toEqual([providerChannel]);
  });

  it('registers a migration that preserves provider data and removes legacy messenger duplicates', () => {
    const migration = fs.readFileSync(
      path.join(repositoryRoot, 'migrations/0056_cleanup_duplicate_instagram_channels.sql'),
      'utf8',
    );
    const journal = JSON.parse(fs.readFileSync(
      path.join(repositoryRoot, 'migrations/meta/_journal.json'),
      'utf8',
    ));

    expect(migration).toContain("legacy_channel.metadata ->> 'backfilledFrom' = 'lead'");
    expect(migration).toContain('metadata = legacy_channel.metadata || provider_channel.metadata');
    expect(migration).toContain('DELETE FROM academy_lead_channels legacy_channel');
    expect(journal.entries.find((entry: { idx: number }) => entry.idx === 56)?.tag)
      .toBe('0056_cleanup_duplicate_instagram_channels');
  });
});
