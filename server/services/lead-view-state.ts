import type { Pool, PoolClient } from 'pg';
import { getAssignedModules, hasLeadershipAccess, type ModuleAccessSource } from '@shared/academy';
import { pool } from '../db';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export type LeadViewer = {
  id: number;
  module?: string | null;
  modules?: readonly string[] | null;
};

export type LeadViewState = {
  leadId: number;
  firstViewedAt: Date | null;
  firstViewedBy: number | null;
};

/**
 * A lead card carries the "new" marker for the whole company until somebody
 * opens it, so the read state lives on the lead row instead of per employee.
 */
export const UNVIEWED_LEAD_SQL = `(
  lead.first_viewed_at IS NULL
  AND COALESCE(lead.is_archived, false) = false
)`;

// A sales employee only ever sees their own and unassigned leads, so counting
// every unviewed lead would announce cards they cannot open.
const scopesToOwnLeads = (viewer: LeadViewer) => {
  const modules = getAssignedModules(viewer as ModuleAccessSource);
  const seesAllLeads = hasLeadershipAccess(viewer as ModuleAccessSource)
    || modules.includes('marketing');
  return modules.includes('sales') && !seesAllLeads;
};

export const countUnviewedLeads = async (
  viewer: LeadViewer,
  client: Queryable = pool,
): Promise<number> => {
  const ownLeadsOnly = scopesToOwnLeads(viewer);
  const result = await client.query<{ count: number | string }>(
    `SELECT COUNT(*)::int AS count
     FROM academy_leads lead
     WHERE ${UNVIEWED_LEAD_SQL}
       ${ownLeadsOnly ? 'AND (lead.manager_id = $1 OR lead.manager_id IS NULL)' : ''}`,
    ownLeadsOnly ? [viewer.id] : [],
  );

  return Number(result.rows[0]?.count ?? 0);
};

export const markLeadViewed = async (
  leadId: number,
  viewerId: number,
  client: Queryable = pool,
): Promise<LeadViewState> => {
  // The first viewer wins: opening an already seen lead must not rewrite who
  // cleared the marker, and must not write at all. `updated_at` stays untouched
  // because viewing a lead is not an edit.
  const result = await client.query<{
    firstViewedAt: Date | null;
    firstViewedBy: number | null;
  }>(
    `WITH marked AS (
       UPDATE academy_leads
       SET first_viewed_at = NOW(), first_viewed_by = $2
       WHERE id = $1 AND first_viewed_at IS NULL
       RETURNING id, first_viewed_at, first_viewed_by
     )
     SELECT COALESCE(marked.first_viewed_at, lead.first_viewed_at) AS "firstViewedAt",
            COALESCE(marked.first_viewed_by, lead.first_viewed_by) AS "firstViewedBy"
     FROM academy_leads lead
     LEFT JOIN marked ON marked.id = lead.id
     WHERE lead.id = $1`,
    [leadId, viewerId],
  );

  return {
    leadId,
    firstViewedAt: result.rows[0]?.firstViewedAt ?? null,
    firstViewedBy: result.rows[0]?.firstViewedBy ?? null,
  };
};
