import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { PortalClassification } from "@shared/contracts/portal-identity";
import { portalContactMatchesSchema } from "@shared/contracts/portal-contact-checks";
import { PortalError } from "../domain/access-policy";
import type {
  PortalAccount,
  PortalActorSnapshot,
  PortalAudit,
  PortalConsent,
  PortalInvitation,
  PortalLink,
  PortalMail,
  PortalRecoveryToken,
  PortalRepository,
  PortalSession,
  PortalStudent,
} from "../application/ports";

type Connection = Pool | PoolClient;
const fields: Record<string, string> = {
  accountId: "account_id",
  authVersion: "auth_version",
  fullName: "full_name",
  passwordHash: "password_hash",
  emailVerifiedAt: "email_verified_at",
  pendingEmail: "pending_email",
  studentId: "student_id",
  verifiedAt: "verified_at",
  verifiedBy: "verified_by",
  expiresAt: "expires_at",
  tokenHash: "token_hash",
  createdBy: "created_by",
  idempotencyKey: "idempotency_key",
  requestHash: "request_hash",
  acceptedAt: "accepted_at",
  acceptedAccountId: "accepted_account_id",
  linkId: "link_id",
  subjectAccountId: "subject_account_id",
  staffId: "staff_id",
  revokedAt: "revoked_at",
  createdAt: "created_at",
  consumedAt: "consumed_at",
  lastSeenAt: "last_seen_at",
  absoluteExpiresAt: "absolute_expires_at",
  csrfToken: "csrf_token",
  reauthenticatedAt: "reauthenticated_at",
  actorKind: "actor_kind",
  requestId: "request_id",
  encryptedPayload: "encrypted_payload",
  invitationId: "invitation_id",
  dedupeKey: "dedupe_key",
};
const dateFields = new Set([
  "emailVerifiedAt",
  "verifiedAt",
  "expiresAt",
  "acceptedAt",
  "revokedAt",
  "createdAt",
  "consumedAt",
  "lastSeenAt",
  "absoluteExpiresAt",
  "reauthenticatedAt",
]);
const encode = (key: string, value: unknown) =>
  dateFields.has(key) && typeof value === "number"
    ? new Date(value)
    : key === "permissions" || key === "details"
      ? JSON.stringify(value)
      : value;
const decode = <T>(row: QueryResultRow): T =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      const name = key.replace(/_([a-z])/g, (_, letter: string) =>
        letter.toUpperCase(),
      );
      return [
        name,
        dateFields.has(name) && value !== null
          ? new Date(value).getTime()
          : value,
      ];
    }),
  ) as T;

export class PostgresPortalRepository implements PortalRepository {
  constructor(
    private readonly connection: Connection,
    private readonly pool: Pool,
    private readonly transactional = false,
  ) {}
  async transaction<T>(
    work: (repository: PortalRepository) => Promise<T>,
  ): Promise<T> {
    if (this.transactional) return work(this);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(
        new PostgresPortalRepository(client, this.pool, true),
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      )
        throw new PortalError("portalIdentityConflict", 409);
      throw error;
    } finally {
      client.release();
    }
  }
  async findContactMatches(contact: { email: string | null; phone: string | null }, staff: { staffId: number; administration: boolean }) {
    const result = await this.connection.query<{ total: number; items: unknown[] }>(`WITH matches AS (
      SELECT account.id,account.login,account.full_name,account.status,
        ($1::text IS NOT NULL AND account.email=$1) AS email_match,
        ($2::text IS NOT NULL AND regexp_replace(COALESCE(account.phone,''),'[^0-9]','','g')=$2) AS phone_match,
        ($3::boolean OR EXISTS(SELECT 1 FROM portal_student_links link JOIN academy_students student ON student.id=link.student_id WHERE link.account_id=account.id AND link.status<>'revoked' AND student.manager_id=$4)
          OR EXISTS(SELECT 1 FROM portal_invitations invitation WHERE invitation.account_id=account.id AND invitation.created_by=$4 AND invitation.status IN('created','sent','delivery_failed','accepted'))) AS visible
      FROM portal_accounts account WHERE account.status<>'archived' AND
        (($1::text IS NOT NULL AND account.email=$1) OR ($2::text IS NOT NULL AND regexp_replace(COALESCE(account.phone,''),'[^0-9]','','g')=$2))
    ), selected AS (SELECT * FROM matches WHERE visible ORDER BY (status='active') DESC,lower(login),id LIMIT 10)
    SELECT (SELECT count(*)::integer FROM matches) AS total,
      COALESCE(jsonb_agg(jsonb_build_object('id',id,'login',login,'fullName',full_name,'status',status,
        'matchedBy',to_jsonb(array_remove(ARRAY[CASE WHEN email_match THEN 'email'::text END,CASE WHEN phone_match THEN 'phone'::text END],NULL)),
        'canUse',status='active') ORDER BY (status='active') DESC,lower(login),id),'[]'::jsonb) AS items FROM selected`,
      [contact.email, contact.phone, staff.administration, staff.staffId]);
    const row = result.rows[0];
    return portalContactMatchesSchema.parse({ items: row.items, additionalMatches: row.total > row.items.length });
  }
  private async one<T>(sql: string, values: unknown[] = []): Promise<T | null> {
    const result = await this.connection.query(sql, values);
    return result.rows[0] ? decode<T>(result.rows[0]) : null;
  }
  private async many<T>(sql: string, values: unknown[] = []): Promise<T[]> {
    return (await this.connection.query(sql, values)).rows.map((row) =>
      decode<T>(row),
    );
  }
  private async insert<T>(table: string, values: object): Promise<T> {
    const entries = Object.entries(values).filter(
      ([, value]) => value !== undefined,
    );
    return (await this.one<T>(
      `INSERT INTO ${table} (${entries.map(([key]) => fields[key] ?? key).join(",")}) VALUES (${entries.map((_, index) => `$${index + 1}`).join(",")}) RETURNING *`,
      entries.map(([key, value]) => encode(key, value)),
    ))!;
  }
  private async update<T>(
    table: string,
    id: number,
    values: object,
  ): Promise<T> {
    const entries = Object.entries(values).filter(
      ([, value]) => value !== undefined,
    );
    if (!entries.length)
      return (await this.one<T>(`SELECT * FROM ${table} WHERE id=$1`, [id]))!;
    return (await this.one<T>(
      `UPDATE ${table} SET ${entries.map(([key], index) => `${fields[key] ?? key}=$${index + 2}`).join(",")}${table === "portal_accounts" || table === "portal_student_links" ? ",updated_at=now()" : ""} WHERE id=$1 RETURNING *`,
      [id, ...entries.map(([key, value]) => encode(key, value))],
    ))!;
  }
  async findAccount(identifier: string, lock = false) {
    return this.one<PortalAccount>(
      `SELECT * FROM portal_accounts WHERE login=$1 OR (email=$1 AND email_verified_at IS NOT NULL) ${lock ? "FOR UPDATE" : ""}`,
      [identifier],
    );
  }
  async getAccount(id: number, lock = false) {
    return this.one<PortalAccount>(
      `SELECT * FROM portal_accounts WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`,
      [id],
    );
  }
  async readActorSnapshot(accountId: number, linkId: number): Promise<PortalActorSnapshot> {
    const result = await this.connection.query<{
      account: PortalActorSnapshot["account"];
      link: QueryResultRow | null;
      student: PortalActorSnapshot["student"];
      consents: QueryResultRow[];
    }>(`SELECT
      CASE WHEN account.id IS NOT NULL THEN jsonb_build_object('id',account.id,'status',account.status) END AS account,
      CASE WHEN link.id IS NOT NULL THEN jsonb_build_object('id',link.id,'account_id',link.account_id,'student_id',link.student_id,
        'kind',link.kind,'permissions',link.permissions,'status',link.status,'verified_at',link.verified_at,'expires_at',link.expires_at) END AS link,
      CASE WHEN student.id IS NOT NULL THEN jsonb_build_object('id',student.id,'classification',COALESCE(identity.classification,'unverified')) END AS student,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('permissions',consent.permissions,'method',consent.method,'revoked_at',consent.revoked_at) ORDER BY consent.id)
        FROM portal_consents consent WHERE consent.link_id=link.id AND link.kind='representative' AND identity.classification='adult'),'[]'::jsonb) AS consents
      FROM (VALUES($1::integer)) requested(account_id)
      LEFT JOIN portal_accounts account ON account.id=requested.account_id
      LEFT JOIN portal_student_links link ON link.id=$2::integer AND link.account_id=account.id AND account.status='active'
      LEFT JOIN academy_students student ON student.id=link.student_id
      LEFT JOIN portal_student_identity identity ON identity.student_id=student.id`, [accountId, linkId]);
    const row = result.rows[0];
    return {
      account: row.account,
      link: row.link ? decode<NonNullable<PortalActorSnapshot["link"]>>(row.link) : null,
      student: row.student,
      consents: row.consents.map(consent => decode<PortalActorSnapshot["consents"][number]>(consent)),
    };
  }
  async createAccount(account: Omit<PortalAccount, "id">) {
    const result = await this.insert<PortalAccount>("portal_accounts", account);
    await this.syncContacts(result);
    return result;
  }
  async updateAccount(id: number, changes: Partial<Omit<PortalAccount, "id">>) {
    const result = await this.update<PortalAccount>(
      "portal_accounts",
      id,
      changes,
    );
    if (
      "phone" in changes ||
      "email" in changes ||
      "emailVerifiedAt" in changes
    )
      await this.syncContacts(result);
    return result;
  }
  private async syncContacts(account: PortalAccount) {
    for (const [kind, value, verifiedAt] of [
      ["phone", account.phone, null],
      ["email", account.email, account.emailVerifiedAt],
    ] as const) {
      if (value)
        await this.connection.query(
          `INSERT INTO portal_account_contacts(account_id,kind,normalized_value,verified_at,verification_method) VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_id,kind,normalized_value) DO UPDATE SET verified_at=EXCLUDED.verified_at,verification_method=EXCLUDED.verification_method`,
          [
            account.id,
            kind,
            value,
            verifiedAt ? new Date(verifiedAt) : null,
            verifiedAt ? "email_link" : null,
          ],
        );
    }
  }
  async getStudent(id: number, lock = false) {
    return this.one<PortalStudent>(
      `SELECT student.id,COALESCE(NULLIF(student.student_name,''),student.contact_name) AS student_name,student.manager_id,COALESCE(identity.classification,'unverified') AS classification,identity.verified_birth_date::text FROM academy_students student LEFT JOIN portal_student_identity identity ON identity.student_id=student.id WHERE student.id=$1 ${lock ? "FOR UPDATE OF student" : ""}`,
      [id],
    );
  }
  async getStudentEnrollmentGroupIds(studentId: number): Promise<number[]> {
    const rows = await this.connection.query<{ group_id: number }>(
      "SELECT DISTINCT group_id FROM academy_student_group_enrollments WHERE student_id=$1 ORDER BY group_id",
      [studentId],
    );
    return rows.rows.map((row) => row.group_id);
  }
  async updateStudentIdentity(
    id: number,
    classification: PortalClassification,
    birthDate: string | null,
    staffId: number,
    method: string,
  ) {
    await this.connection.query(
      `INSERT INTO portal_student_identity(student_id,classification,verified_birth_date,verified_by,verification_method,verified_at) VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT(student_id) DO UPDATE SET classification=EXCLUDED.classification,verified_birth_date=EXCLUDED.verified_birth_date,verified_by=EXCLUDED.verified_by,verification_method=EXCLUDED.verification_method,verified_at=now()`,
      [id, classification, birthDate, staffId, method],
    );
  }
  async getLink(id: number, lock = false) {
    return this.one<PortalLink>(
      `SELECT * FROM portal_student_links WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`,
      [id],
    );
  }
  async listLinks(filter: { accountId?: number; studentId?: number }) {
    return this.many<PortalLink>(
      `SELECT * FROM portal_student_links WHERE ($1::int IS NULL OR account_id=$1) AND ($2::int IS NULL OR student_id=$2) ORDER BY id`,
      [filter.accountId ?? null, filter.studentId ?? null],
    );
  }
  async createLink(link: Omit<PortalLink, "id">) {
    return this.insert<PortalLink>("portal_student_links", link);
  }
  async updateLink(id: number, changes: Partial<Omit<PortalLink, "id">>) {
    return this.update<PortalLink>("portal_student_links", id, changes);
  }
  async getConsents(linkId: number) {
    return this.many<PortalConsent>(
      "SELECT * FROM portal_consents WHERE link_id=$1 ORDER BY id DESC",
      [linkId],
    );
  }
  async createConsent(consent: Omit<PortalConsent, "id">) {
    return this.insert<PortalConsent>("portal_consents", consent);
  }
  async revokeConsents(linkId: number, at: number) {
    await this.connection.query(
      "UPDATE portal_consents SET revoked_at=$2 WHERE link_id=$1 AND revoked_at IS NULL",
      [linkId, new Date(at)],
    );
  }
  async getInvitationByHash(hash: string, lock = false) {
    return this.one<PortalInvitation>(
      `SELECT * FROM portal_invitations WHERE token_hash=$1 ${lock ? "FOR UPDATE" : ""}`,
      [hash],
    );
  }
  async getInvitationByKey(key: string) {
    return this.one<PortalInvitation>(
      "SELECT * FROM portal_invitations WHERE idempotency_key=$1",
      [key],
    );
  }
  async listInvitations(linkId: number) {
    return this.many<PortalInvitation>(
      "SELECT * FROM portal_invitations WHERE link_id=$1 ORDER BY id DESC",
      [linkId],
    );
  }
  async createInvitation(invitation: Omit<PortalInvitation, "id">) {
    return this.insert<PortalInvitation>("portal_invitations", invitation);
  }
  async updateInvitation(
    id: number,
    changes: Partial<Omit<PortalInvitation, "id">>,
  ) {
    return this.update<PortalInvitation>("portal_invitations", id, changes);
  }
  async revokeInvitations(
    filter: { accountId?: number; linkId?: number },
    _at: number,
  ) {
    await this.connection.query(
      `UPDATE portal_invitations SET status='revoked' WHERE ($1::int IS NULL OR account_id=$1) AND ($2::int IS NULL OR link_id=$2) AND status IN ('created','sent','delivery_failed')`,
      [filter.accountId ?? null, filter.linkId ?? null],
    );
    await this.connection.query(
      `UPDATE portal_identity_mail_outbox SET status='expired',encrypted_payload=NULL WHERE invitation_id IN (SELECT id FROM portal_invitations WHERE ($1::int IS NULL OR account_id=$1) AND ($2::int IS NULL OR link_id=$2) AND status='revoked') AND status IN ('pending','delivering','failed')`,
      [filter.accountId ?? null, filter.linkId ?? null],
    );
  }
  async getToken(hash: string, lock = false) {
    return this.one<PortalRecoveryToken>(
      `SELECT * FROM portal_recovery_tokens WHERE token_hash=$1 ${lock ? "FOR UPDATE" : ""}`,
      [hash],
    );
  }
  async createToken(token: Omit<PortalRecoveryToken, "id">) {
    return this.insert<PortalRecoveryToken>("portal_recovery_tokens", token);
  }
  async consumeToken(id: number, at: number) {
    await this.connection.query(
      "UPDATE portal_recovery_tokens SET consumed_at=$2 WHERE id=$1",
      [id, new Date(at)],
    );
  }
  async revokeTokens(accountId: number, at: number) {
    await this.connection.query(
      "UPDATE portal_recovery_tokens SET consumed_at=$2 WHERE account_id=$1 AND consumed_at IS NULL",
      [accountId, new Date(at)],
    );
  }
  async getSession(id: string, lock = false) {
    return this.one<PortalSession>(
      `SELECT * FROM portal_sessions WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`,
      [id],
    );
  }
  async resolveActiveSession(id: string, now: number): Promise<PortalSession | null> {
    return this.one<PortalSession>(`WITH valid_session AS MATERIALIZED (
      SELECT session.id,session.account_id,session.auth_version,session.created_at,session.last_seen_at,
        session.absolute_expires_at,session.csrf_token,session.reauthenticated_at
      FROM portal_sessions session LEFT JOIN portal_accounts account ON account.id=session.account_id
      WHERE session.id=$1 AND session.absolute_expires_at>$2::timestamptz AND session.last_seen_at>$2::timestamptz-interval '24 hours'
        AND (session.account_id IS NULL OR (account.status='active' AND account.auth_version=session.auth_version))
    ), seen_account AS (
      UPDATE portal_accounts account SET last_seen_at=GREATEST(account.last_seen_at,$2::timestamptz)
      FROM valid_session session WHERE account.id=session.account_id AND account.status='active' AND account.auth_version=session.auth_version
        AND (account.last_seen_at IS NULL OR account.last_seen_at<=$2::timestamptz-interval '30 seconds')
      RETURNING account.id
    ), seen_session AS (
      UPDATE portal_sessions session SET last_seen_at=GREATEST(session.last_seen_at,$2::timestamptz)
      FROM valid_session valid WHERE session.id=valid.id AND session.auth_version=valid.auth_version
        AND session.account_id IS NOT DISTINCT FROM valid.account_id AND session.last_seen_at<=$2::timestamptz-interval '30 seconds'
      RETURNING session.id
    ), invalid_cleanup AS (
      DELETE FROM portal_sessions session WHERE session.id=$1 AND NOT EXISTS(SELECT 1 FROM valid_session)
        AND (session.absolute_expires_at<=$2::timestamptz OR session.last_seen_at<=$2::timestamptz-interval '24 hours'
          OR (session.account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM portal_accounts account
            WHERE account.id=session.account_id AND account.status='active' AND account.auth_version=session.auth_version)))
      RETURNING session.id
    ) SELECT id,account_id,auth_version,created_at,GREATEST(last_seen_at,$2::timestamptz) AS last_seen_at,
      absolute_expires_at,csrf_token,reauthenticated_at FROM valid_session`, [id, new Date(now)]);
  }
  async saveSession(session: PortalSession) {
    const result = await this.connection.query(
      `WITH seen_account AS (
        UPDATE portal_accounts SET last_seen_at=GREATEST(last_seen_at,$5::timestamptz)
        WHERE id=$2 AND status='active' AND auth_version=$3 RETURNING id
      ) INSERT INTO portal_sessions(id,account_id,auth_version,created_at,last_seen_at,absolute_expires_at,csrf_token,reauthenticated_at)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8 WHERE $2::integer IS NULL OR EXISTS(SELECT 1 FROM seen_account)
      ON CONFLICT(id) DO UPDATE SET last_seen_at=GREATEST(portal_sessions.last_seen_at,EXCLUDED.last_seen_at),reauthenticated_at=GREATEST(portal_sessions.reauthenticated_at,EXCLUDED.reauthenticated_at)`,
      [
        session.id,
        session.accountId,
        session.authVersion,
        new Date(session.createdAt),
        new Date(session.lastSeenAt),
        new Date(session.absoluteExpiresAt),
        session.csrfToken,
        session.reauthenticatedAt ? new Date(session.reauthenticatedAt) : null,
      ],
    );
    if (result.rowCount !== 1) throw new PortalError("portalAuthenticationRequired", 401);
  }
  async touchSession(session: PortalSession) {
    // Validate on every call; only the activity writes are coalesced. The boolean
    // comes from the current snapshot, so skipping an UPDATE never logs a user out.
    const result = await this.connection.query<{ valid: boolean }>(
      `WITH valid_session AS MATERIALIZED (
        SELECT session.id,session.account_id,session.auth_version
        FROM portal_sessions session LEFT JOIN portal_accounts account ON account.id=session.account_id
        WHERE session.id=$1 AND session.account_id IS NOT DISTINCT FROM $4::integer AND session.auth_version=$5::integer
          AND session.absolute_expires_at>$2::timestamptz AND session.last_seen_at>$2::timestamptz-interval '24 hours'
          AND (session.account_id IS NULL OR (account.status='active' AND account.auth_version=session.auth_version))
      ), seen_account AS (
        UPDATE portal_accounts account SET last_seen_at=GREATEST(account.last_seen_at,$2::timestamptz)
        FROM valid_session session WHERE account.id=session.account_id
          AND account.status='active' AND account.auth_version=session.auth_version
          AND (account.last_seen_at IS NULL OR account.last_seen_at<=$2::timestamptz-interval '30 seconds')
        RETURNING account.id
      ), seen_session AS (
        UPDATE portal_sessions session SET last_seen_at=GREATEST(session.last_seen_at,$2::timestamptz),
          reauthenticated_at=GREATEST(session.reauthenticated_at,$3::timestamptz)
        FROM valid_session valid WHERE session.id=valid.id AND session.auth_version=valid.auth_version
          AND session.account_id IS NOT DISTINCT FROM valid.account_id
          AND (session.last_seen_at<=$2::timestamptz-interval '30 seconds'
            OR ($3::timestamptz IS NOT NULL AND (session.reauthenticated_at IS NULL OR session.reauthenticated_at<$3::timestamptz)))
        RETURNING session.id
      ) SELECT EXISTS(SELECT 1 FROM valid_session) AS valid`,
      [
        session.id,
        new Date(session.lastSeenAt),
        session.reauthenticatedAt ? new Date(session.reauthenticatedAt) : null,
        session.accountId,
        session.authVersion,
      ],
    );
    return result.rows[0]?.valid === true;
  }
  async listSessions(accountId: number) {
    return this.many<PortalSession>(
      "SELECT * FROM portal_sessions WHERE account_id=$1 ORDER BY last_seen_at DESC",
      [accountId],
    );
  }
  async revokeSessions(accountId: number, exceptId?: string) {
    await this.connection.query(
      "DELETE FROM portal_sessions WHERE account_id=$1 AND ($2::text IS NULL OR id<>$2)",
      [accountId, exceptId ?? null],
    );
  }
  async deleteSession(id: string) {
    await this.connection.query("DELETE FROM portal_sessions WHERE id=$1", [
      id,
    ]);
  }
  async rateLimit(key: string, limit: number, windowMs: number, now: number) {
    const result = await this.one<{ count: number; resetAt: Date }>(
      `INSERT INTO portal_rate_limits(key,count,reset_at) VALUES($1,1,$2) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN portal_rate_limits.reset_at<=$3 THEN 1 ELSE portal_rate_limits.count+1 END,reset_at=CASE WHEN portal_rate_limits.reset_at<=$3 THEN EXCLUDED.reset_at ELSE portal_rate_limits.reset_at END RETURNING count,reset_at`,
      [key, new Date(now + windowMs), new Date(now)],
    );
    return result!.count > limit
      ? Math.max(
          1,
          Math.ceil((new Date(result!.resetAt).getTime() - now) / 1000),
        )
      : null;
  }
  async releaseRateLimit(key: string, now: number) {
    await this.connection.query(
      "UPDATE portal_rate_limits SET count=GREATEST(0,count-1) WHERE key=$1 AND reset_at>$2",
      [key, new Date(now)],
    );
  }
  async audit(event: PortalAudit) {
    await this.insert("portal_access_audit", event);
  }
  async queueMail(mail: PortalMail) {
    await this.connection.query(
      `INSERT INTO portal_identity_mail_outbox(account_id,recipient,template,encrypted_payload,expires_at,invitation_id,dedupe_key) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(dedupe_key) DO NOTHING`,
      [
        mail.accountId,
        mail.recipient,
        mail.template,
        mail.encryptedPayload,
        new Date(mail.expiresAt),
        mail.invitationId ?? null,
        mail.dedupeKey,
      ],
    );
  }
}
export const createPostgresPortalRepository = (pool: Pool): PortalRepository =>
  new PostgresPortalRepository(pool, pool);
