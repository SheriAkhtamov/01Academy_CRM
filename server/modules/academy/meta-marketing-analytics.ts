import { query } from './academy-core';
import type { ReportingRange } from './academy-scheduling';

export const getMetaAttributionAnalytics = async (reportingRange: ReportingRange) => {
  const creatives = await query(
    `WITH selected_attribution AS (
       SELECT DISTINCT ON (attribution.lead_id) attribution.*
       FROM meta_lead_attributions attribution
       WHERE attribution.lead_id IS NOT NULL
         AND attribution.captured_at >= $1
         AND attribution.captured_at < $2
       ORDER BY attribution.lead_id, attribution.captured_at, attribution.id
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
       FROM selected_attribution attribution
       JOIN academy_leads lead ON lead.id = attribution.lead_id
       LEFT JOIN academy_lead_statuses current_status ON current_status.code = lead.status_code
       LEFT JOIN paid_by_lead payment ON payment.lead_id = attribution.lead_id
       CROSS JOIN stage_thresholds thresholds
     )
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
       MAX(utm_source) AS utm_source,
       MAX(utm_medium) AS utm_medium,
       MAX(utm_campaign) AS utm_campaign,
       MAX(utm_content) AS utm_content,
       MAX(utm_term) AS utm_term,
       BOOL_OR(utm_derived) AS utm_derived,
       COUNT(DISTINCT lead_id)::int AS leads,
       COUNT(DISTINCT lead_id) FILTER (
         WHERE reached_qualified OR (current_is_pipeline = true AND current_sort >= qualified_sort)
       )::int AS qualified,
       COUNT(DISTINCT lead_id) FILTER (
         WHERE reached_demo OR (current_is_pipeline = true AND current_sort >= demo_sort)
       )::int AS demo_invited,
       COUNT(DISTINCT lead_id) FILTER (WHERE revenue > 0 OR status_code = 'paid')::int AS paid,
       COALESCE(SUM(revenue), 0)::bigint AS revenue,
       COUNT(*) FILTER (WHERE enrichment_status = 'failed')::int AS enrichment_failures,
       MIN(captured_at) AS first_captured_at,
       MAX(captured_at) AS last_captured_at
     FROM enriched
     GROUP BY COALESCE(ad_id, NULLIF(utm_content, ''), 'unattributed')
     ORDER BY COUNT(DISTINCT lead_id) DESC, MAX(captured_at) DESC`,
    [reportingRange.start, reportingRange.end],
  );

  const normalizedCreatives = creatives.map((creative) => {
    const leads = Number(creative.leads || 0);
    const qualified = Number(creative.qualified || 0);
    const paid = Number(creative.paid || 0);
    return {
      ...creative,
      leads,
      qualified,
      demoInvited: Number(creative.demoInvited || 0),
      paid,
      revenue: Number(creative.revenue || 0),
      qualificationRate: leads > 0 ? Number(((qualified / leads) * 100).toFixed(1)) : 0,
      paymentRate: leads > 0 ? Number(((paid / leads) * 100).toFixed(1)) : 0,
    };
  });

  return {
    summary: normalizedCreatives.reduce((summary, creative) => ({
      creatives: summary.creatives + 1,
      leads: summary.leads + creative.leads,
      qualified: summary.qualified + creative.qualified,
      demoInvited: summary.demoInvited + creative.demoInvited,
      paid: summary.paid + creative.paid,
      revenue: summary.revenue + creative.revenue,
    }), { creatives: 0, leads: 0, qualified: 0, demoInvited: 0, paid: 0, revenue: 0 }),
    creatives: normalizedCreatives,
    reportingRange: { from: reportingRange.from, to: reportingRange.to },
  };
};

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
