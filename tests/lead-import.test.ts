import { describe, expect, it } from 'vitest';
import { buildLeadImportComment, normalizeLeadImportPhone } from '../server/services/lead-import';

describe('lead import normalization', () => {
  it('normalizes supported local and international phone numbers', () => {
    expect(normalizeLeadImportPhone('p:+998 90 123 45 67')).toBe('+998901234567');
    expect(normalizeLeadImportPhone('90 123 45 67')).toBe('+998901234567');
    expect(normalizeLeadImportPhone('+99338036603')).toBe('+99338036603');
  });

  it('rejects malformed Uzbekistan and test phone values', () => {
    expect(normalizeLeadImportPhone('+9989999999095')).toBeNull();
    expect(normalizeLeadImportPhone('p:<test lead: dummy data>')).toBeNull();
  });

  it('keeps campaign answers and operator notes in an auditable comment', () => {
    const comment = buildLeadImportComment({
      externalId: '123',
      sheet: 'AI KIDS',
      campaignName: 'Июльская кампания',
      childAgeAnswer: '8 лет',
      note: 'Перезвонить завтра',
    });

    expect(comment).toContain('[Импорт Meta Lead Ads · AI KIDS · #123]');
    expect(comment).toContain('Кампания: Июльская кампания');
    expect(comment).toContain('Возраст ребёнка: 8 лет');
    expect(comment).toContain('Заметка: Перезвонить завтра');
  });
});
