import { pool } from "../db";
import { logger } from "../lib/logger";
import { addDays } from "@shared/academy";

/**
 * Periodic automations extracted from the /automations/run route so the scheduler
 * can run them without an HTTP request. actorUserId is the system user (admin) that
 * gets attributed as the actor for history/tasks.
 */
export const runAutomations = async (actorUserId: number): Promise<string[]> => {
  if (!pool) return [];
  const now = new Date();
  const actions: string[] = [];

  // 1. Move stale leads (no answer for 14+ days) to the warm base.
  const { rows: staleLeads } = await pool.query(
    `SELECT id, status_code, manager_id FROM academy_leads
     WHERE status_code <> 'not_now' AND status_code <> 'paid'
       AND COALESCE(is_archived, false) = false
       AND updated_at < NOW() - INTERVAL '14 days'`,
  );
  for (const lead of staleLeads) {
    await pool.query(
      `UPDATE academy_leads SET status_code='not_now', warm_moved_at=$1, warm_reason=$2, updated_at=NOW() WHERE id=$3`,
      [now, "Нет ответа 14+ дней", lead.id],
    );
    await pool.query(
      `INSERT INTO academy_lead_stage_history (lead_id, from_status_code, to_status_code, changed_by, comment)
       VALUES ($1,$2,'not_now',$3,'Автоматический перенос: нет ответа 14+ дней')`,
      [lead.id, lead.status_code, actorUserId],
    );
    await createTask("Лид автоматически перенесён в тёплую базу", lead.manager_id ?? actorUserId, {
      entityType: "lead", entityId: lead.id, deadlineAt: addDays(now, 1),
    });
    actions.push(`lead:${lead.id}:not_now`);
  }

  // 2. Renewal reminders: paid_until within next 5 days.
  const { rows: renewalPayments } = await pool.query(
    `SELECT p.id, p.paid_until, p.student_id, s.manager_id, s.phone, s.messenger, s.student_name
     FROM academy_payments p
     LEFT JOIN academy_students s ON s.id = p.student_id
     WHERE p.status = 'paid'
       AND p.paid_until BETWEEN NOW() AND NOW() + INTERVAL '5 days'`,
  );
  for (const payment of renewalPayments) {
    await createTask("Напоминание о продлении оплаты", payment.manager_id ?? actorUserId, {
      description: "Позвонить и уточнить продление.",
      entityType: "payment", entityId: payment.id, deadlineAt: addDays(now, 1),
    });
    await createOutbox("whatsapp", payment.phone || payment.messenger || "unknown",
      `01 Academy: оплаченный период ${payment.student_name ?? "ученика"} скоро заканчивается.`,
      { scheduledAt: payment.paid_until, entityType: "payment", entityId: payment.id });
    actions.push(`payment:${payment.id}:renewal_reminder`);
  }

  // 3. Overdue payments (>3 days past due).
  const { rows: overduePayments } = await pool.query(
    `SELECT p.id, p.student_id, s.manager_id FROM academy_payments p
     LEFT JOIN academy_students s ON s.id = p.student_id
     WHERE p.status <> 'paid' AND p.due_at < NOW() - INTERVAL '3 days'`,
  );
  for (const payment of overduePayments) {
    await pool.query(`UPDATE academy_payments SET status='overdue', updated_at=NOW() WHERE id=$1`, [payment.id]);
    await createTask("Просрочена оплата", payment.manager_id ?? actorUserId, {
      entityType: "payment", entityId: payment.id, deadlineAt: addDays(now, 1),
    });
    actions.push(`payment:${payment.id}:overdue`);
  }

  // 4. Warm-base mailings (only leads that didn't decline mailings).
  const { rows: warmLeads } = await pool.query(
    `SELECT id, messenger, phone FROM academy_leads
     WHERE status_code='not_now'
       AND no_mailing=false
       AND COALESCE(is_archived, false) = false`,
  );
  for (const lead of warmLeads) {
    const recipient = lead.messenger || lead.phone;
    await createOutbox("telegram", recipient,
      "01 Academy: результат недели и новые проекты учеников. Хотите прийти на демо?",
      { scheduledAt: now, entityType: "lead", entityId: lead.id });
    await createOutbox("telegram", recipient,
      "01 Academy приглашает на демо-урок. Подберём курс по возрасту.",
      { scheduledAt: addDays(now, 14), entityType: "lead", entityId: lead.id });
    await createOutbox("whatsapp", lead.phone,
      "Специальное предложение 01 Academy на этот месяц.",
      { scheduledAt: addDays(now, 30), entityType: "lead", entityId: lead.id });
    actions.push(`lead:${lead.id}:warm_mailings`);
  }

  // 5. Recompute attendance/progress/risk flags for all active students.
  const { rows: activeStudents } = await pool.query(
    `SELECT id FROM academy_students WHERE status='studying'`,
  );
  for (const s of activeStudents) {
    try {
      await recalcStudent(s.id);
      actions.push(`student:${s.id}:recalc`);
    } catch (error) {
      logger.error("recalc student failed", { id: s.id, error });
    }
  }

  // 6. Monthly parent survey (TZ 2.5): enqueue survey links early in the month for
  //    active students whose parents haven't been surveyed this month yet.
  const period = now.toISOString().slice(0, 7);
  const { rows: surveyTargets } = await pool.query(
    `SELECT s.id, s.phone, s.messenger, s.student_name
     FROM academy_students s
     WHERE s.status='studying'
       AND NOT EXISTS (
         SELECT 1 FROM academy_parent_surveys ps WHERE ps.student_id = s.id AND ps.period = $1
       )`,
    [period],
  );
  for (const target of surveyTargets) {
    await createOutbox("whatsapp", target.phone || target.messenger || "unknown",
      `01 Academy: ежемесячный опрос по ученику ${target.student_name}. Поделитесь впечатлениями о прогрессе.`,
      { scheduledAt: now, entityType: "parent_survey", entityId: target.id });
    actions.push(`student:${target.id}:parent_survey_enqueued`);
  }

  await pool.query(
    `INSERT INTO academy_integration_logs (provider, direction, status, payload, retry_count)
     VALUES ('academy_automation','internal','completed',$1,0)`,
    [{ actions }],
  );

  return actions;
};

const createTask = async (
  title: string,
  responsibleId: number,
  options: { description?: string; entityType?: string; entityId?: number; deadlineAt?: Date | null },
) => {
  await pool.query(
    `INSERT INTO academy_tasks (title, description, responsible_id, deadline_at, entity_type, entity_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,'new')`,
    [title, options.description ?? null, responsibleId, options.deadlineAt ?? null,
     options.entityType ?? null, options.entityId ?? null],
  );
};

const createOutbox = async (
  channel: string, recipient: string, message: string,
  options: { scheduledAt?: Date | null; entityType?: string | null; entityId?: number | null },
) => {
  await pool.query(
    `INSERT INTO academy_notification_outbox (channel, recipient, message, status, scheduled_at, entity_type, entity_id)
     VALUES ($1,$2,$3,'pending',$4,$5,$6)`,
    [channel, recipient, message, options.scheduledAt ?? new Date(),
     options.entityType ?? null, options.entityId ?? null],
  );
};

const recalcStudent = async (studentId: number) => {
  const { rows } = await pool.query(`SELECT group_id FROM academy_students WHERE id=$1`, [studentId]);
  const student = rows[0];
  if (!student?.group_id) return;

  const { rows: conducted } = await pool.query(
    `SELECT id FROM academy_lessons WHERE group_id=$1 AND status='conducted'`, [student.group_id]);
  const { rows: present } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM academy_attendance a JOIN academy_lessons l ON l.id=a.lesson_id
     WHERE a.student_id=$1 AND a.status='present' AND l.status='conducted'`, [studentId]);
  const { rows: group } = await pool.query(`SELECT lesson_count FROM academy_groups WHERE id=$1`, [student.group_id]);
  const { rows: monthPresent } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM academy_attendance a JOIN academy_lessons l ON l.id=a.lesson_id
     WHERE a.student_id=$1 AND a.status='present' AND l.status='conducted'
       AND l.scheduled_at >= date_trunc('month', NOW())`, [studentId]);
  const { rows: monthConducted } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM academy_lessons
     WHERE group_id=$1 AND status='conducted' AND scheduled_at >= date_trunc('month', NOW())`,
    [student.group_id]);
  const { rows: surveys } = await pool.query(
    `SELECT score FROM academy_lesson_surveys WHERE student_id=$1`, [studentId]);

  const presentCount = present[0]?.c ?? 0;
  const conductedCount = conducted.length;
  const lessonTotal = Number(group[0]?.lesson_count) > 0 ? Number(group[0].lesson_count) : conductedCount;
  const attendancePercent = conductedCount > 0 ? Math.round((presentCount / conductedCount) * 100) : 0;
  const progressPercent = lessonTotal > 0 ? Math.min(100, Math.round((presentCount / lessonTotal) * 100)) : 0;
  const monthAttendance = (monthConducted[0]?.c ?? 0) > 0
    ? Math.round(((monthPresent[0]?.c ?? 0) / monthConducted[0].c) * 100) : 0;
  const satisfactionAvg = surveys.length
    ? Math.round(surveys.reduce((s: number, r: any) => s + Number(r.score), 0) / surveys.length) : 0;

  const riskFlags: string[] = [];
  if (attendancePercent > 0 && attendancePercent < 70) riskFlags.push("attendance_below_70");
  if (monthAttendance > 0 && monthAttendance < 50) riskFlags.push("churn_risk");
  if (satisfactionAvg > 0 && satisfactionAvg < 3) riskFlags.push("low_satisfaction");

  await pool.query(
    `UPDATE academy_students SET attendance_percent=$1, progress_percent=$2, satisfaction_avg=$3, risk_flags=$4, updated_at=NOW() WHERE id=$5`,
    [attendancePercent, progressPercent, satisfactionAvg, JSON.stringify(riskFlags), studentId],
  );
};
