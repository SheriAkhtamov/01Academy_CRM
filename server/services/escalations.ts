import type { PoolClient } from "pg";
import { pool } from "../db";
import { logger } from "../lib/logger";

type EscalationKind = "task_sla" | "feedback_sla";

interface EscalationTask {
  id: number;
  title: string;
  responsible_id: number | null;
  responsible_name: string | null;
}

const eligibilitySql = (kind: EscalationKind) => kind === "task_sla"
  ? `t.deadline_at < NOW() - INTERVAL '24 hours'
     AND COALESCE(t.entity_type, '') NOT IN ('lesson_survey', 'parent_survey')`
  : `t.deadline_at < NOW()
     AND t.entity_type IN ('lesson_survey', 'parent_survey')`;

const eventKeyFor = (kind: EscalationKind, taskId: number) =>
  `${kind === "task_sla" ? "task-sla" : "feedback-sla"}:${taskId}`;

const notificationFor = (kind: EscalationKind, task: EscalationTask) => kind === "task_sla"
  ? {
      title: "Просрочена важная задача",
      message: `Задача «${task.title}» не закрыта более 24 часов. Ответственный: ${task.responsible_name ?? "не назначен"}.`,
    }
  : {
      title: "Не закрыт конфликт с учеником или родителем",
      message: `Задача «${task.title}» не закрыта за 12 часов. Ответственный: ${task.responsible_name ?? "не назначен"}.`,
    };

const queueEscalationNotifications = async (
  client: PoolClient,
  responsibleId: number | null,
  title: string,
  message: string,
  entityType: string,
  entityId: number,
) => {
  // The internal notifications and Telegram outbox row are part of the same
  // transaction as the ledger event. A rollback can no longer permanently
  // consume the dedupe key without actually queuing the escalation.
  await client.query(
    `INSERT INTO notifications
       (user_id, type, title, message, related_entity_type, related_entity_id)
     SELECT task_owner.id, 'academy_escalation', $2, $3, $4, $5
     FROM users task_owner
     WHERE task_owner.id = $1
       AND task_owner.is_active = true
       AND NOT EXISTS (
         SELECT 1
         FROM notifications existing
         WHERE existing.user_id = task_owner.id
           AND existing.type = 'academy_escalation'
           AND existing.related_entity_type = $4
           AND existing.related_entity_id = $5
       )`,
    [responsibleId, title, message, entityType, entityId],
  );
  await client.query(
    `INSERT INTO academy_notification_outbox
       (channel, recipient, message, status, scheduled_at, entity_type, entity_id)
     SELECT 'telegram','leadership',$1,'pending',NOW(),$2,$3
     WHERE NOT EXISTS (
       SELECT 1
       FROM academy_notification_outbox existing
       WHERE existing.channel = 'telegram'
         AND existing.recipient = 'leadership'
         AND existing.entity_type = $2
         AND existing.entity_id = $3
     )`,
    [`⚠️ ${title}\n${message}`, entityType, entityId],
  );
};

const escalateTask = async (taskId: number, kind: EscalationKind): Promise<boolean> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<EscalationTask>(
      `SELECT t.id, t.title, t.responsible_id, u.full_name AS responsible_name
       FROM academy_tasks t
       LEFT JOIN users u ON u.id = t.responsible_id
       WHERE t.id = $1
         AND t.status <> 'done'
         AND t.escalated_at IS NULL
         AND ${eligibilitySql(kind)}
       FOR UPDATE OF t`,
      [taskId],
    );
    const task = rows[0];
    if (!task) {
      await client.query("COMMIT");
      return false;
    }

    const eventKey = eventKeyFor(kind, task.id);
    const event = await client.query(
      `INSERT INTO academy_escalation_events
         (event_key, event_type, entity_type, entity_id, payload)
       VALUES ($1,$2,'academy_task',$3,$4)
       ON CONFLICT (event_key) DO NOTHING
       RETURNING id`,
      [eventKey, kind, task.id, task],
    );
    if (!event.rows[0]?.id) {
      // Recover legacy partial state safely: the notification/outbox inserts
      // are themselves idempotent, so missing delivery records are restored
      // without duplicating records that were already queued.
      const notification = notificationFor(kind, task);
      await queueEscalationNotifications(
        client,
        task.responsible_id,
        notification.title,
        notification.message,
        "academy_task",
        task.id,
      );
      await client.query(
        "UPDATE academy_tasks SET escalated_at = COALESCE(escalated_at, NOW()), updated_at = NOW() WHERE id = $1",
        [task.id],
      );
      await client.query("COMMIT");
      return false;
    }

    const notification = notificationFor(kind, task);
    await queueEscalationNotifications(
      client,
      task.responsible_id,
      notification.title,
      notification.message,
      "academy_task",
      task.id,
    );
    await client.query(
      "UPDATE academy_tasks SET escalated_at = NOW(), updated_at = NOW() WHERE id = $1",
      [task.id],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch((rollbackError) => {
      logger.error("Escalation rollback failed", { taskId, kind, rollbackError });
    });
    throw error;
  } finally {
    client.release();
  }
};

export const runEscalations = async (): Promise<string[]> => {
  const actions: string[] = [];

  for (const kind of ["task_sla", "feedback_sla"] as const) {
    let candidates: Array<{ id: number }> = [];
    try {
      const result = await pool.query<{ id: number }>(
        `SELECT t.id
         FROM academy_tasks t
         WHERE t.status <> 'done'
           AND t.escalated_at IS NULL
           AND ${eligibilitySql(kind)}
         ORDER BY t.deadline_at, t.id`,
      );
      candidates = result.rows;
    } catch (error) {
      logger.error("Failed to find escalation candidates", { kind, error });
      continue;
    }

    for (const candidate of candidates) {
      try {
        if (await escalateTask(candidate.id, kind)) {
          actions.push(eventKeyFor(kind, candidate.id));
        }
      } catch (error) {
        // One malformed task or transient write failure must not suppress every
        // other escalation in this scheduler pass.
        logger.error("Failed to escalate task", { taskId: candidate.id, kind, error });
      }
    }
  }

  return actions;
};
