import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import bcrypt from "bcrypt";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { portalInvitationCreateSchema } from "@shared/contracts/portal-identity";
import { PortalIdentityService } from "../server/modules/portal-identity/application/identity-service";
import { createPostgresPortalRepository } from "../server/modules/portal-identity/infrastructure/postgres-repository";
import { createPortalCrypto } from "../server/modules/portal-identity/infrastructure/crypto";

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `portal_identity_it_${crypto.randomBytes(8).toString("hex")}`;
let admin: Pool;
let pool: Pool;
let service: PortalIdentityService;
const staff = {
  staffId: 1,
  modules: ["administration"],
  canManageAccess: true,
};
const cmd = (login = "adult.login") =>
  portalInvitationCreateSchema.parse({
    account: { login, fullName: "Student" },
    kind: "self",
    verificationMethod: "in_person",
    verificationBasis: "Test identity confirmed",
    idempotencyKey: crypto.randomUUID(),
  });
const token = (url: string | null) =>
  new URLSearchParams(new URL(url!).hash.slice(1)).get("token")!;
const password = "ValidPassword123!";

describe.skipIf(!databaseUrl)(
  "portal identity isolated PostgreSQL integration",
  () => {
    beforeAll(async () => {
      if (!databaseUrl) return;
      const host = new URL(databaseUrl).hostname;
      if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host))
        throw new Error("Portal migration tests require local PostgreSQL");
      admin = new Pool({ connectionString: databaseUrl });
      await admin.query(`CREATE SCHEMA ${schema}`);
      pool = new Pool({
        connectionString: databaseUrl,
        options: `-c search_path=${schema}`,
        max: 10,
      });
      await pool.query(
        "CREATE TABLE users(id serial PRIMARY KEY); CREATE TABLE academy_students(id serial PRIMARY KEY,student_name text,contact_name text NOT NULL,manager_id integer REFERENCES users(id))",
      );
      await pool.query(
        readFileSync(
          new URL("../migrations/0134_portal_identity.sql", import.meta.url),
          "utf8",
        ),
      );
      const codec = createPortalCrypto(
        crypto.randomBytes(32).toString("base64"),
      );
      service = new PortalIdentityService(
        createPostgresPortalRepository(pool),
        { ...codec, hashPassword: (value) => bcrypt.hash(value, 1) },
        {
          appUrl: "https://academy.example",
          allowInvitations: true,
        },
      );
    });
    beforeEach(async () => {
      await pool.query(
        "TRUNCATE portal_identity_mail_outbox,portal_access_audit,portal_rate_limits,portal_sessions,portal_recovery_tokens,portal_invitations,portal_consents,portal_student_links,portal_student_identity,portal_account_contacts,portal_accounts,academy_students,users RESTART IDENTITY CASCADE",
      );
      await pool.query(
        "INSERT INTO users DEFAULT VALUES; INSERT INTO academy_students(contact_name,student_name,manager_id) VALUES('Adult','Adult',1),('Child','Child',1)",
      );
      await service.classifyStudent(staff, 1, "adult", "in_person", null);
      await service.classifyStudent(staff, 2, "minor", "in_person", null);
    });
    afterAll(async () => {
      if (pool) await pool.end();
      if (admin) {
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
      }
    });
    it("executes invitation, activation, session and object projection against real schema", async () => {
      const invite = await service.createInvitation(staff, 1, cmd());
      const requestId = crypto.randomUUID();
      const session = await service.acceptInvitation(
        token(invite.activationUrl),
        password,
        undefined,
        null,
        requestId,
      );
      const acceptedAudit = (await pool.query("SELECT request_id,details FROM portal_access_audit WHERE action='INVITATION_ACCEPTED'")).rows[0];
      expect(acceptedAudit).toEqual({ request_id: requestId, details: { linkId: invite.linkId } });
      expect(JSON.stringify(acceptedAudit)).not.toContain(token(invite.activationUrl));
      expect((await service.getSessionDto(session)).subjects[0]).toMatchObject({
        studentId: 1,
        kind: "self",
        studentClassification: "adult",
      });
      expect(
        (
          await service.resolveActor(
            session.id,
            invite.linkId,
            "assignments.submit",
          )
        ).portalAccountId,
      ).toBe(session.accountId);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM portal_access_audit",
          )
        ).rows[0].count,
      ).toBeGreaterThan(2);
    });
    it("serializes concurrent same-key invitation issuance and only returns the token once", async () => {
      const command = cmd();
      const results = await Promise.all([
        service.createInvitation(staff, 1, command),
        service.createInvitation(staff, 1, command),
      ]);
      expect(results[0].invitationId).toBe(results[1].invitationId);
      expect(results.filter((value) => value.activationUrl)).toHaveLength(1);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM portal_invitations",
          )
        ).rows[0].count,
      ).toBe(1);
    });
    it("consumes invitations atomically during concurrent activation", async () => {
      const invite = await service.createInvitation(staff, 1, cmd());
      const tokenValue = token(invite.activationUrl);
      const results = await Promise.allSettled([
        service.acceptInvitation(tokenValue, password, undefined, null),
        service.acceptInvitation(tokenValue, password, undefined, null),
      ]);
      expect(
        results.filter((value) => value.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.filter((value) => value.status === "rejected"),
      ).toHaveLength(1);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM portal_sessions WHERE account_id IS NOT NULL",
          )
        ).rows[0].count,
      ).toBe(1);
    });
    it("enforces unique own identity and representative permission allowlist in PostgreSQL", async () => {
      const invite = await service.createInvitation(staff, 1, cmd());
      await service.acceptInvitation(
        token(invite.activationUrl),
        password,
        undefined,
        null,
      );
      const account = (
        await pool.query(
          "INSERT INTO portal_accounts(login,full_name) VALUES('another.login','Another') RETURNING id",
        )
      ).rows[0];
      await expect(
        pool.query(
          "INSERT INTO portal_student_links(account_id,student_id,kind,permissions,status,verified_at) VALUES($1,1,'self','[]','pending',now())",
          [account.id],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      await expect(
        pool.query(
          "INSERT INTO portal_student_links(account_id,student_id,kind,relationship,permissions,status,verified_at) VALUES($1,2,'representative','parent','[\"assignments.submit\"]','pending',now())",
          [account.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        pool.query(
          "INSERT INTO portal_student_links(account_id,student_id,kind,relationship,permissions,status,verified_at) VALUES($1,2,'representative','parent','[\"unknown.permission\"]','pending',now())",
          [account.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
    it("keeps family contact phone and email non-unique without treating them as login aliases", async () => {
      await pool.query("INSERT INTO portal_accounts(login,full_name,phone,email) VALUES('child.login','Child','same-phone','family@example.com'),('parent.login','Parent','same-phone','family@example.com')");
      const repository = createPostgresPortalRepository(pool);
      expect(await repository.findAccount("family@example.com")).toBeNull();
      expect((await repository.findAccount("parent.login"))?.login).toBe('parent.login');
    });
    it("updates rate limits atomically across multiple repositories and clears reset session artifacts", async () => {
      const invite = await service.createInvitation(staff, 1, cmd());
      const session = await service.acceptInvitation(
        token(invite.activationUrl),
        password,
        undefined,
        null,
      );
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          createPostgresPortalRepository(pool).rateLimit(
            "same-key",
            5,
            60_000,
            Date.now(),
          ),
        ),
      );
      expect(results.filter((value) => value === null)).toHaveLength(5);
      expect(results.filter((value) => typeof value === "number")).toHaveLength(
        5,
      );
      await service.staffReset(
        staff,
        1,
        session.accountId!,
        password,
        "in_person",
        "Identity confirmed",
      );
      expect(await service.resolveSession(session.id)).toBeNull();
    });
    it("preserves relationship history through foreign-key restrictions and never resurrects deleted sessions", async () => {
      const invite = await service.createInvitation(staff, 1, cmd());
      const session = await service.acceptInvitation(
        token(invite.activationUrl),
        password,
        undefined,
        null,
      );
      await service.revokeLink(staff, 1, invite.linkId);
      await expect(
        pool.query("DELETE FROM academy_students WHERE id=1"),
      ).rejects.toMatchObject({ code: "23503" });
      const repository = createPostgresPortalRepository(pool);
      await repository.deleteSession(session.id);
      expect(await repository.touchSession(session)).toBe(false);
      expect(await repository.getSession(session.id)).toBeNull();
    });
    it("validates one hundred recent sessions without rewriting tuples and persists activity at thirty seconds", async () => {
      const invite = await service.createInvitation(staff, 1, cmd());
      const session = await service.acceptInvitation(token(invite.activationUrl), password, undefined, null);
      let now = session.lastSeenAt + 29_999;
      const clockService = new PortalIdentityService(createPostgresPortalRepository(pool), createPortalCrypto(crypto.randomBytes(32).toString("base64")), {
        appUrl: "https://academy.example", allowInvitations: true, now: () => now,
      });
      const state = async () => (await pool.query(
        "SELECT session.xmin::text AS session_xmin,account.xmin::text AS account_xmin,session.last_seen_at AS session_seen,account.last_seen_at AS account_seen FROM portal_sessions session JOIN portal_accounts account ON account.id=session.account_id WHERE session.id=$1", [session.id],
      )).rows[0];
      const initial = await state();
      for (let index = 0; index < 100; index++) expect((await clockService.resolveSession(session.id))?.id).toBe(session.id);
      expect(await state()).toEqual(initial);
      now = session.lastSeenAt + 30_000;
      expect((await clockService.resolveSession(session.id))?.id).toBe(session.id);
      const advanced = await state();
      expect(advanced.session_xmin).not.toBe(initial.session_xmin);
      expect(advanced.account_xmin).not.toBe(initial.account_xmin);
      expect(advanced.session_seen.getTime()).toBe(now);
      expect(advanced.account_seen.getTime()).toBe(now);
      expect((await clockService.resolveSession(session.id))?.id).toBe(session.id);
      expect(await state()).toEqual(advanced);
    });
    it("persists reauthentication immediately inside the activity interval and never moves timestamps backwards", async () => {
      const invite = await service.createInvitation(staff, 1, cmd());
      const session = await service.acceptInvitation(token(invite.activationUrl), password, undefined, null);
      const repository = createPostgresPortalRepository(pool);
      let now = session.lastSeenAt + 5_000;
      const clockService = new PortalIdentityService(repository, createPortalCrypto(crypto.randomBytes(32).toString("base64")), {
        appUrl: "https://academy.example", allowInvitations: true, now: () => now,
      });
      await clockService.reauthenticate(session.id, password);
      const fresh = await repository.getSession(session.id);
      expect(fresh?.reauthenticatedAt).toBe(now);
      expect(fresh?.lastSeenAt).toBe(now);
      now += 31_000;
      expect((await clockService.resolveSession(session.id))?.id).toBe(session.id);
      const later = await repository.getSession(session.id);
      expect(await repository.touchSession({ ...session, lastSeenAt: session.lastSeenAt + 1_000, reauthenticatedAt: session.reauthenticatedAt })).toBe(true);
      expect(await repository.getSession(session.id)).toEqual(later);
      expect(later?.reauthenticatedAt).toBe(fresh?.reauthenticatedAt);
    });
    it("rejects deleted, suspended, stale-version and expired sessions during the coalescing interval", async () => {
      const repository = createPostgresPortalRepository(pool);
      const invite = await service.createInvitation(staff, 1, cmd());
      const session = await service.acceptInvitation(token(invite.activationUrl), password, undefined, null);
      const recent = { ...session, lastSeenAt: session.lastSeenAt + 1_000 };
      expect(await repository.touchSession({ ...recent, authVersion: recent.authVersion + 1 })).toBe(false);
      await pool.query("UPDATE portal_accounts SET status='suspended' WHERE id=$1", [session.accountId]);
      expect(await repository.touchSession(recent)).toBe(false);
      await pool.query("UPDATE portal_accounts SET status='active',auth_version=auth_version+1 WHERE id=$1", [session.accountId]);
      expect(await repository.touchSession(recent)).toBe(false);
      await pool.query("UPDATE portal_accounts SET auth_version=$2 WHERE id=$1", [session.accountId, session.authVersion]);
      await pool.query("UPDATE portal_sessions SET absolute_expires_at=$2 WHERE id=$1", [session.id, new Date(recent.lastSeenAt)]);
      expect(await repository.touchSession(recent)).toBe(false);
      await pool.query("UPDATE portal_sessions SET absolute_expires_at=$2,last_seen_at=$3 WHERE id=$1", [session.id, new Date(recent.lastSeenAt + 86_400_000), new Date(recent.lastSeenAt - 86_400_000)]);
      expect(await repository.touchSession(recent)).toBe(false);
      await repository.deleteSession(session.id);
      expect(await repository.touchSession(recent)).toBe(false);
      expect(await repository.getSession(session.id)).toBeNull();
    });
    it("coalesces concurrent activity, preserves the newest confirmation and immediately rejects a later revocation", async () => {
      const invite = await service.createInvitation(staff, 1, cmd());
      const session = await service.acceptInvitation(token(invite.activationUrl), password, undefined, null);
      const repository = createPostgresPortalRepository(pool);
      const attempts = Array.from({ length: 20 }, (_, index) => ({ ...session, lastSeenAt: session.lastSeenAt + 31_000 + index, reauthenticatedAt: session.lastSeenAt + 1_000 + index }));
      expect(await Promise.all(attempts.map(attempt => repository.touchSession(attempt)))).toEqual(attempts.map(() => true));
      const current = await repository.getSession(session.id);
      expect(current?.lastSeenAt).toBeGreaterThanOrEqual(session.lastSeenAt + 31_000);
      expect(current?.lastSeenAt).toBeLessThanOrEqual(session.lastSeenAt + 31_019);
      expect(current?.reauthenticatedAt).toBe(session.lastSeenAt + 1_019);
      const resolved = await Promise.all(attempts.map((_, index) => repository.resolveActiveSession!(session.id, session.lastSeenAt + 62_000 + index)));
      expect(resolved.every(value => value?.id === session.id)).toBe(true);
      const refreshed = await repository.getSession(session.id);
      expect(refreshed?.lastSeenAt).toBeGreaterThanOrEqual(session.lastSeenAt + 62_000);
      expect(refreshed?.lastSeenAt).toBeLessThanOrEqual(session.lastSeenAt + 62_019);
      expect(refreshed?.reauthenticatedAt).toBe(current?.reauthenticatedAt);
      await service.setAccountStatus(staff, 1, session.accountId!, "suspended");
      expect(await Promise.all(attempts.map(attempt => repository.touchSession(attempt)))).toEqual(attempts.map(() => false));
      expect(await Promise.all(attempts.map(attempt => repository.resolveActiveSession!(session.id, attempt.lastSeenAt)))).toEqual(attempts.map(() => null));
      expect(await repository.getSession(session.id)).toBeNull();
      await expect(service.resolveActor(session.id, invite.linkId)).rejects.toMatchObject({ status: 401 });
    });
    it("rechecks link revocation and password changes while activity writes are coalesced", async () => {
      const invite = await service.createInvitation(staff, 1, cmd());
      const session = await service.acceptInvitation(token(invite.activationUrl), password, undefined, null);
      await service.revokeLink(staff, 1, invite.linkId);
      expect((await service.resolveSession(session.id))?.id).toBe(session.id);
      await expect(service.resolveActor(session.id, invite.linkId)).rejects.toMatchObject({ status: 403 });
      await service.changePassword(session.id, password, "AnotherPassword123!");
      expect(await service.resolveSession(session.id)).toBeNull();
      expect(await createPostgresPortalRepository(pool).touchSession({ ...session, lastSeenAt: session.lastSeenAt + 1_000 })).toBe(false);
    });
    it("resolves each current session in exactly one query with a minimal private record and atomic invalid cleanup", async () => {
      const invite = await service.createInvitation(staff, 1, cmd());
      const session = await service.acceptInvitation(token(invite.activationUrl), password, undefined, null);
      const statements: string[] = [];
      const observed = { query: (sql: string, values: unknown[]) => { statements.push(sql); return pool.query(sql, values); } } as unknown as Pool;
      const repository = createPostgresPortalRepository(observed);
      const now = session.lastSeenAt + 1_000;
      const clockService = new PortalIdentityService(repository, createPortalCrypto(crypto.randomBytes(32).toString("base64")), {
        appUrl: "https://academy.example", allowInvitations: true, now: () => now,
      });
      const valid = await clockService.resolveSession(session.id);
      expect(statements).toHaveLength(1);
      expect(valid).toEqual({ ...session, lastSeenAt: now });
      expect(Object.keys(valid!).sort()).toEqual(["id", "accountId", "authVersion", "createdAt", "lastSeenAt", "absoluteExpiresAt", "csrfToken", "reauthenticatedAt"].sort());
      expect(statements[0]).not.toMatch(/password_hash|full_name|pending_email|SELECT\s+account\.\*/i);
      const deny = async () => { statements.length = 0; expect(await clockService.resolveSession(session.id)).toBeNull(); expect(statements).toHaveLength(1); };
      await pool.query("UPDATE portal_accounts SET auth_version=auth_version+1 WHERE id=$1", [session.accountId]);
      await deny();
      expect(await createPostgresPortalRepository(pool).getSession(session.id)).toBeNull();
      await deny();
      await pool.query("UPDATE portal_accounts SET auth_version=$2 WHERE id=$1", [session.accountId, session.authVersion]);
      await createPostgresPortalRepository(pool).saveSession(session);
      await pool.query("UPDATE portal_accounts SET status='suspended' WHERE id=$1", [session.accountId]);
      await deny();
      expect(await createPostgresPortalRepository(pool).getSession(session.id)).toBeNull();
      await pool.query("UPDATE portal_accounts SET status='active' WHERE id=$1", [session.accountId]);
      await createPostgresPortalRepository(pool).saveSession({ ...session, absoluteExpiresAt: now });
      await deny();
      await createPostgresPortalRepository(pool).saveSession({ ...session, lastSeenAt: now - 86_400_000, absoluteExpiresAt: now + 86_400_000 });
      await deny();
    });
    it("reads the self actor in one query without credentials and immediately rechecks account and link revocation", async () => {
      const invite = await service.createInvitation(staff, 1, cmd());
      const session = await service.acceptInvitation(token(invite.activationUrl), password, undefined, null);
      const otherInvite = await service.createInvitation(staff, 2, cmd("child.login"));
      await service.acceptInvitation(token(otherInvite.activationUrl), password, undefined, null);
      const statements: string[] = [];
      const observed = { query: (sql: string, values: unknown[]) => { statements.push(sql); return pool.query(sql, values); } } as unknown as Pool;
      const repository = createPostgresPortalRepository(observed);
      const fast = new PortalIdentityService(repository, createPortalCrypto(crypto.randomBytes(32).toString("base64")), { appUrl: "https://academy.example", allowInvitations: true });
      const actor = await fast.resolveAccountActor(session.accountId!, invite.linkId, "finance.read", session.id);
      expect(statements).toHaveLength(1);
      expect(actor).toMatchObject({ portalAccountId: session.accountId, studentId: 1, linkId: invite.linkId, kind: "self", sessionId: session.id });
      const snapshot = await repository.readActorSnapshot!(session.accountId!, invite.linkId);
      expect(snapshot.account).toEqual({ id: session.accountId, status: "active" });
      expect(snapshot.student).toEqual({ id: 1, classification: "adult" });
      expect(JSON.stringify(snapshot)).not.toMatch(/password|hash|csrf|email|phone|fullName|studentName|birthDate|managerId|token/i);
      const denied = async (accountId: number, linkId: number, status: number) => { statements.length = 0; await expect(fast.resolveAccountActor(accountId, linkId)).rejects.toMatchObject({ status }); expect(statements).toHaveLength(1); };
      await denied(session.accountId!, otherInvite.linkId, 403);
      await denied(999999, invite.linkId, 401);
      await pool.query("UPDATE portal_accounts SET status='suspended' WHERE id=$1", [session.accountId]);
      await denied(session.accountId!, invite.linkId, 401);
      await pool.query("UPDATE portal_accounts SET status='active' WHERE id=$1", [session.accountId]);
      await service.revokeLink(staff, 1, invite.linkId);
      await denied(session.accountId!, invite.linkId, 403);
    });
    it("uses the same exact adult-consent policy from one fresh snapshot instead of combining partial grants", async () => {
      const invite = await service.createInvitation(staff, 1, portalInvitationCreateSchema.parse({ ...cmd("parent.login"), kind: "representative", relationship: "parent", permissions: ["learning.read", "finance.read"] }));
      const session = await service.acceptInvitation(token(invite.activationUrl), password, undefined, null);
      const original = createPostgresPortalRepository(pool);
      const statements: string[] = [];
      const observed = { query: (sql: string, values: unknown[]) => { statements.push(sql); return pool.query(sql, values); } } as unknown as Pool;
      const fast = new PortalIdentityService(createPostgresPortalRepository(observed), createPortalCrypto(crypto.randomBytes(32).toString("base64")), { appUrl: "https://academy.example", allowInvitations: true });
      const deny = async () => { statements.length = 0; await expect(fast.resolveAccountActor(session.accountId!, invite.linkId)).rejects.toMatchObject({ status: 403 }); expect(statements).toHaveLength(1); };
      await deny();
      await original.updateLink(invite.linkId, { status: "active" });
      const consent = (permissions: ("learning.read" | "finance.read")[], method: "in_person" | "portal" | "staff_verification") => original.createConsent({ linkId: invite.linkId, permissions, method, subjectAccountId: null, staffId: 1, revokedAt: null, createdAt: Date.now() });
      await consent(["learning.read", "finance.read"], "staff_verification");
      await deny();
      await consent(["learning.read"], "in_person"); await consent(["finance.read"], "portal");
      await deny();
      await consent(["finance.read", "learning.read"], "in_person");
      statements.length = 0;
      expect((await fast.resolveAccountActor(session.accountId!, invite.linkId)).permissions).toEqual(["learning.read", "finance.read"]);
      expect(statements).toHaveLength(1);
      await original.revokeConsents(invite.linkId, Date.now());
      await deny();
    });
    it("keeps two children and their permissions separate and rechecks classification, verification and expiry in one snapshot", async () => {
      const invite = await service.createInvitation(staff, 2, portalInvitationCreateSchema.parse({ ...cmd("parent.login"), kind: "representative", relationship: "parent", permissions: ["attendance.read", "child_credentials.manage"] }));
      const session = await service.acceptInvitation(token(invite.activationUrl), password, undefined, null);
      const original = createPostgresPortalRepository(pool);
      const adultLink = await original.createLink({ accountId: session.accountId!, studentId: 1, kind: "representative", relationship: "payer", permissions: ["finance.read"], status: "active", verifiedAt: Date.now(), verifiedBy: 1, expiresAt: null });
      await original.createConsent({ linkId: adultLink.id, permissions: ["finance.read"], method: "in_person", subjectAccountId: null, staffId: 1, revokedAt: null, createdAt: Date.now() });
      const statements: string[] = [];
      const observed = { query: (sql: string, values: unknown[]) => { statements.push(sql); return pool.query(sql, values); } } as unknown as Pool;
      const fast = new PortalIdentityService(createPostgresPortalRepository(observed), createPortalCrypto(crypto.randomBytes(32).toString("base64")), { appUrl: "https://academy.example", allowInvitations: true });
      const child = await fast.resolveAccountActor(session.accountId!, invite.linkId, "child_credentials.manage");
      expect(statements).toHaveLength(1); expect(child.studentId).toBe(2); expect(child.permissions).toEqual(["attendance.read", "child_credentials.manage"]);
      statements.length = 0;
      const adult = await fast.resolveAccountActor(session.accountId!, adultLink.id, "finance.read");
      expect(statements).toHaveLength(1); expect(adult.studentId).toBe(1); expect(adult.permissions).toEqual(["finance.read"]);
      const deny = async () => { statements.length = 0; await expect(fast.resolveAccountActor(session.accountId!, invite.linkId)).rejects.toMatchObject({ status: 403 }); expect(statements).toHaveLength(1); };
      await original.updateStudentIdentity(2, "unverified", null, 1, "in_person"); await deny();
      await original.updateStudentIdentity(2, "minor", null, 1, "in_person");
      await original.updateLink(invite.linkId, { status: "pending", verifiedAt: null }); await deny();
      await original.updateLink(invite.linkId, { status: "active", verifiedAt: Date.now(), expiresAt: Date.now() - 1 }); await deny();
    });
  },
);
