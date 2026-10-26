// Codes created by funnel migration retain their qualification identity even
// after a label is renamed. Snapshot names also cover custom equivalent stages.
const qualifiedStage = (code: string, name: string) => `(${code} ~ '^qualified($|_f[0-9]+_s[0-9]+)'
  OR LOWER(TRANSLATE(BTRIM(${name}), 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ',
    'абвгдеёжзийклмнопрстуфхцчшщъыьэюя')) IN ('qualified', 'qualification passed', 'квалифицирован',
    'квалифицированные', 'квалификация пройдена'))`;

/** Evidence of work and qualification, separate from imported lead descriptions. */
export const salesReportLeadFactsCte = `lead_audit AS (
  SELECT fact.* FROM audit_logs fact
  JOIN portfolio_leads lead ON lead.id = fact.entity_id
  CROSS JOIN report_clock clock
  WHERE fact.entity_type = 'academy_lead' AND fact.created_at <= clock.as_of
), qualification_events AS (
  SELECT history.lead_id, history.entered_at AS happened_at, true AS qualified
  FROM academy_lead_stage_history history
  JOIN portfolio_leads lead ON lead.id = history.lead_id
  CROSS JOIN report_clock clock
  WHERE COALESCE(history.to_funnel_id, lead.funnel_id) = lead.funnel_id
    AND history.entered_at <= clock.as_of
    AND ${qualifiedStage('history.to_status_code', 'history.to_status_name')}
  UNION ALL
  SELECT fact.entity_id, fact.created_at, fact.action = $5
  FROM lead_audit fact JOIN portfolio_leads lead ON lead.id = fact.entity_id
  WHERE fact.action IN ($5, $6)
    AND fact.new_values->0->>'funnelId' = lead.funnel_id::text
), valid_qualifications AS (
  SELECT qualification.lead_id, qualification.happened_at
  FROM qualification_events qualification
  WHERE qualification.qualified AND NOT EXISTS (
    SELECT 1 FROM qualification_events revoked
    WHERE revoked.lead_id = qualification.lead_id AND NOT revoked.qualified
      AND revoked.happened_at >= qualification.happened_at
  )
), qualified_leads AS (
  SELECT lead_id, MIN(happened_at) AS qualified_at FROM valid_qualifications
  WHERE happened_at >= $1 AND happened_at < $2 GROUP BY lead_id
), qualified_lead_states AS (
  SELECT DISTINCT lead_id FROM valid_qualifications
  UNION
  -- A legacy current stage can identify the state, but cannot invent an event date.
  SELECT lead.id FROM portfolio_leads lead
  LEFT JOIN academy_lead_statuses stage ON stage.code = lead.status_code AND stage.funnel_id = lead.funnel_id
  WHERE ${qualifiedStage('lead.status_code', 'stage.name')}
    AND NOT EXISTS (SELECT 1 FROM qualification_events event WHERE event.lead_id = lead.id)
), manual_lead_events AS (
  SELECT fact.entity_id AS lead_id, fact.created_at AS happened_at
  FROM lead_audit fact
  WHERE fact.user_id IS NOT NULL AND fact.created_at >= $1 AND fact.created_at < $2
    AND (fact.action = 'ADD_ACADEMY_LEAD_COMMENT'
      OR (fact.action = 'UPDATE_ACADEMY_LEAD' AND (
        (NULLIF(BTRIM(fact.new_values->0->>'comment'), '') IS NOT NULL
          AND fact.new_values->0->>'comment' IS DISTINCT FROM fact.old_values->0->>'comment')
        OR (fact.new_values->0->>'statusCode' IS NOT NULL
          AND fact.old_values->0->>'statusCode' IS NOT NULL
          AND fact.new_values->0->>'statusCode' <> fact.old_values->0->>'statusCode')
      )))
), closure_events AS (
  SELECT fact.entity_id AS lead_id, fact.created_at AS closed_at, fact.id AS event_id,
    NULLIF(BTRIM(fact.new_values->0->>'archiveReason'), '') AS reason
  FROM lead_audit fact
  WHERE fact.action IN ('ARCHIVE_ACADEMY_LEAD', 'BULK_ARCHIVE_ACADEMY_LEAD')
), latest_closure AS (
  SELECT DISTINCT ON (lead_id) lead_id, closed_at, reason
  FROM closure_events ORDER BY lead_id, closed_at DESC, event_id DESC
), closed_leads AS (
  SELECT lead.id AS lead_id, COALESCE(lead.archived_at, latest.closed_at) AS closed_at,
    COALESCE(NULLIF(BTRIM(lead.archive_reason), ''), latest.reason, 'unspecified') AS reason
  FROM portfolio_leads lead LEFT JOIN latest_closure latest ON latest.lead_id = lead.id
  CROSS JOIN report_clock clock
  WHERE lead.is_archived = true
    AND COALESCE(lead.archived_at, latest.closed_at) >= $1
    AND COALESCE(lead.archived_at, latest.closed_at) < $2
    AND COALESCE(lead.archived_at, latest.closed_at) <= clock.as_of
)`;
