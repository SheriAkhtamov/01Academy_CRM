import type { Pool, PoolClient, QueryResultRow } from "pg";
import { createHash } from "node:crypto";
import type { LmsListOptions } from "@shared/contracts/lms";
import { LmsError, type LmsStaffActor } from "../domain/policy";
export type LmsSql = Pick<PoolClient, "query">;
export const rows = async <T>(
  sql: LmsSql,
  query: string,
  params: unknown[] = [],
): Promise<T[]> =>
  (await sql.query<QueryResultRow>(query, params)).rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.replace(/_([a-z])/g, (_match, letter: string) =>
          letter.toUpperCase(),
        ),
        value instanceof Date
          ? value.toISOString()
          : typeof value === "string" &&
              /^(id|.*_id|version|attempt_number|score|total_score|percent|best_percent|pass_percent|max_score)$/.test(
                key,
              ) &&
              /^\d+(\.\d+)?$/.test(value)
            ? Number(value)
            : value,
      ]),
    ),
  ) as T[];
export const one = async <T>(
  sql: LmsSql,
  query: string,
  params: unknown[] = [],
): Promise<T | null> => (await rows<T>(sql, query, params))[0] ?? null;
/** Cursor filtering is performed by PostgreSQL before projection or response limits. */
export function listRows<T>(
  sql: LmsSql,
  query: string,
  params: unknown[] = [],
  page?: LmsListOptions,
  enabledRuns?: number[],
): Promise<T[]> {
  if (!page) return rows<T>(sql, query, params);
  const cursor = params.length + 1;
  const limit = params.length + 2;
  const runs = params.length + 3;
  return rows<T>(
    sql,
    `SELECT entry.* FROM (${query}) entry WHERE ($${cursor}::bigint IS NULL OR entry.id<$${cursor}) ${enabledRuns ? `AND entry.run_id=ANY($${runs}::bigint[])` : ""} ORDER BY entry.id DESC LIMIT $${limit}`,
    [
      ...params,
      page.cursor ?? null,
      page.limit,
      ...(enabledRuns ? [enabledRuns] : []),
    ],
  );
}
export async function transaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export function hasImplicitStaffRunAccess(
  actor: LmsStaffActor,
  permission: string | readonly string[],
) {
  const permissions = typeof permission === "string" ? [permission] : permission;
  return (
    actor.isLeadership && permissions.some((name) => name !== "reviews.manage")
  );
}
export async function requireStaffRun(
  sql: LmsSql,
  actor: LmsStaffActor,
  runId: number,
  permission: string | readonly string[],
) {
  const row = await one<{ groupId: number }>(
    sql,
    `SELECT run.group_id FROM lms_group_runs run WHERE run.id=$1 AND ($2::boolean OR ($5::boolean AND EXISTS(SELECT 1 FROM academy_groups g JOIN academy_teachers teacher ON teacher.id=g.teacher_id WHERE g.id=run.group_id AND teacher.user_id=$3 AND teacher.status='active')) OR EXISTS(SELECT 1 FROM lms_staff_permissions grant_row WHERE grant_row.user_id=$3 AND grant_row.permission=ANY($4::text[])))`,
    [
      runId,
      hasImplicitStaffRunAccess(actor, permission),
      actor.userId,
      typeof permission === "string" ? [permission] : permission,
      actor.modules.includes("teacher"),
    ],
  );
  if (!row)
    throw new LmsError("lmsNotFound", 404);
  return row;
}
export const enrollmentVisibilitySql = (
  enrollment = "enrollment",
  publication = "publication.publish_at",
) =>
  `${enrollment}.student_id=$1 AND ${publication}>=${enrollment}.enrolled_at AND (${enrollment}.ended_at IS NULL OR ${publication}<${enrollment}.ended_at)`;
export const recipientEnrollmentVisibilitySql = (recipient = "recipient") =>
  `EXISTS(SELECT 1 FROM academy_student_group_enrollments publication_enrollment WHERE publication_enrollment.id=${recipient}.enrollment_id AND ${recipient}.opens_at>=publication_enrollment.enrolled_at AND (publication_enrollment.ended_at IS NULL OR ${recipient}.opens_at<publication_enrollment.ended_at))`;
export const recordEvent = async (
  sql: LmsSql,
  studentId: number,
  runId: number,
  type: string,
  objectId: number,
  eventKey: string,
  data: Record<string, unknown> = {},
) =>
  sql.query(
    `INSERT INTO lms_learning_events(student_id,run_id,type,object_id,event_key,data) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(event_key) DO NOTHING`,
    [studentId, runId, type, objectId, eventKey, JSON.stringify(data)],
  );
export type LmsAttachmentAuthorizer = (
  sql: LmsSql,
  actor: { portalAccountId?: number; userId?: number; studentId?: number },
  fileIds: number[],
  context: { runId: number; recipientId?: number },
) => Promise<void>;
export const denyUnintegratedFiles: LmsAttachmentAuthorizer = async (
  _sql,
  _actor,
  fileIds,
) => {
  if (fileIds.length) throw new LmsError("lmsFileNotReady", 409);
};

export async function recordStaffAudit(
  sql: LmsSql,
  actor: LmsStaffActor,
  runId: number | null,
  entityType: string,
  entityId: number,
  action: string,
  oldValue: unknown,
  newValue: unknown,
  reason?: string,
) {
  await sql.query(
    "INSERT INTO lms_learning_audit(user_id,run_id,entity_type,entity_id,action,old_value,new_value,reason,request_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)",
    [
      actor.userId,
      runId,
      entityType,
      entityId,
      action,
      JSON.stringify(oldValue ?? null),
      JSON.stringify(newValue ?? null),
      reason ?? null,
      actor.requestId ?? null,
    ],
  );
}

/** Authorization must be checked by the caller before replaying a saved command. */
export async function idempotentStaffCommand<T>(
  sql: LmsSql,
  actor: LmsStaffActor,
  runId: number | null,
  action: string,
  input: { idempotencyKey?: string },
  operation: () => Promise<T>,
): Promise<T> {
  if (!input.idempotencyKey) return operation();
  const commandIdentity = `lms-command:${actor.userId}:${runId}:${action}:${input.idempotencyKey}`;
  const commandId = Number.parseInt(
    createHash("sha256").update(commandIdentity).digest("hex").slice(0, 12),
    16,
  );
  await sql.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    commandIdentity,
  ]);
  const requestHash = commandRequestHash(input);
  const prior = await one<{ matches: boolean; response: T }>(
    sql,
    "SELECT new_value->>'requestHash'=$5 AS matches,new_value->'response' AS response FROM lms_learning_audit WHERE user_id=$1 AND run_id IS NOT DISTINCT FROM $2::bigint AND entity_type='idempotent_command' AND entity_id=$6 AND action=$3 AND new_value->>'idempotencyKey'=$4 ORDER BY id DESC LIMIT 1",
    [actor.userId, runId, action, input.idempotencyKey, requestHash, commandId],
  );
  if (prior) {
    if (!prior.matches) throw new LmsError("lmsVersionConflict", 409);
    return prior.response;
  }
  const response = await operation();
  await recordStaffAudit(
    sql,
    actor,
    runId,
    "idempotent_command",
    commandId,
    action,
    null,
    { idempotencyKey: input.idempotencyKey, requestHash, response },
  );
  return response;
}
export function commandRequestHash(value: unknown) {
  const canonical = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(canonical)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([key, entry]) => [key, canonical(entry)]),
          )
        : item;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export async function idempotentPortalCommand<T>(
  sql: LmsSql,
  actor: { portalAccountId: number; studentId: number },
  runId: number,
  action: string,
  targetId: number,
  input: { idempotencyKey?: string },
  operation: () => Promise<T>,
): Promise<T> {
  if (!input.idempotencyKey) return operation();
  const eventKey = `portal-command:${actor.portalAccountId}:${actor.studentId}:${runId}:${action}:${targetId}:${input.idempotencyKey}`;
  await sql.query("SELECT pg_advisory_xact_lock(hashtext($1))", [eventKey]);
  const requestHash = commandRequestHash(input);
  const prior = await one<{ data: { requestHash: string; response: T } }>(
    sql,
    "SELECT data FROM lms_learning_events WHERE event_key=$1",
    [eventKey],
  );
  if (prior) {
    if (prior.data.requestHash !== requestHash)
      throw new LmsError("lmsVersionConflict", 409);
    return prior.data.response;
  }
  const response = await operation();
  const objectId =
    response && typeof response === "object" && "id" in response
      ? Number(response.id)
      : targetId;
  await recordEvent(
    sql,
    actor.studentId,
    runId,
    "portal_command_completed",
    Number.isFinite(objectId) ? objectId : targetId,
    eventKey,
    { requestHash, response, accountId: actor.portalAccountId },
  );
  return response;
}
