/**
 * Dates select newly created leads; all their results are observed as of now.
 * The same current manager/funnel portfolio is used by metrics and drill-downs.
 * $1/$2 are the inclusive/exclusive creation bounds, $3/$4 the portfolio filters.
 */
export const salesCohortCte = `WITH report_clock AS (
  SELECT timezone('UTC', now()) AS as_of
), cohort_leads AS (
  SELECT lead.* FROM academy_leads lead CROSS JOIN report_clock clock
  WHERE lead.created_at >= $1 AND lead.created_at < $2
    AND lead.created_at <= clock.as_of
    AND ($3::int IS NULL OR lead.manager_id = $3)
    AND ($4::int IS NULL OR lead.funnel_id = $4)
)`;
