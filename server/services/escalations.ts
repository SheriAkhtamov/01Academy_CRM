import { pool } from '../db';
import { logger } from '../lib/logger';

const createEventOnce = async (
  eventKey: string,
  eventType: string,
  entityType: string | null,
  entityId: number | null,
  payload: unknown,
) => {
  const result = await pool.query(
    `INSERT INTO academy_escalation_events (event_key, event_type, entity_type, entity_id, payload)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (event_key) DO NOTHING
     RETURNING id`,
    [eventKey, eventType, entityType, entityId, payload],
  );
  return Boolean(result.rows[0]?.id);
};

const notifyLeadership = async (title: string, message: string, entityType?: string, entityId?: number) => {
  const { rows: leaders } = await pool.query(
    `SELECT id FROM users WHERE workspace = 'administration' AND is_active = true`,
  );
  await Promise.all([
    ...leaders.map((leader) => pool.query(
      `INSERT INTO notifications (user_id, type, title, message, related_entity_type, related_entity_id)
       VALUES ($1,'academy_escalation',$2,$3,$4,$5)`,
      [leader.id, title, message, entityType ?? null, entityId ?? null],
    )),
    pool.query(
      `INSERT INTO academy_notification_outbox (channel, recipient, message, status, scheduled_at, entity_type, entity_id)
       VALUES ('telegram','leadership',$1,'pending',NOW(),$2,$3)`,
      [`⚠️ ${title}\n${message}`, entityType ?? null, entityId ?? null],
    ),
  ]);
};

const dateKey = (date = new Date()) => date.toISOString().slice(0, 10);

export const runEscalations = async (): Promise<string[]> => {
  const actions: string[] = [];
  try {
    // Important Kanban tasks become CEO-visible after a full day past their deadline.
    const { rows: overdueTasks } = await pool.query(
      `SELECT t.id, t.title, t.responsible_id, u.full_name AS responsible_name
       FROM academy_tasks t
       LEFT JOIN users u ON u.id = t.responsible_id
       WHERE t.status <> 'done'
         AND t.deadline_at < NOW() - INTERVAL '24 hours'
         AND t.escalated_at IS NULL
         AND COALESCE(t.entity_type, '') NOT IN ('lesson_survey', 'parent_survey')`,
    );
    for (const task of overdueTasks) {
      if (!await createEventOnce(`task-sla:${task.id}`, 'task_sla', 'academy_task', task.id, task)) continue;
      await pool.query(`UPDATE academy_tasks SET escalated_at = NOW(), updated_at = NOW() WHERE id = $1`, [task.id]);
      await notifyLeadership(
        'Просрочена важная задача',
        `Задача «${task.title}» не закрыта более 24 часов. Ответственный: ${task.responsible_name ?? 'не назначен'}.`,
        'academy_task',
        task.id,
      );
      actions.push(`task-sla:${task.id}`);
    }

    // Feedback incidents have a shorter SLA: only 12 hours before leadership is notified.
    const { rows: feedbackTasks } = await pool.query(
      `SELECT t.id, t.title, t.entity_type, t.entity_id, u.full_name AS responsible_name
       FROM academy_tasks t
       LEFT JOIN users u ON u.id = t.responsible_id
       WHERE t.status <> 'done'
         AND t.deadline_at < NOW()
         AND t.escalated_at IS NULL
         AND t.entity_type IN ('lesson_survey', 'parent_survey')`,
    );
    for (const task of feedbackTasks) {
      if (!await createEventOnce(`feedback-sla:${task.id}`, 'feedback_sla', 'academy_task', task.id, task)) continue;
      await pool.query(`UPDATE academy_tasks SET escalated_at = NOW(), updated_at = NOW() WHERE id = $1`, [task.id]);
      await notifyLeadership(
        'Не закрыт конфликт с учеником или родителем',
        `Задача «${task.title}» не закрыта за 12 часов. Ответственный: ${task.responsible_name ?? 'не назначен'}.`,
        'academy_task',
        task.id,
      );
      actions.push(`feedback-sla:${task.id}`);
    }

    // Cash-gap forecast: current cash plus scheduled receipts must cover approved obligations.
    const { rows: [forecast] } = await pool.query(
      `SELECT
         COALESCE((SELECT current_cash_balance_uzs FROM academy_company_settings ORDER BY id LIMIT 1), 0)::int AS cash_balance,
         COALESCE((SELECT SUM(amount_uzs) FROM academy_payments
                   WHERE status IN ('pending', 'overdue')
                     AND due_at >= date_trunc('day', NOW())
                     AND due_at < date_trunc('day', NOW()) + INTERVAL '7 days'), 0)::int AS expected_receipts,
         COALESCE((SELECT SUM(amount_uzs) FROM academy_marketing_expenses
                   WHERE status = 'approved'
                     AND period_start < date_trunc('day', NOW()) + INTERVAL '7 days'
                     AND period_end >= date_trunc('day', NOW())), 0)::int AS approved_expenses`,
    );
    const cashBalance = Number(forecast?.cash_balance || 0);
    const expectedReceipts = Number(forecast?.expected_receipts || 0);
    const approvedExpenses = Number(forecast?.approved_expenses || 0);
    if (approvedExpenses > cashBalance + expectedReceipts) {
      const key = `cash-gap:${dateKey()}`;
      if (await createEventOnce(key, 'cash_gap', 'finance', null, { cashBalance, expectedReceipts, approvedExpenses })) {
        await notifyLeadership(
          'Риск кассового разрыва',
          `Одобренные расходы: ${approvedExpenses.toLocaleString('ru-RU')} сум. Доступно с ожидаемыми поступлениями: ${(cashBalance + expectedReceipts).toLocaleString('ru-RU')} сум.`,
          'finance',
        );
        actions.push(key);
      }
    }
  } catch (error) {
    logger.error('Escalation monitor failed', { error });
  }
  return actions;
};
