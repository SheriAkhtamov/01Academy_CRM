export const LEAD_LANGUAGES = ['ru', 'uz', 'en'] as const;
export type LeadLanguage = (typeof LEAD_LANGUAGES)[number];

const isLeadLanguage = (value: unknown): value is LeadLanguage => (
  typeof value === 'string' && LEAD_LANGUAGES.includes(value as LeadLanguage)
);

export const selectedLeadLanguages = (languages: unknown, language: unknown): LeadLanguage[] => {
  const selected = Array.isArray(languages)
    ? [...new Set(languages.filter(isLeadLanguage))]
    : [];
  return selected.length ? selected : [isLeadLanguage(language) ? language : 'ru'];
};
