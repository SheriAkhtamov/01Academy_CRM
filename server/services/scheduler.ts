import cron from "node-cron";
import { pool } from "../db";
import { logger } from "../lib/logger";
import { runAutomations } from "./automations";
import { refreshExpiringInstagramTokens } from "./instagram";
import { runEscalations } from "./escalations";
import { syncRecentMetaLeadAds } from "./meta-lead-ads";
import {
  enqueueRecentMetaCrmHistory,
  processMetaAttributionEnrichment,
  processMetaConversionEvents,
  syncMetaAdCatalog,
  syncMetaAdInsights,
} from "./meta-marketing";
import { DEFAULT_ACADEMY_TIME_ZONE } from '@shared/scheduling';

export const SCHEDULER_TIME_ZONE = process.env.ACADEMY_TIME_ZONE?.trim() || DEFAULT_ACADEMY_TIME_ZONE;

const leadershipUserAccessSql = `
  (
    u.module = 'administration'
    OR EXISTS (
      SELECT 1
      FROM user_modules uw
      WHERE uw.user_id = u.id AND uw.module = 'administration'
    )
  )
`;

let started = false;

/**
 * Starts all periodic background jobs. Safe to call once at server boot.
 * Uses node-cron expressions:
 *   - Meta attribution/CAPI worker: every minute
 *   - Meta Lead Ads fallback: every five minutes
 *   - automations:   daily at 09:00
 */
export const startScheduler = () => {
  if (started) return;
  started = true;

  const syncRecentMetaCrmHistory = async () => {
    try {
      const queued = await enqueueRecentMetaCrmHistory();
      if (queued > 0) logger.info(`[scheduler] queued ${queued} recent Meta CRM events`);
    } catch (error) {
      logger.error("[scheduler] Meta CRM history sync error", { error });
    }
  };

  void syncRecentMetaCrmHistory();

  // Meta worker — enriches attribution and delivers queued CAPI events.
  cron.schedule("* * * * *", async () => {
    try {
      const [enrichedMetaAttributions, dispatchedMetaEvents] = await Promise.all([
        processMetaAttributionEnrichment(20),
        processMetaConversionEvents(50),
      ]);
      if (enrichedMetaAttributions > 0) {
        logger.info(`[scheduler] enriched ${enrichedMetaAttributions} Meta attributions`);
      }
      if (dispatchedMetaEvents > 0) {
        logger.info(`[scheduler] processed ${dispatchedMetaEvents} Meta CAPI events`);
      }
    } catch (error) {
      logger.error("[scheduler] minute worker error", { error });
    }
  }, { timezone: SCHEDULER_TIME_ZONE, noOverlap: true });

  // Webhooks remain the primary real-time path. This overlapping 24-hour pull
  // recovers Meta Lead Ads notifications that never reached the CRM.
  cron.schedule("*/5 * * * *", async () => {
    try {
      const result = await syncRecentMetaLeadAds(24);
      const imported = result.summary.created + result.summary.merged + result.summary.mergedArchived;
      if (!result.skipped && imported > 0) {
        logger.info(`[scheduler] recovered ${imported} Meta Lead Ads submissions`);
      }
    } catch (error) {
      logger.error("[scheduler] Meta Lead Ads fallback sync error", { error });
    }
  }, { timezone: SCHEDULER_TIME_ZONE, noOverlap: true });

  // Current-day spend changes throughout the day. Keep it fresh enough for the
  // attribution table without repeatedly fetching the full historical window.
  cron.schedule("*/15 * * * *", async () => {
    try {
      const insights = await syncMetaAdInsights(3);
      if (!insights.skipped) logger.info(`[scheduler] synced ${insights.synced} recent Meta ad spend rows`);
    } catch (error) {
      logger.error("[scheduler] Meta ad spend sync error", { error });
    }
  }, { timezone: SCHEDULER_TIME_ZONE, noOverlap: true });

  // Ad catalog — keeps every ad in the account visible, including the ones with no leads.
  // Hourly is plenty: ads change rarely, and the Graph user rate limit is easy to exhaust.
  cron.schedule("7 * * * *", async () => {
    try {
      const { synced, skipped } = await syncMetaAdCatalog();
      if (!skipped) logger.info(`[scheduler] synced ${synced} Meta ads`);
    } catch (error) {
      logger.error("[scheduler] Meta ad catalog sync error", { error });
    }
  }, { timezone: SCHEDULER_TIME_ZONE, noOverlap: true });

  cron.schedule("5 * * * *", syncRecentMetaCrmHistory, {
    timezone: SCHEDULER_TIME_ZONE,
    noOverlap: true,
  });

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

  logger.info(
    `Scheduler started (timezone: ${SCHEDULER_TIME_ZONE}; Meta: 1m, Lead Ads fallback: 5m, spend: 15m, escalations: hourly, automations: daily 09:00)`,
  );
};

export const stopScheduler = async () => {
  if (!started) return;
  await cron.shutdown();
  started = false;
};

const getSystemUserId = async (): Promise<number | null> => {
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT u.id FROM users u WHERE ${leadershipUserAccessSql} AND u.is_active=true ORDER BY u.id LIMIT 1`,
  );
  return rows[0]?.id ?? null;
};
