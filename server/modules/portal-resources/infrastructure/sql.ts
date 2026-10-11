import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { createHash } from 'node:crypto';
import type { PortalActorContext } from '../../portal-identity/domain/actor-context';
import { PortalResourceError } from '../domain/policy';
export type ResourceSql = Pick<PoolClient, 'query'>;
export const resourceRows = async <T>(sql: ResourceSql, query: string, params: unknown[] = []): Promise<T[]> => (
  await sql.query<QueryResultRow>(query, params)
).rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [
  key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase()),
  value instanceof Date ? value.toISOString() : typeof value === 'string' && /^(id|.*_id|version|portal_version|size_bytes|amount_uzs|total_bytes|count)$/.test(key) && /^\d+$/.test(value) ? Number(value) : value,
]))) as T[];
export const resourceOne = async <T>(sql: ResourceSql, query: string, params: unknown[] = []): Promise<T | null> => (await resourceRows<T>(sql, query, params))[0] ?? null;
export const resourceTransaction = async <T>(pool: Pool, operation: (sql: PoolClient) => Promise<T>): Promise<T> => {
  const sql = await pool.connect();
  try { await sql.query('BEGIN'); const result = await operation(sql); await sql.query('COMMIT'); return result; }
  catch (error) { await sql.query('ROLLBACK'); throw error; }
  finally { sql.release(); }
};
export const checkResourceLink = async (sql: ResourceSql, actor: PortalActorContext, permission: string) => {
  const link = await resourceOne(sql, `SELECT link.id FROM portal_student_links link JOIN portal_accounts account ON account.id=link.account_id
    WHERE link.id=$1 AND link.account_id=$2 AND link.student_id=$3 AND link.kind=$4 AND link.status='active'
    AND account.status='active' AND (link.expires_at IS NULL OR link.expires_at>now())
    AND (link.permissions ? $5 OR (link.kind='self' AND $5='finance.read' AND EXISTS(SELECT 1 FROM lms_school_settings WHERE settings->>'childFinanceVisible'='true')))
    AND EXISTS(SELECT 1 FROM portal_student_identity identity WHERE identity.student_id=link.student_id AND identity.classification=$6)
    AND (link.kind='self' OR EXISTS(SELECT 1 FROM portal_student_identity identity WHERE identity.student_id=link.student_id AND identity.classification='minor')
      OR EXISTS(SELECT 1 FROM portal_consents consent WHERE consent.link_id=link.id AND consent.revoked_at IS NULL AND consent.method IN ('in_person','portal') AND consent.permissions @> link.permissions))
    FOR SHARE OF link,account`, [actor.linkId, actor.portalAccountId, actor.studentId, actor.kind, permission, actor.studentClassification]);
  if (!link) throw new PortalResourceError('portalAccessDenied', 403);
};
export const resourceAudit = async (sql: ResourceSql, actor: { portalAccountId?: number; userId?: number; studentId?: number;requestId?:string }, action: string, entityType: string, entityId: number, changes: Record<string, unknown> = {}) => {
  await sql.query(`INSERT INTO lms_resource_audit(portal_account_id,staff_user_id,student_id,action,entity_type,entity_id,changes,request_id) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [actor.portalAccountId ?? null, actor.userId ?? null, actor.studentId ?? null, action, entityType, entityId, JSON.stringify(changes),actor.requestId ?? null]);
};
export const resourceCreationReceipt = async (sql: ResourceSql, actor: PortalActorContext, action: string, requestKey: string | undefined, input: Record<string, unknown>) => {
  if (!requestKey) return { entityId: null, changes: {} as Record<string, unknown> };
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)])) : value;
  const requestHash = createHash('sha256').update(JSON.stringify(canonical({ ...input, idempotencyKey: undefined, studentId: actor.studentId }))).digest('hex');
  await sql.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`resource-create:${actor.portalAccountId}:${action}:${requestKey}`]);
  const receipt = await resourceOne<{ entityId: number; changes: { requestHash: string } }>(sql,
    "SELECT entity_id,changes FROM lms_resource_audit WHERE portal_account_id=$1 AND action=$2 AND changes->>'requestKey'=$3", [actor.portalAccountId, action, requestKey]);
  if (receipt && receipt.changes.requestHash !== requestHash) throw new PortalResourceError('portalVersionConflict', 409);
  return { entityId: receipt?.entityId ?? null, changes: { requestKey, requestHash } as Record<string, unknown> };
};
