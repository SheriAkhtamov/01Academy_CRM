import type { TranslationKey } from '@/lib/i18n';

export const formatLeadCount = (
  count: number,
  language: string,
  labels: { one: string; few: string; many: string },
) => {
  const formattedCount = new Intl.NumberFormat(language === 'ru' ? 'ru-RU' : 'en-US').format(count);
  if (language !== 'ru') return `${formattedCount} ${count === 1 ? labels.one : labels.many}`;

  const plural = new Intl.PluralRules('ru-RU').select(count);
  const noun = plural === 'one' ? labels.one : plural === 'few' ? labels.few : labels.many;
  return `${formattedCount} ${noun}`;
};

