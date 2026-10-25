import type { Pool } from 'pg';
import type { MarketingLeadFact } from '../domain/report';
import type { MarketingBotState } from '@shared/contracts/telegram-marketing';
import { marketingDateBounds } from '../domain/period';
import { metaReportingIntakesSql } from '../../../services/meta-reporting-intakes';

export const marketingLeadFactsSql = `
  WITH ${metaReportingIntakesSql}, intakes AS MATERIALIZED (
    SELECT * FROM meta_intakes
    WHERE acquired_at >= $1 AND acquired_at < $2 AND acquired_at <= $3
  ), cohort AS MATERIALIZED (
    SELECT lead.*, intake.acquired_at FROM academy_leads lead
    JOIN (SELECT lead_id, MIN(acquired_at) AS acquired_at FROM intakes GROUP BY lead_id) intake
      ON intake.lead_id = lead.id
  ), call_facts AS (
    SELECT lead.id AS lead_id, true AS attempted, BOOL_OR(call.talk_seconds > 0) AS reached
    FROM telephony_calls call
    LEFT JOIN academy_students contact ON call.contact_type = 'student' AND contact.id = call.contact_id
    JOIN cohort lead ON lead.id = COALESCE(call.lead_id, CASE WHEN call.contact_type = 'lead' THEN call.contact_id END, contact.lead_id)
    WHERE call.started_at >= lead.acquired_at AND call.started_at <= $3
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
      AND participant.created_at >= lead.acquired_at AND participant.created_at <= $3
    GROUP BY student.lead_id
  ), payment_facts AS (
    SELECT lead.id AS lead_id, COUNT(*) AS count, SUM(payment.amount_uzs) AS revenue
    FROM academy_payments payment
    LEFT JOIN academy_students student ON student.id = payment.student_id
    JOIN cohort lead ON lead.id = COALESCE(payment.lead_id, student.lead_id)
    WHERE payment.status = 'paid' AND payment.amount_uzs > 0
      AND COALESCE(payment.paid_at, payment.created_at) >= lead.acquired_at
      AND COALESCE(payment.paid_at, payment.created_at) <= $3
    GROUP BY lead.id
  )
  SELECT lead.id, COALESCE(intake.course_slug, course.slug) AS "courseSlug", origin.form_name AS "formName",
    origin.campaign_name AS "campaignName", lead.languages, lead.language,
    COALESCE(calls.attempted, false) AS attempted, COALESCE(calls.reached, false) AS reached,
    COALESCE(qualification.qualified, false) AS qualified,
    COALESCE(demos.booked, '{}') AS "bookedStudentIds",
    COALESCE(demos.attended, '{}') AS "attendedStudentIds",
    COALESCE(demos.due, '{}') AS "dueStudentIds",
    COALESCE(payments.count, 0)::int AS "paymentCount",
    COALESCE(payments.revenue, 0)::float8 AS "revenueUzs"
  FROM cohort lead
  JOIN intakes intake ON intake.lead_id = lead.id
  LEFT JOIN LATERAL (
    SELECT record.source_sheet AS form_name, record.payload->>'campaignName' AS campaign_name
    FROM academy_lead_import_records record
    WHERE record.provider = 'meta_lead_ads_live' AND record.lead_id = lead.id
      AND (record.external_id = intake.leadgen_id OR intake.attribution_id IS NULL)
    ORDER BY record.id LIMIT 1
  ) origin ON true
  LEFT JOIN academy_courses course ON course.id = lead.course_id
  LEFT JOIN call_facts calls ON calls.lead_id = lead.id
  LEFT JOIN qualification_facts qualification ON qualification.lead_id = lead.id
  LEFT JOIN demo_facts demos ON demos.lead_id = lead.id
  LEFT JOIN payment_facts payments ON payments.lead_id = lead.id
  ORDER BY lead.id, intake.acquired_at, intake.intake_id`;

export const createMarketingLeadFactsReader = (pool: Pick<Pool, 'query'>) => async (state: MarketingBotState, asOf: Date) => {
  const { start, end } = marketingDateBounds(state);
  const result = await pool.query<MarketingLeadFact>(marketingLeadFactsSql, [start, end, asOf]);
  return result.rows;
};
