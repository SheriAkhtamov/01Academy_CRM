import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { portalDeliveryPageSchema, type PortalDeliveryKind, type PortalDeliveryQuery, type PortalDeliveryRetry } from "@shared/contracts/portal-delivery-management";
import type { PortalStaffActor } from "../../portal-identity/domain/actor-context";
import { PortalError } from "../../portal-identity/domain/access-policy";

type Sql = Pick<PoolClient, "query">;
type FailureRow = {
  id: string; kind: PortalDeliveryKind; account_id: number; login: string; full_name: string; recipient: string;
  template: "invitation" | "recovery" | "email_change" | "email_changed" | "notification";
  created_at: Date; scheduled_at: Date; locked_at: Date | null; attempts: number; last_error_code: string | null;
  expires_at: Date | null; state: string; encrypted_payload?: string | null;
  payload_signature: string;
};
export type PortalDeliveryManagementOptions = {
  pool: Pool;
  enabled: boolean | (() => boolean);
  now?: () => number;
  canRetryIdentity: (id: number, sql: Sql) => Promise<boolean>;
  canRetryResource: (id: number, sql: Sql) => Promise<boolean>;
};
const cursorSchema = z.object({ at: z.string().datetime({ offset: true }), kind: z.enum(["identity", "resource"]), id: z.number().int().positive() }).strict();
const encodeCursor = (row: FailureRow) => Buffer.from(JSON.stringify({ at: row.created_at.toISOString(), kind: row.kind, id: Number(row.id) })).toString("base64url");
const version = (row: FailureRow) => createHash("sha256").update(JSON.stringify([
  row.kind, row.id, row.state, row.attempts, row.scheduled_at.toISOString(), row.locked_at?.toISOString() ?? null,
  row.last_error_code, row.expires_at?.toISOString() ?? null, row.encrypted_payload ?? null,
  row.payload_signature,
])).digest("hex");
const assertAdmin = (actor: PortalStaffActor) => {
  if (!actor.canManageAccess || !actor.modules.includes("administration")) throw new PortalError("portalAccessDenied", 403);
};
const identitySignature = "jsonb_build_array(outbox.account_id,outbox.recipient,outbox.template,outbox.invitation_id,outbox.dedupe_key,outbox.encrypted_payload)::text";
const resourceSignature = "jsonb_build_array(outbox.account_id,outbox.link_id,outbox.category,outbox.code,outbox.params,outbox.href,outbox.event_key,outbox.required_permission,outbox.channel,outbox.urgent,account.email)::text";
const selection = `SELECT outbox.id,'identity'::text AS kind,outbox.account_id,account.login,account.full_name,outbox.recipient,outbox.template,
  outbox.created_at,outbox.available_at AS scheduled_at,outbox.locked_at,outbox.attempts,outbox.last_error_code,outbox.expires_at,outbox.status AS state,outbox.encrypted_payload
  ,${identitySignature} AS payload_signature
  FROM portal_identity_mail_outbox outbox JOIN portal_accounts account ON account.id=outbox.account_id WHERE outbox.status='failed'
  UNION ALL SELECT outbox.id,'resource'::text AS kind,outbox.account_id,account.login,account.full_name,COALESCE(account.email,'') AS recipient,'notification'::text AS template,
  outbox.created_at,outbox.deliver_after AS scheduled_at,outbox.locked_at,outbox.attempts,outbox.last_error_code,NULL::timestamptz AS expires_at,outbox.state,NULL::text AS encrypted_payload
  ,${resourceSignature} AS payload_signature
  FROM lms_resource_outbox outbox JOIN portal_accounts account ON account.id=outbox.account_id WHERE outbox.state='failed' AND outbox.channel='email'`;

export class PortalDeliveryManagement {
  constructor(private readonly options: PortalDeliveryManagementOptions) {}
  private enabled() { return typeof this.options.enabled === "function" ? this.options.enabled() : this.options.enabled; }
  private guard(actor: PortalStaffActor) {
    if (!this.enabled()) throw new PortalError("portalUnavailable", 404);
    assertAdmin(actor);
  }
  private retryAllowed(row: FailureRow, sql: Sql) {
    return row.kind === "identity" ? this.options.canRetryIdentity(Number(row.id), sql) : this.options.canRetryResource(Number(row.id), sql);
  }
  async list(actor: PortalStaffActor, query: PortalDeliveryQuery) {
    this.guard(actor);
    let cursor: z.infer<typeof cursorSchema> | null = null;
    if (query.cursor) {
      try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"))); }
      catch { throw new PortalError("portalInvalidData", 400); }
    }
    const sql = await this.options.pool.connect();
    try {
      await sql.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await sql.query("SET LOCAL statement_timeout='15000'");
      const result = await sql.query<FailureRow>(`WITH failures AS (${selection})
        SELECT * FROM failures WHERE ($1='all' OR kind=$1)
          AND ($2::timestamptz IS NULL OR (created_at,kind,id)<($2::timestamptz,$3::text,$4::bigint))
        ORDER BY created_at DESC,kind DESC,id DESC LIMIT $5`,
        [query.kind, cursor?.at ?? null, cursor?.kind ?? null, cursor?.id ?? null, query.limit + 1]);
      const rows = result.rows.slice(0, query.limit);
      const items = [];
      for (const row of rows) items.push({
        id: Number(row.id), kind: row.kind,
        account: { id: Number(row.account_id), login: row.login, fullName: row.full_name },
        recipient: row.recipient, template: row.template, createdAt: row.created_at.toISOString(),
        reason: row.last_error_code === "delivery_interrupted" ? "delivery_interrupted" : "delivery_failed",
        version: version(row), canRetry: await this.retryAllowed(row, sql),
      });
      await sql.query("COMMIT");
      return portalDeliveryPageSchema.parse({ items, hasMore: result.rows.length > query.limit,
        nextCursor: result.rows.length > query.limit && rows.length ? encodeCursor(rows[rows.length - 1]) : null });
    } catch (error) { await sql.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { sql.release(); }
  }
  async retry(actor: PortalStaffActor, kind: PortalDeliveryKind, id: number, command: PortalDeliveryRetry) {
    this.guard(actor);
    const sql = await this.options.pool.connect();
    try {
      await sql.query("BEGIN");
      await sql.query("SET LOCAL statement_timeout='15000'");
      await sql.query("SET LOCAL lock_timeout='3000'");
      await sql.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`portal-delivery-retry:${actor.staffId}:${command.idempotencyKey}`]);
      const replay = (await sql.query<{ details: { kind: string; deliveryId: number; version: string } }>(
        "SELECT details FROM portal_access_audit WHERE actor_kind='staff' AND staff_id=$1 AND action='EMAIL_DELIVERY_RETRIED' AND details->>'idempotencyKey'=$2 ORDER BY id LIMIT 1",
        [actor.staffId, command.idempotencyKey],
      )).rows[0];
      if (replay) {
        if (replay.details.kind !== kind || replay.details.deliveryId !== id || replay.details.version !== command.version) throw new PortalError("portalDeliveryConflict", 409);
        await sql.query("COMMIT");
        return { queued: true as const, replayed: true };
      }
      const source = kind === "identity" ? "portal_identity_mail_outbox" : "lms_resource_outbox";
      const stateColumn = kind === "identity" ? "status" : "state";
      const scheduledColumn = kind === "identity" ? "available_at" : "deliver_after";
      const row = (await sql.query<FailureRow>(`SELECT outbox.id,$2::text AS kind,outbox.account_id,outbox.${stateColumn} AS state,outbox.attempts,outbox.${scheduledColumn} AS scheduled_at,outbox.locked_at,outbox.last_error_code,
        ${kind === "identity" ? "outbox.expires_at,outbox.encrypted_payload" : "NULL::timestamptz AS expires_at,NULL::text AS encrypted_payload"},
        ${kind === "identity" ? identitySignature : resourceSignature} AS payload_signature
        FROM ${source} outbox JOIN portal_accounts account ON account.id=outbox.account_id WHERE outbox.id=$1 ${kind === "resource" ? "AND outbox.channel='email'" : ""} FOR UPDATE OF outbox`, [id, kind])).rows[0];
      if (!row) throw new PortalError("portalDeliveryRetryUnavailable", 404);
      if (row.state !== "failed" || row.locked_at || version(row) !== command.version) throw new PortalError("portalDeliveryConflict", 409);
      this.guard(actor);
      if (!(await this.retryAllowed(row, sql))) throw new PortalError("portalDeliveryRetryUnavailable", 409);
      this.guard(actor);
      const now = new Date(this.options.now?.() ?? Date.now());
      const updated = await sql.query(`UPDATE ${source} SET ${stateColumn}='pending',attempts=0,locked_at=NULL,last_error_code=NULL,${scheduledColumn}=$2
        WHERE id=$1 AND ${stateColumn}='failed' AND locked_at IS NULL RETURNING id`, [id, now]);
      if (!updated.rowCount) throw new PortalError("portalDeliveryConflict", 409);
      await sql.query(`INSERT INTO portal_access_audit(actor_kind,staff_id,action,request_id,details,created_at)
        VALUES('staff',$1,'EMAIL_DELIVERY_RETRIED',$2,$3::jsonb,$4)`,
        [actor.staffId, actor.requestId ?? null, JSON.stringify({ kind, deliveryId: id, version: command.version, idempotencyKey: command.idempotencyKey, priorAttempts: row.attempts }), now]);
      await sql.query("COMMIT");
      return { queued: true as const, replayed: false };
    } catch (error) { await sql.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { sql.release(); }
  }
}
