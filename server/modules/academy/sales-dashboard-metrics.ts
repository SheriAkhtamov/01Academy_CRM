import { hasLeadershipAccess } from '@shared/academy';
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
  repeatCallDistribution: Array<{ attempts: number; count: number }>;
  targetRefusals: number;
  targetRefusalReasons: SalesDashboardMetricReason[];
};

export type SalesDashboardDailyPoint = {
  date: string;
  newLeads: number;
  processedLeads: number;
  reachedLeads: number;
  demoBookings: number;
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
  managerId: number | null,
  start: Date,
  end: Date,
): Promise<SalesDashboardCoreMetrics> => {
  const managerFilter = managerId
    ? 'AND lead.manager_id = $3'
    : '';
  const values = managerId
    ? [start, end, managerId]
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
       COALESCE((
         SELECT JSON_AGG(JSON_BUILD_OBJECT('attempts', buckets.attempts, 'count', buckets.count) ORDER BY buckets.attempts)
         FROM (SELECT calls.attempts, COUNT(*)::int AS count FROM period_calls calls
               WHERE calls.attempts BETWEEN 2 AND 5 GROUP BY calls.attempts) buckets
       ), '[]'::json) AS repeat_call_distribution,
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
    repeatCallDistribution: Array.isArray(row?.repeatCallDistribution) ? row.repeatCallDistribution.flatMap((item: Row) => {
      const attempts = countValue(item?.attempts);
      return attempts >= 2 && attempts <= 5 ? [{ attempts, count: countValue(item.count) }] : [];
    }) : [],
    targetRefusals: countValue(row?.targetRefusals),
    targetRefusalReasons,
  };
};

/**
 * Builds per-day series of the core funnel KPIs inside the reporting range
 * (dates follow the academy timezone).
 */
const buildSalesDashboardDailySeries = async (
  managerId: number | null,
  range: ReportingRange,
): Promise<SalesDashboardDailyPoint[]> => {
  const managerFilter = managerId
    ? 'AND lead.manager_id = $3'
    : '';
  const values = managerId
    ? [range.start, range.end, managerId]
    : [range.start, range.end];

  const [newRows, processedRows, reachedRows, bookingRows] = await Promise.all([
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
    query<Row>(
      `SELECT MIN(history.entered_at) AS happened_at
       FROM academy_lead_stage_history history
       JOIN academy_leads lead ON lead.id = history.lead_id
       WHERE history.entered_at >= $1 AND history.entered_at < $2
         AND history.to_status_code = 'demo_invited'
         ${managerFilter}
       GROUP BY history.lead_id`,
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
  const bookingCounts = new Map<string, number>();
  const reachedKeysByDay = new Map<string, Set<string>>();
  const bump = (map: Map<string, number>, key: string) => {
    map.set(key, (map.get(key) ?? 0) + 1);
  };

  for (const eventRow of newRows) {
    if (!eventRow.happenedAt) continue;
    bump(newCounts, academyDateOnlyKey(new Date(eventRow.happenedAt as string)));
  }
  // A lead contributes once, on its first booking in this period, matching the headline.
  for (const eventRow of bookingRows) {
    if (!eventRow.happenedAt) continue;
    bump(bookingCounts, academyDateOnlyKey(new Date(eventRow.happenedAt as string)));
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
    demoBookings: bookingCounts.get(date) ?? 0,
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
  requestedManagerId: number | null = null,
): Promise<SalesDashboardMetrics> => {
  // A sales employee is always pinned to their own figures. Leadership can
  // request one employee or leave the filter empty for the company-wide view.
  const managerId = hasLeadershipAccess(actor)
    ? requestedManagerId
    : actor.userId;
  const durationMs = Math.max(1, range.end.getTime() - range.start.getTime());
  const previousEnd = new Date(range.start.getTime());
  const previousStart = new Date(range.start.getTime() - durationMs);

  const [current, previous, daily] = await Promise.all([
    buildSalesDashboardPeriodMetrics(managerId, range.start, range.end),
    buildSalesDashboardPeriodMetrics(managerId, previousStart, previousEnd),
    buildSalesDashboardDailySeries(managerId, range),
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

export type SalesDemoStudent = {
  id: string;
  participantId: number | null;
  studentId: number | null;
  leadId: number | null;
  studentName: string | null;
  contactName: string | null;
  phone: string | null;
  courseName: string | null;
  schoolName: string | null;
  roomName: string | null;
  teacherName: string | null;
  scheduledAt: string | null;
  durationMinutes: number | null;
  format: 'offline' | 'online' | null;
  participantStatus: 'attended' | 'no_show' | 'invited' | 'confirmed' | 'cancelled';
  noShowReasonCode: string | null;
  noShowReasonNote: string | null;
  result: string | null;
  managerId: number | null;
  managerName: string | null;
};

export const buildSalesDemoStudents = async (
  actor: DatasetActor,
  range: ReportingRange,
  requestedManagerId: number | null = null,
): Promise<SalesDemoStudent[]> => {
  const managerId = hasLeadershipAccess(actor)
    ? requestedManagerId
    : actor.userId;

  const managerFilter = managerId ? 'AND COALESCE(student.manager_id, lead.manager_id) = $3' : '';
  const values = managerId ? [range.start, range.end, managerId] : [range.start, range.end];

  const rows = await query<Row>(
    `SELECT
      participant.id AS participant_id,
      participant.status AS participant_status,
      participant.result AS result,
      participant.no_show_reason_code,
      participant.no_show_reason_note,
      demo.id AS demo_id,
      demo.scheduled_at,
      demo.duration_minutes,
      demo.format,
      demo.status AS demo_status,
      course.name AS course_name,
      school.name AS school_name,
      room.name AS room_name,
      teacher.full_name AS teacher_name,
      student.id AS student_id,
      COALESCE(student.student_name, lead.student_name) AS student_name,
      COALESCE(student.contact_name, lead.contact_name) AS contact_name,
      COALESCE(student.phone, lead.phone) AS phone,
      lead.id AS lead_id,
      lead.status_code AS lead_status_code,
      COALESCE(student.manager_id, lead.manager_id) AS manager_id,
      manager.full_name AS manager_name
    FROM academy_demo_lesson_participants participant
    JOIN academy_demo_lessons demo ON demo.id = participant.demo_lesson_id
    JOIN academy_students student ON student.id = participant.student_id
    LEFT JOIN academy_leads lead ON lead.id = student.lead_id
    LEFT JOIN academy_courses course ON course.id = demo.course_id
    LEFT JOIN academy_schools school ON school.id = demo.school_id
    LEFT JOIN academy_rooms room ON room.id = demo.room_id
    LEFT JOIN academy_teachers teacher ON teacher.id = demo.teacher_id
    LEFT JOIN users manager ON manager.id = COALESCE(student.manager_id, lead.manager_id)
    WHERE demo.scheduled_at >= $1 AND demo.scheduled_at < $2
      ${managerFilter}

    UNION ALL

    SELECT
      NULL AS participant_id,
      CASE WHEN lead.status_code = 'demo_attended' OR COALESCE(lead.demo_attended, false) THEN 'attended' ELSE 'invited' END AS participant_status,
      NULL AS result,
      NULL AS no_show_reason_code,
      NULL AS no_show_reason_note,
      NULL AS demo_id,
      history.entered_at AS scheduled_at,
      NULL AS duration_minutes,
      NULL AS format,
      NULL AS demo_status,
      course.name AS course_name,
      school.name AS school_name,
      NULL AS room_name,
      NULL AS teacher_name,
      student.id AS student_id,
      COALESCE(student.student_name, lead.student_name) AS student_name,
      COALESCE(student.contact_name, lead.contact_name) AS contact_name,
      COALESCE(student.phone, lead.phone) AS phone,
      lead.id AS lead_id,
      lead.status_code AS lead_status_code,
      COALESCE(student.manager_id, lead.manager_id) AS manager_id,
      manager.full_name AS manager_name
    FROM academy_lead_stage_history history
    JOIN academy_leads lead ON lead.id = history.lead_id
    LEFT JOIN academy_students student ON student.lead_id = lead.id
    LEFT JOIN academy_courses course ON course.id = lead.course_id
    LEFT JOIN academy_schools school ON school.id = lead.school_id
    LEFT JOIN users manager ON manager.id = COALESCE(student.manager_id, lead.manager_id)
    WHERE history.entered_at >= $1 AND history.entered_at < $2
      AND history.to_status_code IN ('demo_invited', 'demo_attended')
      ${managerFilter}
      AND NOT EXISTS (
        SELECT 1 FROM academy_demo_lesson_participants p2
        JOIN academy_demo_lessons d2 ON d2.id = p2.demo_lesson_id
        JOIN academy_students s2 ON s2.id = p2.student_id
        WHERE s2.lead_id = lead.id
          AND d2.scheduled_at >= $1 AND d2.scheduled_at < $2
      )
    ORDER BY scheduled_at DESC, participant_id DESC NULLS LAST`,
    values,
  );

  return rows.map((row) => ({
    id: row.participant_id
      ? `participant-${row.participant_id}`
      : `lead-stage-${row.lead_id}-${new Date(row.scheduled_at).getTime()}`,
    participantId: row.participant_id ? Number(row.participant_id) : null,
    studentId: row.student_id ? Number(row.student_id) : null,
    leadId: row.lead_id ? Number(row.lead_id) : null,
    studentName: row.student_name ? String(row.student_name) : null,
    contactName: row.contact_name ? String(row.contact_name) : null,
    phone: row.phone ? String(row.phone) : null,
    courseName: row.course_name ? String(row.course_name) : null,
    schoolName: row.school_name ? String(row.school_name) : null,
    roomName: row.room_name ? String(row.room_name) : null,
    teacherName: row.teacher_name ? String(row.teacher_name) : null,
    scheduledAt: row.scheduled_at ? new Date(row.scheduled_at).toISOString() : null,
    durationMinutes: row.duration_minutes ? Number(row.duration_minutes) : null,
    format: row.format === 'online' ? 'online' : row.format === 'offline' ? 'offline' : null,
    participantStatus: (row.participant_status as any) || 'invited',
    noShowReasonCode: row.no_show_reason_code ? String(row.no_show_reason_code) : null,
    noShowReasonNote: row.no_show_reason_note ? String(row.no_show_reason_note) : null,
    result: row.result ? String(row.result) : null,
    managerId: row.manager_id ? Number(row.manager_id) : null,
    managerName: row.manager_name ? String(row.manager_name) : null,
  }));
};
