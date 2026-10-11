import crypto from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { decryptPortalMail } from "./crypto";

export type PortalIdentityMailDelivery = {
  accountId: number;
  invitationId: number | null;
  recipient: string;
  template: "invitation" | "recovery" | "email_change" | "email_changed";
  locale: "ru" | "en";
  url?: string;
  deliveryKey?: string;
};
type MailRow = {
  id: string;
  account_id: number;
  recipient: string;
  template: PortalIdentityMailDelivery["template"];
  encrypted_payload: string;
  expires_at: Date;
  invitation_id: number | null;
  attempts: number;
  locked_at: Date;
};
export type PortalIdentityMailWorkerOptions = {
  pool: Pool;
  encryptionKey: string;
  send: (mail: PortalIdentityMailDelivery) => Promise<boolean>;
  now?: () => number;
  batchSize?: number;
  canDeliver?: (mail: {
    accountId: number;
    template: PortalIdentityMailDelivery["template"];
    invitationId: number | null;
  }) => boolean | Promise<boolean>;
};

export class PortalIdentityMailWorker {
  private running = false;
  constructor(private readonly options: PortalIdentityMailWorkerOptions) {}
  private async transaction<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await this.options.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async runOnce(): Promise<{ sent: number; failed: number; expired: number }> {
    if (this.running) return { sent: 0, failed: 0, expired: 0 };
    this.running = true;
    const now = this.options.now?.() ?? Date.now();
    const result = { sent: 0, failed: 0, expired: 0 };
    try {
      const expire = await this.options.pool.query(
        `UPDATE portal_identity_mail_outbox SET status='expired',encrypted_payload=NULL,last_error_code=NULL WHERE expires_at<=$1 AND status IN ('pending','delivering','failed') RETURNING id`,
        [new Date(now)],
      );
      result.expired = expire.rowCount ?? 0;
      await this.options.pool.query(
        `UPDATE portal_invitations SET status='expired' WHERE expires_at<=$1 AND status IN ('created','sent','delivery_failed')`,
        [new Date(now)],
      );
      await this.options.pool.query(
        `UPDATE portal_identity_mail_outbox SET status='pending',locked_at=NULL WHERE status='delivering' AND locked_at<$1 AND attempts<5 AND expires_at>$2`,
        [new Date(now - 5 * 60_000), new Date(now)],
      );
      await this.options.pool.query(
        `UPDATE portal_identity_mail_outbox SET status='failed',locked_at=NULL,last_error_code='delivery_interrupted' WHERE status='delivering' AND locked_at<$1 AND attempts>=5`,
        [new Date(now - 5 * 60_000)],
      );
      const ceiling = (await this.options.pool.query<{ id: string }>(
        "SELECT COALESCE(max(id),0)::text AS id FROM portal_identity_mail_outbox WHERE status='pending' AND available_at<=$1 AND expires_at>$1 AND attempts<5",
        [new Date(now)],
      )).rows[0].id;
      const visited: string[] = [];
      for (let index = 0; index < (this.options.batchSize ?? 20); index++) {
        const claimTime = this.options.now?.() ?? Date.now();
        const row = (await this.options.pool.query<MailRow>(
          `WITH candidate AS (
            SELECT id FROM portal_identity_mail_outbox
            WHERE status='pending' AND available_at<=$1 AND expires_at>$1 AND attempts<5
              AND id<=$2::bigint AND NOT(id=ANY($3::bigint[]))
            ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1
          ) UPDATE portal_identity_mail_outbox mail SET status='delivering',locked_at=$1,attempts=mail.attempts+1
            FROM candidate WHERE mail.id=candidate.id AND mail.status='pending' RETURNING mail.*`,
          [new Date(claimTime), ceiling, visited],
        )).rows[0];
        if (!row) break;
        visited.push(row.id);
        let valid = false;
        let delivered = false;
        let payload: Record<string, unknown> = {};
        try {
          payload = decryptPortalMail(
            row.encrypted_payload,
            this.options.encryptionKey,
          );
          valid = await this.isDeliverable(row, payload, this.options.now?.() ?? Date.now());
          const current = valid && (await this.options.pool.query(
            `SELECT 1 FROM portal_identity_mail_outbox WHERE id=$1 AND status='delivering' AND locked_at=$2 AND attempts=$3
              AND expires_at>$4 AND locked_at>$4::timestamptz-interval '5 minutes'`,
            [row.id, row.locked_at, row.attempts, new Date(this.options.now?.() ?? Date.now())],
          )).rowCount === 1;
          if (current)
            delivered = await this.options.send({
              accountId: row.account_id,
              invitationId: row.invitation_id,
              recipient: row.recipient,
              template: row.template,
              locale: payload.locale === "en" ? "en" : "ru",
              url: typeof payload.url === "string" ? payload.url : undefined,
              deliveryKey: `portal-identity:${row.id}`,
            });
          else if (valid) continue;
        } catch {
          valid = true;
        }
        if (!valid) {
          const expired = await this.options.pool.query(
            `UPDATE portal_identity_mail_outbox SET status='expired',encrypted_payload=NULL,locked_at=NULL,last_error_code=NULL
              WHERE id=$1 AND status='delivering' AND locked_at=$2 AND attempts=$3`,
            [row.id, row.locked_at, row.attempts],
          );
          result.expired += expired.rowCount ?? 0;
          continue;
        }
        const recorded = await this.transaction(async (client) => {
          if (delivered) {
            const changed = await client.query(
              `UPDATE portal_identity_mail_outbox SET status='sent',encrypted_payload=NULL,delivered_at=$2,locked_at=NULL,last_error_code=NULL
                WHERE id=$1 AND status='delivering' AND locked_at=$3 AND attempts=$4`,
              [row.id, new Date(this.options.now?.() ?? Date.now()), row.locked_at, row.attempts],
            );
            if (!changed.rowCount) return false;
            if (row.invitation_id)
              await client.query(
                `UPDATE portal_invitations SET status='sent' WHERE id=$1 AND status IN ('created','delivery_failed')`,
                [row.invitation_id],
              );
          } else {
            const exhausted = row.attempts >= 5;
            const changed = await client.query(
              `UPDATE portal_identity_mail_outbox SET status=$2,available_at=$3,locked_at=NULL,last_error_code='delivery_failed'
                WHERE id=$1 AND status='delivering' AND locked_at=$4 AND attempts=$5`,
              [
                row.id,
                exhausted ? "failed" : "pending",
                new Date((this.options.now?.() ?? Date.now()) + 30_000 * Math.pow(2, row.attempts - 1)),
                row.locked_at,
                row.attempts,
              ],
            );
            if (!changed.rowCount) return false;
            if (row.invitation_id)
              await client.query(
                `UPDATE portal_invitations SET status='delivery_failed' WHERE id=$1 AND status IN ('created','sent','delivery_failed')`,
                [row.invitation_id],
              );
          }
          return true;
        });
        if (recorded && delivered) result.sent++;
        else if (recorded) result.failed++;
      }
      // Hygiene is independent of feature activity; no bearer tokens or request identifiers are logged.
      await this.options.pool.query(
        "DELETE FROM portal_sessions WHERE absolute_expires_at<=$1 OR last_seen_at<$2",
        [new Date(now), new Date(now - 24 * 60 * 60 * 1000)],
      );
      await this.options.pool.query(
        "DELETE FROM portal_rate_limits WHERE reset_at<$1",
        [new Date(now - 24 * 60 * 60 * 1000)],
      );
      return result;
    } finally {
      this.running = false;
    }
  }
  private async isDeliverable(
    row: MailRow,
    payload: Record<string, unknown>,
    now: number,
    sql: Pick<PoolClient, "query"> = this.options.pool,
  ): Promise<boolean> {
    if (
      this.options.canDeliver &&
      !(await this.options.canDeliver({
        accountId: row.account_id,
        template: row.template,
        invitationId: row.invitation_id,
      }))
    )
      return false;
    const account = (
      await sql.query<{
        status: string;
        email: string | null;
        email_verified_at: Date | null;
        pending_email: string | null;
      }>(
        "SELECT status,email,email_verified_at,pending_email FROM portal_accounts WHERE id=$1",
        [row.account_id],
      )
    ).rows[0];
    if (!account || ["suspended", "archived"].includes(account.status))
      return false;
    if (row.template === "email_changed") return true;
    if (typeof payload.token !== "string") return false;
    const hash = crypto
      .createHash("sha256")
      .update(payload.token)
      .digest("hex");
    if (row.template === "invitation") {
      const invitation = (
        await sql.query<{
          status: string;
          expires_at: Date;
          link_status: string;
        }>(
          `SELECT invitation.status,invitation.expires_at,link.status AS link_status FROM portal_invitations invitation JOIN portal_student_links link ON link.id=invitation.link_id WHERE invitation.id=$1 AND invitation.token_hash=$2 AND invitation.account_id=$3`,
          [row.invitation_id, hash, row.account_id],
        )
      ).rows[0];
      return Boolean(
        invitation &&
        ["created", "sent", "delivery_failed"].includes(invitation.status) &&
        invitation.link_status === "pending" &&
        new Date(invitation.expires_at).getTime() > now &&
        account.email === row.recipient,
      );
    }
    const token = (
      await sql.query<{
        purpose: string;
        expires_at: Date;
        consumed_at: Date | null;
        payload: string | null;
      }>(
        `SELECT purpose,expires_at,consumed_at,payload FROM portal_recovery_tokens WHERE token_hash=$1 AND account_id=$2`,
        [hash, row.account_id],
      )
    ).rows[0];
    if (
      !token ||
      token.consumed_at ||
      new Date(token.expires_at).getTime() <= now
    )
      return false;
    if (row.template === "recovery")
      return (
        token.purpose === "recovery" &&
        account.status === "active" &&
        Boolean(account.email_verified_at) &&
        account.email === row.recipient
      );
    return (
      token.purpose === "email" &&
      token.payload === row.recipient &&
      account.pending_email === row.recipient
    );
  }
  async canRetryFailedEmail(id: number, sql: Pick<PoolClient, "query"> = this.options.pool): Promise<boolean> {
    const now = this.options.now?.() ?? Date.now();
    const row = (await sql.query<MailRow & { status: string; locked_at: Date | null }>("SELECT * FROM portal_identity_mail_outbox WHERE id=$1", [id])).rows[0];
    if (!row || row.status !== "failed" || row.locked_at || !row.encrypted_payload || row.expires_at.getTime() <= now) return false;
    let payload: Record<string, unknown>;
    try { payload = decryptPortalMail(row.encrypted_payload, this.options.encryptionKey); }
    catch { return false; }
    return this.isDeliverable(row, payload, now, sql);
  }
}
