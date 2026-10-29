export const META_WEBSITE_SOURCE = { code: 'meta_website', name: 'Meta · сайт', channel: 'website' } as const;

const courses = {
  explorer: { courseSlug: 'ai-kids', courseName: 'AI Kids' },
  creator: { courseSlug: 'ai-creator', courseName: 'AI Creator' },
  professional: { courseSlug: 'vibe-coding', courseName: 'AI Professional' },
} as const;

export type MetaWebsiteLanding = {
  courseId: keyof typeof courses;
  courseSlug: string;
  courseName: string;
  pageUrl: string;
  utm: Record<string, string>;
  adId: string | null;
  adsetId: string | null;
  campaignId: string | null;
};

/** Advertising identity comes from a dedicated route on the authenticated site. */
export function resolveMetaWebsiteLanding(pageUrl: string | null, siteDomain: string): MetaWebsiteLanding | null {
  if (!pageUrl || siteDomain.toLowerCase().replace(/^www\./, '') !== '01academy.uz') return null;
  try {
    const url = new URL(pageUrl);
    if (!['https:', 'http:'].includes(url.protocol)
      || url.hostname.toLowerCase().replace(/^www\./, '') !== '01academy.uz') return null;
    const id = /^\/(?:ru|uz)\/meta\/courses\/(explorer|creator|professional)\/?$/.exec(url.pathname)?.[1];
    if (!id || !(id in courses)) return null;
    const courseId = id as keyof typeof courses;
    const utm: Record<string, string> = {};
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id']) {
      const value = url.searchParams.get(key)?.trim().slice(0, 500);
      if (value) utm[key] = value;
    }
    const metaId = (key: string) => {
      const value = url.searchParams.get(key)?.trim() ?? '';
      return /^\d{3,120}$/.test(value) ? value : null;
    };
    return { courseId, ...courses[courseId], pageUrl, utm,
      adId: metaId('ad_id'), adsetId: metaId('adset_id') ?? metaId('utm_term'),
      campaignId: metaId('campaign_id') ?? metaId('utm_id') };
  } catch {
    return null;
  }
}

/** Keep the advertising entry point even when the visitor changes page or language.
 * The selected course describes the request; the source URL describes the ad visit.
 */
export function resolveMetaWebsiteSubmission(
  pageUrl: string | null,
  landingPageUrl: string | null,
  siteDomain: string,
  selectedCourseId?: unknown,
): MetaWebsiteLanding | null {
  const landing = resolveMetaWebsiteLanding(landingPageUrl, siteDomain)
    ?? resolveMetaWebsiteLanding(pageUrl, siteDomain);
  if (!landing) return null;
  let currentCourseId: string | undefined;
  try {
    const current = new URL(pageUrl ?? '');
    if (['https:', 'http:'].includes(current.protocol)
      && current.hostname.toLowerCase().replace(/^www\./, '') === '01academy.uz') {
      currentCourseId = /^\/(?:ru|uz)\/(?:meta\/)?courses\/(explorer|creator|professional)\/?$/
        .exec(current.pathname)?.[1];
    }
  } catch { /* A missing current URL does not discard a valid advertising entry. */ }
  const id = typeof selectedCourseId === 'string' && Object.prototype.hasOwnProperty.call(courses, selectedCourseId)
    ? selectedCourseId : currentCourseId;
  if (!id) return landing;
  const courseId = id as keyof typeof courses;
  return { ...landing, courseId, ...courses[courseId] };
}

export const isWebsiteSubmissionId = (value: unknown): value is string => typeof value === 'string'
  && /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value);

/** All reporting readers share the same definition of a saved landing submission. */
export const metaWebsiteSubmissionSql = (alias: string) =>
  `${alias}.provider = 'meta' AND ${alias}.channel = 'website' AND ${alias}.referral_type = 'landing_form'`;
