import { pool } from "../db";
import { createOutbox } from "./outbox-helpers";

interface WeeklyReportResult {
  outboxId: number | null;
  preview: string;
}

/**
 * Builds the weekly leadership report (TZ 4.4) and enqueues it to the Telegram outbox.
 * Runs both from the scheduler (cron) and from the manual /reports/weekly/test endpoint.
 */
export const buildWeeklyReport = async (
  _actorUserId: number,
  recipient = "leadership",
): Promise<WeeklyReportResult> => {
  if (!pool) {
    return { outboxId: null, preview: "" };
  }

  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const { rows: leadRow } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM academy_leads WHERE created_at >= $1`, [weekStart]);
  const { rows: demoRow } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM academy_leads WHERE status_code IN ('demo_invited','demo_attended','offer','thinking','enrolled','paid') AND demo_attended=true`);
  const { rows: paidRow } = await pool.query(
    `SELECT COUNT(DISTINCT student_id)::int AS c FROM academy_payments WHERE status='paid' AND paid_at >= $1`, [weekStart]);
  const { rows: revenueRow } = await pool.query(
    `SELECT COALESCE(SUM(amount_uzs),0)::bigint AS s FROM academy_payments WHERE status='paid' AND paid_at >= $1`, [monthStart]);
  const { rows: attendanceRow } = await pool.query(
    `SELECT COALESCE(AVG(attendance_percent),0)::int AS a FROM academy_students WHERE status='studying'`);
  const { rows: surveyRow } = await pool.query(
    `SELECT COALESCE(AVG(score),0)::numeric(4,2) AS s FROM academy_lesson_surveys WHERE created_at >= $1`, [weekStart]);
  const { rows: riskRow } = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM academy_students WHERE status='studying' AND attendance_percent > 0 AND attendance_percent < 70)
       + (SELECT COUNT(*)::int FROM academy_payments WHERE status='overdue')
       + (SELECT COUNT(*)::int FROM academy_leads WHERE status_code='thinking' AND updated_at < NOW() - INTERVAL '7 days')
     AS total`);

  const message = [
    "📊 Еженедельный отчёт 01 Academy",
    "",
    `🆕 Новые лиды за неделю: ${leadRow[0]?.c ?? 0}`,
    `🎓 Были на демо: ${demoRow[0]?.c ?? 0}`,
    `💰 Новые оплатившие: ${paidRow[0]?.c ?? 0}`,
    `💵 Выручка за месяц: ${Number(revenueRow[0]?.s ?? 0).toLocaleString("ru-RU")} сум`,
    `✅ Средняя посещаемость: ${attendanceRow[0]?.a ?? 0}%`,
    `⭐ Средняя оценка урока: ${surveyRow[0]?.s ?? 0}`,
    `🚩 Красные флаги: ${riskRow[0]?.total ?? 0}`,
  ].join("\n");

  const outboxId = await createOutbox("telegram", recipient, message, { entityType: "weekly_report" });
  return { outboxId, preview: message };
};
