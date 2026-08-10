import { query } from './academy-core';
import { getMetaSpendCurrency } from '../../services/meta-marketing';
import type { ReportingRange } from './academy-scheduling';

export const getMetaAttributionAnalytics = async (reportingRange: ReportingRange) => {
  const creatives = await query(
    `WITH period_attribution AS (
       SELECT attribution.*,
              ROW_NUMBER() OVER (
                PARTITION BY attribution.lead_id
                ORDER BY attribution.captured_at, attribution.id
              ) AS lead_rank
       FROM meta_lead_attributions attribution
       WHERE attribution.lead_id IS NOT NULL
         AND attribution.captured_at >= $1
         AND attribution.captured_at < $2
     ),
     paid_by_lead AS (
       SELECT payment.lead_id,
              COALESCE(SUM(payment.amount_uzs) FILTER (WHERE payment.status = 'paid'), 0)::bigint AS revenue
       FROM academy_payments payment
       WHERE payment.lead_id IS NOT NULL
       GROUP BY payment.lead_id
     ),
     stage_thresholds AS (
       SELECT
         COALESCE(MAX(sort_order) FILTER (WHERE code = 'qualified'), 30) AS qualified_sort,
         COALESCE(MAX(sort_order) FILTER (WHERE code = 'demo_invited'), 40) AS demo_sort
       FROM academy_lead_statuses
     ),
     enriched AS (
       SELECT attribution.*,
              lead.status_code,
              current_status.sort_order AS current_sort,
              current_status.is_pipeline AS current_is_pipeline,
              COALESCE(payment.revenue, 0)::bigint AS revenue,
              thresholds.qualified_sort,
              thresholds.demo_sort,
              EXISTS (
                SELECT 1
                FROM academy_lead_stage_history history
                JOIN academy_lead_statuses history_status ON history_status.code = history.to_status_code
                WHERE history.lead_id = attribution.lead_id
                  AND history_status.is_pipeline = true
                  AND history_status.sort_order >= thresholds.qualified_sort
              ) AS reached_qualified,
              EXISTS (
                SELECT 1
                FROM academy_lead_stage_history history
                JOIN academy_lead_statuses history_status ON history_status.code = history.to_status_code
                WHERE history.lead_id = attribution.lead_id
                  AND history_status.is_pipeline = true
                  AND history_status.sort_order >= thresholds.demo_sort
              ) AS reached_demo
       FROM period_attribution attribution
       JOIN academy_leads lead ON lead.id = attribution.lead_id
       LEFT JOIN academy_lead_statuses current_status ON current_status.code = lead.status_code
       LEFT JOIN paid_by_lead payment ON payment.lead_id = attribution.lead_id
       CROSS JOIN stage_thresholds thresholds
     ),
     stats AS (
     SELECT
       COALESCE(ad_id, NULLIF(utm_content, ''), 'unattributed') AS attribution_key,
       MAX(ad_id) AS ad_id,
       MAX(ad_name) AS ad_name,
       MAX(adset_id) AS adset_id,
       MAX(adset_name) AS adset_name,
       MAX(campaign_id) AS campaign_id,
       MAX(campaign_name) AS campaign_name,
       MAX(creative_id) AS creative_id,
       MAX(creative_name) AS creative_name,
       MAX(creative_title) AS creative_title,
       MAX(media_type) AS media_type,
       MAX(hook_name) AS hook_name,
       MAX(placement) AS placement,
       MAX(source_url) AS source_url,
       MAX(thumbnail_url) AS thumbnail_url,
       MAX(utm_source) AS utm_source,
       MAX(utm_medium) AS utm_medium,
       MAX(utm_campaign) AS utm_campaign,
       MAX(utm_content) AS utm_content,
       MAX(utm_term) AS utm_term,
       BOOL_OR(utm_derived) AS utm_derived,
       COUNT(*)::int AS leads,
       COUNT(DISTINCT lead_id) FILTER (
         WHERE lead_rank = 1
           AND (reached_qualified OR (current_is_pipeline = true AND current_sort >= qualified_sort))
       )::int AS qualified,
       COUNT(DISTINCT lead_id) FILTER (
         WHERE lead_rank = 1
           AND (reached_demo OR (current_is_pipeline = true AND current_sort >= demo_sort))
       )::int AS demo_invited,
       COUNT(DISTINCT lead_id) FILTER (
         WHERE lead_rank = 1 AND (revenue > 0 OR status_code = 'paid')
       )::int AS paid,
       COALESCE(SUM(revenue) FILTER (WHERE lead_rank = 1), 0)::bigint AS revenue,
       COUNT(*) FILTER (WHERE enrichment_status = 'failed')::int AS enrichment_failures,
       MIN(captured_at) AS first_captured_at,
       MAX(captured_at) AS last_captured_at
     FROM enriched
     GROUP BY COALESCE(ad_id, NULLIF(utm_content, ''), 'unattributed')
     ),
     spend AS (
       SELECT ad_id,
              SUM(spend)::numeric AS spend,
              SUM(impressions)::bigint AS impressions,
              SUM(clicks)::bigint AS clicks,
              MAX(currency) AS currency
       FROM meta_ad_insights
       WHERE stat_date >= $3::date AND stat_date <= $4::date
       GROUP BY ad_id
     ),
     keys AS (
       SELECT ad_id AS attribution_key FROM meta_ads
       UNION
       SELECT ad_id FROM spend
       UNION
       SELECT attribution_key FROM stats
     )
     SELECT
       keys.attribution_key,
       COALESCE(catalog.ad_id, stats.ad_id) AS ad_id,
       COALESCE(catalog.ad_name, stats.ad_name) AS ad_name,
       COALESCE(catalog.adset_id, stats.adset_id) AS adset_id,
       COALESCE(catalog.adset_name, stats.adset_name) AS adset_name,
       COALESCE(catalog.campaign_id, stats.campaign_id) AS campaign_id,
       COALESCE(catalog.campaign_name, stats.campaign_name) AS campaign_name,
       COALESCE(catalog.creative_id, stats.creative_id) AS creative_id,
       COALESCE(catalog.creative_name, stats.creative_name) AS creative_name,
       COALESCE(catalog.creative_title, stats.creative_title) AS creative_title,
       COALESCE(catalog.media_type, stats.media_type) AS media_type,
       COALESCE(catalog.hook_name, stats.hook_name) AS hook_name,
       COALESCE(catalog.thumbnail_url, stats.thumbnail_url) AS thumbnail_url,
       COALESCE(catalog.source_url, stats.source_url) AS source_url,
       catalog.effective_status,
       (catalog.ad_id IS NOT NULL) AS in_catalog,
       stats.placement,
       stats.utm_source, stats.utm_medium, stats.utm_campaign, stats.utm_content, stats.utm_term,
       COALESCE(stats.utm_derived, false) AS utm_derived,
       COALESCE(stats.leads, 0)::int AS leads,
       COALESCE(stats.qualified, 0)::int AS qualified,
       COALESCE(stats.demo_invited, 0)::int AS demo_invited,
       COALESCE(stats.paid, 0)::int AS paid,
       COALESCE(stats.revenue, 0)::bigint AS revenue,
       COALESCE(stats.enrichment_failures, 0)::int AS enrichment_failures,
       COALESCE(spend.spend, 0)::float8 AS spend,
       COALESCE(spend.impressions, 0)::int AS impressions,
       COALESCE(spend.clicks, 0)::int AS clicks,
       spend.currency AS spend_currency,
       stats.first_captured_at,
       stats.last_captured_at
     FROM keys
     LEFT JOIN meta_ads catalog ON catalog.ad_id = keys.attribution_key
     LEFT JOIN stats ON stats.attribution_key = keys.attribution_key
     LEFT JOIN spend ON spend.ad_id = keys.attribution_key
     ORDER BY COALESCE(stats.leads, 0) DESC, COALESCE(spend.spend, 0) DESC,
              stats.last_captured_at DESC NULLS LAST,
              COALESCE(catalog.ad_created_time, TIMESTAMP '1970-01-01') DESC`,
    [reportingRange.start, reportingRange.end, reportingRange.from, reportingRange.to],
  );

  // Meta reports spend in the ad account currency (USD here); the CRM shows soum
  // everywhere else, so convert only when an explicit rate is configured.
  const { usdToUzsRate, convertsToUzs } = getMetaSpendCurrency();
  const toDisplaySpend = (spendValue: number) => (
    convertsToUzs ? Math.round(spendValue * usdToUzsRate) : Number(spendValue.toFixed(2))
  );

  const normalizedCreatives = creatives.map((creative) => {
    const leads = Number(creative.leads || 0);
    const qualified = Number(creative.qualified || 0);
    const paid = Number(creative.paid || 0);
    const spend = toDisplaySpend(Number(creative.spend || 0));
    return {
      ...creative,
      leads,
      qualified,
      demoInvited: Number(creative.demoInvited || 0),
      paid,
      revenue: Number(creative.revenue || 0),
      spend,
      costPerLead: leads > 0 ? toDisplaySpend(Number(creative.spend || 0) / leads) : null,
      qualificationRate: leads > 0 ? Number(((qualified / leads) * 100).toFixed(1)) : 0,
      paymentRate: leads > 0 ? Number(((paid / leads) * 100).toFixed(1)) : 0,
    };
  });

  // Which Instant Form a lead filled in is a separate question from which ad showed it,
  // so the forms are counted on their own rather than folded into the ad rows.
  const forms = await query(
    `WITH stage_thresholds AS (
       SELECT
         COALESCE(MAX(sort_order) FILTER (WHERE code = 'qualified'), 30) AS qualified_sort,
         COALESCE(MAX(sort_order) FILTER (WHERE code = 'demo_invited'), 40) AS demo_sort
       FROM academy_lead_statuses
     ),
     selected AS (
       SELECT attribution.id,
              attribution.lead_id,
              attribution.form_id,
              attribution.leadgen_id,
              ROW_NUMBER() OVER (
                PARTITION BY attribution.lead_id
                ORDER BY attribution.captured_at, attribution.id
              ) AS lead_rank
       FROM meta_lead_attributions attribution
       WHERE attribution.lead_id IS NOT NULL
         AND attribution.form_id IS NOT NULL
         AND attribution.captured_at >= $1
         AND attribution.captured_at < $2
     )
     SELECT
       selected.form_id,
       MAX(record.source_sheet) AS form_name,
       COUNT(*)::int AS leads,
       COUNT(DISTINCT selected.lead_id) FILTER (
         WHERE selected.lead_rank = 1
           AND EXISTS (
           SELECT 1 FROM academy_lead_stage_history history
           JOIN academy_lead_statuses history_status ON history_status.code = history.to_status_code
           WHERE history.lead_id = selected.lead_id
             AND history_status.is_pipeline = true
             AND history_status.sort_order >= thresholds.qualified_sort
         )
       )::int AS qualified,
       COUNT(DISTINCT selected.lead_id) FILTER (
         WHERE selected.lead_rank = 1
           AND EXISTS (
           SELECT 1 FROM academy_lead_stage_history history
           JOIN academy_lead_statuses history_status ON history_status.code = history.to_status_code
           WHERE history.lead_id = selected.lead_id
             AND history_status.is_pipeline = true
             AND history_status.sort_order >= thresholds.demo_sort
         )
       )::int AS demo_invited,
       COUNT(DISTINCT selected.lead_id) FILTER (
         WHERE selected.lead_rank = 1 AND payment.revenue > 0
       )::int AS paid,
       COALESCE(SUM(payment.revenue) FILTER (WHERE selected.lead_rank = 1), 0)::bigint AS revenue
     FROM selected
     CROSS JOIN stage_thresholds thresholds
     LEFT JOIN LATERAL (
       SELECT record_inner.source_sheet
       FROM academy_lead_import_records record_inner
       WHERE record_inner.provider = 'meta_lead_ads_live'
         AND record_inner.external_id = selected.leadgen_id
       LIMIT 1
     ) record ON true
     LEFT JOIN LATERAL (
       SELECT COALESCE(SUM(payment_inner.amount_uzs) FILTER (WHERE payment_inner.status = 'paid'), 0)::bigint AS revenue
       FROM academy_payments payment_inner
       WHERE payment_inner.lead_id = selected.lead_id
     ) payment ON true
     GROUP BY selected.form_id
     ORDER BY COUNT(*) DESC`,
    [reportingRange.start, reportingRange.end],
  );

  return {
    forms,
    summary: normalizedCreatives.reduce((summary, creative) => ({
      // `creatives` stays the count of ads that actually produced leads in the period;
      // `totalAds` is the whole account, so the pair reads as "11 of 48 brought leads".
      creatives: summary.creatives + (creative.leads > 0 ? 1 : 0),
      totalAds: summary.totalAds + 1,
      leads: summary.leads + creative.leads,
      qualified: summary.qualified + creative.qualified,
      demoInvited: summary.demoInvited + creative.demoInvited,
      paid: summary.paid + creative.paid,
      revenue: summary.revenue + creative.revenue,
      spend: summary.spend + creative.spend,
    }), { creatives: 0, totalAds: 0, leads: 0, qualified: 0, demoInvited: 0, paid: 0, revenue: 0, spend: 0 }),
    creatives: normalizedCreatives,
    spendCurrency: convertsToUzs ? 'UZS' : 'USD',
    reportingRange: { from: reportingRange.from, to: reportingRange.to },
  };
};

export const getMetaAttributionLeads = async (
  reportingRange: ReportingRange,
  attributionKey: string,
) => query(
  `WITH period_attribution AS (
     SELECT attribution.*
     FROM meta_lead_attributions attribution
     WHERE attribution.lead_id IS NOT NULL
       AND attribution.captured_at >= $1
       AND attribution.captured_at < $2
   )
   SELECT attribution.id AS attribution_id,
          lead.id,
          lead.contact_name,
          lead.student_name,
          COALESCE(
            NULLIF(BTRIM(lead.phone), ''),
            (
              SELECT phone.phone
              FROM academy_lead_phones phone
              WHERE phone.lead_id = lead.id
              ORDER BY phone.is_primary DESC, phone.id
              LIMIT 1
            )
          ) AS phone,
          lead.status_code,
          status.name AS status_name,
          status.color AS status_color,
          lead.manager_id,
          manager.full_name AS manager_name,
          lead.is_archived,
          lead.created_at,
          attribution.captured_at,
          attribution.leadgen_id,
          attribution.form_id
   FROM period_attribution attribution
   JOIN academy_leads lead ON lead.id = attribution.lead_id
   LEFT JOIN academy_lead_statuses status ON status.code = lead.status_code
   LEFT JOIN users manager ON manager.id = lead.manager_id
   WHERE COALESCE(attribution.ad_id, NULLIF(attribution.utm_content, ''), 'unattributed') = $3
   ORDER BY attribution.captured_at DESC, lead.id DESC`,
  [reportingRange.start, reportingRange.end, attributionKey],
);

export const getMetaConversionEventDataset = async (limit = 200) => {
  const [events, statusCounts] = await Promise.all([
    query(
      `SELECT event.id, event.lead_id, lead.contact_name, event.event_id, event.event_name,
              event.crm_stage, event.event_time, event.action_source, event.messaging_channel,
              event.custom_data, event.status, event.attempt_count, event.next_attempt_at,
              event.last_attempt_at, event.sent_at, event.response_payload, event.error_message,
              event.created_at, event.updated_at,
              attribution.ad_id, attribution.ad_name, attribution.hook_name, attribution.campaign_name
       FROM meta_conversion_events event
       LEFT JOIN academy_leads lead ON lead.id = event.lead_id
       LEFT JOIN meta_lead_attributions attribution ON attribution.id = event.attribution_id
       ORDER BY event.event_time DESC, event.id DESC
       LIMIT $1`,
      [Math.max(1, Math.min(limit, 500))],
    ),
    query<{ status: string; count: number }>(
      `SELECT status, COUNT(*)::int AS count
       FROM meta_conversion_events
       GROUP BY status`,
    ),
  ]);
  const counts = Object.fromEntries(statusCounts.map((row) => [row.status, Number(row.count || 0)]));
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const sent = counts.sent ?? 0;
  return {
    summary: {
      total,
      pending: (counts.pending ?? 0) + (counts.processing ?? 0),
      sent,
      failed: counts.failed ?? 0,
      deliveryRate: total > 0 ? Number(((sent / total) * 100).toFixed(1)) : 0,
    },
    events,
  };
};
