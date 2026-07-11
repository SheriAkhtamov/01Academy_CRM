import { pool } from "../db";
import { appConfig } from "../config";
import { logger } from "../lib/logger";
import { normalizeOutboxRecipient } from "./message-recipients";

interface OutboxOptions {
  scheduledAt?: Date | null;
  entityType?: string | null;
  entityId?: number | null;
}

/**
 * Inserts a pending outbox message. Returns the new row id, or null when the DB is unavailable.
 * Shared between scheduler-driven services and the academy routes.
 */
export const createOutbox = async (
  channel: string,
  recipient: string,
  message: string,
  options: OutboxOptions = {},
): Promise<number | null> => {
  if (!pool) return null;
  const normalizedChannel = channel.trim().toLowerCase();
  const normalizedRecipient = normalizeOutboxRecipient(
    normalizedChannel,
    recipient,
    appConfig.integrations?.telegram?.leadershipChatId,
  );
  if (!normalizedRecipient) {
    logger.warn("Skipping outbox message with invalid recipient", {
      channel: normalizedChannel,
    });
    return null;
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO academy_notification_outbox (channel, recipient, message, status, scheduled_at, entity_type, entity_id)
       VALUES ($1,$2,$3,'pending',$4,$5,$6) RETURNING id`,
      [
        normalizedChannel,
        normalizedRecipient,
        message,
        options.scheduledAt ?? new Date(),
        options.entityType ?? null,
        options.entityId ?? null,
      ],
    );
    return rows[0]?.id ?? null;
  } catch (error) {
    logger.error("createOutbox failed", { error });
    return null;
  }
};
