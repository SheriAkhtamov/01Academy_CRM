import type { PortalActorContext } from "../../portal-identity/domain/actor-context";
import type { Outbox, Sql } from "./notification-support";

/** Historical results remain readable, but stale state-change email cannot be retried as a current result. */
export async function isNotificationResultCurrent(sql: Sql, row: Outbox, actor: PortalActorContext | null, now: number): Promise<boolean> {
  const type = String(row.params.sourceType ?? "");
  const studentId = actor?.studentId;
  const runId = row.params.runId;
  if (type === "assignment_submitted") return Boolean((await sql.query(
    `SELECT submission.id FROM lms_submissions submission JOIN lms_assignment_recipients recipient ON recipient.id=submission.recipient_id
      JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id WHERE submission.id=$1 AND recipient.id=$2
        AND recipient.student_id=$3 AND assignment.run_id=$4 AND submission.withdrawn_at IS NULL AND recipient.status NOT IN('cancelled','excused')`,
    [row.params.objectId, row.params.recipientId, studentId, runId],
  )).rowCount);
  if (["assignment_accepted", "assignment_revision_required"].includes(type)) {
    const decision = type === "assignment_accepted" ? "accepted" : "revision_required";
    if (row.params.reviewId) return Boolean((await sql.query(
      `SELECT review.id FROM lms_reviews review JOIN lms_submissions submission ON submission.id=review.submission_id
        JOIN lms_assignment_recipients recipient ON recipient.id=submission.recipient_id JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id
        WHERE review.id=$1 AND recipient.id=$2 AND recipient.student_id=$3 AND assignment.run_id=$4 AND review.decision=$5
          AND recipient.status=$5 AND submission.withdrawn_at IS NULL
          AND review.id=(SELECT max(latest.id) FROM lms_reviews latest JOIN lms_submissions previous ON previous.id=latest.submission_id WHERE previous.recipient_id=recipient.id)`,
      [row.params.reviewId, row.params.recipientId, studentId, runId, decision],
    )).rowCount);
    return Boolean((await sql.query(
      `SELECT recipient.id FROM lms_assignment_recipients recipient JOIN lms_assignments assignment ON assignment.id=recipient.assignment_id
        WHERE recipient.id=$1 AND recipient.student_id=$2 AND assignment.run_id=$3 AND recipient.status=$4`,
      [row.params.recipientId ?? row.params.objectId, studentId, runId, decision],
    )).rowCount);
  }
  if (type === "quiz_finished") return Boolean((await sql.query(
    `SELECT attempt.id FROM lms_quiz_attempts attempt JOIN lms_quiz_recipients recipient ON recipient.id=attempt.recipient_id
      JOIN lms_quizzes quiz ON quiz.id=recipient.quiz_id WHERE attempt.id=$1 AND recipient.student_id=$2 AND quiz.run_id=$3
        AND attempt.state='finished' AND recipient.status='assigned'`,
    [row.params.objectId, studentId, runId],
  )).rowCount);
  if (type === "report_published") return Boolean((await sql.query(
    "SELECT id FROM lms_reports WHERE id=$1 AND student_id=$2 AND run_id=$3 AND published_at<=$4",
    [row.params.objectId, studentId, runId, new Date(now)],
  )).rowCount);
  if (["achievement_awarded", "achievement_revoked"].includes(type)) return Boolean((await sql.query(
    "SELECT id FROM lms_achievements WHERE id=$1 AND student_id=$2 AND run_id=$3 AND (revoked_at IS NOT NULL)=$4",
    [row.params.objectId, studentId, runId, type === "achievement_revoked"],
  )).rowCount);
  if (["course_completed", "course_reopened"].includes(type)) return Boolean((await sql.query(
    "SELECT id FROM lms_course_completions WHERE id=$1 AND student_id=$2 AND run_id=$3 AND (reopened_at IS NOT NULL)=$4",
    [row.params.objectId, studentId, runId, type === "course_reopened"],
  )).rowCount);
  return true;
}
