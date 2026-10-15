import type { TranslationKey } from '@/lib/i18n';

const cityKeys: Record<string, TranslationKey> = {
  'Asia/Tashkent': 'timezoneCityTashkent', 'Asia/Samarkand': 'timezoneCitySamarkand',
  'Europe/Moscow': 'timezoneCityMoscow', 'Europe/Istanbul': 'timezoneCityIstanbul',
  'Asia/Dubai': 'timezoneCityDubai', 'Asia/Almaty': 'timezoneCityAlmaty',
  'Asia/Bishkek': 'timezoneCityBishkek', 'Asia/Dushanbe': 'timezoneCityDushanbe',
  'Asia/Baku': 'timezoneCityBaku', 'Asia/Tbilisi': 'timezoneCityTbilisi',
  'Europe/London': 'timezoneCityLondon', 'Europe/Berlin': 'timezoneCityBerlin',
  'Europe/Paris': 'timezoneCityParis', 'Europe/Kiev': 'timezoneCityKyiv', 'Europe/Kyiv': 'timezoneCityKyiv',
  'America/New_York': 'timezoneCityNewYork', 'America/Los_Angeles': 'timezoneCityLosAngeles',
  'Asia/Tokyo': 'timezoneCityTokyo', 'Asia/Shanghai': 'timezoneCityShanghai',
  'Asia/Calcutta': 'timezoneCityKolkata', 'Asia/Kolkata': 'timezoneCityKolkata',
};
export type TimezoneOption = { value: string; label: string };
const canonicalTimezone = (value: string) => {
  try { return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone; }
  catch { return null; }
};

export function timezoneOptions(current: string, t: (key: TranslationKey) => string): TimezoneOption[] {
  const supported = (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  let values: string[];
  try { values = supported ? supported('timeZone') : Object.keys(cityKeys); }
  catch { values = Object.keys(cityKeys); }
  const catalog = new Set(['UTC', 'Asia/Tashkent', ...values]);
  if (current && canonicalTimezone(current)) catalog.add(current);
  return [...catalog].sort().map(value => {
    const key = cityKeys[value] ?? cityKeys[canonicalTimezone(value) ?? ''];
    return { value, label: key ? `${t(key)} · ${value}` : value };
  });
}

export const timezoneSearchText = (value: string) => value.toLocaleLowerCase().replace(/[_/]/g, ' ').trim();
