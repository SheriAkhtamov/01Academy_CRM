import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { collectLmsHealth, parseLmsHttpMetrics, readLmsHttpMetrics } from "../scripts/lms-health-metrics";
import { parseLmsHealthArguments } from "../scripts/lms-health";

const now = new Date("2026-10-11T15:00:00Z");
const record = (message: string, timestamp = "2026-10-11 14:59:00", extra = {}) => JSON.stringify({ message, timestamp, ...extra });

describe("read-only LMS operational metrics", () => {
  it("extracts portal HTTP counters and p95 from current Morgan/structured logs without private values", () => {
    const lines = [record("POST /api/portal/auth/login 401 10 ms", undefined, { password: "do-not-show", email: "secret@example.invalid" }),
      record("POST /api/portal/auth/login 429 20 ms"), record("GET /api/portal/subjects/1/files?token=private 403 30 ms"),
      record("GET /api/lms-management/students 500 40 ms"), record("GET /api/public/portfolio/private-share 200 50 ms"),
      record("GET /api/academy/students/5/portal-access 200 60 ms"), record("GET /api/academy/students 401 99999 ms"),
      record("POST /api/portal/auth/login 401 99999 ms", "2026-10-10 14:00:00"),
      JSON.stringify({ timestamp: now.toISOString(), path: "/api/portal/me", statusCode: 200, durationMs: 70 }), "malformed"];
    const metrics = parseLmsHttpMetrics(lines, now);
    expect(metrics).toMatchObject({ requests: 7, unauthorized401: 1, rateLimited429: 1, forbidden403: 1, serverErrors5xx: 1, authErrors: 2, accessErrors: 1, latencySamples: 7, p95Ms: 70, malformedLines: 1, ignoredLines: 2 });
    expect(JSON.stringify(metrics)).not.toMatch(/private|secret|password|token|share/);
    expect(parseLmsHttpMetrics([record("GET /api/portal/me 200 - ms")], now).p95Ms).toBeNull();
    expect(parseLmsHttpMetrics([JSON.stringify({ timestamp: now.toISOString(), path: "/api/portal/me", status: { toString: null, valueOf: null }, durationMs: 5 })], now).requests).toBe(0);
  });
  it("bounds log reads and refuses symlinks, special files and partial lines", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "lms-health-log-"));
    try {
      const log = path.join(directory, "combined.log");
      await writeFile(log, `${"x".repeat(2500)}\n${record("GET /api/portal/me 200 8 ms")}\n${record("GET /api/portal/me 200 999 ms")}`);
      await symlink(log, path.join(directory, "alias.log"));
      const metrics = await readLmsHttpMetrics([log, path.join(directory, "alias.log"), directory], now, 60, 2000);
      expect(metrics).toMatchObject({ filesRead: 1, bytesRead: 2000, requests: 1, p95Ms: 8, truncated: true });
      const refused = await readLmsHttpMetrics([path.join(directory, "alias.log"), directory], now, 60, 1024);
      expect(refused.filesRead).toBe(0);
      expect(refused.unavailableFiles).toBe(2);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("returns safe unavailable metrics and validates regular backup markers and archives", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "lms-health-backup-"));
    const failed = { connect: async () => { throw Object.assign(new Error("postgresql://private:password@server/private"), { code: "ECONNREFUSED" }); } } as unknown as Pool;
    try {
      const archive = "academy-crm-backup-20261011T140000Z.zip";
      await writeFile(path.join(directory, archive), "archive-fixture");
      await writeFile(path.join(directory, ".last-success"), `2026-10-11T14:00:00Z ${archive}\n`);
      const report = await collectLmsHealth(failed, { uploadsDirectory: directory, backupDirectory: directory, now });
      expect(report.database).toMatchObject({ available: false, code: "ECONNREFUSED", resourceOutbox: null });
      expect(report.backup).toMatchObject({ ageSeconds: 3600, archiveBytes: 15, code: null });
      expect(report.disk.availableBytes).toBeGreaterThan(0);
      expect(report.notificationFailed).toBeNull();
      expect(JSON.stringify(report)).not.toContain("private");
      expect(JSON.stringify(report)).not.toContain(directory);
      await writeFile(path.join(directory, ".last-success"), "2026-10-11T14:00:00Z ../secret.zip\n");
      expect((await collectLmsHealth(failed, { uploadsDirectory: directory, backupDirectory: directory, now })).backup).toMatchObject({ ageSeconds: null, code: "HEALTH_BACKUP_MARKER_INVALID" });
      await rm(path.join(directory, ".last-success"));
      await symlink(path.join(directory, archive), path.join(directory, ".last-success"));
      expect((await collectLmsHealth(failed, { uploadsDirectory: directory, backupDirectory: directory, now })).backup.code).not.toBeNull();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("rejects unbounded inputs and never treats missing arguments as instructions to connect", async () => {
    const pool = { connect: vi.fn() } as unknown as Pool;
    expect(parseLmsHealthArguments(["--help"]).help).toBe(true);
    expect(parseLmsHealthArguments(["--log-file", "/tmp/first", "--log-file", "/tmp/second"]).options.logFiles).toHaveLength(2);
    expect(() => parseLmsHealthArguments(["--unknown", "secret"])).toThrow("HEALTH_ARGUMENT_INVALID");
    await expect(collectLmsHealth(pool, { uploadsDirectory: "/tmp", backupDirectory: "/tmp", logMaxBytes: 1 })).rejects.toThrow("HEALTH_ARGUMENT_INVALID");
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it("does not require antivirus services, signature storage or scanner networks for the CRM", () => {
    const yaml = createRequire(import.meta.url)("js-yaml");
    const compose = yaml.load(readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8"));
    expect(compose.services.clamav).toBeUndefined();
    expect(compose.services["clamav-updater"]).toBeUndefined();
    expect(compose.volumes.clamav_signatures).toBeUndefined();
    expect(compose.networks).toBeUndefined();
    expect(compose.services.crm.networks).toEqual(["default"]);
    expect(compose.services.crm.ports).toEqual(["127.0.0.1:8011:5001"]);
  });
});

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `lms_health_it_${randomBytes(8).toString("hex")}`;
let admin: Pool, pool: Pool, directory: string;
describe.skipIf(!databaseUrl)("LMS health PostgreSQL read-only snapshots", () => {
  beforeAll(async () => {
    if (!databaseUrl) return;
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(databaseUrl).hostname)) throw new Error("Health integration tests require local PostgreSQL");
    directory = await mkdtemp(path.join(os.tmpdir(), "lms-health-pg-"));
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA ${schema};
      CREATE TABLE ${schema}.lms_resource_outbox(state text,channel text,deliver_after timestamptz,locked_at timestamptz,created_at timestamptz);
      CREATE TABLE ${schema}.portal_identity_mail_outbox(status text,available_at timestamptz,locked_at timestamptz,created_at timestamptz);
      CREATE TABLE ${schema}.lms_files(state text,scan_after timestamptz,deleted_at timestamptz,created_at timestamptz);
      INSERT INTO ${schema}.lms_resource_outbox VALUES
        ('pending','in_app','2026-10-11 14:55Z',NULL,'2026-10-11 14:00Z'),
        ('pending','email','2026-10-11 16:00Z',NULL,'2026-10-11 14:30Z'),
        ('pending','email','2026-10-11 14:59Z','2026-10-11 14:59Z','2026-10-11 14:59Z'),
        ('failed','email','2026-10-11 14:59Z',NULL,'2026-10-11 14:59Z'),
        ('failed','in_app','2026-10-11 14:59Z',NULL,'2026-10-11 14:59Z');
      INSERT INTO ${schema}.portal_identity_mail_outbox VALUES
        ('pending','2026-10-11 14:45Z',NULL,'2026-10-11 13:00Z'),
        ('delivering','2026-10-11 14:55Z','2026-10-11 14:55Z','2026-10-11 14:50Z'),
        ('failed','2026-10-11 14:55Z',NULL,'2026-10-11 14:50Z');
      INSERT INTO ${schema}.lms_files VALUES
        ('uploading','2026-10-11 14:00Z',NULL,'2026-10-11 14:00Z'),
        ('checking','2026-10-11 14:30Z',NULL,'2026-10-11 14:30Z'),
        ('checking','2026-10-11 16:00Z',NULL,'2026-10-11 14:45Z'),
        ('rejected','2026-10-11 14:30Z',NULL,'2026-10-11 14:30Z'),
        ('checking','2026-10-10 14:30Z','2026-10-11 14:00Z','2026-10-10 14:30Z');`);
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema} -c timezone=UTC -c default_transaction_read_only=on` });
  });
  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  it("reports queue age, quarantine and failed email without any SQL writes", async () => {
    const client = await pool.connect();
    const query = vi.spyOn(client, "query");
    const connect = vi.spyOn(pool, "connect").mockResolvedValue(client as never);
    let report, statements: string[];
    try {
      report = await collectLmsHealth(pool, { uploadsDirectory: directory, backupDirectory: directory, now });
      statements = query.mock.calls.map(([sql]) => String(sql));
    } finally { connect.mockRestore(); query.mockRestore(); }
    expect(statements!.some((sql) => /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP)\b/i.test(sql))).toBe(false);
    expect(statements!).toContain("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(report!.database.available).toBe(true);
    expect(report!.database.resourceOutbox).toEqual({ pending: 3, inAppPending: 1, due: 2, failed: 2, oldestPendingAgeSeconds: 3600, oldestDueAgeSeconds: 300, oldestLeaseAgeSeconds: 60 });
    expect(report!.database.quarantine).toEqual({ uploading: 1, checking: 2, rejected: 1, due: 1, oldestUploadingAgeSeconds: 3600, oldestCheckingAgeSeconds: 1800 });
    expect(report!.notificationFailed).toBe(2);
    expect((await pool.query("SELECT count(*) FROM lms_resource_outbox")).rows[0].count).toBe("5");
  });
  it("returns absent tables as unavailable instead of zero metrics or schema creation", async () => {
    const absent = new Pool({ connectionString: databaseUrl, options: "-c search_path=pg_catalog -c default_transaction_read_only=on" });
    try {
      const report = await collectLmsHealth(absent, { uploadsDirectory: directory, backupDirectory: directory, now });
      expect(report.database.available).toBe(true);
      expect(report.database.unavailableTables).toEqual(["lms_resource_outbox", "lms_files"]);
      expect(report.database.quarantine).toBeNull();
      expect(report.notificationFailed).toBeNull();
    } finally { await absent.end(); }
  });
});
