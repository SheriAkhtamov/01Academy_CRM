import type { Pool } from 'pg';
import type { MarketingLeadFact } from '../domain/report';
import type { MarketingBotState } from '@shared/contracts/telegram-marketing';
import { marketingDateBounds } from '../domain/period';

export const marketingLeadFactsSql = `
  WITH cohort AS MATERIALIZED (
    SELECT lead.* FROM academy_leads lead
    JOIN academy_lead_sources source ON source.id = lead.source_id
    WHERE lead.created_at >= $1 AND lead.created_at < $2
      AND (source.code IN ('meta_lead_ads', 'meta_lead_ads_facebook') OR EXISTS (
        SELECT 1 FROM meta_lead_attributions attribution
        WHERE attribution.lead_id = lead.id
          AND (NULLIF(attribution.ad_id, '') IS NOT NULL OR NULLIF(attribution.leadgen_id, '') IS NOT NULL)
      ))
  ), origin AS (
    SELECT DISTINCT ON (record.lead_id) record.lead_id, record.source_sheet AS form_name,
      record.payload->>'campaignName' AS campaign_name
    FROM academy_lead_import_records record JOIN cohort lead ON lead.id = record.lead_id
    WHERE record.provider = 'meta_lead_ads_live'
    ORDER BY record.lead_id, record.id
  ), call_facts AS (
    SELECT lead.id AS lead_id, true AS attempted, BOOL_OR(call.talk_seconds > 0) AS reached
    FROM telephony_calls call
    LEFT JOIN academy_students contact ON call.contact_type = 'student' AND contact.id = call.contact_id
    JOIN cohort lead ON lead.id = COALESCE(call.lead_id, CASE WHEN call.contact_type = 'lead' THEN call.contact_id END, contact.lead_id)
    WHERE call.started_at >= $1 AND call.started_at >= lead.created_at AND call.started_at <= $3
    GROUP BY lead.id
  ), latest_qualification AS (
    SELECT DISTINCT ON (fact.entity_id, fact.new_values->0->>'funnelId') fact.entity_id, fact.action
    FROM audit_logs fact JOIN cohort lead ON lead.id = fact.entity_id
    WHERE fact.entity_type = 'academy_lead'
      AND fact.action IN ('QUALIFY_ACADEMY_LEAD_BY_CRITERIA', 'REVOKE_ACADEMY_LEAD_QUALIFICATION')
      AND fact.created_at <= $3
    ORDER BY fact.entity_id, fact.new_values->0->>'funnelId', fact.created_at DESC, fact.id DESC
  ), qualification_facts AS (
    SELECT entity_id AS lead_id, BOOL_OR(action = 'QUALIFY_ACADEMY_LEAD_BY_CRITERIA') AS qualified
    FROM latest_qualification GROUP BY entity_id
  ), demo_facts AS (
    SELECT student.lead_id, ARRAY_AGG(DISTINCT student.id) AS booked,
      ARRAY_AGG(DISTINCT student.id) FILTER (WHERE participant.status = 'attended' AND demo.scheduled_at <= $3) AS attended,
      ARRAY_AGG(DISTINCT student.id) FILTER (WHERE demo.scheduled_at <= $3) AS due
    FROM academy_students student
    JOIN cohort lead ON lead.id = student.lead_id
    JOIN academy_demo_lesson_participants participant ON participant.student_id = student.id
    JOIN academy_demo_lessons demo ON demo.id = participant.demo_lesson_id
    WHERE participant.status <> 'cancelled' AND demo.status IN ('scheduled', 'completed')
      AND participant.created_at >= lead.created_at AND participant.created_at <= $3
    GROUP BY student.lead_id
  ), payment_facts AS (
    SELECT lead.id AS lead_id, COUNT(*) AS count, SUM(payment.amount_uzs) AS revenue
    FROM academy_payments payment
    LEFT JOIN academy_students student ON student.id = payment.student_id
    JOIN cohort lead ON lead.id = COALESCE(payment.lead_id, student.lead_id)
    WHERE payment.status = 'paid' AND payment.amount_uzs > 0
      AND COALESCE(payment.paid_at, payment.created_at) >= lead.created_at
      AND COALESCE(payment.paid_at, payment.created_at) <= $3
    GROUP BY lead.id
  )
  SELECT lead.id, course.slug AS "courseSlug", origin.form_name AS "formName",
    origin.campaign_name AS "campaignName", lead.languages, lead.language,
    COALESCE(calls.attempted, false) AS attempted, COALESCE(calls.reached, false) AS reached,
    COALESCE(qualification.qualified, false) AS qualified,
    COALESCE(demos.booked, '{}') AS "bookedStudentIds",
    COALESCE(demos.attended, '{}') AS "attendedStudentIds",
    COALESCE(demos.due, '{}') AS "dueStudentIds",
    COALESCE(payments.count, 0)::int AS "paymentCount",
    COALESCE(payments.revenue, 0)::float8 AS "revenueUzs"
  FROM cohort lead
  LEFT JOIN origin ON origin.lead_id = lead.id
  LEFT JOIN academy_courses course ON course.id = lead.course_id
  LEFT JOIN call_facts calls ON calls.lead_id = lead.id
  LEFT JOIN qualification_facts qualification ON qualification.lead_id = lead.id
  LEFT JOIN demo_facts demos ON demos.lead_id = lead.id
  LEFT JOIN payment_facts payments ON payments.lead_id = lead.id
  ORDER BY lead.id`;

export const createMarketingLeadFactsReader = (pool: Pick<Pool, 'query'>) => async (state: MarketingBotState, asOf: Date) => {
  const { start, end } = marketingDateBounds(state);
  const result = await pool.query<MarketingLeadFact>(marketingLeadFactsSql, [start, end, asOf]);
  return result.rows;
};
