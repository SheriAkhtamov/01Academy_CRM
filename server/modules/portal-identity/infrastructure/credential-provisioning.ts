import type { Pool, PoolClient } from 'pg';
import type { PortalCrypto } from '../application/ports';
import { PortalError, selfPermissions } from '../domain/access-policy';
import { credentialAccountColumns, type CredentialAccountRow, credentialAudit, generatePortalLogin, rememberInitialPassword } from './credential-support';

export type CredentialStudentSource = { id: number; lead_id: number; name: string; phone: string; classification: 'adult' | 'minor' | 'unverified'; groups: number[] };
export type CredentialProvisioningOptions = {
  enabled: () => boolean;
  enabledForStudent: (studentId: number, groups: readonly number[]) => boolean | Promise<boolean>;
  now?: () => number;
};
export async function credentialStudent(sql: PoolClient, studentId: number, leadId?: number): Promise<CredentialStudentSource> {
  const row = (await sql.query<CredentialStudentSource>(`SELECT student.id,student.lead_id,
    COALESCE(NULLIF(student.student_name,''),student.contact_name) AS name,student.phone,
    COALESCE(identity.classification,'unverified') AS classification,
    ARRAY(SELECT group_id FROM academy_student_group_enrollments WHERE student_id=student.id) AS groups
    FROM academy_students student LEFT JOIN portal_student_identity identity ON identity.student_id=student.id
    WHERE student.id=$1 AND student.lead_id IS NOT NULL AND ($2::integer IS NULL OR student.lead_id=$2) FOR UPDATE OF student`, [studentId, leadId ?? null])).rows[0];
  if (!row) throw new PortalError('academyAccessLeadUnavailable', 404);
  return row;
}
export async function existingStudentCredential(sql: PoolClient, studentId: number): Promise<CredentialAccountRow | null> {
  return (await sql.query<CredentialAccountRow>(`SELECT ${credentialAccountColumns} FROM portal_student_links link
    JOIN portal_accounts account ON account.id=link.account_id
    LEFT JOIN portal_initial_credentials initial ON initial.account_id=account.id
    WHERE link.student_id=$1 AND link.kind='self' AND link.status<>'revoked' ORDER BY link.id LIMIT 1 FOR UPDATE OF account`, [studentId])).rows[0] ?? null;
}

/** Creates pending student accounts. A staff issuance verifies and activates their own access. */
export class PortalCredentialProvisioning {
  private readonly now: () => number;
  constructor(private readonly pool: Pool, readonly crypto: PortalCrypto, readonly options: CredentialProvisioningOptions) {
    this.now = options.now ?? Date.now;
  }
  async ensureDraft(sql: PoolClient, student: CredentialStudentSource, password: string, hash: string): Promise<CredentialAccountRow> {
    const existing = await existingStudentCredential(sql, student.id);
    if (existing) return existing;
    if ((await sql.query("SELECT id FROM portal_student_links WHERE student_id=$1 AND kind='self'", [student.id])).rowCount)
      throw new PortalError('portalSelfLinkAlreadyExists', 409);
    if (!this.options.enabled() || !await this.options.enabledForStudent(student.id, student.groups)) throw new PortalError('portalInvitationsDisabled', 403);
    const flag = (await sql.query("SELECT enabled FROM lms_feature_flags WHERE key='invitations' AND enabled AND(all_groups OR group_ids && $1::integer[]) FOR SHARE", [student.groups])).rows[0];
    if (!flag) throw new PortalError('portalInvitationsDisabled', 403);
    const login = await generatePortalLogin(sql, `student-${student.id}`, this.crypto);
    const account = (await sql.query<{ id: number }>(`INSERT INTO portal_accounts(login,full_name,phone,status,password_hash,auth_version)
      VALUES($1,$2,$3,'pending',$4,1) RETURNING id`, [login, student.name, student.phone, hash])).rows[0];
    await sql.query(`INSERT INTO portal_student_links(account_id,student_id,kind,permissions,status)
      VALUES($1,$2,'self',$3::jsonb,'pending')`, [account.id, student.id, JSON.stringify(selfPermissions(student.classification))]);
    await rememberInitialPassword(sql, account.id, 1, password, this.crypto, this.now());
    await credentialAudit(sql, null, student.id, 'STUDENT_CREDENTIALS_PREPARED', { accountId: account.id, source: 'academy_students', leadId: student.lead_id });
    return (await existingStudentCredential(sql, student.id))!;
  }
  async runOnce(signal?: AbortSignal) {
    const result = { prepared: 0 };
    if (!this.options.enabled() || signal?.aborted) return result;
    const eligible = (await this.pool.query<{ id: number }>(`SELECT student.id FROM academy_students student
      JOIN academy_leads lead ON lead.id=student.lead_id
      WHERE NOT EXISTS(SELECT 1 FROM portal_student_links link WHERE link.student_id=student.id AND link.kind='self')
      ORDER BY student.id LIMIT 25`)).rows;
    for (const row of eligible) {
      if (!this.options.enabled() || signal?.aborted) break;
      const password = this.crypto.randomToken().slice(0, 20);
      const hash = await this.crypto.hashPassword(password);
      if (!this.options.enabled() || signal?.aborted) break;
      const sql = await this.pool.connect();
      try {
        await sql.query('BEGIN');
        const student = await credentialStudent(sql, row.id);
        if (!await this.options.enabledForStudent(student.id, student.groups)) { await sql.query('ROLLBACK'); continue; }
        const existed = await existingStudentCredential(sql, student.id);
        await this.ensureDraft(sql, student, password, hash);
        if (signal?.aborted || !this.options.enabled()) throw new Error('LMS_JOB_LEASE_LOST');
        await sql.query('COMMIT');
        if (!existed) result.prepared++;
      } catch (error) {
        await sql.query('ROLLBACK');
        if (error instanceof PortalError && error.code === 'portalInvitationsDisabled') break;
        throw error;
      } finally { sql.release(); }
    }
    return result;
  }
}
