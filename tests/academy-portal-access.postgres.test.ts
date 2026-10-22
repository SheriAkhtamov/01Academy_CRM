import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import bcrypt from 'bcrypt';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { academyPortalCredentialChangeSchema, academyPortalLeadRoleSchema } from '@shared/contracts/academy-portal-access';
import { PostgresAcademyPortalAccessRepository } from '../server/modules/portal-identity/infrastructure/academy-access-repository';
import { AcademyPortalAccessService } from '../server/modules/portal-identity/application/academy-access-service';
import { createPortalCrypto } from '../server/modules/portal-identity/infrastructure/crypto';
import { createPostgresPortalRepository } from '../server/modules/portal-identity/infrastructure/postgres-repository';
import { PortalIdentityService } from '../server/modules/portal-identity/application/identity-service';

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `academy_credentials_it_${randomBytes(8).toString('hex')}`;
const staff = { staffId: 1, modules: ['administration'], canManageAccess: true };
let admin: Pool, pool: Pool, repository: PostgresAcademyPortalAccessRepository, service: AcademyPortalAccessService, identity: PortalIdentityService;
const key = randomBytes(32).toString('base64');
const crypto = { ...createPortalCrypto(key), hashPassword: (value: string) => bcrypt.hash(value, 1) };
const query = { q: '', page: 1, pageSize: 25 };
const parent = (studentId = 2, classification: 'adult' | 'minor' = 'minor', adultConsent = false) => academyPortalLeadRoleSchema.parse({
  role: 'representative', relationship: 'parent', relationshipConfirmed: true, students: [{ studentId, classification, adultConsent }],
});

describe.skipIf(!databaseUrl)('Academy lead access, local credentials and retired mail migration', () => {
  beforeAll(async () => {
    if (!databaseUrl || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(databaseUrl).hostname)) throw new Error('Local test database required');
    admin = new Pool({ connectionString: databaseUrl }); await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema} -c timezone=UTC` });
    await pool.query(`CREATE TABLE users(id serial PRIMARY KEY);
      CREATE TABLE academy_leads(id serial PRIMARY KEY,contact_name text NOT NULL,phone text NOT NULL);
      CREATE TABLE academy_students(id serial PRIMARY KEY,lead_id integer REFERENCES academy_leads(id),student_name text,contact_name text NOT NULL,phone text,manager_id integer REFERENCES users(id));
      CREATE TABLE academy_courses(id serial PRIMARY KEY); CREATE TABLE academy_groups(id serial PRIMARY KEY,course_id integer);
      CREATE TABLE academy_lessons(id serial PRIMARY KEY,group_id integer);
      CREATE TABLE academy_student_group_enrollments(id serial PRIMARY KEY,student_id integer,group_id integer,enrolled_at timestamptz,ended_at timestamptz);
      CREATE TABLE academy_payments(id serial PRIMARY KEY,amount_uzs integer); CREATE TABLE academy_portfolio_projects(id serial PRIMARY KEY);`);
    for (const name of ['0134_portal_identity', '0135_lms_learning', '0136_portal_resources', '0137_lms_crm_preparation', '0138_manual_portal_credentials']) {
      await pool.query(readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8'));
    }
    repository = new PostgresAcademyPortalAccessRepository(pool, crypto, key, { enabled: () => true, enabledForStudent: () => true });
    service = new AcademyPortalAccessService(repository, () => true);
    identity = new PortalIdentityService(createPostgresPortalRepository(pool, { initialCredentials: true }), crypto, { appUrl: 'https://academy.example', allowInvitations: true });
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE users,academy_leads,academy_students,portal_accounts RESTART IDENTITY CASCADE');
    await pool.query(`INSERT INTO users DEFAULT VALUES;
      INSERT INTO academy_leads(contact_name,phone) VALUES('Adult learner','shared-phone'),('Parent','shared-phone'),('Empty lead','shared-phone');
      INSERT INTO academy_students(lead_id,student_name,contact_name,phone,manager_id) VALUES(1,'Adult learner','Adult learner','shared-phone',1),(2,'Child','Parent','shared-phone',1);
      INSERT INTO lms_feature_flags(key,enabled,all_groups,group_ids) VALUES('learning',true,true,'{}'),('invitations',true,true,'{}') ON CONFLICT(key) DO UPDATE SET enabled=true,all_groups=true,group_ids='{}';`);
  });
  afterAll(async () => { if (pool) await pool.end(); if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } });

  it('generates pending student accounts without guessing lead roles or exposing passwords in the directory', async () => {
    const before = await service.directory(staff, query);
    expect(before.total).toBe(2); expect(before.items.every(lead => !lead.account && !lead.students[0].account)).toBe(true);
    expect(await repository.provisioning.runOnce()).toEqual({ prepared: 2 });
    expect(await repository.provisioning.runOnce()).toEqual({ prepared: 0 });
    const directory = await service.directory(staff, query);
    expect(directory.items.every(lead => lead.role === null && lead.account === null && lead.students[0].account?.status === 'pending')).toBe(true);
    expect(JSON.stringify(directory)).not.toMatch(/encrypted|password_hash|"password"/);
    expect((await service.directory(staff, { ...query, q: 'student-2' })).items.map(lead => lead.id)).toEqual([2]);
    expect((await service.directory(staff, { ...query, q: '%' })).total).toBe(0);
    const encrypted = (await pool.query('SELECT encrypted_password FROM portal_initial_credentials')).rows;
    expect(encrypted.every(row => !row.encrypted_password.includes('password'))).toBe(true);
  });
  it('restores manually issued parent access after the adult student consents again', async () => {
    await repository.provisioning.runOnce();
    const representative = await service.chooseLeadRole(staff, 2, parent());
    const child = (await pool.query("SELECT account.id,account.auth_version FROM portal_accounts account JOIN portal_student_links link ON link.account_id=account.id WHERE link.student_id=2 AND link.kind='self'")).rows[0];
    const credentials = await service.showCredentials(staff, 2, child.id, child.auth_version);
    const session = await identity.login(credentials.account.login, credentials.password!, 'child-consent');
    expect(await identity.listSubjects(representative.account.id)).toHaveLength(1);
    await identity.classifyStudent(staff, 2, 'adult', 'in_person', null);
    const link = (await identity.ownRepresentatives(session.id))[0];
    expect(link.status).toBe('suspended');
    await identity.representativeConsent(session.id, link.linkId, link.permissions, true);
    expect((await identity.ownRepresentatives(session.id))[0].status).toBe('active');
    expect(await identity.listSubjects(representative.account.id)).toHaveLength(1);
    expect((await pool.query('SELECT count(*)::int AS count FROM portal_invitations')).rows[0].count).toBe(0);
    await pool.query("UPDATE portal_accounts SET status='suspended' WHERE id=$1", [representative.account.id]);
    await expect(identity.representativeConsent(session.id, link.linkId, link.permissions, true)).rejects.toMatchObject({code:'portalAccountUnavailable'});
    await identity.representativeConsent(session.id, link.linkId, link.permissions, false);
    await expect(identity.representativeConsent(session.id, link.linkId, link.permissions, true)).rejects.toMatchObject({code:'portalLinkNotFound'});
  });
  it('prepares eligible accounts beyond a disabled callback prefix without duplicates on concurrent runs', async () => {
    await pool.query("INSERT INTO academy_students(id,lead_id,student_name,contact_name,phone,manager_id) SELECT n,2,'Child '||n,'Parent','shared-phone',1 FROM generate_series(3,26) n");
    const rollout = new PostgresAcademyPortalAccessRepository(pool, crypto, key, {
      enabled: () => true, enabledForStudent: id => id === 26,
    });
    const results = await Promise.all([rollout.provisioning.runOnce(), rollout.provisioning.runOnce()]);
    expect(results.reduce((sum,result) => sum + result.prepared,0)).toBe(1);
    expect(await rollout.provisioning.runOnce()).toEqual({prepared:0});
    expect((await pool.query("SELECT student_id FROM portal_student_links WHERE kind='self'")).rows).toEqual([{student_id:26}]);
  });
  it('applies group rollout before batching and retains the account preparation limit', async () => {
    await pool.query("INSERT INTO academy_students(id,lead_id,student_name,contact_name,phone,manager_id) SELECT n,2,'Child '||n,'Parent','shared-phone',1 FROM generate_series(3,26) n; INSERT INTO academy_groups(id) VALUES(7); INSERT INTO academy_student_group_enrollments(student_id,group_id,enrolled_at) VALUES(26,7,now()); UPDATE lms_feature_flags SET all_groups=false,group_ids='{7}' WHERE key='invitations'");
    expect(await repository.provisioning.runOnce()).toEqual({prepared:1});
    expect((await pool.query("SELECT student_id FROM portal_student_links WHERE kind='self'")).rows).toEqual([{student_id:26}]);
    await pool.query("TRUNCATE portal_accounts CASCADE; UPDATE lms_feature_flags SET all_groups=true WHERE key='invitations'");
    expect(await repository.provisioning.runOnce()).toEqual({prepared:25});
    expect(await repository.provisioning.runOnce()).toEqual({prepared:1});
    expect(await repository.provisioning.runOnce()).toEqual({prepared:0});
  });
  it('reuses the student account for an explicit adult self role and erases the initial password after successful login', async () => {
    await repository.provisioning.runOnce();
    const result = await service.chooseLeadRole(staff, 1, { role: 'self', studentId: 1 });
    expect(result.password).toBeTruthy(); expect(result.account.status).toBe('active');
    expect((await pool.query('SELECT count(*)::int AS count FROM portal_accounts')).rows[0].count).toBe(2);
    const session = await identity.login(result.account.login, result.password!, 'fixture-ip');
    expect(session.accountId).toBe(result.account.id);
    expect((await service.showCredentials(staff, 1, result.account.id, result.account.version)).password).toBeNull();
    expect((await pool.query('SELECT encrypted_password FROM portal_initial_credentials WHERE account_id=$1', [result.account.id])).rows[0].encrypted_password).toBeNull();
  });
  it('creates a distinct parent account and never grants student submission rights to the parent', async () => {
    await repository.provisioning.runOnce();
    const result = await service.chooseLeadRole(staff, 2, parent());
    const child = (await service.directory(staff, query)).items.find(lead => lead.id === 2)!.students[0].account!;
    expect(result.account.id).not.toBe(child.id); expect(result.password).toBeTruthy();
    const links = await identity.listSubjects(result.account.id);
    expect(links[0]).toMatchObject({ kind: 'representative', studentId: 2 });
    expect(links[0].permissions).toContain('child_credentials.manage');
    expect(links[0].permissions).not.toContain('assignments.submit');
    expect((await identity.listSubjects(child.id))).toEqual([]);
    await expect(service.chooseLeadRole(staff, 2, { role: 'self', studentId: 2 })).rejects.toMatchObject({ code: 'academyAccessRoleConflict' });
  });
  it('requires adult consent and denies foreign lead, empty lead and non-admin credential access', async () => {
    await expect(service.chooseLeadRole(staff, 1, parent(1, 'adult'))).rejects.toMatchObject({ code: 'portalAdultConsentRequired' });
    await expect(service.chooseLeadRole(staff, 3, { role: 'self', studentId: 1 })).rejects.toMatchObject({ status: 404 });
    const own = await service.chooseLeadRole(staff, 1, { role: 'self', studentId: 1 });
    await expect(service.showCredentials(staff, 2, own.account.id, 1)).rejects.toMatchObject({ status: 403 });
    await expect(service.directory({ ...staff, modules: ['sales'] }, query)).rejects.toMatchObject({ status: 403 });
    await expect(service.chooseLeadRole(staff, 2, { role: 'self', studentId: 1 })).rejects.toMatchObject({ status: 404 });
  });
  it('changes a login without changing its password and uses versions to prevent stale resets', async () => {
    const original = await service.chooseLeadRole(staff, 1, { role: 'self', studentId: 1 });
    const renamed = await service.changeCredentials(staff, 1, original.account.id, academyPortalCredentialChangeSchema.parse({ version: 1, login: 'renamed.student' }));
    expect(renamed.account.version).toBe(2);
    expect((await service.showCredentials(staff, 1, original.account.id, 2)).password).toBe(original.password);
    await expect(identity.login(original.account.login, original.password!, 'old-ip')).rejects.toMatchObject({ status: 401 });
    const session = await identity.login(renamed.account.login, original.password!, 'new-ip');
    const reset = await service.changeCredentials(staff, 1, original.account.id, academyPortalCredentialChangeSchema.parse({ version: 2, generatePassword: true }));
    expect(reset.password).not.toBe(original.password); expect(await identity.resolveSession(session.id)).toBeNull();
    await expect(service.changeCredentials(staff, 1, original.account.id, academyPortalCredentialChangeSchema.parse({ version: 2, generatePassword: true }))).rejects.toMatchObject({ code: 'academyAccessVersionConflict' });
    await expect(identity.login(renamed.account.login, original.password!, 'wrong-ip')).rejects.toMatchObject({ status: 401 });
    expect((await identity.login(renamed.account.login, reset.password!, 'correct-ip')).accountId).toBe(original.account.id);
    const audit = JSON.stringify((await pool.query('SELECT details FROM portal_access_audit')).rows);
    expect(audit).not.toContain(original.password!); expect(audit).not.toContain(reset.password!);
  });
  it('rejects swapped encrypted credentials and does not resurrect revoked or suspended accounts', async () => {
    await repository.provisioning.runOnce();
    const directory = await service.directory(staff, query);
    const first = directory.items.find(lead => lead.id === 1)!.students[0].account!;
    const second = directory.items.find(lead => lead.id === 2)!.students[0].account!;
    await pool.query('UPDATE portal_initial_credentials SET encrypted_password=(SELECT encrypted_password FROM portal_initial_credentials WHERE account_id=$2) WHERE account_id=$1', [first.id, second.id]);
    await expect(service.showCredentials(staff, 1, first.id, 1)).rejects.toMatchObject({ code: 'academyAccessInitialUnavailable' });
    await pool.query("UPDATE portal_student_links SET status='revoked' WHERE account_id=$1;", [first.id]);
    await pool.query("UPDATE portal_accounts SET status='suspended' WHERE id=$1", [second.id]);
    expect(await repository.provisioning.runOnce()).toEqual({ prepared: 0 });
    await expect(service.showCredentials(staff, 2, second.id, 1)).rejects.toMatchObject({ code: 'portalAccountUnavailable' });
  });
  it('retains contact addresses while removing mail queues, recovery tokens and mail notification channels', async () => {
    const tables = (await pool.query('SELECT tablename FROM pg_tables WHERE schemaname=$1', [schema])).rows.map(row => row.tablename);
    expect(tables).not.toContain('portal_identity_mail_outbox'); expect(tables).not.toContain('portal_recovery_tokens');
    expect((await pool.query("SELECT key FROM lms_feature_flags WHERE key='email'")).rows).toEqual([]);
    await pool.query("INSERT INTO portal_accounts(login,full_name,email) VALUES('contact.one','Contact','same@example.invalid'),('contact.two','Contact','same@example.invalid')");
    expect(await createPostgresPortalRepository(pool).findAccount('same@example.invalid')).toBeNull();
  });
});
