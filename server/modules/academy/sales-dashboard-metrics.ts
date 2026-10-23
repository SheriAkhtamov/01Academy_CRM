import { hasLeadershipAccess } from '@shared/academy';
import type { SalesActivityReport } from '@shared/contracts/sales-report';
import { LEAD_QUALIFIED_ACTION, LEAD_QUALIFICATION_REVOKED_ACTION } from '@shared/contracts/lead-qualification';
import { type DatasetActor, type Row, queryOne, ACADEMY_TIME_ZONE } from './academy-core';
import type { ReportingRange } from './academy-scheduling';
import { fillSalesReportDays } from './sales-report-series';
import { salesDemoAttendanceCte } from './sales-demo-students';

/**
 * Activity dates are independent of card stages. The report scopes the current
 * lead portfolio by funnel and manager; attendance uses the same portfolio.
 * Qualifications retain their confirmed funnel and can be explicitly revoked.
 */
export const buildSalesDashboardMetrics = async (
  actor: DatasetActor,
  range: ReportingRange,
  requestedManagerId: number | null = null,
  funnelId: number | null = null,
): Promise<SalesActivityReport> => {
  const managerId = hasLeadershipAccess(actor) ? requestedManagerId : actor.userId;
  const row = await queryOne<Row>(
    `${salesDemoAttendanceCte},
     visible_leads AS (
       SELECT lead.* FROM academy_leads lead
       WHERE ($3::int IS NULL OR lead.manager_id = $3)
         AND ($4::int IS NULL OR lead.funnel_id = $4)
     ),
     period_calls AS (
       SELECT phone_call.*,
         COALESCE(phone_call.lead_id,
           CASE WHEN phone_call.contact_type = 'lead' THEN phone_call.contact_id END,
           student.lead_id) AS report_lead_id
       FROM telephony_calls phone_call
       LEFT JOIN academy_students student
         ON phone_call.contact_type = 'student' AND student.id = phone_call.contact_id
       JOIN visible_leads lead ON lead.id = COALESCE(phone_call.lead_id,
         CASE WHEN phone_call.contact_type = 'lead' THEN phone_call.contact_id END, student.lead_id)
       WHERE phone_call.started_at >= $1 AND phone_call.started_at < $2
     ),
     qualification_states AS (
       SELECT DISTINCT ON (lead.id, lead.funnel_id)
         fact.entity_id AS lead_id, fact.created_at, fact.action
       FROM audit_logs fact
       JOIN visible_leads lead ON lead.id = fact.entity_id
       WHERE fact.entity_type = 'academy_lead' AND fact.action IN ($5, $6)
         AND fact.new_values->0->>'funnelId' = lead.funnel_id::text
       ORDER BY lead.id, lead.funnel_id, fact.created_at DESC, fact.id DESC
     ),
     qualified_facts AS (
       SELECT lead_id, created_at FROM qualification_states
       WHERE action = $5 AND created_at >= $1 AND created_at < $2
     ),
     booked_students AS (
       SELECT student.id AS student_id, student.lead_id, MIN(participant.created_at) AS happened_at
       FROM academy_demo_lesson_participants participant
       JOIN academy_demo_lessons demo ON demo.id = participant.demo_lesson_id
       JOIN academy_students student ON student.id = participant.student_id
       JOIN visible_leads lead ON lead.id = student.lead_id
       WHERE participant.created_at >= $1 AND participant.created_at < $2
         AND participant.status <> 'cancelled' AND demo.status <> 'cancelled'
       GROUP BY student.id, student.lead_id
     ),
     attended_students AS (
       SELECT student_id, MIN(scheduled_at) AS happened_at
       FROM attended_demos GROUP BY student_id
     ),
     first_student_payments AS (
       SELECT student.id AS student_id, student.lead_id,
         MIN(payment.paid_at) AS paid_at
       FROM academy_students student
       JOIN visible_leads lead ON lead.id = student.lead_id
       JOIN academy_payments payment ON payment.student_id = student.id
       WHERE payment.status = 'paid' AND payment.amount_uzs > 0 AND payment.paid_at IS NOT NULL
       GROUP BY student.id, student.lead_id
     ),
     successful_students AS (
       SELECT * FROM first_student_payments WHERE paid_at >= $1 AND paid_at < $2
     ),
     closure_events AS (
       SELECT fact.entity_id AS lead_id, fact.created_at AS closed_at,
         NULLIF(BTRIM(fact.new_values->0->>'archiveReason'), '') AS reason
       FROM audit_logs fact
       JOIN visible_leads lead ON lead.id = fact.entity_id
       WHERE fact.entity_type = 'academy_lead'
         AND fact.action IN ('ARCHIVE_ACADEMY_LEAD', 'BULK_ARCHIVE_ACADEMY_LEAD')
         AND fact.created_at >= $1 AND fact.created_at < $2
       UNION ALL
       SELECT lead.id, lead.archived_at, NULLIF(BTRIM(lead.archive_reason), '')
       FROM visible_leads lead
       WHERE lead.is_archived AND lead.archived_at >= $1 AND lead.archived_at < $2
     ),
     closed_leads AS (
       SELECT DISTINCT ON (lead_id) lead_id, closed_at, COALESCE(reason, 'unspecified') AS reason
       FROM closure_events ORDER BY lead_id, closed_at DESC, reason
     ),
     processed_events AS (
       SELECT report_lead_id AS lead_id, started_at AS happened_at FROM period_calls
       WHERE direction = 'outgoing' OR talk_seconds > 0
       UNION ALL
       SELECT communication.lead_id, communication.created_at
       FROM academy_communications communication
       JOIN visible_leads lead ON lead.id = communication.lead_id
       WHERE communication.created_by IS NOT NULL
         AND communication.created_at >= $1 AND communication.created_at < $2
       UNION ALL
       SELECT comment.lead_id, comment.created_at FROM academy_lead_comments comment
       JOIN visible_leads lead ON lead.id = comment.lead_id
       WHERE comment.author_id IS NOT NULL AND comment.created_at >= $1 AND comment.created_at < $2
       UNION ALL SELECT lead_id, happened_at FROM booked_students
       UNION ALL SELECT lead_id, created_at FROM qualified_facts
       UNION ALL SELECT lead_id, paid_at FROM successful_students
       UNION ALL SELECT lead_id, closed_at FROM closure_events
     ),
     processed_lead_ids AS (
       SELECT lead_id, MIN(happened_at) AS happened_at FROM processed_events GROUP BY lead_id
     ),
     metric_events AS (
       SELECT 'newLeads' AS metric, created_at AS happened_at FROM visible_leads
       WHERE created_at >= $1 AND created_at < $2
       UNION ALL SELECT 'processedLeads', happened_at FROM processed_lead_ids
       UNION ALL SELECT 'reachedCalls', started_at FROM period_calls WHERE talk_seconds > 0
       UNION ALL SELECT 'qualifiedLeads', created_at FROM qualified_facts
       UNION ALL SELECT 'demoBookings', happened_at FROM booked_students
       UNION ALL SELECT 'demoAttendees', happened_at FROM attended_students
       UNION ALL SELECT 'successfulStudents', paid_at FROM successful_students
     ),
     daily_metrics AS (
       SELECT TO_CHAR(happened_at AT TIME ZONE 'UTC' AT TIME ZONE $7, 'YYYY-MM-DD') AS date,
         COUNT(*) FILTER (WHERE metric = 'newLeads')::int AS new_leads,
         COUNT(*) FILTER (WHERE metric = 'processedLeads')::int AS processed_leads,
         COUNT(*) FILTER (WHERE metric = 'reachedCalls')::int AS reached_calls,
         COUNT(*) FILTER (WHERE metric = 'qualifiedLeads')::int AS qualified_leads,
         COUNT(*) FILTER (WHERE metric = 'demoBookings')::int AS demo_bookings,
         COUNT(*) FILTER (WHERE metric = 'demoAttendees')::int AS demo_attendees,
         COUNT(*) FILTER (WHERE metric = 'successfulStudents')::int AS successful_students
       FROM metric_events GROUP BY date
     )
     SELECT
       COALESCE((SELECT JSON_AGG(JSON_BUILD_OBJECT(
         'date', date, 'newLeads', new_leads, 'processedLeads', processed_leads,
         'reachedCalls', reached_calls, 'qualifiedLeads', qualified_leads,
         'demoBookings', demo_bookings, 'demoAttendees', demo_attendees,
         'successfulStudents', successful_students) ORDER BY date) FROM daily_metrics), '[]'::json) AS daily,
       (SELECT COUNT(*)::int FROM visible_leads WHERE created_at >= $1 AND created_at < $2) AS new_leads,
       (SELECT COUNT(*)::int FROM processed_lead_ids) AS processed_leads,
       (SELECT COUNT(*)::int FROM period_calls WHERE talk_seconds > 0) AS reached_calls,
       (SELECT COUNT(DISTINCT lead_id)::int FROM qualified_facts) AS qualified_leads,
       (SELECT COUNT(*)::int FROM booked_students) AS demo_bookings,
       (SELECT COUNT(*)::int FROM attended_students) AS demo_attendees,
       (SELECT COUNT(*)::int FROM successful_students) AS successful_students,
       (SELECT COUNT(*)::int FROM closed_leads) AS closed_leads,
       COALESCE((SELECT JSON_AGG(reasons ORDER BY reasons.count DESC, reasons.reason)
         FROM (SELECT reason, COUNT(*)::int AS count FROM closed_leads GROUP BY reason) reasons), '[]'::json) AS closed_reasons`,
    [range.start, range.end, managerId, funnelId, LEAD_QUALIFIED_ACTION, LEAD_QUALIFICATION_REVOKED_ACTION, ACADEMY_TIME_ZONE],
  );
  const count = (value: unknown) => Math.max(0, Number(value) || 0);
  return {
    daily: fillSalesReportDays(row?.daily, range),
    newLeads: count(row?.newLeads), processedLeads: count(row?.processedLeads),
    reachedCalls: count(row?.reachedCalls), qualifiedLeads: count(row?.qualifiedLeads),
    demoBookings: count(row?.demoBookings), demoAttendees: count(row?.demoAttendees),
    successfulStudents: count(row?.successfulStudents), closedLeads: count(row?.closedLeads),
    closedReasons: Array.isArray(row?.closedReasons) ? row.closedReasons : [],
  };
};
