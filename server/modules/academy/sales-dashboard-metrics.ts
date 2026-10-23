import { hasLeadershipAccess } from '@shared/academy';
import type { SalesActivityReport } from '@shared/contracts/sales-report';
import { LEAD_QUALIFIED_ACTION, LEAD_QUALIFICATION_REVOKED_ACTION } from '@shared/contracts/lead-qualification';
import { type DatasetActor, type Row, queryOne, ACADEMY_TIME_ZONE } from './academy-core';
import type { ReportingRange } from './academy-scheduling';
import { fillSalesReportDays } from './sales-report-series';
import { salesDemoAttendanceCte } from './sales-demo-students';
import { salesCohortCallsCte } from './sales-cohort-calls';

/**
 * Every metric belongs to the same creation-date cohort and current portfolio.
 * Later results are included through the query's clock, including after range.to.
 * Daily points group these results by lead creation date, not by action date.
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
     ${salesCohortCallsCte},
     qualification_states AS (
       SELECT DISTINCT ON (lead.id, lead.funnel_id)
         fact.entity_id AS lead_id, fact.created_at, fact.action
       FROM audit_logs fact
       JOIN cohort_leads lead ON lead.id = fact.entity_id
       CROSS JOIN report_clock clock
       WHERE fact.entity_type = 'academy_lead' AND fact.action IN ($5, $6)
         AND fact.new_values->0->>'funnelId' = lead.funnel_id::text
         AND fact.created_at <= clock.as_of
       ORDER BY lead.id, lead.funnel_id, fact.created_at DESC, fact.id DESC
     ),
     qualified_facts AS (
       SELECT lead_id FROM qualification_states WHERE action = $5
     ),
     booked_students AS (
       SELECT DISTINCT student.id AS student_id, student.lead_id
       FROM academy_demo_lesson_participants participant
       JOIN academy_demo_lessons demo ON demo.id = participant.demo_lesson_id
       JOIN academy_students student ON student.id = participant.student_id
       JOIN cohort_leads lead ON lead.id = student.lead_id
       CROSS JOIN report_clock clock
       WHERE participant.created_at <= clock.as_of
         AND participant.status <> 'cancelled' AND demo.status <> 'cancelled'
     ),
     attended_students AS (
       SELECT DISTINCT student_id, lead_id FROM attended_demos
     ),
     successful_students AS (
       SELECT student.id AS student_id, student.lead_id, MIN(payment.paid_at) AS paid_at
       FROM academy_students student
       JOIN cohort_leads lead ON lead.id = student.lead_id
       JOIN academy_payments payment ON payment.student_id = student.id
       CROSS JOIN report_clock clock
       WHERE payment.status = 'paid' AND payment.amount_uzs > 0
         AND payment.paid_at <= clock.as_of
       GROUP BY student.id, student.lead_id
     ),
     closure_events AS (
       SELECT fact.entity_id AS lead_id, fact.created_at AS closed_at, fact.id AS event_id,
         NULLIF(BTRIM(fact.new_values->0->>'archiveReason'), '') AS reason
       FROM audit_logs fact
       JOIN cohort_leads lead ON lead.id = fact.entity_id
       CROSS JOIN report_clock clock
       WHERE fact.entity_type = 'academy_lead'
         AND fact.action IN ('ARCHIVE_ACADEMY_LEAD', 'BULK_ARCHIVE_ACADEMY_LEAD')
         AND fact.created_at <= clock.as_of
     ),
     latest_closure AS (
       SELECT DISTINCT ON (lead_id) lead_id, reason
       FROM closure_events ORDER BY lead_id, closed_at DESC, event_id DESC
     ),
     closed_leads AS (
       SELECT lead.id AS lead_id,
         COALESCE(NULLIF(BTRIM(lead.archive_reason), ''), latest.reason, 'unspecified') AS reason
       FROM cohort_leads lead LEFT JOIN latest_closure latest ON latest.lead_id = lead.id
       WHERE lead.is_archived = true
     ),
     processed_lead_ids AS (
       SELECT report_lead_id AS lead_id FROM cohort_calls
       WHERE direction = 'outgoing' OR talk_seconds > 0
       UNION
       SELECT communication.lead_id FROM academy_communications communication
       JOIN cohort_leads lead ON lead.id = communication.lead_id
       CROSS JOIN report_clock clock
       WHERE communication.created_by IS NOT NULL AND communication.created_at <= clock.as_of
       UNION
       SELECT comment.lead_id FROM academy_lead_comments comment
       JOIN cohort_leads lead ON lead.id = comment.lead_id
       CROSS JOIN report_clock clock
       WHERE comment.author_id IS NOT NULL AND comment.created_at <= clock.as_of
       UNION SELECT lead_id FROM booked_students
       UNION SELECT lead_id FROM attended_students
       UNION SELECT lead_id FROM qualified_facts
       UNION SELECT lead_id FROM successful_students
       UNION SELECT lead_id FROM closure_events
       UNION SELECT lead_id FROM closed_leads
     ),
     metric_entities AS (
       SELECT 'newLeads' AS metric, id AS lead_id FROM cohort_leads
       UNION ALL SELECT 'processedLeads', lead_id FROM processed_lead_ids
       UNION ALL SELECT 'reachedLeads', report_lead_id FROM first_reached_calls
       UNION ALL SELECT 'qualifiedLeads', lead_id FROM qualified_facts
       UNION ALL SELECT 'demoBookings', lead_id FROM booked_students
       UNION ALL SELECT 'demoAttendees', lead_id FROM attended_students
       UNION ALL SELECT 'successfulStudents', lead_id FROM successful_students
     ),
     daily_metrics AS (
       SELECT TO_CHAR(lead.created_at AT TIME ZONE 'UTC' AT TIME ZONE $7, 'YYYY-MM-DD') AS date,
         COUNT(*) FILTER (WHERE metric = 'newLeads')::int AS new_leads,
         COUNT(*) FILTER (WHERE metric = 'processedLeads')::int AS processed_leads,
         COUNT(*) FILTER (WHERE metric = 'reachedLeads')::int AS reached_leads,
         COUNT(*) FILTER (WHERE metric = 'qualifiedLeads')::int AS qualified_leads,
         COUNT(*) FILTER (WHERE metric = 'demoBookings')::int AS demo_bookings,
         COUNT(*) FILTER (WHERE metric = 'demoAttendees')::int AS demo_attendees,
         COUNT(*) FILTER (WHERE metric = 'successfulStudents')::int AS successful_students
       FROM metric_entities entity JOIN cohort_leads lead ON lead.id = entity.lead_id
       GROUP BY date
     ),
     contact_breakdown AS (
       SELECT JSON_BUILD_OBJECT(
         'firstAttempt', COUNT(*) FILTER (WHERE first.direction = 'outgoing' AND first.outgoing_attempt_number = 1),
         'secondAttempt', COUNT(*) FILTER (WHERE first.direction = 'outgoing' AND first.outgoing_attempt_number = 2),
         'thirdAttempt', COUNT(*) FILTER (WHERE first.direction = 'outgoing' AND first.outgoing_attempt_number = 3),
         'laterAttempt', COUNT(*) FILTER (WHERE first.direction = 'outgoing' AND first.outgoing_attempt_number >= 4),
         'incomingFirst', COUNT(*) FILTER (WHERE first.direction = 'incoming'),
         'attemptedUnreached', COUNT(*) FILTER (WHERE first.report_lead_id IS NULL AND attempts.count > 0),
         'notAttempted', COUNT(*) FILTER (WHERE first.report_lead_id IS NULL AND COALESCE(attempts.count, 0) = 0),
         'reachedArchived', COUNT(*) FILTER (WHERE first.report_lead_id IS NOT NULL AND lead.is_archived = true),
         'reachedQualifiedInWork', COUNT(*) FILTER (WHERE first.report_lead_id IS NOT NULL
           AND NOT COALESCE(lead.is_archived, false) AND qualified.lead_id IS NOT NULL),
         'reachedUnqualifiedInWork', COUNT(*) FILTER (WHERE first.report_lead_id IS NOT NULL
           AND NOT COALESCE(lead.is_archived, false) AND qualified.lead_id IS NULL)
       ) AS value
       FROM cohort_leads lead
       LEFT JOIN first_reached_calls first ON first.report_lead_id = lead.id
       LEFT JOIN outgoing_attempts attempts ON attempts.report_lead_id = lead.id
       LEFT JOIN qualified_facts qualified ON qualified.lead_id = lead.id
     )
     SELECT
       (SELECT as_of AT TIME ZONE 'UTC' FROM report_clock) AS as_of,
       (SELECT value FROM contact_breakdown) AS contact_breakdown,
       COALESCE((SELECT JSON_AGG(JSON_BUILD_OBJECT(
         'date', date, 'newLeads', new_leads, 'processedLeads', processed_leads,
         'reachedLeads', reached_leads, 'qualifiedLeads', qualified_leads,
         'demoBookings', demo_bookings, 'demoAttendees', demo_attendees,
         'successfulStudents', successful_students) ORDER BY date) FROM daily_metrics), '[]'::json) AS daily,
       (SELECT COUNT(*)::int FROM cohort_leads) AS new_leads,
       (SELECT COUNT(*)::int FROM processed_lead_ids) AS processed_leads,
       (SELECT COUNT(*)::int FROM first_reached_calls) AS reached_leads,
       (SELECT COUNT(*)::int FROM qualified_facts) AS qualified_leads,
       (SELECT COUNT(*)::int FROM booked_students) AS demo_bookings,
       (SELECT COUNT(*)::int FROM attended_students) AS demo_attendees,
       (SELECT COUNT(*)::int FROM successful_students) AS successful_students,
       (SELECT COUNT(*)::int FROM closed_leads) AS closed_leads,
       COALESCE((SELECT JSON_AGG(reasons ORDER BY reasons.count DESC, reasons.reason)
         FROM (SELECT reason, COUNT(*)::int AS count FROM closed_leads GROUP BY reason) reasons), '[]'::json) AS closed_reasons`,
    [range.start, range.end, managerId, funnelId, LEAD_QUALIFIED_ACTION, LEAD_QUALIFICATION_REVOKED_ACTION, ACADEMY_TIME_ZONE],
  );
  const count = (value: unknown) => Math.max(0, Number(value) || 0);
  const contact = row?.contactBreakdown;
  return {
    asOf: new Date(row?.asOf ?? Date.now()).toISOString(),
    daily: fillSalesReportDays(row?.daily, range),
    newLeads: count(row?.newLeads), processedLeads: count(row?.processedLeads),
    reachedLeads: count(row?.reachedLeads), qualifiedLeads: count(row?.qualifiedLeads),
    demoBookings: count(row?.demoBookings), demoAttendees: count(row?.demoAttendees),
    successfulStudents: count(row?.successfulStudents), closedLeads: count(row?.closedLeads),
    closedReasons: Array.isArray(row?.closedReasons) ? row.closedReasons : [],
    contactBreakdown: {
      firstAttempt: count(contact?.firstAttempt), secondAttempt: count(contact?.secondAttempt),
      thirdAttempt: count(contact?.thirdAttempt), laterAttempt: count(contact?.laterAttempt),
      incomingFirst: count(contact?.incomingFirst), attemptedUnreached: count(contact?.attemptedUnreached),
      notAttempted: count(contact?.notAttempted), reachedArchived: count(contact?.reachedArchived),
      reachedQualifiedInWork: count(contact?.reachedQualifiedInWork),
      reachedUnqualifiedInWork: count(contact?.reachedUnqualifiedInWork),
    },
  };
};
