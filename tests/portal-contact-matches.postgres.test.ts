import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PortalIdentityService, createPostgresPortalRepository, createPortalCrypto, createPortalAccessRouter } from "../server/modules/portal-identity";

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `portal_contacts_it_${randomBytes(8).toString("hex")}`;
let admin: Pool, pool: Pool, service: PortalIdentityService;
const actor = { staffId: 1, modules: ["administration"], canManageAccess: true };
const app = (staff = actor, enabled = true) => {
  const server = express(); server.use(express.json());
  server.use("/students/:studentId/access", createPortalAccessRouter({ service, enabled, resolveStaffActor: () => staff }));
  return server;
};
describe.skipIf(!databaseUrl)("Exact portal contact warnings with PostgreSQL + HTTP", () => {
  beforeAll(async () => {
    if (!databaseUrl) return;
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(databaseUrl).hostname)) throw new Error("Contact tests require local PostgreSQL");
    admin = new Pool({ connectionString: databaseUrl }); await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema} -c timezone=UTC`, max: 8 });
    await pool.query("CREATE TABLE users(id serial PRIMARY KEY); CREATE TABLE academy_students(id serial PRIMARY KEY,student_name text,contact_name text,manager_id integer REFERENCES users(id))");
    await pool.query(readFileSync(new URL("../migrations/0134_portal_identity.sql", import.meta.url), "utf8"));
    service = new PortalIdentityService(createPostgresPortalRepository(pool), createPortalCrypto(randomBytes(32).toString("base64")), { appUrl: "https://academy.invalid", emailEnabled: false, allowInvitations: true });
  });
  beforeEach(async () => {
    const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname=$1", [schema])).rows.map((row) => `"${schema}"."${row.tablename}"`).join(",");
    await pool.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE;
      INSERT INTO users DEFAULT VALUES; INSERT INTO users DEFAULT VALUES; INSERT INTO users DEFAULT VALUES;
      INSERT INTO academy_students(student_name,contact_name,manager_id) VALUES('Own student','Contact',2),('Other student','Other contact',3),('No portal student','Contact',2);
      INSERT INTO portal_student_identity(student_id,classification,verified_at,verified_by,verification_method) VALUES(1,'minor',now(),1,'in_person'),(2,'minor',now(),1,'in_person'),(3,'minor',now(),1,'in_person');
      INSERT INTO portal_accounts(login,full_name,status,password_hash,email,email_verified_at,phone) VALUES
        ('own.parent','Own Parent','active','hash','own@example.invalid',now(),'+998 90 123 45 67'),
        ('other.parent','Private Other Parent','active','hash','other@example.invalid',now(),'998901234567'),
        ('pending.parent','Pending Parent','pending',NULL,'pending@example.invalid',NULL,'+998901234567'),
        ('blocked.parent','Blocked Parent','suspended','hash',NULL,NULL,'998901234567'),
        ('archived.parent','Archived Parent','archived','hash',NULL,NULL,'998901234567');
      INSERT INTO portal_student_links(account_id,student_id,kind,relationship,permissions,status,verified_at,verified_by) VALUES
        (1,1,'representative','parent','["learning.read"]','active',now(),1),(2,2,'representative','parent','["learning.read"]','active',now(),1);`);
  });
  afterAll(async () => { if (pool) await pool.end(); if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } });
  it("warns on exact normalized contacts without granting access, changing CRM or exposing authentication artifacts", async () => {
    const before = (await pool.query("SELECT count(*)::int FROM portal_student_links")).rows[0].count;
    const phone = await request(app()).post("/students/3/access/contact-matches").send({ phone: "+998 (90) 123-45-67" });
    expect(phone.status).toBe(200);
    expect(phone.body.items.map((row: { login: string }) => row.login)).toEqual(["other.parent","own.parent","blocked.parent","pending.parent"]);
    expect(phone.body.items[0]).toMatchObject({ matchedBy: ["phone"], canUse: true });
    expect(phone.body.items.find((row: { login: string }) => row.login === "pending.parent").canUse).toBe(false);
    expect(JSON.stringify(phone.body)).not.toMatch(/password|token|authVersion|email_verified|998901234567/);
    const email = await request(app()).post("/students/3/access/contact-matches").send({ email: " OWN@EXAMPLE.INVALID " });
    expect(email.body.items).toHaveLength(1); expect(email.body.items[0].matchedBy).toEqual(["email"]);
    expect((await pool.query("SELECT count(*)::int FROM portal_student_links")).rows[0].count).toBe(before);
    expect((await pool.query("SELECT count(*)::int FROM portal_invitations")).rows[0].count).toBe(0);
    expect((await service.checkContacts(actor,3,{ phone: "1234567" })).items).toHaveLength(0);
    expect((await service.checkContacts(actor,3,{ phone: "45-67" })).items).toHaveLength(0);
  });
  it("limits manager identities to their students and reports other matches without personal data", async () => {
    const sales = { staffId: 2, modules: ["sales"], canManageAccess: true };
    const own = await request(app(sales)).post("/students/3/access/contact-matches").send({ phone: "998901234567" });
    expect(own.status).toBe(200); expect(own.body.items.map((row: { login: string }) => row.login)).toEqual(["own.parent"]);
    expect(own.body.additionalMatches).toBe(true);
    expect(JSON.stringify(own.body)).not.toMatch(/Private Other Parent|other.parent|pending.parent|blocked.parent/);
    expect((await request(app(sales)).post("/students/2/access/contact-matches").send({ email: "other@example.invalid" })).status).toBe(403);
    expect((await request(app({ ...sales, canManageAccess: false })).post("/students/3/access/contact-matches").send({})).status).toBe(403);
    expect((await request(app(actor,false)).post("/students/3/access/contact-matches").send({})).status).toBe(404);
  });
  it("links only an explicitly chosen account and rejects unrelated or oversized request fields", async () => {
    expect((await request(app()).post("/students/3/access/contact-matches").send({ email: "invalid" })).status).toBe(400);
    expect((await request(app()).post("/students/3/access/contact-matches").send({ phone: "9".repeat(51) })).status).toBe(400);
    expect((await request(app()).post("/students/3/access/contact-matches").send({ phone: "998901234567", accountId: 1 })).status).toBe(400);
    await service.checkContacts(actor,3,{ phone: "998901234567" });
    const separate = await request(app()).post("/students/3/access/invitations").send({
      account: { login: "separate.parent", fullName: "Separate Parent", phone: "998901234567", locale: "en" },
      kind: "representative", relationship: "parent", permissions: ["learning.read"], verificationMethod: "in_person", verificationBasis: "Different person confirmed", channel: "manual", idempotencyKey: randomUUID(),
    });
    expect(separate.status).toBe(201); expect(separate.body.accountId).not.toBe(1);
    expect((await pool.query("SELECT account_id FROM portal_student_links WHERE student_id=3")).rows[0].account_id).toBe(separate.body.accountId);
    const explicit = await request(app()).post("/students/3/access/invitations").send({
      accountId: 1, kind: "representative", relationship: "parent", permissions: ["learning.read"], verificationMethod: "in_person", verificationBasis: "Account owner confirmed", channel: "manual", idempotencyKey: randomUUID(),
    });
    expect(explicit.status).toBe(201); expect(explicit.body.accountId).toBe(1);
  });
});
