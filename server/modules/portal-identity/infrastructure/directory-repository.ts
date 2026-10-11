import type { Pool, PoolClient } from "pg";
import {
  portalDirectoryPageSchema, portalRepresentativePageSchema,
  type PortalDirectoryPage, type PortalDirectoryQuery, type PortalDirectoryRow,
  type PortalDirectoryStats, type PortalRepresentativePage,
} from "@shared/contracts/portal-directory";

const activeAccess = `account.status='active' AND link.status='active' AND link.verified_at IS NOT NULL
  AND (link.expires_at IS NULL OR link.expires_at>$1::timestamptz)
  AND (link.kind='self' OR (COALESCE(identity.classification,'unverified')<>'unverified'
    AND jsonb_array_length(link.permissions)>0 AND (identity.classification<>'adult' OR consent.valid)))`;
const pendingAccess = `link.status='pending' AND invitation.status IN('created','sent','delivery_failed') AND invitation.expires_at>$1::timestamptz`;
const unverifiedAccess = `link.verified_at IS NULL OR (link.kind='representative' AND identity.classification='adult' AND NOT consent.valid)`;
const blockedAccess = `link.status='suspended' OR account.status IN('suspended','archived')`;
const baseSql = `WITH directory AS (
  SELECT student.id,
    jsonb_build_object('id',student.id,'studentName',student.student_name,'contactName',student.contact_name,
      'status',student.status,'managerName',manager.full_name,'leadId',student.lead_id,'updatedAt',student.updated_at,
      'classification',COALESCE(identity.classification,'unverified'),'groups',COALESCE(groups.items,'[]'::jsonb)) AS student,
    COALESCE(access.items,'[]'::jsonb) AS access,
    COALESCE(access.has_access,false) AS has_access,
    COALESCE(identity.classification,'unverified')='unverified' OR COALESCE(access.needs_verification,false) AS needs_verification,
    COALESCE(access.pending_activation,false) AS pending_activation,
    COALESCE(access.blocked,false) AS blocked,
    access.last_seen_at
  FROM academy_students student
  LEFT JOIN users manager ON manager.id=student.manager_id
  LEFT JOIN portal_student_identity identity ON identity.student_id=student.id
  LEFT JOIN LATERAL(
    SELECT jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) ORDER BY g.name,g.id) AS items
    FROM academy_groups g WHERE g.id=student.group_id OR EXISTS(
      SELECT 1 FROM academy_student_group_enrollments enrollment
      WHERE enrollment.student_id=student.id AND enrollment.group_id=g.id AND enrollment.ended_at IS NULL
    )
  ) groups ON true
  LEFT JOIN LATERAL(
    SELECT jsonb_agg(jsonb_build_object(
      'accountId',account.id,'linkId',link.id,'fullName',account.full_name,'login',account.login,
      'accountStatus',account.status,'linkStatus',link.status,'relationship',link.relationship,'permissions',link.permissions,
      'invitationStatus',CASE WHEN invitation.status IN('created','sent','delivery_failed') AND invitation.expires_at<= $1::timestamptz THEN 'expired' ELSE invitation.status END,
      'lastSeenAt',account.last_seen_at,'kind',link.kind,
      'hasAccess',COALESCE((${activeAccess}),false),'pendingActivation',COALESCE((${pendingAccess}),false),
      'needsVerification',COALESCE((${unverifiedAccess}),false),'blocked',COALESCE((${blockedAccess}),false)
    ) ORDER BY link.id) AS items,
    max(account.last_seen_at) AS last_seen_at,
    bool_or(${activeAccess}) AS has_access,
    bool_or(${unverifiedAccess}) AS needs_verification,
    bool_or(${pendingAccess}) AS pending_activation,
    bool_or(${blockedAccess}) AS blocked
    FROM portal_student_links link JOIN portal_accounts account ON account.id=link.account_id
    LEFT JOIN LATERAL(SELECT status,expires_at FROM portal_invitations WHERE link_id=link.id ORDER BY id DESC LIMIT 1) invitation ON true
    CROSS JOIN LATERAL(SELECT EXISTS(SELECT 1 FROM portal_consents consent WHERE consent.link_id=link.id
      AND consent.revoked_at IS NULL AND consent.method IN('in_person','portal') AND consent.permissions @> link.permissions) AS valid) consent
    WHERE link.student_id=student.id AND link.status<>'revoked'
  ) access ON true
  WHERE ($2::integer IS NULL OR student.group_id=$2 OR EXISTS(
    SELECT 1 FROM academy_student_group_enrollments enrollment WHERE enrollment.student_id=student.id AND enrollment.group_id=$2
  ))
  AND ($3::text='' OR COALESCE(student.student_name,'') ILIKE $3 ESCAPE '\\' OR student.contact_name ILIKE $3 ESCAPE '\\'
    OR EXISTS(SELECT 1 FROM portal_student_links search_link JOIN portal_accounts search_account ON search_account.id=search_link.account_id
      WHERE search_link.student_id=student.id AND search_link.status<>'revoked' AND (search_account.login ILIKE $3 ESCAPE '\\' OR search_account.full_name ILIKE $3 ESCAPE '\\')))
), filtered AS (
  SELECT * FROM directory WHERE $4::text='all'
    OR ($4='without_access' AND NOT has_access)
    OR ($4='pending' AND pending_activation)
    OR ($4='unverified' AND needs_verification)
    OR ($4='blocked' AND blocked)
)`;
const searchPattern = (q: string) => q ? `%${q.replace(/[\\%_]/g, (character) => `\\${character}`)}%` : "";
const parameters = (query: PortalDirectoryQuery, now: Date) => [now, query.groupId ?? null, searchPattern(query.q), query.filter];
const timestamp = (value: unknown) => value === null || value === undefined ? null : new Date(String(value)).toISOString();
function presentRow(row: Record<string, unknown>): PortalDirectoryRow {
  const access = row.access as Record<string, unknown>[];
  const account = (item: Record<string, unknown>) => ({ ...item, lastSeenAt: timestamp(item.lastSeenAt) });
  const student = row.student as Record<string, unknown>;
  return {
    student: { ...student, updatedAt: timestamp(student.updatedAt) } as PortalDirectoryRow["student"],
    selfAccount: access.find((item) => item.kind === "self") ? account(access.find((item) => item.kind === "self")!) as PortalDirectoryRow["selfAccount"] : null,
    representatives: access.filter((item) => item.kind === "representative").map(account) as PortalDirectoryRow["representatives"],
    lastSeenAt: timestamp(row.last_seen_at), hasAccess: Boolean(row.has_access), needsVerification: Boolean(row.needs_verification), pendingActivation: Boolean(row.pending_activation), blocked: Boolean(row.blocked),
  };
}

export class PortalDirectoryRepository {
  constructor(private readonly pool: Pool, private readonly now: () => Date = () => new Date()) {}
  private async snapshot<T>(work: (sql: PoolClient, now: Date) => Promise<T>): Promise<T> {
    const sql = await this.pool.connect();
    try {
      await sql.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const result = await work(sql, this.now());
      await sql.query("COMMIT");
      return result;
    } catch (error) { await sql.query("ROLLBACK"); throw error; }
    finally { sql.release(); }
  }
  private async stats(sql: PoolClient, query: PortalDirectoryQuery, now: Date): Promise<PortalDirectoryStats> {
    const row = (await sql.query(`${baseSql}, account_ids AS (
      SELECT DISTINCT (entry->>'accountId')::integer AS id FROM filtered CROSS JOIN LATERAL jsonb_array_elements(filtered.access) AS expanded(entry)
    ) SELECT (SELECT count(*) FROM filtered)::integer AS students,count(account.id)::integer AS accounts,
      count(account.id) FILTER(WHERE account.last_seen_at IS NOT NULL OR EXISTS(SELECT 1 FROM portal_invitations invitation WHERE invitation.account_id=account.id AND invitation.status='accepted'))::integer AS activated,
      count(account.id) FILTER(WHERE account.last_seen_at>=$1::timestamptz-interval '7 days' AND account.last_seen_at<=$1::timestamptz)::integer AS active7,
      count(account.id) FILTER(WHERE account.last_seen_at>=$1::timestamptz-interval '30 days' AND account.last_seen_at<=$1::timestamptz)::integer AS active30
      FROM account_ids JOIN portal_accounts account ON account.id=account_ids.id`, parameters(query, now))).rows[0];
    return { students: row.students, accounts: row.accounts, activatedAccounts: row.activated, activationPercent: row.accounts ? Math.round(row.activated / row.accounts * 1000) / 10 : 0, active7Days: row.active7, active30Days: row.active30, periodEnd: now.toISOString() };
  }
  async students(query: PortalDirectoryQuery): Promise<PortalDirectoryPage> {
    return this.snapshot(async (sql, now) => {
      const items = (await sql.query(`${baseSql} SELECT * FROM filtered ORDER BY lower(COALESCE(NULLIF(student->>'studentName',''),student->>'contactName')),id LIMIT $5 OFFSET $6`, [...parameters(query, now), query.pageSize, (query.page - 1) * query.pageSize])).rows.map(presentRow);
      const stats = await this.stats(sql, query, now);
      const groups = (await sql.query("SELECT id,name FROM academy_groups ORDER BY name,id")).rows;
      return portalDirectoryPageSchema.parse({ items, total: stats.students, page: query.page, pageSize: query.pageSize, stats, groups });
    });
  }
  async representatives(query: PortalDirectoryQuery): Promise<PortalRepresentativePage> {
    return this.snapshot(async (sql, now) => {
      const representativeSql = `${baseSql}, representatives AS (
        SELECT (entry->>'accountId')::integer AS account_id,entry->>'fullName' AS full_name,entry->>'login' AS login,
          entry->>'accountStatus' AS account_status,entry->>'lastSeenAt' AS last_seen_at,
          jsonb_agg(jsonb_build_object('student',directory.student,'access',entry) ORDER BY directory.id) AS students
        FROM directory CROSS JOIN LATERAL jsonb_array_elements(directory.access) AS expanded(entry) WHERE entry->>'kind'='representative'
          AND ($4::text='all' OR ($4='without_access' AND NOT (entry->>'hasAccess')::boolean)
            OR ($4='pending' AND (entry->>'pendingActivation')::boolean)
            OR ($4='unverified' AND (directory.student->>'classification'='unverified' OR (entry->>'needsVerification')::boolean))
            OR ($4='blocked' AND (entry->>'blocked')::boolean))
        GROUP BY entry->>'accountId',entry->>'fullName',entry->>'login',entry->>'accountStatus',entry->>'lastSeenAt'
      )`;
      const values = parameters(query, now);
      const rows = (await sql.query(`${representativeSql} SELECT * FROM representatives ORDER BY lower(full_name),account_id LIMIT $5 OFFSET $6`, [...values, query.pageSize, (query.page - 1) * query.pageSize])).rows;
      const total = Number((await sql.query(`${representativeSql} SELECT count(*) FROM representatives`, values)).rows[0].count);
      const groups = (await sql.query("SELECT id,name FROM academy_groups ORDER BY name,id")).rows;
      return portalRepresentativePageSchema.parse({ total, page: query.page, pageSize: query.pageSize, groups, items: rows.map((row) => ({ accountId: row.account_id, fullName: row.full_name, login: row.login, accountStatus: row.account_status, lastSeenAt: timestamp(row.last_seen_at), students: row.students.map((item: { student: Record<string, unknown>; access: Record<string, unknown> }) => ({ student: { ...item.student, updatedAt: timestamp(item.student.updatedAt) }, access: { ...item.access, lastSeenAt: timestamp(item.access.lastSeenAt) } })) })) });
    });
  }
  async exportStudents(query: PortalDirectoryQuery, maximumRows = 5_000): Promise<PortalDirectoryRow[] | null> {
    return this.snapshot(async (sql, now) => {
      const rows = (await sql.query(`${baseSql} SELECT * FROM filtered ORDER BY id LIMIT $5`, [...parameters(query, now), maximumRows + 1])).rows;
      return rows.length > maximumRows ? null : rows.map(presentRow);
    });
  }
  async auditExport(staffId: number, query: PortalDirectoryQuery, count: number, requestId?: string): Promise<void> {
    await this.pool.query("INSERT INTO portal_access_audit(actor_kind,staff_id,action,details,request_id) VALUES('staff',$1,'ADMIN_ACCESS_EXPORT',$2::jsonb,$3)", [staffId, JSON.stringify({ filter: query.filter, groupId: query.groupId ?? null, count }), requestId ?? null]);
  }
}
