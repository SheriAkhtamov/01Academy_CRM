import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { portalDirectoryQuerySchema } from "@shared/contracts/portal-directory";
import { createPortalAdminRouter, csvCell } from "../server/modules/portal-identity/http/admin-router";
import { PortalDirectoryRepository } from "../server/modules/portal-identity/infrastructure/directory-repository";
import { createPostgresPortalRepository } from "../server/modules/portal-identity/infrastructure/postgres-repository";
import type { PortalSession } from "../server/modules/portal-identity/application/ports";
import { requestContextMiddleware } from "../server/middleware/errorHandler";
const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `portal_directory_it_${randomBytes(8).toString("hex")}`;
const now = new Date("2026-10-11T12:00:00Z");
let admin: Pool, pool: Pool, repository: PortalDirectoryRepository;
const query = (input: object = {}) => portalDirectoryQuerySchema.parse(input);
const app = (module = "administration", enabled = true, manage = true) => {
  const server = express();
  server.use(requestContextMiddleware);
  server.use("/api/lms-management", createPortalAdminRouter({ repository, enabled, resolveStaffActor: request => ({ staffId: 1, modules: [module], canManageAccess: manage, requestId: request.requestId }) }));
  return server;
};
describe("Portal access CSV cells", () => {
  it("quotes cells and prevents formulas in names and logins", () => {
    expect(csvCell('A "quoted" name')).toBe('"A ""quoted"" name"');
    expect(csvCell("=HYPERLINK(\"bad\")")).toBe('"\'=HYPERLINK(""bad"")"');
    expect(csvCell("  +SUM(A1)")).toBe('"\'  +SUM(A1)"');
    expect(csvCell("@username")).toBe('"\'@username"');
    expect(csvCell("\tname")).toBe('"\'\tname"');
  });
});
describe.skipIf(!databaseUrl)("Portal administration directory PostgreSQL + HTTP", () => {
  beforeAll(async () => {
    if (!databaseUrl) return;
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(databaseUrl).hostname)) throw new Error("Portal directory tests require local PostgreSQL");
    admin = new Pool({ connectionString: databaseUrl }); await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema} -c timezone=UTC`, max: 8 });
    await pool.query(`CREATE TABLE users(id serial PRIMARY KEY,full_name text,is_active boolean DEFAULT true,is_archived boolean DEFAULT false);
      CREATE TABLE academy_students(id serial PRIMARY KEY,student_name text,contact_name text,status text DEFAULT 'studying',manager_id integer REFERENCES users(id),lead_id integer,group_id integer,updated_at timestamptz DEFAULT now());
      CREATE TABLE academy_groups(id serial PRIMARY KEY,name text);
      CREATE TABLE academy_student_group_enrollments(id serial PRIMARY KEY,student_id integer REFERENCES academy_students(id),group_id integer REFERENCES academy_groups(id),enrolled_at timestamptz,ended_at timestamptz);`);
    await pool.query(readFileSync(new URL("../migrations/0134_portal_identity.sql", import.meta.url), "utf8"));
    repository = new PortalDirectoryRepository(pool, () => now);
  });
  beforeEach(async () => {
    const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname=$1", [schema])).rows.map((row) => `"${schema}"."${row.tablename}"`).join(",");
    await pool.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
    await pool.query(`INSERT INTO users(full_name) VALUES('Administrator'),('Manager');
      INSERT INTO academy_groups(name) VALUES('Group One'),('Group Two');
      INSERT INTO academy_students(student_name,contact_name,manager_id,lead_id,group_id) VALUES('Anna','Anna contact',2,11,1),('Adult','Adult contact',2,12,2),('Unverified','Unverified contact',2,13,NULL),('Pending','Pending contact',2,14,1),('Blocked','Blocked contact',2,15,1),('Revoked','Revoked contact',2,16,2);
      INSERT INTO academy_student_group_enrollments(student_id,group_id,enrolled_at) VALUES(1,1,'2026-09-01'),(2,2,'2026-09-01'),(4,1,'2026-09-01'),(5,1,'2026-09-01'),(6,2,'2026-09-01');
      INSERT INTO portal_student_identity(student_id,classification,verified_at,verified_by,verification_method) VALUES(1,'minor',now(),1,'in_person'),(2,'adult',now(),1,'in_person'),(4,'minor',now(),1,'in_person'),(5,'minor',now(),1,'in_person'),(6,'minor',now(),1,'in_person');
      INSERT INTO portal_accounts(login,full_name,status,password_hash,last_seen_at) VALUES('anna.login','Anna','active','hash','2026-10-10T12:00:00Z'),('parent.login','Parent','active','hash','2026-10-03T12:00:00Z'),('pending.login','Pending','pending',NULL,NULL),('blocked.login','Blocked','suspended','hash','2026-09-01T12:00:00Z'),('revoked.login','Revoked','active','hash','2026-10-10T12:00:00Z');
      INSERT INTO portal_student_links(account_id,student_id,kind,relationship,permissions,status,verified_at,verified_by) VALUES(1,1,'self',NULL,'["learning.read"]','active',now(),1),(2,1,'representative','parent','["learning.read"]','active',now(),1),(2,2,'representative','payer','["finance.read"]','active',now(),1),(3,4,'self',NULL,'[]','pending',now(),1),(4,5,'self',NULL,'["learning.read"]','suspended',now(),1),(5,6,'self',NULL,'["learning.read"]','revoked',now(),1);
      INSERT INTO portal_invitations(account_id,link_id,token_hash,expires_at,status,channel,created_by,idempotency_key,request_hash) VALUES(3,4,repeat('a',64),'2026-10-12','created','manual',1,'00000000-0000-4000-8000-000000000001',repeat('b',64));`);
    // Refresh estimates for the small fixture after every truncate and seed.
    await pool.query("ANALYZE users,academy_students,academy_groups,academy_student_group_enrollments,portal_student_identity,portal_accounts,portal_student_links,portal_invitations,portal_consents");
  });
  afterAll(async () => { if (pool) await pool.end(); if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } });
  it("paginates stable rows and returns current account metadata without authentication artifacts", async () => {
    const first = await repository.students(query({ pageSize: 2 }));
    const second = await repository.students(query({ pageSize: 2, page: 2 }));
    expect(first.total).toBe(6); expect(first.items.map((row) => row.student.id)).toEqual([2, 1]);
    expect(first.items.some((row) => second.items.some((next) => next.student.id === row.student.id))).toBe(false);
    expect(first.groups).toHaveLength(2);
    const anna = first.items.find((row) => row.student.id === 1)!;
    expect(anna.student.managerName).toBe("Manager"); expect(anna.selfAccount?.login).toBe("anna.login");
    expect(anna.representatives[0].login).toBe("parent.login"); expect(anna.lastSeenAt).toBe("2026-10-10T12:00:00.000Z");
    expect(JSON.stringify(first)).not.toMatch(/password_hash|csrf|token_hash|encrypted_payload/);
    expect(anna.selfAccount).not.toHaveProperty("hasAccess");
  });
  it("filters no access, pending, unverified and blocked with adult consent and revocation enforced", async () => {
    expect((await repository.students(query({ filter: "without_access" }))).items.map((row) => row.student.id).sort()).toEqual([2, 3, 4, 5, 6]);
    expect((await repository.students(query({ filter: "pending" }))).items.map((row) => row.student.id)).toEqual([4]);
    expect((await repository.students(query({ filter: "unverified" }))).items.map((row) => row.student.id).sort()).toEqual([2, 3]);
    expect((await repository.students(query({ filter: "blocked" }))).items.map((row) => row.student.id)).toEqual([5]);
    await pool.query("INSERT INTO portal_consents(link_id,permissions,method,staff_id) VALUES(3,'[\"finance.read\"]','in_person',1)");
    expect((await repository.students(query({ filter: "without_access" }))).items.some((row) => row.student.id === 2)).toBe(false);
    expect((await repository.students(query({ filter: "unverified" }))).items.map((row) => row.student.id)).toEqual([3]);
    await pool.query("UPDATE portal_invitations SET expires_at='2026-10-10' WHERE id=1");
    expect((await repository.students(query({ filter: "pending" }))).total).toBe(0);
    expect((await repository.students(query({ q: "Pending" }))).items[0].selfAccount?.invitationStatus).toBe("expired");
  });
  it("scopes search/groups, escapes wildcard input and gives explicit unique-account denominators", async () => {
    const all = await repository.students(query());
    expect(all.stats).toMatchObject({ students: 6, accounts: 4, activatedAccounts: 3, activationPercent: 75, active7Days: 1, active30Days: 2 });
    const group = await repository.students(query({ groupId: 2 }));
    expect(group.items.map((row) => row.student.id).sort()).toEqual([2, 6]);
    expect(group.stats).toMatchObject({ students: 2, accounts: 1, active30Days: 1 });
    expect((await repository.students(query({ q: "parent.login" }))).items.map((row) => row.student.id).sort()).toEqual([1, 2]);
    expect((await repository.students(query({ q: "%" }))).total).toBe(0);
  });
  it("lists one representative once with both students, scopes links and filters the representative's own access", async () => {
    const all = await repository.representatives(query());
    expect(all.total).toBe(1); expect(all.items[0].students).toHaveLength(2);
    expect((await repository.representatives(query({ groupId: 1 }))).items[0].students.map((item) => item.student.id)).toEqual([1]);
    expect((await repository.representatives(query({ filter: "without_access" }))).items[0].students.map((item) => item.student.id)).toEqual([2]);
    expect((await repository.representatives(query({ filter: "blocked" }))).total).toBe(0);
    await pool.query("UPDATE portal_accounts SET status='suspended' WHERE id=2");
    expect((await repository.representatives(query({ filter: "blocked" }))).items[0].students).toHaveLength(2);
  });
  it("retains monotonic last visits after logout and ignores a session revoked by account suspension", async () => {
    const identity = createPostgresPortalRepository(pool);
    const session: PortalSession = { id: "test-session", accountId: 1, authVersion: 1, createdAt: now.getTime(), lastSeenAt: now.getTime(), absoluteExpiresAt: now.getTime() + 86400_000, csrfToken: "csrf", reauthenticatedAt: now.getTime() };
    await identity.saveSession(session);
    await identity.touchSession({ ...session, lastSeenAt: now.getTime() - 1000, reauthenticatedAt: null });
    await identity.deleteSession(session.id);
    expect((await repository.students(query({ q: "anna.login" }))).items[0].lastSeenAt).toBe(now.toISOString());
    await identity.saveSession(session);
    await pool.query("UPDATE portal_accounts SET status='suspended',auth_version=2 WHERE id=1");
    expect(await identity.touchSession({ ...session, lastSeenAt: now.getTime() + 1000 })).toBe(false);
  });
  it("allows only administrators, validates pagination and closes the whole route when disabled", async () => {
    await request(app("sales")).get("/api/lms-management/access-directory").expect(403);
    await request(app("teacher")).get("/api/lms-management/representatives").expect(403);
    await request(app("administration", true, false)).get("/api/lms-management/access-directory/export").expect(403);
    await request(app("administration", false)).get("/api/lms-management/access-directory").expect(404);
    await request(app()).get("/api/lms-management/access-directory?pageSize=1000").expect(400);
    const result = await request(app()).get("/api/lms-management/access-directory?pageSize=2").expect(200);
    expect(result.headers["cache-control"]).toBe("private, no-store"); expect(result.body.items).toHaveLength(2);
  });
  it("exports only filtered students with local headers and safe names, and logs its scope", async () => {
    await pool.query("UPDATE academy_students SET student_name='=HYPERLINK(\"unsafe\")' WHERE id=1");
    const requestId = "directory-export-fixture-request";
    const csv = await request(app()).get("/api/lms-management/access-directory/export?groupId=1&locale=en").set("X-Request-ID", requestId).expect(200);
    expect(csv.headers["content-type"]).toContain("text/csv"); expect(csv.text).toContain('"Student"');
    expect(csv.text).toContain('"\'=HYPERLINK(""unsafe"")"'); expect(csv.text).not.toContain("Adult contact");
    const audit = (await pool.query("SELECT request_id,details FROM portal_access_audit WHERE action='ADMIN_ACCESS_EXPORT'")).rows[0];
    expect(audit).toEqual({ request_id: requestId, details: { filter: "all", groupId: 1, count: 3 } });
    expect(JSON.stringify(audit)).not.toContain("HYPERLINK");
    await repository.auditExport(1, query({ groupId: 2 }), 0);
    expect((await pool.query("SELECT request_id FROM portal_access_audit WHERE action='ADMIN_ACCESS_EXPORT' ORDER BY id DESC LIMIT 1")).rows[0].request_id).toBeNull();
    expect(await repository.exportStudents(query(), 2)).toBeNull();
  });
});
