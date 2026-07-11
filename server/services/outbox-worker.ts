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
  claimed_at: Date | string;
}

const MAX_RETRY_ATTEMPTS = 5;
const PROCESSING_LEASE_MINUTES = 15;
const BASE_RETRY_DELAY_MS = 60_000;
const MAX_RETRY_DELAY_MS = 60 * 60_000;

const retryAt = (retryCount: number) => new Date(
  Date.now() + Math.min(
    BASE_RETRY_DELAY_MS * (2 ** Math.max(0, retryCount - 1)),
    MAX_RETRY_DELAY_MS,
  ),
);

/**
 * Picks due outbox messages (status='pending', scheduled_at <= now) and dispatches them
 * through the configured channel clients. Messages without a configured client are marked
 * 'simulated' so they stop blocking the queue but are still auditable.
 */
export const processOutbox = async (batchSize = 50): Promise<number> => {
  if (!pool) return 0;

  // Claim rows and make them invisible to concurrent workers in one statement.
  // A stale processing row is reclaimable after the lease so a process crash
  // does not strand it forever.
  const { rows } = await pool.query<OutboxRow>(
    `WITH due AS (
       SELECT id
       FROM academy_notification_outbox
       WHERE (
         status = 'pending'
         AND (scheduled_at IS NULL OR scheduled_at <= NOW())
       ) OR (
         status = 'processing'
         AND updated_at < NOW() - ($2 * INTERVAL '1 minute')
       )
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE academy_notification_outbox AS outbox
     SET status = 'processing', updated_at = date_trunc('milliseconds', NOW())
     FROM due
     WHERE outbox.id = due.id
     RETURNING outbox.id, outbox.channel, outbox.recipient, outbox.message,
               outbox.retry_count, outbox.updated_at AS claimed_at`,
    [batchSize, PROCESSING_LEASE_MINUTES],
  );

  if (rows.length === 0) {
    return 0;
  }

  let dispatched = 0;
  for (const row of rows) {
    try {
      const result = await dispatchChannel(row.channel, row.recipient, row.message);
      if (!result.ok) {
        await recordFailure(
          row,
          result.error ?? `${row.channel} dispatch failed`,
          result.retryable !== false,
        );
        continue;
      }

      const status = result.simulated ? "simulated" : "sent";
      const update = await pool.query(
        `UPDATE academy_notification_outbox
         SET status = $1, sent_at = NOW(), error_message = $2, updated_at = NOW()
         WHERE id = $3 AND status = 'processing' AND updated_at = $4`,
        [status, result.error ?? null, row.id, row.claimed_at],
      );
      if (update.rowCount === 0) {
        logger.warn("Outbox claim expired before success was recorded", { id: row.id });
      } else {
        dispatched += 1;
      }
    } catch (error: any) {
      logger.error("Outbox dispatch error", { id: row.id, error });
      await recordFailure(row, String(error?.message ?? error));
    }
  }

  return dispatched;
};

const recordFailure = async (row: OutboxRow, error: string, retryable = true) => {
  const nextRetryCount = row.retry_count + 1;
  const exhausted = !retryable || nextRetryCount >= MAX_RETRY_ATTEMPTS;
  const update = await pool.query(
    `UPDATE academy_notification_outbox
     SET status = $1,
         error_message = $2,
         scheduled_at = $3,
         retry_count = $4,
         updated_at = NOW()
     WHERE id = $5 AND status = 'processing' AND updated_at = $6`,
    [
      exhausted ? "failed" : "pending",
      error,
      exhausted ? null : retryAt(nextRetryCount),
      nextRetryCount,
      row.id,
      row.claimed_at,
    ],
  );
  if (update.rowCount === 0) {
    logger.warn("Outbox claim expired before failure was recorded", { id: row.id });
  }
};

const dispatchChannel = async (channel: string, recipient: string, message: string) => {
  switch (channel) {
    case "telegram":
      return sendTelegramMessage(recipient, message);
    case "whatsapp":
      return sendWhatsAppMessage(recipient, message);
    default:
      logger.error(`[outbox:unknown-channel:${channel}]`, { recipient, message });
      return { ok: false, retryable: false, error: `Unknown channel: ${channel}` };
  }
};
