import cron from "node-cron";
import { pool } from "../db";
import { logger } from "../lib/logger";
import { processOutbox } from "./outbox-worker";
import { runAutomations } from "./automations";
import { buildWeeklyReport } from "./weekly-report";

let started = false;

/**
 * Starts all periodic background jobs. Safe to call once at server boot.
 * Uses node-cron expressions:
 *   - outbox worker: every minute (TZ-required delays <= 1 min for notifications)
 *   - automations:   daily at 09:00
 *   - weekly report: every Monday at 09:00
 */
export const startScheduler = () => {
  if (started) return;
  started = true;

  // Outbox worker — drains the notification queue every minute.
  cron.schedule("* * * * *", async () => {
    try {
      const dispatched = await processOutbox(50);
      if (dispatched > 0) {
        logger.info(`[scheduler] outbox dispatched ${dispatched} messages`);
      }
    } catch (error) {
      logger.error("[scheduler] outbox worker error", { error });
    }
  });

  // Daily automations at 09:00.
  cron.schedule("0 9 * * *", async () => {
    const actorId = await getSystemUserId();
    if (!actorId) return;
    try {
      const actions = await runAutomations(actorId);
      logger.info(`[scheduler] daily automations completed (${actions.length} actions)`);
    } catch (error) {
      logger.error("[scheduler] daily automations error", { error });
    }
  });

  // Weekly leadership report every Monday at 09:00.
  cron.schedule("0 9 * * 1", async () => {
    const actorId = await getSystemUserId();
    if (!actorId) return;
    try {
      const result = await buildWeeklyReport(actorId);
      logger.info("[scheduler] weekly report enqueued", { outboxId: result.outboxId });
    } catch (error) {
      logger.error("[scheduler] weekly report error", { error });
    }
  });

  logger.info("Scheduler started (outbox: 1m, automations: daily 09:00, weekly report: Mon 09:00)");
};

const getSystemUserId = async (): Promise<number | null> => {
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE workspace = 'administration' AND is_active=true ORDER BY id LIMIT 1`,
  );
  return rows[0]?.id ?? null;
};
