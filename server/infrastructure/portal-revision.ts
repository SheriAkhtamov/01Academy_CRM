import type { Pool } from "pg";
import type { PortalRealtimeContext } from "../realtime/portal-websocket-gateway";

/** CRM writes may happen in another process; its canonical rows must invalidate the portal too. */
export async function readPortalRevision(
  pool: Pick<Pool, "query">,
  contexts: readonly PortalRealtimeContext[],
) {
  const studentIds = [...new Set(contexts.flatMap((context) => context.studentIds))];
  const accountIds = [...new Set(contexts.map((context) => context.accountId))];
  const result = await pool.query<{ revision: string }>(
    `WITH scoped_students AS MATERIALIZED (
      SELECT student.* FROM academy_students student WHERE student.id=ANY($1::integer[])
    ), scoped_groups AS MATERIALIZED (
      SELECT DISTINCT enrollment.group_id FROM academy_student_group_enrollments enrollment
      WHERE enrollment.student_id=ANY($1::integer[])
    ), scoped_payments AS MATERIALIZED (
      SELECT payment.* FROM academy_payments payment
      WHERE payment.student_id=ANY($1::integer[]) OR payment.lead_id IN(SELECT lead_id FROM scoped_students)
        OR EXISTS(SELECT 1 FROM academy_payment_student_allocations allocation
          WHERE allocation.payment_id=payment.id AND allocation.student_id=ANY($1::integer[]))
    ) SELECT md5(jsonb_build_array(
      (SELECT jsonb_agg(value ORDER BY value.student_id) FROM (SELECT student_id,max(id) AS id FROM lms_learning_events WHERE student_id=ANY($1::integer[]) GROUP BY student_id) value),
      (SELECT jsonb_agg(value ORDER BY value.student_id) FROM (SELECT student_id,max(id) AS id FROM lms_resource_audit WHERE student_id=ANY($1::integer[]) GROUP BY student_id) value),
      (SELECT jsonb_agg(value ORDER BY value.account_id) FROM (SELECT account_id,max(id) AS id FROM portal_notifications WHERE account_id=ANY($2::bigint[]) GROUP BY account_id) value),
      (SELECT jsonb_agg(value ORDER BY value.owner_account_id,value.run_id) FROM (SELECT owner_account_id,run_id,max(checked_at) AS checked_at FROM lms_files WHERE owner_account_id=ANY($2::bigint[]) OR run_id IN(SELECT run.id FROM lms_group_runs run JOIN scoped_groups scope ON scope.group_id=run.group_id) GROUP BY owner_account_id,run_id) value),
      (SELECT md5(jsonb_agg(student ORDER BY student.id)::text) FROM scoped_students student),
      (SELECT md5(jsonb_agg(enrollment ORDER BY enrollment.id)::text) FROM academy_student_group_enrollments enrollment WHERE enrollment.student_id=ANY($1::integer[])),
      (SELECT md5(jsonb_agg(g ORDER BY g.id)::text) FROM academy_groups g JOIN scoped_groups scope ON scope.group_id=g.id),
      (SELECT md5(jsonb_agg(run ORDER BY run.id)::text) FROM lms_group_runs run JOIN scoped_groups scope ON scope.group_id=run.group_id),
      (SELECT md5(jsonb_agg(lesson ORDER BY lesson.id)::text) FROM academy_lessons lesson JOIN scoped_groups scope ON scope.group_id=lesson.group_id),
      (SELECT md5(jsonb_agg(mark ORDER BY mark.id)::text) FROM academy_attendance mark WHERE mark.student_id=ANY($1::integer[])),
      (SELECT md5(jsonb_agg(jsonb_build_array(to_jsonb(payment),payment.status='pending' AND payment.due_at<now()) ORDER BY payment.id)::text) FROM scoped_payments payment),
      (SELECT md5(jsonb_agg(allocation ORDER BY allocation.payment_id,allocation.student_id)::text)
        FROM academy_payment_student_allocations allocation JOIN scoped_payments payment ON payment.id=allocation.payment_id)
    )::text) AS revision`,
    [studentIds, accountIds],
  );
  return result.rows[0].revision;
}
