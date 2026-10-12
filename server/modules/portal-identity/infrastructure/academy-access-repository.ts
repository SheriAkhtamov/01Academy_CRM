import type { Pool, PoolClient } from 'pg';
import type { AcademyPortalAccessRepository } from '../application/academy-access-service';
import type { AcademyPortalQuery, AcademyPortalLeadRole, AcademyPortalCredentialChange, AcademyPortalCredentialResult } from '@shared/contracts/academy-portal-access';
import type { PortalStaffActor } from '../domain/actor-context';
import type { PortalCrypto } from '../application/ports';
import { PortalError, selfPermissions } from '../domain/access-policy';
import { academyAccessDirectory } from './academy-access-directory';
import { PortalCredentialProvisioning, credentialStudent, type CredentialProvisioningOptions } from './credential-provisioning';
import { credentialAccount, credentialAccountColumns, credentialAudit, generatePortalLogin, rememberInitialPassword, initialPortalPassword, type CredentialAccountRow } from './credential-support';

type LeadSource = { id: number; name: string; phone: string };
type LeadMapping = { account_id: number; role: 'self' | 'representative'; student_id: number | null };
const parentPermissions = ['learning.read', 'attendance.read', 'feedback.read', 'finance.read', 'communication.create', 'portfolio.approve'];

export class PostgresAcademyPortalAccessRepository implements AcademyPortalAccessRepository {
  readonly provisioning: PortalCredentialProvisioning;
  private readonly now: () => number;
  constructor(private readonly pool: Pool, private readonly crypto: PortalCrypto, private readonly encryptionKey: string, private readonly options: CredentialProvisioningOptions) {
    this.now = options.now ?? Date.now;
    this.provisioning = new PortalCredentialProvisioning(pool, crypto, options);
  }
  directory(query: AcademyPortalQuery) { return academyAccessDirectory(this.pool, query, this.now()); }
  private async transaction<T>(work: (sql: PoolClient) => Promise<T>) {
    const sql = await this.pool.connect();
    try {
      await sql.query('BEGIN');
      const result = await work(sql);
      await sql.query('COMMIT');
      return result;
    } catch (error) {
      await sql.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') throw new PortalError('portalLoginUnavailable', 409);
      throw error;
    } finally { sql.release(); }
  }
  private async lead(sql: PoolClient, leadId: number): Promise<LeadSource> {
    const lead = (await sql.query<LeadSource>(`SELECT id,contact_name AS name,phone FROM academy_leads
      WHERE id=$1 AND EXISTS(SELECT 1 FROM academy_students WHERE lead_id=$1) FOR UPDATE`, [leadId])).rows[0];
    if (!lead) throw new PortalError('academyAccessLeadUnavailable', 404);
    return lead;
  }
  private async account(sql: PoolClient, accountId: number): Promise<CredentialAccountRow> {
    const row = (await sql.query<CredentialAccountRow>(`SELECT ${credentialAccountColumns} FROM portal_accounts account
      LEFT JOIN portal_initial_credentials initial ON initial.account_id=account.id WHERE account.id=$1 FOR UPDATE OF account`, [accountId])).rows[0];
    if (!row || row.status === 'suspended' || row.status === 'archived') throw new PortalError('portalAccountUnavailable', 409);
    return row;
  }
  private async allowedStudent(sql: PoolClient, leadId: number, studentId: number) {
    const student = await credentialStudent(sql, studentId, leadId);
    if (!this.options.enabled() || !await this.options.enabledForStudent(student.id, student.groups)) throw new PortalError('portalInvitationsDisabled', 403);
    if (!(await sql.query("SELECT key FROM lms_feature_flags WHERE key='invitations' AND enabled=true AND(all_groups OR group_ids && $1::integer[]) FOR SHARE", [student.groups])).rowCount) throw new PortalError('portalInvitationsDisabled', 403);
    return student;
  }
  private async authorizedAccount(sql: PoolClient, leadId: number, accountId: number) {
    await this.lead(sql, leadId);
    const own = await sql.query(`SELECT account_id FROM portal_lead_accounts WHERE lead_id=$1 AND account_id=$2
      UNION ALL SELECT link.account_id FROM portal_student_links link JOIN academy_students student ON student.id=link.student_id
      WHERE student.lead_id=$1 AND link.account_id=$2 AND link.kind='self' AND link.status<>'revoked'`, [leadId, accountId]);
    if (!own.rowCount) throw new PortalError('portalAccessDenied', 403);
    const students = (await sql.query<{ id: number }>(`SELECT student.id FROM academy_students student JOIN portal_student_links link ON link.student_id=student.id
      WHERE student.lead_id=$1 AND link.account_id=$2 AND link.status<>'revoked' ORDER BY student.id`, [leadId, accountId])).rows;
    for (const student of students) await this.allowedStudent(sql, leadId, student.id);
    if (!students.length) throw new PortalError('portalAccountUnavailable', 409);
    return this.account(sql, accountId);
  }
  private async issue(sql: PoolClient, actor: PortalStaffActor, account: CredentialAccountRow): Promise<AcademyPortalCredentialResult> {
    const dto = credentialAccount(account, this.now());
    let password: string | null = null;
    if (dto.hasInitialPassword && account.encrypted_password) {
      password = initialPortalPassword(account, this.encryptionKey, this.now());
      await sql.query("UPDATE portal_accounts SET status='active',updated_at=$2 WHERE id=$1 AND status='pending'", [account.id, new Date(this.now())]);
      await sql.query(`UPDATE portal_student_links SET status='active',verified_at=$3,verified_by=$2
        WHERE account_id=$1 AND kind='self' AND status='pending'`, [account.id, actor.staffId, new Date(this.now())]);
      await sql.query('UPDATE portal_initial_credentials SET issued_at=COALESCE(issued_at,$2) WHERE account_id=$1', [account.id, new Date(this.now())]);
      account.status = 'active';
    }
    await credentialAudit(sql, actor, null, 'CREDENTIALS_ISSUED', { accountId: account.id, hasInitialPassword: Boolean(password) });
    return { account: credentialAccount(account, this.now()), password };
  }
  async chooseLeadRole(actor: PortalStaffActor, leadId: number, command: AcademyPortalLeadRole) {
    const password = this.crypto.randomToken().slice(0, 20);
    const hash = await this.crypto.hashPassword(password);
    return this.transaction(async sql => {
      const lead = await this.lead(sql, leadId);
      const mapped = (await sql.query<LeadMapping>('SELECT account_id,role,student_id FROM portal_lead_accounts WHERE lead_id=$1 FOR UPDATE', [leadId])).rows[0];
      if (mapped && (mapped.role !== command.role || (command.role === 'self' && mapped.student_id !== command.studentId))) throw new PortalError('academyAccessRoleConflict', 409);
      let account: CredentialAccountRow;
      if (command.role === 'self') {
        const student = await this.allowedStudent(sql, leadId, command.studentId);
        account = await this.provisioning.ensureDraft(sql, student, password, hash);
      } else {
        for (const target of [...command.students].sort((a, b) => a.studentId - b.studentId)) {
          const student = await this.allowedStudent(sql, leadId, target.studentId);
          if (student.classification !== 'unverified' && student.classification !== target.classification) throw new PortalError('portalInvalidData');
        }
        if (mapped) account = await this.account(sql, mapped.account_id);
        else {
          const login = await generatePortalLogin(sql, `lead-${leadId}`, this.crypto);
          const created = (await sql.query<{ id: number }>(`INSERT INTO portal_accounts(login,full_name,phone,status,password_hash,auth_version)
            VALUES($1,$2,$3,'pending',$4,1) RETURNING id`, [login, lead.name, lead.phone, hash])).rows[0];
          await rememberInitialPassword(sql, created.id, 1, password, this.crypto, this.now());
          account = await this.account(sql, created.id);
        }
        for (const target of [...command.students].sort((a, b) => a.studentId - b.studentId)) await this.bindRepresentative(sql, actor, account.id, leadId, target, command.relationship);
      }
      if (!mapped) await sql.query(`INSERT INTO portal_lead_accounts(lead_id,account_id,role,student_id,verified_by,verified_at)
        VALUES($1,$2,$3,$4,$5,$6)`, [leadId, account.id, command.role, command.role === 'self' ? command.studentId : null, actor.staffId, new Date(this.now())]);
      await credentialAudit(sql, actor, command.role === 'self' ? command.studentId : null, 'LEAD_ROLE_CONFIRMED', { leadId, accountId: account.id, role: command.role });
      return this.issue(sql, actor, account);
    });
  }
  private async bindRepresentative(sql: PoolClient, actor: PortalStaffActor, accountId: number, leadId: number, target: { studentId: number; classification: 'adult' | 'minor'; adultConsent: boolean }, relationship: string) {
    const student = await this.allowedStudent(sql, leadId, target.studentId);
    if (target.classification === 'adult' && !target.adultConsent) throw new PortalError('portalAdultConsentRequired');
    if (student.classification === 'unverified') {
      await sql.query(`INSERT INTO portal_student_identity(student_id,classification,verified_by,verified_at,verification_method)
        VALUES($1,$2,$3,$4,'academy_access') ON CONFLICT(student_id) DO UPDATE SET classification=EXCLUDED.classification,
        verified_by=EXCLUDED.verified_by,verified_at=EXCLUDED.verified_at,verification_method=EXCLUDED.verification_method`, [student.id, target.classification, actor.staffId, new Date(this.now())]);
      await sql.query("UPDATE portal_student_links SET permissions=$2::jsonb WHERE student_id=$1 AND kind='self' AND status<>'revoked'", [student.id, JSON.stringify(selfPermissions(target.classification, this.options.childFinanceVisible()))]);
      await credentialAudit(sql, actor, student.id, 'CLASSIFICATION_VERIFIED', { classification: target.classification, method: 'academy_access' });
    }
    const legalGuardian = relationship === 'parent' || relationship === 'guardian';
    const permissions = relationship === 'payer' ? ['finance.read', 'communication.create']
      : legalGuardian ? [...parentPermissions, ...(target.classification === 'minor' ? ['child_credentials.manage'] : [])]
      : ['learning.read', 'attendance.read', 'feedback.read', 'communication.create'];
    let link = (await sql.query<{ id: number; status: string }>("SELECT id,status FROM portal_student_links WHERE account_id=$1 AND student_id=$2 AND kind='representative' AND status<>'revoked' FOR UPDATE", [accountId, student.id])).rows[0];
    if (link?.status === 'suspended') throw new PortalError('portalAccountUnavailable', 409);
    if (link?.status === 'active') return;
    if (link) await sql.query("UPDATE portal_student_links SET permissions=$2::jsonb,relationship=$3,status='active',verified_by=$4,verified_at=$5 WHERE id=$1", [link.id, JSON.stringify(permissions), relationship, actor.staffId, new Date(this.now())]);
    else link = (await sql.query<{ id: number; status: string }>(`INSERT INTO portal_student_links(account_id,student_id,kind,relationship,permissions,status,verified_by,verified_at)
      VALUES($1,$2,'representative',$3,$4::jsonb,'active',$5,$6) RETURNING id,status`, [accountId, student.id, relationship, JSON.stringify(permissions), actor.staffId, new Date(this.now())])).rows[0];
    await sql.query(`INSERT INTO portal_consents(link_id,permissions,staff_id,method,created_at)
      VALUES($1,$2::jsonb,$3,$4,$5)`, [link.id, JSON.stringify(permissions), actor.staffId, target.classification === 'adult' ? 'in_person' : 'staff_verification', new Date(this.now())]);
    await credentialAudit(sql, actor, student.id, 'REPRESENTATIVE_ACCESS_CONFIRMED', { accountId, leadId, linkId: link.id, relationship, adultConsent: target.adultConsent });
  }
  showCredentials(actor: PortalStaffActor, leadId: number, accountId: number, version: number) {
    return this.transaction(async sql => {
      const account = await this.authorizedAccount(sql, leadId, accountId);
      if (account.auth_version !== version) throw new PortalError('academyAccessVersionConflict', 409);
      return this.issue(sql, actor, account);
    });
  }
  async changeCredentials(actor: PortalStaffActor, leadId: number, accountId: number, command: AcademyPortalCredentialChange) {
    const password = command.generatePassword ? this.crypto.randomToken().slice(0, 20) : command.password;
    const hash = password ? await this.crypto.hashPassword(password) : null;
    return this.transaction(async sql => {
      const account = await this.authorizedAccount(sql, leadId, accountId);
      if (account.auth_version !== command.version) throw new PortalError('academyAccessVersionConflict', 409);
      const source = (await sql.query<{ student_id: number }>("SELECT student_id FROM portal_student_links WHERE account_id=$1 AND kind='self' AND status<>'revoked' LIMIT 1", [accountId])).rows[0];
      const prefix = source ? `student-${source.student_id}` : `lead-${leadId}`;
      const login = command.generateLogin ? await generatePortalLogin(sql, prefix, this.crypto, true) : command.login ?? account.login;
      if ((await sql.query('SELECT id FROM portal_accounts WHERE login=$1 AND id<>$2', [login, accountId])).rowCount) throw new PortalError('portalLoginUnavailable', 409);
      if (!password && login === account.login) return { account: credentialAccount(account, this.now()), password: null };
      const nextVersion = account.auth_version + 1;
      let preservedInitialPassword: string | null = null;
      if (!password && credentialAccount(account, this.now()).hasInitialPassword && account.encrypted_password) {
        preservedInitialPassword = initialPortalPassword(account, this.encryptionKey, this.now());
      }
      await sql.query(`UPDATE portal_accounts SET login=$2,password_hash=COALESCE($3,password_hash),auth_version=$4,status='active',updated_at=$5 WHERE id=$1`, [accountId, login, hash, nextVersion, new Date(this.now())]);
      await sql.query('DELETE FROM portal_sessions WHERE account_id=$1', [accountId]);
      await sql.query("UPDATE portal_invitations SET status='revoked' WHERE account_id=$1 AND status IN('created','sent','delivery_failed')", [accountId]);
      await sql.query('UPDATE portal_initial_credentials SET encrypted_password=NULL WHERE account_id=$1', [accountId]);
      if (password) await rememberInitialPassword(sql, accountId, nextVersion, password, this.crypto, this.now());
      else if (preservedInitialPassword) await rememberInitialPassword(sql, accountId, nextVersion, preservedInitialPassword, this.crypto, this.now());
      await sql.query("UPDATE portal_student_links SET status='active',verified_at=COALESCE(verified_at,$3),verified_by=COALESCE(verified_by,$2) WHERE account_id=$1 AND kind='self' AND status='pending'", [accountId, actor.staffId, new Date(this.now())]);
      await credentialAudit(sql, actor, source?.student_id ?? null, 'STAFF_CREDENTIALS_CHANGED', { subjectAccountId: accountId, leadId, loginChanged: login !== account.login, passwordChanged: Boolean(password) });
      return { account: credentialAccount(await this.account(sql, accountId), this.now()), password: password ?? null };
    });
  }
}
