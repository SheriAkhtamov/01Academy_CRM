import cron from "node-cron";
import { pool } from "../db";
import { logger } from "../lib/logger";
import { processOutbox } from "./outbox-worker";
import { runAutomations } from "./automations";
import { buildWeeklyReport } from "./weekly-report";
import { refreshExpiringInstagramTokens } from "./instagram";
import { runEscalations } from "./escalations";

export const SCHEDULER_TIME_ZONE = process.env.ACADEMY_TIME_ZONE?.trim() || "Asia/Tashkent";

const leadershipUserAccessSql = `
  (
    u.workspace = 'administration'
    OR EXISTS (
      SELECT 1
      FROM user_workspaces uw
      WHERE uw.user_id = u.id AND uw.workspace = 'administration'
    )
  )
`;

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
  }, { timezone: SCHEDULER_TIME_ZONE, noOverlap: true });

  // The escalation monitor makes overdue work and cash risks push themselves to leadership.
  cron.schedule("0 * * * *", async () => {
    try {
      const actions = await runEscalations();
      if (actions.length > 0) {
        logger.warn(`[scheduler] escalations raised (${actions.join(', ')})`);
      }
    } catch (error) {
      logger.error("[scheduler] escalation monitor error", { error });
    }
  }, { timezone: SCHEDULER_TIME_ZONE, noOverlap: true });

  // Daily automations at 09:00.
  cron.schedule("0 9 * * *", async () => {
    try {
      const actorId = await getSystemUserId();
      if (!actorId) return;
      const [actions, refreshedInstagramTokens] = await Promise.all([
        runAutomations(actorId),
        refreshExpiringInstagramTokens(),
      ]);
      logger.info(`[scheduler] daily automations completed (${actions.length} actions)`);
      if (refreshedInstagramTokens > 0) {
        logger.info(`[scheduler] refreshed ${refreshedInstagramTokens} Instagram tokens`);
      }
    } catch (error) {
      logger.error("[scheduler] daily automations error", { error });
    }
  }, { timezone: SCHEDULER_TIME_ZONE, noOverlap: true });

  // Weekly leadership report every Monday at 09:00.
  cron.schedule("0 9 * * 1", async () => {
    try {
      const actorId = await getSystemUserId();
      if (!actorId) return;
      const result = await buildWeeklyReport(actorId);
      logger.info("[scheduler] weekly report enqueued", { outboxId: result.outboxId });
    } catch (error) {
      logger.error("[scheduler] weekly report error", { error });
    }
  }, { timezone: SCHEDULER_TIME_ZONE, noOverlap: true });

  logger.info(
    `Scheduler started (timezone: ${SCHEDULER_TIME_ZONE}; outbox: 1m, escalations: hourly, automations: daily 09:00, weekly report: Mon 09:00)`,
  );
};

const getSystemUserId = async (): Promise<number | null> => {
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT u.id FROM users u WHERE ${leadershipUserAccessSql} AND u.is_active=true ORDER BY u.id LIMIT 1`,
  );
  return rows[0]?.id ?? null;
};
