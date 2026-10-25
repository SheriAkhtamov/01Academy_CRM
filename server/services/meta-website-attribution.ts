import type { PoolClient } from 'pg';
import { metaWebsiteSubmissionSql, type MetaWebsiteLanding } from '@shared/meta-website-leads';

type Executor = Pick<PoolClient, 'query'>;

export async function findMetaWebsiteReceipt(executor: Executor, submissionId: string) {
  const { rows } = await executor.query<{ lead_id: number }>(
    `SELECT attribution.lead_id FROM meta_lead_attributions attribution
     WHERE ${metaWebsiteSubmissionSql('attribution')} AND attribution.referral_ref = $1 LIMIT 1`,
    [submissionId],
  );
  return rows[0]?.lead_id ?? null;
}

export async function saveMetaWebsiteAttribution(
  executor: Executor,
  leadId: number,
  submissionId: string,
  landing: MetaWebsiteLanding,
) {
  const utm = { utm_source: 'meta', utm_medium: 'paid_social', ...landing.utm };
  await executor.query(
    `INSERT INTO meta_lead_attributions
       (lead_id, provider, channel, touch_type, referral_type, referral_source, referral_ref,
        source_url, ad_id, adset_id, campaign_id, campaign_name,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_values,
        utm_derived, raw_payload, enrichment_status, captured_at)
     VALUES ($1,'meta','website','first_touch','landing_form','01academy.uz',$2,
       $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15::jsonb,$16,NOW())`,
    [leadId, submissionId, landing.pageUrl, landing.adId, landing.adsetId, landing.campaignId,
      landing.utm.utm_campaign ?? null, utm.utm_source, utm.utm_medium,
      landing.utm.utm_campaign ?? null, landing.utm.utm_content ?? null, landing.utm.utm_term ?? null,
      JSON.stringify(utm), !landing.utm.utm_source || !landing.utm.utm_medium,
      JSON.stringify({ courseId: landing.courseId, courseSlug: landing.courseSlug,
        courseName: landing.courseName, submissionId }), landing.adId ? 'pending' : 'not_required'],
  );
}

export async function resolveMetaWebsiteCourseId(executor: Executor, landing: MetaWebsiteLanding) {
  const { rows } = await executor.query<{ id: number }>(
    'SELECT id FROM academy_courses WHERE slug = $1 ORDER BY id LIMIT 1', [landing.courseSlug],
  );
  return rows[0]?.id ?? null;
}
