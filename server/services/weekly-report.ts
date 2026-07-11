import { pool } from "../db";
import { logger } from "../lib/logger";

interface WeeklyReportResult {
  outboxId: number | null;
  preview: string;
}

interface WeeklyMetrics {
  period_key: number;
  lead_count: number | string;
  demo_count: number | string;
  paid_count: number | string;
  revenue_sum: number | string;
  attendance_avg: number | string;
  survey_avg: number | string;
  risk_count: number | string;
}

const WEEKLY_REPORT_ADVISORY_LOCK = 10_100_003;
const REPORT_TIME_ZONE = process.env.ACADEMY_TIME_ZONE?.trim() || "Asia/Tashkent";

/**
 * Builds the report for the previous completed Monday-Sunday period in the
 * academy timezone and enqueues it once. The transaction-level advisory lock
 * makes the operation idempotent across multiple server replicas.
 */
export const buildWeeklyReport = async (
  _actorUserId: number,
  recipient = "leadership",
): Promise<WeeklyReportResult> => {
  if (!pool) return { outboxId: null, preview: "" };

  const normalizedRecipient = recipient.trim();
  if (!normalizedRecipient) {
    throw new Error("Weekly report recipient is required");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [WEEKLY_REPORT_ADVISORY_LOCK]);

    const { rows } = await client.query<WeeklyMetrics>(
      `WITH bounds AS (
         SELECT
           (
             (date_trunc('week', NOW() AT TIME ZONE $1) - INTERVAL '7 days')
             AT TIME ZONE $1
           ) AT TIME ZONE 'UTC' AS week_start,
           (
             date_trunc('week', NOW() AT TIME ZONE $1)
             AT TIME ZONE $1
           ) AT TIME ZONE 'UTC' AS week_end,
           (
             date_trunc('month', NOW() AT TIME ZONE $1)
             AT TIME ZONE $1
           ) AT TIME ZONE 'UTC' AS month_start,
           date_trunc('week', NOW() AT TIME ZONE $1) AS local_week_end
       )
       SELECT
         to_char(bounds.local_week_end, 'YYYYMMDD')::int AS period_key,
         (
           SELECT COUNT(*)::int
           FROM academy_leads l
           WHERE l.created_at >= bounds.week_start
             AND l.created_at < bounds.week_end
             AND COALESCE(l.is_archived, false) = false
         ) AS lead_count,
         (
           SELECT COUNT(DISTINCT history.lead_id)::int
           FROM academy_lead_stage_history history
           JOIN academy_leads l ON l.id = history.lead_id
           WHERE history.to_status_code = 'demo_attended'
             AND history.entered_at >= bounds.week_start
             AND history.entered_at < bounds.week_end
             AND COALESCE(l.is_archived, false) = false
         ) AS demo_count,
         (
           SELECT COUNT(DISTINCT COALESCE(
             CASE WHEN payment.student_id IS NOT NULL THEN 'student:' || payment.student_id::text END,
             CASE WHEN payment.lead_id IS NOT NULL THEN 'lead:' || payment.lead_id::text END,
             'payment:' || payment.id::text
           ))::int
           FROM academy_payments payment
           WHERE payment.status = 'paid'
             AND payment.paid_at >= bounds.week_start
             AND payment.paid_at < bounds.week_end
         ) AS paid_count,
         (
           SELECT COALESCE(SUM(payment.amount_uzs), 0)::bigint
           FROM academy_payments payment
           WHERE payment.status = 'paid'
             AND payment.paid_at >= bounds.month_start
         ) AS revenue_sum,
         (
           SELECT COALESCE(AVG(student.attendance_percent), 0)::int
           FROM academy_students student
           WHERE student.status = 'studying'
         ) AS attendance_avg,
         (
           SELECT COALESCE(AVG(survey.score), 0)::numeric(4,2)
           FROM academy_lesson_surveys survey
           WHERE survey.created_at >= bounds.week_start
             AND survey.created_at < bounds.week_end
         ) AS survey_avg,
         (
           (SELECT COUNT(*)::int
           FROM academy_students student
            WHERE student.status = 'studying'
              AND (
                student.risk_flags @> '["attendance_below_70"]'::jsonb
                OR student.attendance_percent BETWEEN 1 AND 69
              ))
           +
           (SELECT COUNT(*)::int
            FROM academy_payments payment
            WHERE payment.status = 'overdue'
               OR (payment.status = 'pending' AND payment.due_at < NOW()))
           +
           (SELECT COUNT(*)::int
            FROM academy_leads lead
            WHERE lead.status_code = 'thinking'
              AND lead.updated_at < NOW() - INTERVAL '7 days'
              AND COALESCE(lead.is_archived, false) = false)
         ) AS risk_count
       FROM bounds`,
      [REPORT_TIME_ZONE],
    );
    const metrics = rows[0];
    if (!metrics) throw new Error("Failed to calculate weekly report metrics");

    const message = [
      "📊 Еженедельный отчёт 01 Academy",
      "",
      `🆕 Новые лиды за неделю: ${Number(metrics.lead_count) || 0}`,
      `🎓 Были на демо: ${Number(metrics.demo_count) || 0}`,
      `💰 Новые оплатившие: ${Number(metrics.paid_count) || 0}`,
      `💵 Выручка за месяц: ${(Number(metrics.revenue_sum) || 0).toLocaleString("ru-RU")} сум`,
      `✅ Средняя посещаемость: ${Number(metrics.attendance_avg) || 0}%`,
      `⭐ Средняя оценка урока: ${Number(metrics.survey_avg) || 0}`,
      `🚩 Красные флаги: ${Number(metrics.risk_count) || 0}`,
    ].join("\n");

    const existing = await client.query<{ id: number; message: string }>(
      `SELECT id, message
       FROM academy_notification_outbox
       WHERE channel = 'telegram'
         AND recipient = $1
         AND entity_type = 'weekly_report'
         AND entity_id = $2
       ORDER BY id
       LIMIT 1`,
      [normalizedRecipient, metrics.period_key],
    );
    if (existing.rows[0]) {
      await client.query("COMMIT");
      return { outboxId: existing.rows[0].id, preview: existing.rows[0].message };
    }

    const inserted = await client.query<{ id: number }>(
      `INSERT INTO academy_notification_outbox
         (channel, recipient, message, status, scheduled_at, entity_type, entity_id)
       VALUES ('telegram',$1,$2,'pending',NOW(),'weekly_report',$3)
       RETURNING id`,
      [normalizedRecipient, message, metrics.period_key],
    );
    await client.query("COMMIT");
    return { outboxId: inserted.rows[0]?.id ?? null, preview: message };
  } catch (error) {
    await client.query("ROLLBACK").catch((rollbackError) => {
      logger.error("Weekly report rollback failed", { rollbackError });
    });
    throw error;
  } finally {
    client.release();
  }
};
