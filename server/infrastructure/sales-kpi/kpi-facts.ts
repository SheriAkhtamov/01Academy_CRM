import { pool } from '../../db';
import type { KpiFacts, KpiLeadFact, KpiSaleFact, KpiSurveyFact, KpiTrialFact } from '@shared/sales-kpi';
import { kpiMonthBounds } from '@shared/sales-kpi-time';

// PostgreSQL timestamp columns use UTC. JSON round-tripping converts the pg
// Date values into the same ISO contract used by API callers and unit tests.
const datesToIso = <T>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T;

export async function readKpiFacts(employeeIds: number[], month: string, asOf: string): Promise<KpiFacts> {
  if (!employeeIds.length) return { leads: [], trials: [], sales: [], surveys: [] };
  const { end } = kpiMonthBounds(month);
  const cutoff = new Date(Math.min(end.getTime() - 1, new Date(asOf).getTime()));
  const [leads, trials, sales, surveys] = await Promise.all([
    pool.query(
      `SELECT tracked.lead_id AS id, COALESCE(lead.student_name, lead.contact_name) AS name,
        tracked.hunter_id AS "hunterId", tracked.closer_id AS "closerId",
        tracked.received_at AS "receivedAt", tracked.tracked_at AS "trackedAt",
        tracked.first_response_at AS "firstResponseAt", tracked.qualified_at AS "qualifiedAt",
        tracked.crm_completed_at AS "crmCompletedAt", tracked.offer_at AS "offerAt",
        tracked.reactivated_at AS "reactivatedAt",
        COALESCE((SELECT activity.kind = 'cold' FROM academy_sales_kpi_activity activity
          WHERE activity.lead_id = lead.id AND activity.kind IN ('cold', 'reactivated')
            AND activity.occurred_at <= $2 ORDER BY activity.occurred_at DESC, activity.id DESC LIMIT 1), false) AS "isCold",
        (SELECT MAX(activity.occurred_at) FROM academy_sales_kpi_activity activity
          WHERE activity.lead_id = lead.id AND activity.kind = 'contact' AND activity.occurred_at <= $2) AS "lastContactAt"
       FROM academy_sales_kpi_leads tracked JOIN academy_leads lead ON lead.id = tracked.lead_id
       WHERE tracked.hunter_id = ANY($1::int[]) OR tracked.closer_id = ANY($1::int[])
         OR EXISTS (SELECT 1 FROM academy_students student
           JOIN academy_demo_lesson_participants participant ON participant.student_id = student.id
           JOIN academy_sales_kpi_trials trial ON trial.participant_id = participant.id
           WHERE student.lead_id = lead.id AND (trial.hunter_id = ANY($1::int[]) OR trial.closer_id = ANY($1::int[])))`, [employeeIds, cutoff],
    ),
    pool.query(
      `SELECT participant.id, student.lead_id AS "leadId", participant.student_id AS "studentId",
        demo.course_id AS "courseId", COALESCE(student.student_name, student.contact_name) AS name,
        tracked.hunter_id AS "hunterId", tracked.closer_id AS "closerId",
        COALESCE(tracked.booked_at, participant.created_at) AS "bookedAt", demo.scheduled_at AS "scheduledAt",
        demo.duration_minutes AS "durationMinutes", participant.status, demo.status AS "lessonStatus",
        COALESCE(tracked.reactivated, false) AS reactivated
       FROM academy_demo_lesson_participants participant
       JOIN academy_demo_lessons demo ON demo.id = participant.demo_lesson_id
       JOIN academy_students student ON student.id = participant.student_id
       LEFT JOIN academy_sales_kpi_trials tracked ON tracked.participant_id = participant.id
       WHERE participant.status IN ('confirmed', 'attended', 'no_show', 'cancelled')
         AND participant.student_id IN (
           SELECT owned.student_id FROM academy_demo_lesson_participants owned
           JOIN academy_sales_kpi_trials owner ON owner.participant_id = owned.id
           WHERE owner.hunter_id = ANY($1::int[]) OR owner.closer_id = ANY($1::int[])
         )`, [employeeIds],
    ),
    pool.query(
      `SELECT payment.id, COALESCE(payment.lead_id, student.lead_id) AS "leadId",
        payment.student_id AS "studentId", payment.group_id AS "groupId",
        COALESCE(student.student_name, student.contact_name) AS name,
        tracked.closer_id AS "closerId", COALESCE(payment.paid_at, payment.created_at) AS "paidAt",
        payment.paid_until AS "paidUntil", payment.amount_uzs AS "amountUzs", payment.status,
        tracked.kind, tracked.cycle_key AS "cycleKey", tracked.referral_initiated AS "referralInitiated"
       FROM academy_sales_kpi_sales tracked
       JOIN academy_payments payment ON payment.id = tracked.payment_id
       JOIN academy_students student ON student.id = payment.student_id
       WHERE tracked.closer_id = ANY($1::int[]) OR payment.student_id IN (
         SELECT participant.student_id FROM academy_demo_lesson_participants participant
         JOIN academy_sales_kpi_trials trial ON trial.participant_id = participant.id
         WHERE trial.closer_id = ANY($1::int[])
       )`, [employeeIds],
    ),
    pool.query(
      `SELECT survey.id, survey.student_id AS "studentId", COALESCE(student.student_name, student.contact_name) AS name,
        tracked.closer_id AS "closerId", survey.nps_score AS score, survey.created_at AS "createdAt"
       FROM academy_sales_kpi_surveys tracked JOIN academy_parent_surveys survey ON survey.id = tracked.survey_id
       JOIN academy_students student ON student.id = survey.student_id
       WHERE tracked.closer_id = ANY($1::int[]) AND survey.nps_score BETWEEN 0 AND 10`, [employeeIds],
    ),
  ]);
  return { leads: datesToIso<KpiLeadFact[]>(leads.rows), trials: datesToIso<KpiTrialFact[]>(trials.rows),
    sales: datesToIso<KpiSaleFact[]>(sales.rows), surveys: datesToIso<KpiSurveyFact[]>(surveys.rows) };
}
