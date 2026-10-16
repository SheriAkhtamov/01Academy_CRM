import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import bcrypt from "bcrypt";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PortalIdentityService } from "../server/modules/portal-identity/application/identity-service";
import type { PortalAccount, PortalSession } from "../server/modules/portal-identity/application/ports";
import { createPostgresPortalRepository } from "../server/modules/portal-identity/infrastructure/postgres-repository";
import { createPortalCrypto } from "../server/modules/portal-identity/infrastructure/crypto";

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `portal_photo_it_${randomBytes(8).toString("hex")}`;
const photo = "/api/portal/me/photos/AAAAAAAAAAAAAAAAAAAAA";
const replacement = "/api/portal/me/photos/BBBBBBBBBBBBBBBBBBBBB";
const migration = readFileSync(new URL("../migrations/0153_portal_profile_photos.sql", import.meta.url), "utf8");
let admin: Pool, pool: Pool;
let repository: ReturnType<typeof createPostgresPortalRepository>;
let service: PortalIdentityService;
let owner: PortalAccount, other: PortalAccount, session: PortalSession;
let passwordHash: string;
const password = "ValidPassword123!";
const now = Date.UTC(2026, 9, 16);

describe.skipIf(!databaseUrl)("portal profile photos in isolated PostgreSQL", () => {
  beforeAll(async () => {
    if (!databaseUrl) return;
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(databaseUrl).hostname))
      throw new Error("Portal photo tests require local PostgreSQL");
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema} -c timezone=UTC`, max: 4 });
    await pool.query("CREATE TABLE users(id serial PRIMARY KEY); CREATE TABLE academy_students(id serial PRIMARY KEY,student_name text,contact_name text NOT NULL,manager_id integer REFERENCES users(id))");
    await pool.query(readFileSync(new URL("../migrations/0134_portal_identity.sql", import.meta.url), "utf8"));
    await pool.query("INSERT INTO portal_accounts(login,full_name) VALUES('preexisting.login','Existing account')");
    await pool.query(migration);
    expect((await pool.query("SELECT full_name,avatar_url FROM portal_accounts WHERE login='preexisting.login'")).rows)
      .toEqual([{ full_name: "Existing account", avatar_url: null }]);
    passwordHash = await bcrypt.hash(password, 1);
    repository = createPostgresPortalRepository(pool);
    service = new PortalIdentityService(repository, createPortalCrypto(randomBytes(32).toString("base64")), {
      appUrl: "https://academy.example", allowInvitations: false, now: () => now,
    });
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE portal_accounts RESTART IDENTITY CASCADE");
    const account = (login: string): Omit<PortalAccount, "id"> => ({
      login, fullName: login, email: null, phone: null, locale: "ru", status: "active",
      passwordHash, authVersion: 1, avatarUrl: photo,
    });
    owner = await repository.createAccount(account("owner.login"));
    other = await repository.createAccount(account("other.login"));
    session = { id: randomUUID(), accountId: owner.id, authVersion: 1, csrfToken: "photo-csrf", createdAt: now,
      lastSeenAt: now, absoluteExpiresAt: now + 60_000, reauthenticatedAt: null };
    await repository.saveSession(session);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });

  it("persists create/update mappings, preserves existing data on migration replay and keeps other accounts unchanged", async () => {
    expect((await repository.getAccount(owner.id))?.avatarUrl).toBe(photo);
    const updated = await service.updateProfile(session.id, { fullName: "Updated owner", phone: "+998900000000" }, replacement);
    expect(updated).toMatchObject({ id: owner.id, fullName: "Updated owner", avatarUrl: replacement });
    expect(updated).not.toHaveProperty("passwordHash");
    await pool.query(migration);
    expect((await service.getSessionDto(session)).account?.avatarUrl).toBe(replacement);
    expect((await service.updateProfile(session.id, { locale: "en" })).avatarUrl).toBe(replacement);
    const relogged = await service.login(owner.login, password, "127.0.0.1");
    expect((await service.getSessionDto(relogged)).account?.avatarUrl).toBe(replacement);
    expect(await repository.getAccount(other.id)).toMatchObject({ fullName: "other.login", avatarUrl: photo, locale: "ru" });
    expect((await pool.query("SELECT normalized_value FROM portal_account_contacts WHERE account_id=$1", [owner.id])).rows)
      .toEqual([{ normalized_value: "+998900000000" }]);
  });

  it("rolls back both profile and photo when a related contact write fails", async () => {
    await pool.query(`CREATE FUNCTION reject_photo_contact() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'contact write failed'; END $$;
      CREATE TRIGGER reject_photo_contact BEFORE INSERT ON portal_account_contacts FOR EACH ROW EXECUTE FUNCTION reject_photo_contact()`);
    try {
      await expect(service.updateProfile(session.id, { fullName: "Must roll back", phone: "+998900000000" }, replacement))
        .rejects.toThrow("contact write failed");
      expect(await repository.getAccount(owner.id)).toMatchObject({ fullName: "owner.login", phone: null, avatarUrl: photo });
      expect((await pool.query("SELECT count(*)::integer AS count FROM portal_account_contacts")).rows[0].count).toBe(0);
    } finally {
      await pool.query("DROP TRIGGER reject_photo_contact ON portal_account_contacts; DROP FUNCTION reject_photo_contact()");
    }
  });

  it.each(["revoked-session", "changed-credentials", "suspended-account"] as const)(
    "rejects a committed %s between authentication and the photo transaction", async (change) => {
      const transaction = repository.transaction.bind(repository);
      let resume: () => void = () => {};
      let authenticated: () => void = () => {};
      const reached = new Promise<void>((resolve) => { authenticated = resolve; });
      const proceed = new Promise<void>((resolve) => { resume = resolve; });
      const spy = vi.spyOn(repository, "transaction").mockImplementationOnce(async (work) => {
        authenticated();
        await proceed;
        return transaction(work);
      });
      const updating = service.updateProfile(session.id, { fullName: "Denied update" }, replacement);
      await reached;
      if (change === "revoked-session") await pool.query("DELETE FROM portal_sessions WHERE id=$1", [session.id]);
      else if (change === "changed-credentials") await pool.query("UPDATE portal_accounts SET auth_version=auth_version+1 WHERE id=$1", [owner.id]);
      else await pool.query("UPDATE portal_accounts SET status='suspended' WHERE id=$1", [owner.id]);
      resume();
      await expect(updating).rejects.toMatchObject({ code: "portalAuthenticationRequired", status: 401 });
      spy.mockRestore();
      expect(await repository.getAccount(owner.id)).toMatchObject({ fullName: "owner.login", avatarUrl: photo });
      expect(await repository.getAccount(other.id)).toMatchObject({ fullName: "other.login", avatarUrl: photo });
    },
  );
});
