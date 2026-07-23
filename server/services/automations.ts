import type { PoolClient } from "pg";
import { addDays, resolveStudentRiskFlags } from "@shared/academy";
import { pool } from "../db";
import { logger } from "../lib/logger";
import { normalizeOutboxRecipient } from "./message-recipients";

const AUTOMATION_ADVISORY_LOCK = 10_100_002;
const AUTOMATION_TIME_ZONE = process.env.ACADEMY_TIME_ZONE?.trim() || "Asia/Tashkent";

type QueryExecutor = Pick<PoolClient, "query">;

const withTransaction = async <T>(client: PoolClient, work: () => Promise<T>): Promise<T> => {
  await client.query("BEGIN");
  try {
    const result = await work();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch((rollbackError) => {
      logger.error("Automation transaction rollback failed", { rollbackError });
    });
    throw error;
  }
};

/**
 * Runs the periodic CRM automations. The advisory lock and all automation SQL
 * share one connection, while each multi-step entity action is committed as a
 * transaction. A crash therefore cannot leave a state change without its task,
 * history entry, or queued notification.
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

    const now = new Date();
    const actions: string[] = [];

    // Lead stages are never changed by a background job. A stage change is a
    // business decision and must be made explicitly by an employee.

    // 1. Renewal reminders follow the student's effective coverage end, not an
    // arbitrary older payment row. Only active students need a renewal task.
    const { rows: renewalCandidates } = await client.query<{ id: number }>(
      `SELECT id
       FROM academy_students
       WHERE status = 'studying'
         AND next_payment_at BETWEEN NOW() AND NOW() + INTERVAL '5 days'`,
    );
    for (const candidate of renewalCandidates) {
      const created = await withTransaction(client, async () => {
        const { rows } = await client.query<{
          id: number;
          next_payment_at: Date | string;
          manager_id: number | null;
          phone: string | null;
          student_name: string | null;
        }>(
          `SELECT id, next_payment_at, manager_id, phone, student_name
           FROM academy_students
           WHERE id = $1
             AND status = 'studying'
             AND next_payment_at BETWEEN NOW() AND NOW() + INTERVAL '5 days'
           FOR UPDATE`,
          [candidate.id],
        );
        const student = rows[0];
        if (!student) return false;

        const taskCreated = await createTaskOnce(client, "Напоминание о продлении оплаты", student.manager_id ?? actorUserId, {
          description: "Позвонить и уточнить продление.",
          entityType: "student",
          entityId: student.id,
          deadlineAt: addDays(now, 1),
        });
        const reminderCreated = await createOutboxOnce(
          client,
          "whatsapp",
          student.phone,
          `01 Academy: оплаченный период ${student.student_name ?? "ученика"} скоро заканчивается.`,
          {
            scheduledAt: now,
            entityType: "renewal",
            entityId: student.id,
            dedupeByEntityOnly: true,
            dedupeSince: addDays(new Date(student.next_payment_at), -5),
          },
        );
        return taskCreated || reminderCreated;
      });
      if (created) actions.push(`student:${candidate.id}:renewal_reminder`);
    }

    // 2. Only pending payments become overdue. The task and status transition
    // commit together, so a retry cannot strand either half of the action.
    const { rows: overdueCandidates } = await client.query<{ id: number }>(
      `SELECT id
       FROM academy_payments
       WHERE status = 'pending'
         AND due_at < NOW() - INTERVAL '3 days'`,
    );
    for (const candidate of overdueCandidates) {
      const transitioned = await withTransaction(client, async () => {
        const { rows } = await client.query<{ id: number; manager_id: number | null }>(
          `SELECT p.id, COALESCE(s.manager_id, l.manager_id) AS manager_id
           FROM academy_payments p
           LEFT JOIN academy_students s ON s.id = p.student_id
           LEFT JOIN academy_leads l ON l.id = p.lead_id
           WHERE p.id = $1
             AND p.status = 'pending'
             AND p.due_at < NOW() - INTERVAL '3 days'
           FOR UPDATE OF p`,
          [candidate.id],
        );
        const payment = rows[0];
        if (!payment) return false;

        await createTaskOnce(client, "Просрочена оплата", payment.manager_id ?? actorUserId, {
          entityType: "payment",
          entityId: payment.id,
          deadlineAt: addDays(now, 1),
        });
        await client.query(
          "UPDATE academy_payments SET status = 'overdue', updated_at = NOW() WHERE id = $1",
          [payment.id],
        );
        return true;
      });
      if (transitioned) actions.push(`payment:${candidate.id}:overdue`);
    }

    // 3. Warm-base mailings (only leads that did not decline mailings).
    const { rows: warmCandidates } = await client.query<{ id: number }>(
      `SELECT id
       FROM academy_leads
       WHERE status_code = 'not_now'
         AND no_mailing = false
         AND COALESCE(is_archived, false) = false`,
    );
    for (const candidate of warmCandidates) {
      const created = await withTransaction(client, async () => {
        const { rows } = await client.query<{
          id: number;
          phone: string | null;
          warm_moved_at: Date | string | null;
        }>(
          `SELECT id, phone, warm_moved_at
           FROM academy_leads
           WHERE id = $1
             AND status_code = 'not_now'
             AND no_mailing = false
             AND COALESCE(is_archived, false) = false
           FOR UPDATE`,
          [candidate.id],
        );
        const lead = rows[0];
        if (!lead) return false;

        const immediateCreated = await createOutboxOnce(
          client,
          "whatsapp",
          lead.phone,
          "01 Academy: результат недели и новые проекты учеников. Хотите прийти на демо?",
          {
            scheduledAt: now,
            entityType: "lead",
            entityId: lead.id,
            dedupeSince: lead.warm_moved_at,
          },
        );
        const demoCreated = await createOutboxOnce(
          client,
          "whatsapp",
          lead.phone,
          "01 Academy приглашает на демо-урок. Подберём курс по возрасту.",
          {
            scheduledAt: addDays(now, 14),
            entityType: "lead",
            entityId: lead.id,
            dedupeSince: lead.warm_moved_at,
          },
        );
        const offerCreated = await createOutboxOnce(
          client,
          "whatsapp",
          lead.phone,
          "Специальное предложение 01 Academy на этот месяц.",
          {
            scheduledAt: addDays(now, 30),
            entityType: "lead",
            entityId: lead.id,
            dedupeSince: lead.warm_moved_at,
          },
        );
        return immediateCreated || demoCreated || offerCreated;
      });
      if (created) actions.push(`lead:${candidate.id}:warm_mailings`);
    }

    // 4. Recompute attendance/progress/risk flags for all active students.
    const { rows: activeStudents } = await client.query<{ id: number }>(
      "SELECT id FROM academy_students WHERE status = 'studying'",
    );
    for (const student of activeStudents) {
      try {
        const recalculated = await recalcStudent(client, student.id);
        if (recalculated) actions.push(`student:${student.id}:recalc`);
      } catch (error) {
        logger.error("recalc student failed", { id: student.id, error });
      }
    }

    // 5. Monthly parent survey. Both the period and the monthly dedupe boundary
    // use the academy timezone rather than the host process/database timezone.
    const { rows: periodRows } = await client.query<{ period: string }>(
      "SELECT to_char(NOW() AT TIME ZONE $1, 'YYYY-MM') AS period",
      [AUTOMATION_TIME_ZONE],
    );
    const period = periodRows[0]?.period;
    if (!period) throw new Error("Failed to resolve automation survey period");

    const { rows: surveyCandidates } = await client.query<{ id: number }>(
      `SELECT s.id
       FROM academy_students s
       WHERE s.status = 'studying'
         AND NOT EXISTS (
           SELECT 1
           FROM academy_parent_surveys ps
           WHERE ps.student_id = s.id AND ps.period = $1
         )`,
      [period],
    );
    for (const candidate of surveyCandidates) {
      const enqueued = await withTransaction(client, async () => {
        const { rows } = await client.query<{
          id: number;
          phone: string | null;
          student_name: string | null;
        }>(
          `SELECT s.id, s.phone, s.student_name
           FROM academy_students s
           WHERE s.id = $1
             AND s.status = 'studying'
             AND NOT EXISTS (
               SELECT 1
               FROM academy_parent_surveys ps
               WHERE ps.student_id = s.id AND ps.period = $2
             )
           FOR UPDATE`,
          [candidate.id, period],
        );
        const target = rows[0];
        if (!target) return false;
        return createOutboxOnce(
          client,
          "whatsapp",
          target.phone,
          `01 Academy: ежемесячный опрос по ученику ${target.student_name}. Поделитесь впечатлениями о прогрессе.`,
          {
            scheduledAt: now,
            entityType: "parent_survey",
            entityId: target.id,
            dedupeThisMonth: true,
            dedupeByEntityOnly: true,
          },
        );
      });
      if (enqueued) actions.push(`student:${candidate.id}:parent_survey_enqueued`);
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

const createTaskOnce = async (
  executor: QueryExecutor,
  title: string,
  responsibleId: number,
  options: { description?: string; entityType?: string; entityId?: number; deadlineAt?: Date | null },
) => {
  const { rows } = await executor.query(
    `INSERT INTO academy_tasks (title, description, responsible_id, deadline_at, entity_type, entity_id, status)
     SELECT $1,$2,$3,$4,$5,$6,'new'
     WHERE NOT EXISTS (
       SELECT 1
       FROM academy_tasks
       WHERE title = $1
         AND entity_type IS NOT DISTINCT FROM $5::text
         AND entity_id IS NOT DISTINCT FROM $6::integer
         AND status <> 'done'
     )
     RETURNING id`,
    [
      title,
      options.description ?? null,
      responsibleId,
      options.deadlineAt ?? null,
      options.entityType ?? null,
      options.entityId ?? null,
    ],
  );
  return Boolean(rows[0]?.id);
};

const createOutboxOnce = async (
  executor: QueryExecutor,
  channel: string,
  recipient: string | null | undefined,
  message: string,
  options: {
    scheduledAt?: Date | null;
    entityType?: string | null;
    entityId?: number | null;
    dedupeThisMonth?: boolean;
    dedupeByEntityOnly?: boolean;
    dedupeSince?: Date | string | null;
  },
) => {
  const normalizedChannel = String(channel ?? "").trim().toLowerCase();
  const normalizedRecipient = normalizeOutboxRecipient(normalizedChannel, recipient);
  if (!normalizedRecipient) return false;

  const { rows } = await executor.query(
    `INSERT INTO academy_notification_outbox
       (channel, recipient, message, status, scheduled_at, entity_type, entity_id)
     SELECT $1,$2,$3,'pending',$4,$5,$6
     WHERE NOT EXISTS (
       SELECT 1
       FROM academy_notification_outbox
       WHERE channel = $1
         AND entity_type IS NOT DISTINCT FROM $5::text
         AND entity_id IS NOT DISTINCT FROM $6::integer
         AND (
           (
             $7::boolean = true
             AND created_at >= (
               (date_trunc('month', NOW() AT TIME ZONE $8) AT TIME ZONE $8)
               AT TIME ZONE 'UTC'
             )
           )
           OR (
             $7::boolean = false
             AND (
               $9::boolean = true
               OR (
                 message = $3
                 AND (
                   recipient = $2
                   OR (
                     $1 = 'whatsapp'
                     AND regexp_replace(recipient, '\\D', '', 'g') = $2
                   )
                 )
               )
             )
             AND ($10::timestamp IS NULL OR created_at >= $10)
           )
         )
     )
     RETURNING id`,
    [
      normalizedChannel,
      normalizedRecipient,
      message,
      options.scheduledAt ?? new Date(),
      options.entityType ?? null,
      options.entityId ?? null,
      options.dedupeThisMonth === true,
      AUTOMATION_TIME_ZONE,
      options.dedupeByEntityOnly === true,
      options.dedupeSince ?? null,
    ],
  );
  return Boolean(rows[0]?.id);
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
  const { rows: surveys } = await executor.query(
    `SELECT survey.score
     FROM academy_lesson_surveys survey
     JOIN academy_lessons lesson ON lesson.id = survey.lesson_id
     WHERE survey.student_id = $1
       AND lesson.group_id = $2
       AND lesson.scheduled_at >= $3
       AND COALESCE(
         (
           SELECT history.to_status
           FROM academy_student_status_history history
           WHERE history.student_id = $1
             AND history.created_at <= lesson.scheduled_at
           ORDER BY history.created_at DESC, history.id DESC
           LIMIT 1
         ),
         'studying'
       ) = 'studying'`,
    [studentId, student.group_id, student.membership_started_at],
  );

  const presentCount = present[0]?.c ?? 0;
  const conductedCount = conducted.length;
  const lessonTotal = Number(group[0]?.lesson_count) > 0 ? Number(group[0].lesson_count) : conductedCount;
  const attendancePercent = conductedCount > 0 ? Math.round((presentCount / conductedCount) * 100) : 0;
  const progressPercent = lessonTotal > 0 ? Math.min(100, Math.round((presentCount / lessonTotal) * 100)) : 0;
  const monthAttendance = (monthConducted[0]?.c ?? 0) > 0
    ? Math.round(((monthPresent[0]?.c ?? 0) / monthConducted[0].c) * 100)
    : 0;
  const satisfactionAvg = surveys.length
    ? Math.round(surveys.reduce((sum: number, row: any) => sum + Number(row.score), 0) / surveys.length)
    : 0;

  const riskFlags = resolveStudentRiskFlags({
    conductedCount,
    attendancePercent,
    monthConductedCount: monthConducted[0]?.c ?? 0,
    monthAttendancePercent: monthAttendance,
    satisfactionAvg,
  });

  await executor.query(
    `UPDATE academy_students
     SET attendance_percent = $1, progress_percent = $2,
         satisfaction_avg = $3, risk_flags = $4, updated_at = NOW()
     WHERE id = $5 AND status = 'studying'`,
    [attendancePercent, progressPercent, satisfactionAvg, JSON.stringify(riskFlags), studentId],
  );
  return true;
};
