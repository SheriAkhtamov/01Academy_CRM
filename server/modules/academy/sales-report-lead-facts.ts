/** Evidence of work and qualification, separate from imported lead descriptions. */
export const salesReportLeadFactsCte = `lead_audit AS (
  SELECT fact.* FROM audit_logs fact
  JOIN portfolio_leads lead ON lead.id = fact.entity_id
  CROSS JOIN report_clock clock
  WHERE fact.entity_type = 'academy_lead' AND fact.created_at <= clock.as_of
), qualified_leads AS (
  -- The criteria button is the only qualification fact; stage names never count.
  SELECT lead.id AS lead_id, lead.qualified_at
  FROM portfolio_leads lead CROSS JOIN report_clock clock
  WHERE lead.is_qualified AND lead.qualified_at >= $1 AND lead.qualified_at < $2
    AND lead.qualified_at <= clock.as_of
), qualified_lead_states AS (
  SELECT lead.id AS lead_id
  FROM portfolio_leads lead CROSS JOIN report_clock clock
  WHERE lead.is_qualified AND lead.qualified_at <= clock.as_of
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
