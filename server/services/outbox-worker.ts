import { pool } from "../db";
import { logger } from "../lib/logger";
import { sendTelegramMessage } from "./telegram";
import { sendWhatsAppMessage } from "./whatsapp";

interface OutboxRow {
  id: number;
  channel: string;
  recipient: string;
  message: string;
  retry_count: number;
}

/**
 * Picks due outbox messages (status='pending', scheduled_at <= now) and dispatches them
 * through the configured channel clients. Messages without a configured client are marked
 * 'simulated' so they stop blocking the queue but are still auditable.
 */
export const processOutbox = async (batchSize = 50): Promise<number> => {
  if (!pool) return 0;

  const { rows } = await pool.query<OutboxRow>(
    `SELECT id, channel, recipient, message, retry_count
     FROM academy_notification_outbox
     WHERE status = 'pending' AND (scheduled_at IS NULL OR scheduled_at <= NOW())
     ORDER BY created_at
     LIMIT $1`,
    [batchSize],
  );

  if (rows.length === 0) {
    return 0;
  }

  let dispatched = 0;
  for (const row of rows) {
    try {
      const result = await dispatchChannel(row.channel, row.recipient, row.message);
      const status = result.ok ? (result.simulated ? "simulated" : "sent") : "failed";
      await pool.query(
        `UPDATE academy_notification_outbox
         SET status = $1, sent_at = CASE WHEN $1 IN ('sent','simulated') THEN NOW() ELSE sent_at END,
             error_message = $2, retry_count = $3, updated_at = NOW()
         WHERE id = $4`,
        [status, result.error ?? null, status === "failed" ? row.retry_count + 1 : row.retry_count, row.id],
      );
      if (status !== "failed") dispatched += 1;
    } catch (error: any) {
      logger.error("Outbox dispatch error", { id: row.id, error });
      await pool.query(
        `UPDATE academy_notification_outbox
         SET status = CASE WHEN retry_count >= 5 THEN 'failed' ELSE status END,
             error_message = $1, retry_count = retry_count + 1, updated_at = NOW()
         WHERE id = $2`,
        [String(error?.message ?? error), row.id],
      );
    }
  }

  return dispatched;
};

const dispatchChannel = async (channel: string, recipient: string, message: string) => {
  switch (channel) {
    case "telegram":
      return sendTelegramMessage(recipient, message);
    case "whatsapp":
      return sendWhatsAppMessage(recipient, message);
    default:
      logger.info(`[outbox:unknown-channel:${channel}]`, { recipient, message });
      return { ok: true, simulated: true, error: `Unknown channel: ${channel}` };
  }
};
