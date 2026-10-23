import type { TranslationKey } from '@/lib/i18n';

const unitKeys = {
  leads: { one: 'leadCountOne', few: 'leadCountFew', many: 'leadCountMany' },
  students: { one: 'salesReportStudentOne', few: 'salesReportStudentFew', many: 'salesReportStudentMany' },
} as const satisfies Record<string, Record<string, TranslationKey>>;

export function salesReportUnitKey(unit: keyof typeof unitKeys, count: number, language: string): TranslationKey {
  const category = new Intl.PluralRules(language).select(count);
  return unitKeys[unit][category === 'one' ? 'one' : category === 'few' ? 'few' : 'many'];
}
