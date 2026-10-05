import { leadLanguageSchema, leadLanguagesSchema } from '@shared/contracts/academy-leads';

export const parseLeadLanguageUpdates = (body: Record<string, unknown>) => {
  if (body.languages !== undefined) {
    const result = leadLanguagesSchema.safeParse(body.languages);
    return result.success
      ? { language: result.data[0] ?? '', languages: result.data }
      : null;
  }
  if (body.language === undefined) return {};
  const result = leadLanguageSchema.safeParse(body.language);
  if (!result.success) return null;
  return { language: result.data, languages: result.data ? [result.data] : [] };
};
