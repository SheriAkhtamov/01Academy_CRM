import { selectedLeadLanguages } from '@shared/lead-languages';
import type { MarketingBotCourse } from '@shared/contracts/telegram-marketing';

type Evidence = { courseSlug: string | null; formName?: string | null; campaignName?: string | null };
const courseFromName = (name: string | null | undefined): Exclude<MarketingBotCourse, 'all' | 'other' | 'unknown'> | null => {
  const value = (name ?? '').normalize('NFKC').toLowerCase();
  const candidates = [
    /(?:ai|аи|ай)[\s_-]*kids|(?:аи|ай)[\s_-]*кидс|\bai[\s_-]*kids\b/u.test(value) ? 'ai-kids' : null,
    /вайб[\s_-]*кодинг|vibe[\s_-]*coding/u.test(value) ? 'vibe-coding' : null,
    /(?:ai|аи|ай)[\s_-]*(?:creator|креатор)/u.test(value) ? 'ai-creator' : null,
  ].filter((course) => course !== null);
  return candidates.length === 1 ? candidates[0] as Exclude<MarketingBotCourse, 'all' | 'other' | 'unknown'> : null;
};

export function resolveMarketingCourse(evidence: Evidence): Exclude<MarketingBotCourse, 'all'> {
  if (evidence.courseSlug) {
    return ['ai-kids', 'vibe-coding', 'ai-creator'].includes(evidence.courseSlug)
      ? evidence.courseSlug as Exclude<MarketingBotCourse, 'all'> : 'other';
  }
  return courseFromName(evidence.formName) ?? courseFromName(evidence.campaignName) ?? 'unknown';
}

export function resolveMarketingLanguages(evidence: {
  languages: string[] | null; language: string | null; formName?: string | null; campaignName?: string | null;
}) {
  return selectedLeadLanguages(evidence.languages, evidence.language);
}
