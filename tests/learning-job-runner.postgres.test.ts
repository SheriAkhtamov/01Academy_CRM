import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createLearningJobRunner, type LearningJobName } from "../server/infrastructure/learning-job-runner";

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `learning_jobs_${randomBytes(6).toString("hex")}`;
let admin: Pool, business: Pool, leaseA: Pool, leaseB: Pool;

describe.skipIf(!databaseUrl)("Distributed learning job coordination on isolated PostgreSQL", () => {
  beforeAll(async () => {
    if (!databaseUrl || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(databaseUrl).hostname)) throw new Error("Local isolated PostgreSQL required");
    admin = new Pool({ connectionString: databaseUrl, max: 2 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    business = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 1 });
    leaseA = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: `${schema}_lease_a`, max: 1 });
    leaseB = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: `${schema}_lease_b`, max: 1 });
  });
  afterAll(async () => {
    await Promise.all([business?.end(), leaseA?.end(), leaseB?.end()]);
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });
  it("allows only one lifecycle owner while another job and the bounded business pool remain usable", async () => {
    const first = createLearningJobRunner(leaseA), second = createLearningJobRunner(leaseB);
    let release!: () => void, started!: () => void, duplicates = 0;
    const held = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    const running = first("lifecycle", async () => { await business.query("SELECT 1"); started(); await held; });
    try {
      await entered;
      expect(await second("lifecycle", async () => { duplicates++; })).toBe(false);
      expect(await second("maintenance", async signal => { expect(signal.aborted).toBe(false); await business.query("SELECT 1"); })).toBe(true);
      expect(duplicates).toBe(0);
    } finally { release(); expect(await running).toBe(true); }
  });
  it("releases the lease after a business failure so another replica can run", async () => {
    const first = createLearningJobRunner(leaseA), second = createLearningJobRunner(leaseB);
    await expect(first("maintenance", async () => { throw new Error("Fixture work failed"); })).rejects.toThrow("Fixture work failed");
    expect(await second("maintenance", async () => { await business.query("SELECT 1"); })).toBe(true);
  });
  it("aborts cooperative work after connection loss and lets another replica reclaim the singleton", async () => {
    const first = createLearningJobRunner(leaseA), second = createLearningJobRunner(leaseB);
    let started!: () => void, aborted = false;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const running = first("lifecycle", async signal => {
      started();
      await new Promise<void>(resolve => signal.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true }));
    }).then(() => "completed", error => error.message as string);
    await entered;
    const pid = (await admin.query("SELECT pid FROM pg_stat_activity WHERE application_name=$1", [`${schema}_lease_a`])).rows[0].pid;
    expect((await admin.query("SELECT pg_terminate_backend($1) AS terminated", [pid])).rows[0].terminated).toBe(true);
    expect(await running).toBe("LMS_JOB_LEASE_LOST"); expect(aborted).toBe(true);
    // The connection error can reach the client before the terminating backend
    // releases its advisory lock. A replica retries a busy singleton normally.
    let reclaimedRuns = 0;
    await vi.waitFor(async () => {
      expect(await second("lifecycle", async () => {
        reclaimedRuns++;
        await business.query("SELECT 1");
      })).toBe(true);
    }, { timeout: 2000, interval: 20 });
    expect(reclaimedRuns).toBe(1);
  });
  it("leaves queue-based roles parallel and never borrows the singleton connection for them", async () => {
    const connect = vi.fn(() => { throw new Error("Unexpected lease connection"); });
    const run = createLearningJobRunner({ connect } as unknown as Pool);
    for (const name of ["notifications", "identity-email", "notification-email", "files"] as LearningJobName[]) {
      expect(await run(name, async signal => { expect(signal.aborted).toBe(false); })).toBe(true);
    }
    expect(connect).not.toHaveBeenCalled();
  });
});
