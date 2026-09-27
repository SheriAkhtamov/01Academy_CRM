import { describe, expect, it } from 'vitest';
import { parseLeadLanguageUpdates } from '../server/modules/academy/lead-languages';
import { selectedLeadLanguages } from '../shared/lead-languages';

describe('lead communication languages', () => {
  it('keeps existing single-language leads selectable', () => {
    expect(selectedLeadLanguages(null, 'uz')).toEqual(['uz']);
  });

  it('accepts several unique languages while keeping the first as primary', () => {
    expect(parseLeadLanguageUpdates({ languages: ['ru', 'uz'] })).toEqual({
      language: 'ru', languages: ['ru', 'uz'],
    });
    expect(parseLeadLanguageUpdates({ language: 'en' })).toEqual({
      language: 'en', languages: ['en'],
    });
  });

  it('rejects empty, repeated, and unknown languages', () => {
    expect(parseLeadLanguageUpdates({ languages: [] })).toBeNull();
    expect(parseLeadLanguageUpdates({ languages: ['ru', 'ru'] })).toBeNull();
    expect(parseLeadLanguageUpdates({ languages: ['ru', 'other'] })).toBeNull();
  });
});
