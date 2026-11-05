import type { PoolClient } from "pg";
import { resolveStudentRiskFlags } from "@shared/academy";
import { pool } from "../db";
import { logger } from "../lib/logger";
import { DEFAULT_ACADEMY_TIME_ZONE } from '@shared/scheduling';

const AUTOMATION_ADVISORY_LOCK = 10_100_002;
const AUTOMATION_TIME_ZONE = process.env.ACADEMY_TIME_ZONE?.trim() || DEFAULT_ACADEMY_TIME_ZONE;

type QueryExecutor = Pick<PoolClient, "query">;

/**
 * Runs the periodic CRM automations. The advisory lock and all automation SQL
 * share one connection, while each multi-step entity action is committed as a
 * transaction.
 */
export const runAutomations = async (actorUserId: number): Promise<string[]> => {
  if (!pool) return [];

  const client = await pool.connect();
  let lockHeld = false;
  try {
    const lockResult = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [AUTOMATION_ADVISORY_LOCK],
    );
    if (lockResult.rows[0]?.acquired !== true) {
      logger.info("Automation run skipped because another worker owns the lease");
      return [];
    }
    lockHeld = true;

    const actions: string[] = [];

    // Lead stages are never changed by a background job. A stage change is a
    // business decision and must be made explicitly by an employee.

    // Recompute attendance/progress/risk flags for all active students. Payments
    // never create reminders: a payment is only the record of money received.
    const { rows: activeStudents } = await client.query<{ id: number }>(
      "SELECT id FROM academy_students WHERE status = 'studying' AND is_archived = false",
    );
    for (const student of activeStudents) {
      try {
        const recalculated = await recalcStudent(client, student.id);
        if (recalculated) actions.push(`student:${student.id}:recalc`);
      } catch (error) {
        logger.error("recalc student failed", { id: student.id, error });
      }
    }

    await client.query(
      `INSERT INTO academy_integration_logs (provider, direction, status, payload, retry_count)
       VALUES ('academy_automation','internal','completed',$1,0)`,
      [{ actions }],
    );

    return actions;
  } finally {
    if (lockHeld) {
      await client.query("SELECT pg_advisory_unlock($1)", [AUTOMATION_ADVISORY_LOCK]).catch((error) => {
        logger.error("Failed to release automation lease", { error });
      });
    }
    client.release();
  }
};

const recalcStudent = async (executor: QueryExecutor, studentId: number): Promise<boolean> => {
  const { rows } = await executor.query(
    `SELECT
       student.group_id,
       COALESCE(
         (
           SELECT MAX(transfer.created_at)
           FROM academy_student_transfers transfer
           WHERE transfer.student_id = student.id
             AND transfer.to_group_id = student.group_id
         ),
         student.enrolled_at,
         student.created_at
       ) AS membership_started_at
     FROM academy_students student
     WHERE student.id = $1 AND student.status = 'studying'`,
    [studentId],
  );
  const student = rows[0];
  if (!student?.group_id) return false;

  const { rows: conducted } = await executor.query(
    `SELECT lesson.id
     FROM academy_lessons lesson
     WHERE lesson.group_id = $1
       AND lesson.status = 'conducted'
       AND lesson.scheduled_at >= $2
       AND COALESCE(
         (
           SELECT history.to_status
           FROM academy_student_status_history history
           WHERE history.student_id = $3
             AND history.created_at <= lesson.scheduled_at
           ORDER BY history.created_at DESC, history.id DESC
           LIMIT 1
         ),
         'studying'
       ) = 'studying'`,
    [student.group_id, student.membership_started_at, studentId],
  );
  const { rows: present } = await executor.query(
    `SELECT COUNT(*)::int AS c
     FROM academy_attendance a
     JOIN academy_lessons l ON l.id = a.lesson_id
     WHERE a.student_id = $1
       AND a.status = 'present'
       AND l.status = 'conducted'
       AND l.group_id = $2
       AND l.scheduled_at >= $3
       AND COALESCE(
         (
           SELECT history.to_status
           FROM academy_student_status_history history
           WHERE history.student_id = $1
             AND history.created_at <= l.scheduled_at
           ORDER BY history.created_at DESC, history.id DESC
           LIMIT 1
         ),
         'studying'
       ) = 'studying'`,
    [studentId, student.group_id, student.membership_started_at],
  );
  const { rows: group } = await executor.query(
    "SELECT lesson_count FROM academy_groups WHERE id = $1",
    [student.group_id],
  );
  const { rows: monthPresent } = await executor.query(
    `SELECT COUNT(*)::int AS c
     FROM academy_attendance a
     JOIN academy_lessons l ON l.id = a.lesson_id
     WHERE a.student_id = $1
       AND a.status = 'present'
       AND l.status = 'conducted'
       AND l.group_id = $2
       AND l.scheduled_at >= $3
       AND COALESCE(
         (
           SELECT history.to_status
           FROM academy_student_status_history history
           WHERE history.student_id = $1
             AND history.created_at <= l.scheduled_at
           ORDER BY history.created_at DESC, history.id DESC
           LIMIT 1
         ),
         'studying'
       ) = 'studying'
       AND l.scheduled_at >= (
         (date_trunc('month', NOW() AT TIME ZONE $4) AT TIME ZONE $4)
         AT TIME ZONE 'UTC'
       )`,
    [studentId, student.group_id, student.membership_started_at, AUTOMATION_TIME_ZONE],
  );
  const { rows: monthConducted } = await executor.query(
    `SELECT COUNT(*)::int AS c
     FROM academy_lessons lesson
     WHERE lesson.group_id = $1
       AND lesson.status = 'conducted'
       AND lesson.scheduled_at >= $2
       AND COALESCE(
         (
           SELECT history.to_status
           FROM academy_student_status_history history
           WHERE history.student_id = $3
             AND history.created_at <= lesson.scheduled_at
           ORDER BY history.created_at DESC, history.id DESC
           LIMIT 1
         ),
         'studying'
       ) = 'studying'
       AND lesson.scheduled_at >= (
         (date_trunc('month', NOW() AT TIME ZONE $4) AT TIME ZONE $4)
         AT TIME ZONE 'UTC'
       )`,
    [student.group_id, student.membership_started_at, studentId, AUTOMATION_TIME_ZONE],
  );
  const presentCount = present[0]?.c ?? 0;
  const conductedCount = conducted.length;
  const lessonTotal = Number(group[0]?.lesson_count) > 0 ? Number(group[0].lesson_count) : conductedCount;
  const attendancePercent = conductedCount > 0 ? Math.round((presentCount / conductedCount) * 100) : 0;
  const progressPercent = lessonTotal > 0 ? Math.min(100, Math.round((presentCount / lessonTotal) * 100)) : 0;
  const monthAttendance = (monthConducted[0]?.c ?? 0) > 0
    ? Math.round(((monthPresent[0]?.c ?? 0) / monthConducted[0].c) * 100)
    : 0;

  const riskFlags = resolveStudentRiskFlags({
    conductedCount,
    attendancePercent,
    monthConductedCount: monthConducted[0]?.c ?? 0,
    monthAttendancePercent: monthAttendance,
  });

  await executor.query(
    `UPDATE academy_students
     SET attendance_percent = $1, progress_percent = $2,
         risk_flags = $3, updated_at = NOW()
     WHERE id = $4 AND status = 'studying'`,
    [attendancePercent, progressPercent, JSON.stringify(riskFlags), studentId],
  );
  return true;
};
