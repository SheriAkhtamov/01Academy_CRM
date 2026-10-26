import { hasLeadershipAccess } from '@shared/academy';
import type { SalesActivityReport } from '@shared/contracts/sales-report';
import { LEAD_QUALIFIED_ACTION, LEAD_QUALIFICATION_REVOKED_ACTION } from '@shared/contracts/lead-qualification';
import { type DatasetActor, type Row, queryOne, ACADEMY_TIME_ZONE } from './academy-core';
import type { ReportingRange } from './academy-scheduling';
import { fillSalesReportDays } from './sales-report-series';
import { salesDemoAttendanceCte } from './sales-demo-students';
import { salesReportCallsCte } from './sales-report-calls';
import { salesReportLeadFactsCte } from './sales-report-lead-facts';
import { groupSalesClosureReasons } from './sales-report-reasons';

/**
 * Every result is dated by its business event, including work on older leads.
 * The denominator includes new leads and leads with activity during the period.
 * Each daily series uses the same date basis as its headline and drill-down.
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
     ${salesReportCallsCte},
     ${salesReportLeadFactsCte},
     booked_students AS (
       SELECT student.id AS student_id, student.lead_id, MIN(participant.created_at) AS booked_at
       FROM academy_demo_lesson_participants participant
       JOIN academy_demo_lessons demo ON demo.id = participant.demo_lesson_id
       JOIN academy_students student ON student.id = participant.student_id
       JOIN portfolio_leads lead ON lead.id = student.lead_id
       CROSS JOIN report_clock clock
       WHERE participant.created_at <= clock.as_of
         AND participant.created_at >= $1 AND participant.created_at < $2
         AND participant.status <> 'cancelled' AND demo.status <> 'cancelled'
       GROUP BY student.id, student.lead_id
     ),
     attended_students AS (
       SELECT student_id, lead_id, MIN(scheduled_at) AS attended_at
       FROM attended_demos GROUP BY student_id, lead_id
     ),
     student_payments AS (
       SELECT student.id AS student_id, student.lead_id, payment.paid_at
       FROM academy_students student
       JOIN portfolio_leads lead ON lead.id = student.lead_id
       JOIN academy_payments payment ON payment.student_id = student.id
       CROSS JOIN report_clock clock
       WHERE payment.status = 'paid' AND payment.amount_uzs > 0
         AND payment.paid_at <= clock.as_of
     ),
     successful_students AS (
       SELECT student_id, lead_id, MIN(paid_at) AS paid_at
       FROM student_payments GROUP BY student_id, lead_id
       HAVING MIN(paid_at) >= $1 AND MIN(paid_at) < $2
     ),
     processed_events AS (
       SELECT report_lead_id AS lead_id, started_at AS happened_at FROM period_calls
       WHERE direction = 'outgoing' OR talk_seconds > 0
       UNION ALL
       SELECT lead.id, communication.created_at FROM academy_communications communication
       LEFT JOIN academy_students student ON student.id = communication.student_id
       JOIN portfolio_leads lead ON lead.id = COALESCE(communication.lead_id, student.lead_id)
       CROSS JOIN report_clock clock
       WHERE communication.created_by IS NOT NULL AND communication.created_at <= clock.as_of
         AND communication.created_at >= $1 AND communication.created_at < $2
       UNION ALL SELECT lead_id, happened_at FROM manual_lead_events
       UNION ALL SELECT lead_id, booked_at FROM booked_students
       UNION ALL SELECT lead_id, attended_at FROM attended_students
       UNION ALL SELECT lead_id, qualified_at FROM qualified_leads
       UNION ALL SELECT lead_id, paid_at FROM student_payments WHERE paid_at >= $1 AND paid_at < $2
       UNION ALL SELECT lead_id, closed_at FROM closure_events WHERE closed_at >= $1 AND closed_at < $2
       UNION ALL SELECT lead_id, closed_at FROM closed_leads
     ),
     processed_leads AS (
       SELECT lead_id, MIN(happened_at) AS processed_at FROM processed_events GROUP BY lead_id
     ),
     period_lead_ids AS (
       SELECT id AS lead_id FROM new_leads
       UNION SELECT lead_id FROM processed_leads
       UNION SELECT report_lead_id FROM period_calls
     ),
     metric_events AS (
       SELECT 'newLeads' AS metric, created_at AS happened_at FROM new_leads
       UNION ALL SELECT 'processedLeads', processed_at FROM processed_leads
       UNION ALL SELECT 'reachedLeads', started_at FROM first_reached_calls
       UNION ALL SELECT 'qualifiedLeads', qualified_at FROM qualified_leads
       UNION ALL SELECT 'demoBookings', booked_at FROM booked_students
       UNION ALL SELECT 'demoAttendees', attended_at FROM attended_students
       UNION ALL SELECT 'successfulStudents', paid_at FROM successful_students
     ),
     daily_metrics AS (
       SELECT TO_CHAR(happened_at AT TIME ZONE 'UTC' AT TIME ZONE $7, 'YYYY-MM-DD') AS date,
         COUNT(*) FILTER (WHERE metric = 'newLeads')::int AS new_leads,
         COUNT(*) FILTER (WHERE metric = 'processedLeads')::int AS processed_leads,
         COUNT(*) FILTER (WHERE metric = 'reachedLeads')::int AS reached_leads,
         COUNT(*) FILTER (WHERE metric = 'qualifiedLeads')::int AS qualified_leads,
         COUNT(*) FILTER (WHERE metric = 'demoBookings')::int AS demo_bookings,
         COUNT(*) FILTER (WHERE metric = 'demoAttendees')::int AS demo_attendees,
         COUNT(*) FILTER (WHERE metric = 'successfulStudents')::int AS successful_students
       FROM metric_events GROUP BY date
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
       FROM period_lead_ids scope JOIN portfolio_leads lead ON lead.id = scope.lead_id
       LEFT JOIN first_reached_calls first ON first.report_lead_id = lead.id
       LEFT JOIN outgoing_attempts attempts ON attempts.report_lead_id = lead.id
       LEFT JOIN qualified_lead_states qualified ON qualified.lead_id = lead.id
     )
     SELECT
       (SELECT as_of AT TIME ZONE 'UTC' FROM report_clock) AS as_of,
       (SELECT value FROM contact_breakdown) AS contact_breakdown,
       COALESCE((SELECT JSON_AGG(JSON_BUILD_OBJECT(
         'date', date, 'newLeads', new_leads, 'processedLeads', processed_leads,
         'reachedLeads', reached_leads, 'qualifiedLeads', qualified_leads,
         'demoBookings', demo_bookings, 'demoAttendees', demo_attendees,
         'successfulStudents', successful_students) ORDER BY date) FROM daily_metrics), '[]'::json) AS daily,
       (SELECT COUNT(*)::int FROM new_leads) AS new_leads,
       (SELECT COUNT(*)::int FROM period_lead_ids) AS report_leads,
       (SELECT COUNT(*)::int FROM processed_leads) AS processed_leads,
       (SELECT COUNT(*)::int FROM first_reached_calls) AS reached_leads,
       (SELECT COUNT(*)::int FROM qualified_leads) AS qualified_leads,
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
    newLeads: count(row?.newLeads), reportLeads: count(row?.reportLeads), processedLeads: count(row?.processedLeads),
    reachedLeads: count(row?.reachedLeads), qualifiedLeads: count(row?.qualifiedLeads),
    demoBookings: count(row?.demoBookings), demoAttendees: count(row?.demoAttendees),
    successfulStudents: count(row?.successfulStudents), closedLeads: count(row?.closedLeads),
    closedReasons: groupSalesClosureReasons(Array.isArray(row?.closedReasons) ? row.closedReasons : []),
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
