/**
 * Manager/funnel select the current portfolio independently of lead age.
 * Dates select events; creation dates apply only to the new-lead metric.
 * $1/$2 are inclusive/exclusive date bounds, $3/$4 the portfolio filters.
 */
export const salesReportScopeCte = `WITH report_clock AS (
  SELECT timezone('UTC', now()) AS as_of
), portfolio_leads AS (
  SELECT lead.* FROM academy_leads lead CROSS JOIN report_clock clock
  WHERE lead.created_at <= clock.as_of
    AND ($3::int IS NULL OR lead.manager_id = $3)
    AND ($4::int IS NULL OR lead.funnel_id = $4)
), new_leads AS (
  SELECT * FROM portfolio_leads WHERE created_at >= $1 AND created_at < $2
)`;
