import type { Pool } from "pg";

/** Observe CRM transitions separately from staff decisions about the learning run. */
export async function reconcileCrmGroupLifecycle(pool: Pool, enabledRuns: number[]) {
  if (!enabledRuns.length) return { completed: 0 };
  const result = await pool.query<{ id: number; status: string }>(
    `WITH source AS MATERIALIZED (
      SELECT run.id AS run_id,g.id AS group_id,g.status AS group_status,
        previous.new_value->>'status' AS previous_group_status,manual.status AS manual_status,
        LEAST(now(),COALESCE((SELECT MAX(lesson.scheduled_at+lesson.duration_minutes*interval '1 minute')
          FROM academy_lessons lesson WHERE lesson.group_id=g.id AND lesson.status='conducted'),g.end_date,g.updated_at,now())) AS completed_at
      FROM lms_group_runs run JOIN academy_groups g ON g.id=run.group_id
      LEFT JOIN LATERAL (
        SELECT audit.new_value FROM lms_learning_audit audit
        WHERE audit.entity_type='crm_group_lifecycle' AND audit.entity_id=g.id
          AND audit.action='crm.lifecycle.observed' ORDER BY audit.id DESC LIMIT 1
      ) previous ON true
      LEFT JOIN LATERAL (
        SELECT audit.new_value->>'status' AS status FROM lms_learning_audit audit
        WHERE audit.entity_type='group_run' AND audit.entity_id=run.id AND audit.action='update'
          AND audit.old_value->>'status' IS DISTINCT FROM audit.new_value->>'status'
        ORDER BY audit.id DESC LIMIT 1
      ) manual ON true
      WHERE run.id=ANY($1::bigint[])
    ), updated AS (
      UPDATE lms_group_runs run SET
        status=CASE WHEN source.group_status='completed' THEN 'completed' ELSE 'active' END,
        completed_at=CASE WHEN source.group_status='completed' THEN COALESCE(run.completed_at,source.completed_at) ELSE NULL END,
        access_until=NULL,version=run.version+1
      FROM source WHERE run.id=source.run_id
        AND ((run.status='active' AND source.group_status='completed')
          OR (run.status='completed' AND source.group_status IN('open','in_progress','frozen')
            AND (source.previous_group_status='completed'
              OR (source.previous_group_status IS NULL AND source.manual_status IS DISTINCT FROM 'completed'))))
      RETURNING run.id,run.status
    ), observed AS (
      INSERT INTO lms_learning_audit(user_id,run_id,entity_type,entity_id,action,new_value)
      SELECT NULL,source.run_id,'crm_group_lifecycle',source.group_id,'crm.lifecycle.observed',
        jsonb_build_object('status',source.group_status)
      FROM source WHERE source.previous_group_status IS DISTINCT FROM source.group_status
      RETURNING id
    ) SELECT id,status FROM updated`,
    [enabledRuns],
  );
  return { completed: result.rows.filter((run) => run.status === "completed").length };
}
