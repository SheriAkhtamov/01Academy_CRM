import { describe, expect, it } from 'vitest';
import {
  buildLeadChannelProfileUrl,
  normalizeLeadChannelHandle,
  safeLeadChannelProfileUrl,
} from '../shared/lead-channels';

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
});
