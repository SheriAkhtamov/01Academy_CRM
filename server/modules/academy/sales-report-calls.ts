/** One row per recorded call. Client/provider updates share a row in telephony_calls. */
export const salesReportCallsCte = `period_calls AS (
  SELECT phone_call.*, lead.id AS report_lead_id
  FROM telephony_calls phone_call
  LEFT JOIN academy_students student
    ON phone_call.contact_type = 'student' AND student.id = phone_call.contact_id
  JOIN portfolio_leads lead ON lead.id = COALESCE(phone_call.lead_id,
    CASE WHEN phone_call.contact_type = 'lead' THEN phone_call.contact_id END, student.lead_id)
  CROSS JOIN report_clock clock
  WHERE phone_call.started_at <= clock.as_of
    AND phone_call.started_at >= $1 AND phone_call.started_at < $2
    AND phone_call.direction IN ('incoming', 'outgoing')
    AND COALESCE(phone_call.metadata->>'actualDialPerformed', 'true') <> 'false'
), ordered_calls AS (
  SELECT period_calls.*,
    COUNT(*) FILTER (WHERE direction = 'outgoing') OVER (
      PARTITION BY report_lead_id ORDER BY started_at, id ROWS UNBOUNDED PRECEDING
    ) AS outgoing_attempt_number
  FROM period_calls
), first_reached_calls AS (
  SELECT DISTINCT ON (report_lead_id)
    report_lead_id, direction, outgoing_attempt_number, started_at
  FROM ordered_calls WHERE talk_seconds > 0
  ORDER BY report_lead_id, started_at, id
), outgoing_attempts AS (
  SELECT report_lead_id, COUNT(*) FILTER (WHERE direction = 'outgoing')::int AS count
  FROM period_calls GROUP BY report_lead_id
)`;
