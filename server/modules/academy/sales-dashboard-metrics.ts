import { getAssignedModules, hasLeadershipAccess } from '@shared/academy';
import {
  type DatasetActor,
  type Row,
  query,
  queryOne,
} from './academy-core';
import { academyDateOnlyKey, type ReportingRange } from './academy-scheduling';

const DAY_MS = 24 * 60 * 60 * 1_000;

export type SalesDashboardMetricReason = {
  reason: string;
  count: number;
};

export type SalesDashboardCoreMetrics = {
  newLeads: number;
  processedLeads: number;
  reachedLeads: number;
  qualifiedLeads: number;
  demoBookings: number;
  repeatCallLeads: number;
  targetRefusals: number;
  targetRefusalReasons: SalesDashboardMetricReason[];
};

export type SalesDashboardDailyPoint = {
  date: string;
  newLeads: number;
  processedLeads: number;
  reachedLeads: number;
};

export type SalesDashboardMetrics = SalesDashboardCoreMetrics & {
  previous: SalesDashboardCoreMetrics;
  previousRange: { from: string; to: string };
  daily: SalesDashboardDailyPoint[];
};

const countValue = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

/**
 * Builds event-based sales KPIs for the selected reporting period.
 *
 * Metric grain is one unique lead:
 * - processed: any persisted action in the period;
 * - reached: at least one call with an answer or positive talk time;
 * - qualified: reached the configured "qualified" stage or anything after it;
 * - demo booking: entered the "demo_invited" stage;
 * - repeat calls: two to five phone attempts in the period;
 * - target refusal: archived in the period after ever reaching qualification.
 */
const buildSalesDashboardPeriodMetrics = async (
  actor: DatasetActor,
  start: Date,
  end: Date,
): Promise<SalesDashboardCoreMetrics> => {
  const isManagerScoped =
    actor.scopeModule === 'sales'
    && getAssignedModules(actor).includes('sales')
    && !hasLeadershipAccess(actor);
  const managerFilter = isManagerScoped
    ? 'AND lead.manager_id = $3'
    : '';
  const values = isManagerScoped
    ? [start, end, actor.userId]
    : [start, end];

  const row = await queryOne<Row>(
    `WITH visible_leads AS (
       SELECT lead.*
       FROM academy_leads lead
       WHERE TRUE ${managerFilter}
     ),
     period_calls AS (
       SELECT
         COALESCE(
           phone_call.lead_id,
           CASE WHEN phone_call.contact_type = 'lead' THEN phone_call.contact_id END
         ) AS lead_id,
         COUNT(*)::int AS attempts,
         BOOL_OR(phone_call.answered_at IS NOT NULL OR phone_call.talk_seconds > 0) AS was_reached
       FROM telephony_calls phone_call
       JOIN visible_leads lead
         ON lead.id = COALESCE(
           phone_call.lead_id,
           CASE WHEN phone_call.contact_type = 'lead' THEN phone_call.contact_id END
         )
       WHERE phone_call.started_at >= $1
         AND phone_call.started_at < $2
       GROUP BY COALESCE(
         phone_call.lead_id,
         CASE WHEN phone_call.contact_type = 'lead' THEN phone_call.contact_id END
       )
     ),
     period_stage_events AS (
       SELECT history.lead_id, history.from_status_code, history.to_status_code
       FROM academy_lead_stage_history history
       JOIN visible_leads lead ON lead.id = history.lead_id
       WHERE history.entered_at >= $1
         AND history.entered_at < $2
     ),
     processed_lead_ids AS (
       SELECT calls.lead_id FROM period_calls calls
       UNION
       SELECT communication.lead_id
       FROM academy_communications communication
       JOIN visible_leads lead ON lead.id = communication.lead_id
       WHERE communication.created_at >= $1
         AND communication.created_at < $2
       UNION
       SELECT stage.lead_id
       FROM period_stage_events stage
       WHERE stage.from_status_code IS NOT NULL
       UNION
       SELECT comment.lead_id
       FROM academy_lead_comments comment
       JOIN visible_leads lead ON lead.id = comment.lead_id
       WHERE comment.created_at >= $1
         AND comment.created_at < $2
       UNION
       SELECT student.lead_id
       FROM academy_students student
       JOIN visible_leads lead ON lead.id = student.lead_id
       WHERE student.created_at >= $1
         AND student.created_at < $2
       UNION
       SELECT lead.id
       FROM visible_leads lead
       WHERE lead.archived_at >= $1
         AND lead.archived_at < $2
       UNION
       SELECT lead.id
       FROM visible_leads lead
       WHERE lead.updated_at >= $1
         AND lead.updated_at < $2
         AND lead.updated_at > lead.created_at
     ),
     quality_stage AS (
       SELECT status.sort_order
       FROM academy_lead_statuses status
       WHERE status.code = 'qualified'
       LIMIT 1
     ),
     qualified_lead_ids AS (
       SELECT DISTINCT stage.lead_id
       FROM period_stage_events stage
       JOIN academy_lead_statuses reached_status
         ON reached_status.code = stage.to_status_code
       CROSS JOIN quality_stage
       WHERE reached_status.sort_order >= quality_stage.sort_order
     ),
     demo_booking_lead_ids AS (
       SELECT DISTINCT stage.lead_id
       FROM period_stage_events stage
       WHERE stage.to_status_code = 'demo_invited'
     ),
     target_refusal_leads AS (
       SELECT lead.id, COALESCE(NULLIF(BTRIM(lead.archive_reason), ''), 'other') AS reason
       FROM visible_leads lead
       CROSS JOIN quality_stage
       LEFT JOIN academy_lead_statuses current_status
         ON current_status.code = lead.status_code
       WHERE lead.archived_at >= $1
         AND lead.archived_at < $2
         AND (
           current_status.sort_order >= quality_stage.sort_order
           OR EXISTS (
             SELECT 1
             FROM academy_lead_stage_history history
             JOIN academy_lead_statuses reached_status
               ON reached_status.code = history.to_status_code
             WHERE history.lead_id = lead.id
               AND reached_status.sort_order >= quality_stage.sort_order
               AND history.entered_at <= lead.archived_at
           )
         )
     ),
     target_refusal_reason_counts AS (
       SELECT refusal.reason, COUNT(*)::int AS count
       FROM target_refusal_leads refusal
       GROUP BY refusal.reason
       ORDER BY count DESC, refusal.reason
     )
     SELECT
       (
         SELECT COUNT(*)::int
         FROM visible_leads lead
         WHERE lead.created_at >= $1 AND lead.created_at < $2
       ) AS new_leads,
       (SELECT COUNT(*)::int FROM processed_lead_ids) AS processed_leads,
       (SELECT COUNT(*)::int FROM period_calls calls WHERE calls.was_reached) AS reached_leads,
       (SELECT COUNT(*)::int FROM qualified_lead_ids) AS qualified_leads,
       (SELECT COUNT(*)::int FROM demo_booking_lead_ids) AS demo_bookings,
       (
         SELECT COUNT(*)::int
         FROM period_calls calls
         WHERE calls.attempts BETWEEN 2 AND 5
       ) AS repeat_call_leads,
       (SELECT COUNT(*)::int FROM target_refusal_leads) AS target_refusals,
       COALESCE(
         (
           SELECT JSON_AGG(
             JSON_BUILD_OBJECT('reason', reason_counts.reason, 'count', reason_counts.count)
             ORDER BY reason_counts.count DESC, reason_counts.reason
           )
           FROM target_refusal_reason_counts reason_counts
         ),
         '[]'::json
       ) AS target_refusal_reasons`,
    values,
  );

  const targetRefusalReasons = Array.isArray(row?.targetRefusalReasons)
    ? row.targetRefusalReasons.flatMap((item: unknown) => {
        if (!item || typeof item !== 'object') return [];
        const reason = String((item as Row).reason ?? '').trim();
        if (!reason) return [];
        return [{ reason, count: countValue((item as Row).count) }];
      })
    : [];

  return {
    newLeads: countValue(row?.newLeads),
    processedLeads: countValue(row?.processedLeads),
    reachedLeads: countValue(row?.reachedLeads),
    qualifiedLeads: countValue(row?.qualifiedLeads),
    demoBookings: countValue(row?.demoBookings),
    repeatCallLeads: countValue(row?.repeatCallLeads),
    targetRefusals: countValue(row?.targetRefusals),
    targetRefusalReasons,
  };
};

/**
 * Builds per-day series of the core funnel KPIs inside the reporting range
 * (dates follow the academy timezone).
 */
const buildSalesDashboardDailySeries = async (
  actor: DatasetActor,
  range: ReportingRange,
): Promise<SalesDashboardDailyPoint[]> => {
  const isManagerScoped =
    actor.scopeModule === 'sales'
    && getAssignedModules(actor).includes('sales')
    && !hasLeadershipAccess(actor);
  const managerFilter = isManagerScoped
    ? 'AND lead.manager_id = $3'
    : '';
  const values = isManagerScoped
    ? [range.start, range.end, actor.userId]
    : [range.start, range.end];

  const [newRows, processedRows, reachedRows] = await Promise.all([
    query<Row>(
      `SELECT lead.created_at AS happened_at
       FROM academy_leads lead
       WHERE lead.created_at >= $1
         AND lead.created_at < $2
         ${managerFilter}`,
      values,
    ),
    query<Row>(
      `WITH visible_leads AS (
         SELECT lead.id
         FROM academy_leads lead
         WHERE TRUE ${managerFilter}
       ),
       processed_events AS (
         SELECT phone_call.started_at AS happened_at,
                lead.id AS lead_id
         FROM telephony_calls phone_call
         JOIN visible_leads lead
           ON lead.id = COALESCE(
             phone_call.lead_id,
             CASE WHEN phone_call.contact_type = 'lead' THEN phone_call.contact_id END
           )
         WHERE phone_call.started_at >= $1
           AND phone_call.started_at < $2
         UNION ALL
         SELECT communication.created_at AS happened_at,
                communication.lead_id AS lead_id
         FROM academy_communications communication
         JOIN visible_leads lead ON lead.id = communication.lead_id
         WHERE communication.created_at >= $1
           AND communication.created_at < $2
         UNION ALL
         SELECT stage.entered_at AS happened_at,
                stage.lead_id AS lead_id
         FROM academy_lead_stage_history stage
         JOIN visible_leads lead ON lead.id = stage.lead_id
         WHERE stage.entered_at >= $1
           AND stage.entered_at < $2
           AND stage.from_status_code IS NOT NULL
         UNION ALL
         SELECT comment.created_at AS happened_at,
                comment.lead_id AS lead_id
         FROM academy_lead_comments comment
         JOIN visible_leads lead ON lead.id = comment.lead_id
         WHERE comment.created_at >= $1
           AND comment.created_at < $2
         UNION ALL
         SELECT student.created_at AS happened_at,
                student.lead_id AS lead_id
         FROM academy_students student
         JOIN visible_leads lead ON lead.id = student.lead_id
         WHERE student.created_at >= $1
           AND student.created_at < $2
         UNION ALL
         SELECT source_lead.archived_at AS happened_at,
                lead.id AS lead_id
         FROM visible_leads lead
         JOIN academy_leads source_lead ON source_lead.id = lead.id
         WHERE source_lead.archived_at >= $1
           AND source_lead.archived_at < $2
         UNION ALL
         SELECT source_lead.updated_at AS happened_at,
                lead.id AS lead_id
         FROM visible_leads lead
         JOIN academy_leads source_lead ON source_lead.id = lead.id
         WHERE source_lead.updated_at >= $1
           AND source_lead.updated_at < $2
           AND source_lead.updated_at > source_lead.created_at
       )
       SELECT processed_events.happened_at
       FROM processed_events`,
      values,
    ),
    query<Row>(
      `SELECT phone_call.started_at AS happened_at,
              lead.id AS lead_id
       FROM telephony_calls phone_call
       JOIN academy_leads lead
         ON lead.id = COALESCE(
           phone_call.lead_id,
           CASE WHEN phone_call.contact_type = 'lead' THEN phone_call.contact_id END
         )
       WHERE phone_call.started_at >= $1
         AND phone_call.started_at < $2
         AND (phone_call.answered_at IS NOT NULL OR phone_call.talk_seconds > 0)
         ${managerFilter}`,
      values,
    ),
  ]);

  const totalDays = Math.max(
    1,
    Math.round((range.end.getTime() - range.start.getTime()) / DAY_MS),
  );
  const dayKeys: string[] = [];
  for (let index = 0; index < totalDays; index += 1) {
    dayKeys.push(academyDateOnlyKey(new Date(range.start.getTime() + index * DAY_MS)));
  }

  const newCounts = new Map<string, number>();
  const processedCounts = new Map<string, number>();
  const reachedKeysByDay = new Map<string, Set<string>>();
  const bump = (map: Map<string, number>, key: string) => {
    map.set(key, (map.get(key) ?? 0) + 1);
  };

  for (const eventRow of newRows) {
    if (!eventRow.happenedAt) continue;
    bump(newCounts, academyDateOnlyKey(new Date(eventRow.happenedAt as string)));
  }
  for (const eventRow of processedRows) {
    if (!eventRow.happenedAt) continue;
    bump(processedCounts, academyDateOnlyKey(new Date(eventRow.happenedAt as string)));
  }
  for (const eventRow of reachedRows) {
    if (!eventRow.happenedAt) continue;
    const happenedAt = new Date(eventRow.happenedAt as string);
    const key = academyDateOnlyKey(happenedAt);
    const leadKey = String(eventRow.leadId ?? '');
    if (!leadKey) continue;
    const bucket = reachedKeysByDay.get(key) ?? new Set<string>();
    bucket.add(leadKey);
    reachedKeysByDay.set(key, bucket);
  }

  return dayKeys.map((date) => ({
    date,
    newLeads: newCounts.get(date) ?? 0,
    processedLeads: processedCounts.get(date) ?? 0,
    reachedLeads: reachedKeysByDay.get(date)?.size ?? 0,
  }));
};

/**
 * Builds sales KPIs for the selected reporting period, the same KPIs for the
 * previous period of equal length (for trend deltas) and the daily activity
 * series used by the dashboard charts.
 */
export const buildSalesDashboardMetrics = async (
  actor: DatasetActor,
  range: ReportingRange,
): Promise<SalesDashboardMetrics> => {
  const durationMs = Math.max(1, range.end.getTime() - range.start.getTime());
  const previousEnd = new Date(range.start.getTime());
  const previousStart = new Date(range.start.getTime() - durationMs);

  const [current, previous, daily] = await Promise.all([
    buildSalesDashboardPeriodMetrics(actor, range.start, range.end),
    buildSalesDashboardPeriodMetrics(actor, previousStart, previousEnd),
    buildSalesDashboardDailySeries(actor, range),
  ]);

  return {
    ...current,
    previous,
    previousRange: {
      from: academyDateOnlyKey(previousStart),
      to: academyDateOnlyKey(new Date(previousEnd.getTime() - 1)),
    },
    daily,
  };
};
