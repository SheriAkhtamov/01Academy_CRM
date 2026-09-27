import { leadLanguagesSchema } from '@shared/contracts/academy-leads';
import { LEAD_LANGUAGES, type LeadLanguage } from '@shared/lead-languages';

export const parseLeadLanguageUpdates = (body: Record<string, unknown>) => {
  if (body.languages !== undefined) {
    const result = leadLanguagesSchema.safeParse(body.languages);
    return result.success
      ? { language: result.data[0], languages: result.data }
      : null;
  }
  if (body.language === undefined) return {};
  if (typeof body.language !== 'string'
    || !LEAD_LANGUAGES.includes(body.language as LeadLanguage)) return null;
  return { language: body.language, languages: [body.language] };
};
