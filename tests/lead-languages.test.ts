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

  it('leaves missing languages unselected and respects an explicitly empty selection', () => {
    expect(selectedLeadLanguages(null, null)).toEqual([]);
    expect(selectedLeadLanguages(undefined, '')).toEqual([]);
    expect(selectedLeadLanguages([], 'ru')).toEqual([]);
    expect(parseLeadLanguageUpdates({ languages: [] })).toEqual({ language: '', languages: [] });
    expect(parseLeadLanguageUpdates({ language: '' })).toEqual({ language: '', languages: [] });
    expect(parseLeadLanguageUpdates({})).toEqual({});
  });

  it('rejects repeated and unknown languages', () => {
    expect(parseLeadLanguageUpdates({ languages: ['ru', 'ru'] })).toBeNull();
    expect(parseLeadLanguageUpdates({ languages: ['ru', 'other'] })).toBeNull();
  });
});
