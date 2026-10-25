import { metaWebsiteSubmissionSql } from '@shared/meta-website-leads';

/** One acquisition per persisted Meta submission, not per CRM contact.
 * Legacy Meta contacts without an attribution retain one historical acquisition.
 * The fallback checks the entire history so a repeat cannot also count as a new contact.
 */
export const metaReportingIntakesSql = `
  meta_attribution_events AS (
    SELECT attribution.* FROM meta_lead_attributions attribution
    JOIN academy_leads contact ON contact.id = attribution.lead_id
    WHERE attribution.provider = 'meta' AND (
      NULLIF(attribution.leadgen_id, '') IS NOT NULL
      OR NULLIF(attribution.ad_id, '') IS NOT NULL
      OR (${metaWebsiteSubmissionSql('attribution')})
    )
  ), meta_intakes AS (
    SELECT attribution.lead_id, attribution.captured_at AS acquired_at,
      attribution.id AS attribution_id, attribution.leadgen_id,
      'attribution:' || attribution.id AS intake_id,
      CASE WHEN ${metaWebsiteSubmissionSql('attribution')}
        THEN attribution.raw_payload->>'courseSlug' END AS course_slug,
      CASE WHEN ${metaWebsiteSubmissionSql('attribution')} THEN 'meta_website'
        WHEN LOWER(COALESCE(NULLIF(attribution.placement, ''),
          attribution.raw_payload->'lead'->>'platform',
          CASE WHEN source.code = 'meta_lead_ads_facebook' THEN 'facebook' END, 'instagram'))
          IN ('fb', 'facebook') THEN 'meta_lead_ads_facebook'
        ELSE 'meta_lead_ads' END AS source_code
    FROM meta_attribution_events attribution
    JOIN academy_leads lead ON lead.id = attribution.lead_id
    LEFT JOIN academy_lead_sources source ON source.id = lead.source_id
    UNION ALL
    SELECT lead.id, lead.created_at, NULL::integer, NULL::text,
      'legacy:' || lead.id, NULL::text, source.code
    FROM academy_leads lead
    JOIN academy_lead_sources source ON source.id = lead.source_id
    WHERE source.code IN ('meta_lead_ads', 'meta_lead_ads_facebook', 'meta_website')
      AND NOT EXISTS (SELECT 1 FROM meta_attribution_events attribution WHERE attribution.lead_id = lead.id)
  )`;

/** Same acquisitions as the source totals, grouped into unique contacts for the funnel. */
export const marketingReportingCohortSql = `
  ${metaReportingIntakesSql}, marketing_acquisitions AS (
    SELECT lead.id AS lead_id, lead.source_id, lead.created_at AS acquired_at
    FROM academy_leads lead LEFT JOIN academy_lead_sources source ON source.id = lead.source_id
    WHERE COALESCE(source.code, '') NOT IN ('meta_lead_ads', 'meta_lead_ads_facebook', 'meta_website')
      AND lead.created_at >= $1 AND lead.created_at < $2 AND lead.created_at <= timezone('UTC', now())
    UNION ALL
    SELECT intake.lead_id, source.id, intake.acquired_at
    FROM meta_intakes intake LEFT JOIN academy_lead_sources source ON source.code = intake.source_code
    WHERE intake.acquired_at >= $1 AND intake.acquired_at < $2 AND intake.acquired_at <= timezone('UTC', now())
  ), marketing_cohort AS (
    SELECT lead_id, MIN(acquired_at) AS acquired_at, ARRAY_AGG(DISTINCT source_id) AS source_ids
    FROM marketing_acquisitions GROUP BY lead_id
  )`;

/** Adds optional ad metadata without dropping legacy acquisitions lacking ad IDs. */
export const metaReportingAttributionsSql = `
  ${metaReportingIntakesSql}, reporting_attributions AS (
    SELECT COALESCE(intake.attribution_id, -intake.lead_id) AS id,
      intake.lead_id, intake.acquired_at AS captured_at,
      attribution.ad_id, attribution.ad_name, attribution.adset_id, attribution.adset_name,
      attribution.campaign_id, attribution.campaign_name, attribution.creative_id,
      attribution.creative_name, attribution.creative_title, attribution.media_type,
      attribution.hook_name, attribution.placement, attribution.source_url, attribution.thumbnail_url,
      attribution.utm_source, attribution.utm_medium, attribution.utm_campaign,
      attribution.utm_content, attribution.utm_term, attribution.utm_derived,
      attribution.enrichment_status, attribution.form_id, attribution.leadgen_id
    FROM meta_intakes intake
    LEFT JOIN meta_lead_attributions attribution ON attribution.id = intake.attribution_id
  )`;
