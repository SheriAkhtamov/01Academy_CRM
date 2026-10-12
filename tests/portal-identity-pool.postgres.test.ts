import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import bcrypt from "bcrypt";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { portalInvitationCreateSchema } from "@shared/contracts/portal-identity";
import { PortalIdentityService } from "../server/modules/portal-identity/application/identity-service";
import type { PortalIdentityOptions, PortalRepository } from "../server/modules/portal-identity/application/ports";
import { createPortalCrypto } from "../server/modules/portal-identity/infrastructure/crypto";
import { createPostgresPortalRepository } from "../server/modules/portal-identity/infrastructure/postgres-repository";
import type { AppConfig } from "../server/config";
import { createLearningRuntime } from "../server/infrastructure/lms-runtime";
import { DEFAULT_LEARNING_SCHOOL_SETTINGS } from "@shared/contracts/learning-settings";

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `portal_identity_pool_it_${crypto.randomBytes(8).toString("hex")}`;
const codec = createPortalCrypto(crypto.randomBytes(32).toString("base64"));
const cheapCrypto = { ...codec, hashPassword: (value: string) => bcrypt.hash(value, 1) };
const password = "ValidPassword123!";
const staff = { staffId: 1, modules: ["administration"], canManageAccess: true };
let admin: Pool;
let fixture: Pool;
let limited: Pool;
let repository: PortalRepository;
let service: PortalIdentityService;
let now: number;

const command = (login: string, representative = false) => portalInvitationCreateSchema.parse({
  account: { login, fullName: "Synthetic identity" },
  kind: representative ? "representative" : "self",
  relationship: representative ? "parent" : null,
  permissions: representative ? ["child_credentials.manage"] : [],
  verificationMethod: "in_person",
  verificationBasis: "Synthetic fixture confirmed",
  channel: "manual",
  idempotencyKey: crypto.randomUUID(),
});
const options = (extra: Partial<PortalIdentityOptions> = {}): PortalIdentityOptions => ({
  appUrl: "https://academy.example", allowInvitations: true, now: () => now, ...extra,
});

async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Identity command exceeded bounded test deadline")), 2_000);
    })]);
  } finally { clearTimeout(timer); }
}

function rendezvous() {
  let arrivals = 0, release!: () => void;
  const joined = new Promise<void>(resolve => { release = resolve; });
  return async () => { if (++arrivals === 2) release(); await bounded(joined); };
}

const poolOptions = (max: number) => ({
  connectionString: databaseUrl, options: `-c search_path=${schema} -c statement_timeout=2000`,
  max, connectionTimeoutMillis: 250,
});

async function activate(studentId: number, login: string, representative = false) {
  const invite = await service.createInvitation(staff, studentId, command(login, representative));
  const token = new URLSearchParams(new URL(invite.activationUrl!).hash.slice(1)).get("token")!;
  const session = await service.acceptInvitation(token, password, undefined, null);
  return { invite, session };
}

async function runtimeFixture() {
  const config = JSON.parse(readFileSync(new URL("../config/app.config.example.json", import.meta.url), "utf8")) as AppConfig;
  config.server.environment = "development";
  config.portal = { enabled: true, learningEnabled: true, publicPortfolioEnabled: false, allowInvitations: true,
    groupIds: [11], sessionSecret: "pool-regression-fixture-session-secret-123456789", tokenEncryptionKey: crypto.randomBytes(32).toString("base64"),
    };
  const runtime = createLearningRuntime(limited, config);
  await runtime.flags.refresh();
  return runtime;
}

function holdBothRuntimeChecks(runtime: Awaited<ReturnType<typeof runtimeFixture>>) {
  const enabled = runtime.flags.enabledForStudent.bind(runtime.flags), join = rendezvous();
  const snapshots: { total: number; idle: number }[] = [];
  const spy = vi.spyOn(runtime.flags, "enabledForStudent").mockImplementation(async (key, studentId, reader) => {
    await join();
    snapshots.push({ total: limited.totalCount, idle: limited.idleCount });
    return enabled(key, studentId, reader);
  });
  return { snapshots, restore: () => spy.mockRestore() };
}

describe.skipIf(!databaseUrl)("identity policy checks on the held PostgreSQL connection", () => {
  beforeAll(async () => {
    if (!databaseUrl) return;
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(databaseUrl).hostname))
      throw new Error("Identity pool tests require local PostgreSQL");
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA ${schema}`);
    fixture = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    await fixture.query("CREATE TABLE users(id serial PRIMARY KEY); CREATE TABLE academy_students(id serial PRIMARY KEY,student_name text,contact_name text NOT NULL,manager_id integer REFERENCES users(id)); CREATE TABLE academy_student_group_enrollments(id serial PRIMARY KEY,student_id integer REFERENCES academy_students(id),group_id integer NOT NULL,status text,enrolled_at timestamptz,ended_at timestamptz)");
    await fixture.query(readFileSync(new URL("../migrations/0134_portal_identity.sql", import.meta.url), "utf8"));
    await fixture.query("CREATE TABLE lms_feature_flags(key text PRIMARY KEY,enabled boolean,all_groups boolean,group_ids integer[],updated_at timestamptz,version integer); CREATE TABLE lms_school_settings(singleton boolean PRIMARY KEY,settings jsonb,version integer,updated_by integer)");
    limited = new Pool(poolOptions(2));
    repository = createPostgresPortalRepository(limited);
  });
  beforeEach(async () => {
    now = Date.now();
    await fixture.query("TRUNCATE portal_identity_mail_outbox,portal_access_audit,portal_rate_limits,portal_sessions,portal_recovery_tokens,portal_invitations,portal_consents,portal_student_links,portal_student_identity,portal_account_contacts,portal_accounts,academy_students,users RESTART IDENTITY CASCADE");
    await fixture.query("INSERT INTO users DEFAULT VALUES; INSERT INTO academy_students(contact_name,student_name,manager_id) VALUES('Synthetic adult','Synthetic adult',1),('Synthetic child','Synthetic child',1); INSERT INTO academy_student_group_enrollments(student_id,group_id,status,enrolled_at,ended_at) VALUES(1,11,'completed',now()-interval '2 years',now()-interval '1 year'),(1,11,'withdrawn',now()-interval '3 years',now()-interval '2 years'),(1,20,'active',now(),NULL),(2,11,'withdrawn',now()-interval '2 years',now()-interval '1 year')");
    await fixture.query("TRUNCATE lms_feature_flags,lms_school_settings; INSERT INTO lms_feature_flags(key,enabled,all_groups,group_ids,updated_at,version) VALUES('learning',true,false,ARRAY[11,20],now(),1),('invitations',true,false,ARRAY[11,20],now(),1),('email',true,false,ARRAY[11,20],now(),1),('public_portfolio',false,false,'{}',now(),1)");
    await fixture.query("INSERT INTO lms_school_settings(singleton,settings,version,updated_by) VALUES(true,$1::jsonb,1,NULL)", [JSON.stringify(DEFAULT_LEARNING_SCHOOL_SETTINGS)]);
    service = new PortalIdentityService(createPostgresPortalRepository(fixture), cheapCrypto, options());
    await service.classifyStudent(staff, 1, "adult", "in_person", null);
    await service.classifyStudent(staff, 2, "minor", "in_person", null);
  });
  afterAll(async () => {
    if (limited) await limited.end();
    if (fixture) await fixture.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });

  it("reads distinct historical memberships and observes a fresh committed cohort change", async () => {
    expect(await repository.getStudentEnrollmentGroupIds(1)).toEqual([11, 20]);
    expect(await repository.getStudentEnrollmentGroupIds(2)).toEqual([11]);
    expect(await repository.getStudentEnrollmentGroupIds(999)).toEqual([]);
    await repository.transaction(async current => {
      expect(await current.getStudentEnrollmentGroupIds(1)).toEqual([11, 20]);
      await fixture.query("INSERT INTO academy_student_group_enrollments(student_id,group_id,status) VALUES(1,99,'completed')");
      expect(await current.getStudentEnrollmentGroupIds(1)).toEqual([11, 20, 99]);
    });
  });

  it("issues two invitations while both pool connections are already held by their transactions", async () => {
    const join = rendezvous();
    const snapshots: { total: number; idle: number }[] = [];
    const identity = new PortalIdentityService(repository, cheapCrypto, options({
      invitationsEnabledForStudent: async (studentId, current = repository) => {
        await join();
        snapshots.push({ total: limited.totalCount, idle: limited.idleCount });
        return (await current.getStudentEnrollmentGroupIds(studentId)).includes(11);
      },
    }));
    const invitations = await bounded(Promise.all([
      identity.createInvitation(staff, 1, command("parallel1.login")),
      identity.createInvitation(staff, 2, command("parallel2.login")),
    ]));
    expect(invitations).toHaveLength(2);
    expect(snapshots).toEqual([{ total: 2, idle: 0 }, { total: 2, idle: 0 }]);
    expect((await fixture.query("SELECT (SELECT count(*)::int FROM portal_accounts) AS accounts,(SELECT count(*)::int FROM portal_student_links) AS links,(SELECT count(*)::int FROM portal_invitations) AS invitations,(SELECT count(*)::int FROM portal_access_audit WHERE action='INVITATION_CREATED') AS audits,(SELECT count(*)::int FROM portal_identity_mail_outbox) AS mail")).rows[0])
      .toEqual({ accounts: 2, links: 2, invitations: 2, audits: 2, mail: 0 });
    expect(limited.waitingCount).toBe(0); expect(limited.idleCount).toBe(2);
  });

  it("rejects a non-pilot student inside the transaction without creating access or mail", async () => {
    const before = (await fixture.query("SELECT count(*)::int AS count FROM portal_access_audit")).rows[0].count;
    const identity = new PortalIdentityService(repository, cheapCrypto, options({
      invitationsEnabledForStudent: async (studentId, current = repository) => (await current.getStudentEnrollmentGroupIds(studentId)).includes(20),
    }));
    await expect(bounded(identity.createInvitation(staff, 2, command("denied.login")))).rejects.toMatchObject({ code: "portalInvitationsDisabled", status: 403 });
    expect((await fixture.query("SELECT (SELECT count(*)::int FROM portal_accounts) AS accounts,(SELECT count(*)::int FROM portal_student_links) AS links,(SELECT count(*)::int FROM portal_invitations) AS invitations,(SELECT count(*)::int FROM portal_consents) AS consents,(SELECT count(*)::int FROM portal_identity_mail_outbox) AS mail,(SELECT count(*)::int FROM portal_access_audit) AS audits")).rows[0])
      .toEqual({ accounts: 0, links: 0, invitations: 0, consents: 0, mail: 0, audits: before });
    expect(limited.waitingCount).toBe(0);
  });

  it("uses the held connection for staff activation and new child credentials even with a one-connection pool", async () => {
    const pending = await service.createInvitation(staff, 1, command("pending.login"));
    const parent = await activate(2, "parent.login", true);
    const single = new Pool(poolOptions(1));
    const original = createPostgresPortalRepository(single);
    const identity = new PortalIdentityService(original, cheapCrypto, options({
      invitationsEnabledForStudent: async (studentId, current = original) => (await current.getStudentEnrollmentGroupIds(studentId)).includes(11),
    }));
    try {
      await bounded(identity.staffReset(staff, 1, pending.accountId, password, "in_person", "Synthetic identity confirmed"));
      await bounded(identity.childCredentials(parent.session.id, parent.invite.linkId, password, "child.login"));
      expect((await fixture.query("SELECT login,status,password_hash IS NOT NULL AS has_password FROM portal_accounts ORDER BY login")).rows)
        .toEqual([{ login: "child.login", status: "active", has_password: true }, { login: "parent.login", status: "active", has_password: true }, { login: "pending.login", status: "active", has_password: true }]);
      expect(single.waitingCount).toBe(0); expect(single.idleCount).toBe(1);
    } finally { await single.end(); }
  });

  it("uses the production runtime wiring for parallel invitations and requires the same group in both rollout restrictions", async () => {
    const runtime = await runtimeFixture(), held = holdBothRuntimeChecks(runtime);
    try {
      const result = await bounded(Promise.all([
        runtime.identity.createInvitation(staff, 1, command("runtime1.login")),
        runtime.identity.createInvitation(staff, 2, command("runtime2.login")),
      ]));
      expect(result).toHaveLength(2);
      expect(held.snapshots).toEqual([{ total: 2, idle: 0 }, { total: 2, idle: 0 }]);
      held.restore();
      await fixture.query("UPDATE lms_feature_flags SET group_ids=ARRAY[20] WHERE key='invitations'");
      await runtime.flags.refresh();
      // This student has groups 11 and 20, but no group matches flag 20 and configuration 11 together.
      await expect(bounded(runtime.identity.createInvitation(staff, 1, command("mismatch.login")))).rejects.toMatchObject({ code: "portalInvitationsDisabled", status: 403 });
      expect((await fixture.query("SELECT count(*)::int AS count FROM portal_accounts")).rows[0].count).toBe(2);
      expect((await fixture.query("SELECT count(*)::int AS count FROM portal_invitations")).rows[0].count).toBe(2);
      expect(limited.waitingCount).toBe(0);
    } finally { held.restore(); await runtime.stop(); }
  });
});
