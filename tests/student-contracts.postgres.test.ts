import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pool: null as unknown as Pool,
  transaction: null as unknown as AsyncLocalStorage<PoolClient>,
  audit: vi.fn(),
}));
vi.mock("../server/modules/academy/academy-core", () => {
  const query = async (sql: string, values: unknown[] = []) => {
    const client = mocks.transaction.getStore() ?? mocks.pool;
    const result = await client.query(sql, values);
    return result.rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value,
    ])));
  };
  return {
    query,
    queryOne: async (sql: string, values: unknown[] = []) => (await query(sql, values))[0] ?? null,
    createAudit: mocks.audit,
    withTransaction: async (work: () => Promise<unknown>) => {
      if (mocks.transaction.getStore()) return work();
      const client = await mocks.pool.connect();
      try {
        await client.query("BEGIN");
        const result = await mocks.transaction.run(client, work);
        await client.query("COMMIT");
        return result;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
  };
});
import { StudentContractService, attachStudentContractDraft } from "../server/modules/academy/student-contracts";
import { actorContextFrom } from "../server/modules/leads/domain/actor-context";
import { withTransaction } from "../server/modules/academy/academy-core";
import { LocalResourceFileStore } from "../server/modules/portal-resources/infrastructure/file-store";

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `student_contracts_${randomUUID().replace(/-/g, "")}`;
const manager = actorContextFrom({ id: 7, modules: ["sales"] });
const otherManager = actorContextFrom({ id: 8, modules: ["sales"] });
const administrator = actorContextFrom({ id: 9, modules: ["administration"] });
describe.skipIf(!databaseUrl)("student contracts persistence", () => {
  let admin: Pool;
  let directory: string;
  let service: StudentContractService;
  beforeAll(async () => {
    if (!databaseUrl || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(databaseUrl).hostname)) {
      throw new Error("Local isolated PostgreSQL required");
    }
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA ${schema}`);
    mocks.pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    mocks.transaction = new AsyncLocalStorage();
    await mocks.pool.query(`
      CREATE TABLE users(id integer PRIMARY KEY);
      CREATE TABLE academy_leads(id integer PRIMARY KEY,manager_id integer,is_archived boolean DEFAULT false);
      CREATE TABLE academy_students(id integer PRIMARY KEY,lead_id integer REFERENCES academy_leads(id),updated_at timestamptz DEFAULT now());
      INSERT INTO users VALUES(7),(8),(9);
      INSERT INTO academy_leads(id,manager_id) VALUES(11,7),(12,8);
      INSERT INTO academy_students(id,lead_id) VALUES(21,11),(22,11),(23,12),(24,NULL);
    `);
    await mocks.pool.query(await fs.readFile("migrations/0159_student_contracts.sql", "utf8"));
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "student-contract-test-"));
    service = new StudentContractService(new LocalResourceFileStore(path.join(directory, "files"), directory));
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    await mocks.pool.query("TRUNCATE academy_student_contracts");
    await mocks.pool.query("ALTER SEQUENCE academy_student_contract_number_seq RESTART WITH 1");
  });
  afterAll(async () => {
    if (mocks.pool) await mocks.pool.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  });
  it("persists immediately, serializes repeated creates, and leaves student payment versions unchanged", async () => {
    const before = (await mocks.pool.query("SELECT updated_at FROM academy_students WHERE id=21")).rows[0].updated_at;
    const results = await Promise.all(Array.from({ length: 8 }, () => service.create(manager, { studentId: 21 })));
    expect(new Set(results.map(result => result.id)).size).toBe(1);
    expect(await service.forStudent(manager, 21)).toEqual(results[0]);
    const after = (await mocks.pool.query("SELECT updated_at FROM academy_students WHERE id=21")).rows[0].updated_at;
    expect(after).toEqual(before);
  });
  it("generates unique numbers concurrently and skips existing imported generated-style numbers", async () => {
    const first = await service.create(manager, { studentId: 21 });
    await service.changeNumber(manager, first.id, first.version, first.number.replace(/000001$/, "000002"));
    const results = await Promise.all(Array.from({ length: 10 }, (_, index) => index % 2
      ? service.create(manager, { leadId: 11 })
      : service.create(otherManager, { leadId: 12 })));
    expect(new Set(results.map(result => result.number)).size).toBe(10);
    expect(results.every(result => !result.number.endsWith("000002"))).toBe(true);
  });
  it("retains historical numbers, rejects case-insensitive duplicates, and rejects stale modifications", async () => {
    const first = await service.create(manager, { studentId: 21 });
    const second = await service.create(manager, { studentId: 22 });
    const changed = await service.changeNumber(manager, first.id, 1, "VC-225/2025");
    expect(changed.number).toBe("VC-225/2025");
    await expect(service.changeNumber(manager, second.id, 1, "vc-225/2025")).rejects.toMatchObject({ code: "studentContractNumberTaken" });
    await expect(service.changeNumber(manager, first.id, 1)).rejects.toMatchObject({ code: "studentContractChanged" });
    expect((await service.changeNumber(manager, first.id, changed.version)).number).not.toBe(changed.number);
  });
  it("accepts exactly one concurrent claimant for a manual historical number", async () => {
    const first = await service.create(manager, { studentId: 21 });
    const second = await service.create(otherManager, { studentId: 23 });
    const results = await Promise.allSettled([
      service.changeNumber(manager, first.id, 1, "08-02"),
      service.changeNumber(otherManager, second.id, 1, "08-02"),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toMatchObject([
      { reason: { code: "studentContractNumberTaken", statusCode: 409 } },
    ]);
    expect((await mocks.pool.query("SELECT id FROM academy_student_contracts WHERE number='08-02'")).rowCount).toBe(1);
  });
  it("binds only the creator's matching lead draft and rolls attachment back with student creation", async () => {
    const draft = await service.create(manager, { leadId: 11 });
    await expect(withTransaction(async () => {
      await attachStudentContractDraft(manager, { contractDraftId: draft.id }, 21, 11);
      throw new Error("student save failed");
    })).rejects.toThrow("student save failed");
    expect((await service.get(manager, draft.id)).studentId).toBeNull();
    await expect(withTransaction(() => attachStudentContractDraft(otherManager, { contractDraftId: draft.id }, 21, 11)))
      .rejects.toMatchObject({ code: "studentContractDraftInvalid" });
    await expect(withTransaction(() => attachStudentContractDraft(manager, { contractDraftId: draft.id }, 23, 12)))
      .rejects.toMatchObject({ code: "studentContractDraftInvalid" });
    await withTransaction(() => attachStudentContractDraft(manager, { contractDraftId: draft.id }, 21, 11));
    expect((await service.forStudent(manager, 21))?.number).toBe(draft.number);
    await expect(withTransaction(() => attachStudentContractDraft(manager, { contractDraftId: draft.id }, 22, 11)))
      .rejects.toMatchObject({ code: "studentContractDraftInvalid" });
  });
  it("denies other managers and teachers, permits the current owner, and keeps unrelated drafts private", async () => {
    const contract = await service.create(manager, { studentId: 21 });
    const draft = await service.create(manager, { leadId: 11 });
    await expect(service.get(otherManager, contract.id)).rejects.toMatchObject({ code: "accessDenied" });
    await expect(service.get(actorContextFrom({ id: 9, modules: ["teaching"] }), contract.id)).rejects.toMatchObject({ code: "accessDenied" });
    await expect(service.get(administrator, draft.id)).rejects.toMatchObject({ code: "accessDenied" });
    await expect(service.create(manager, { studentId: 24 })).rejects.toMatchObject({ code: "accessDenied" });
    expect((await service.get(administrator, contract.id)).number).toBe(contract.number);
    await mocks.pool.query("UPDATE academy_leads SET manager_id=8 WHERE id=11");
    try {
      await expect(service.changeNumber(manager, contract.id, 1)).rejects.toMatchObject({ code: "accessDenied" });
      expect((await service.get(otherManager, contract.id)).id).toBe(contract.id);
    } finally { await mocks.pool.query("UPDATE academy_leads SET manager_id=7 WHERE id=11"); }
  });
  it("protects file bytes, checks signatures and size, retains replaced/cancelled files, and guards stale cancellation", async () => {
    const contract = await service.create(manager, { studentId: 21 });
    const upload = path.join(directory, "upload");
    await fs.writeFile(upload, "<html>not a PDF</html>");
    await expect(service.upload(manager, contract.id, 1, upload, "Договор.pdf")).rejects.toMatchObject({ code: "studentContractFileTypeInvalid" });
    await fs.truncate(upload, 10 * 1024 * 1024 + 1);
    await expect(service.upload(manager, contract.id, 1, upload, "Договор.pdf")).rejects.toMatchObject({ code: "studentContractFileTooLarge" });
    await fs.writeFile(upload, "%PDF-1.7\ncontract one");
    const uploaded = await service.upload(manager, contract.id, 1, upload, "Договор.pdf");
    expect(uploaded.file).toMatchObject({ name: "Договор.pdf", mime: "application/pdf" });
    expect(uploaded).not.toHaveProperty("fileKey");
    const download = await service.download(manager, contract.id);
    expect(await fs.readFile(download.path, "utf8")).toContain("contract one");
    await expect(service.download(otherManager, contract.id)).rejects.toMatchObject({ code: "accessDenied" });
    await expect(service.cancel(manager, contract.id, 1)).rejects.toMatchObject({ code: "studentContractChanged" });
    await fs.writeFile(upload, "%PDF-1.7\ncontract two");
    const replacement = await service.upload(manager, contract.id, uploaded.version, upload, "Договор-2.pdf");
    expect(await fs.readFile(path.join(directory, ".retained", path.relative(directory, download.path)), "utf8")).toContain("contract one");
    await service.cancel(manager, contract.id, replacement.version);
    expect(await service.forStudent(manager, 21)).toBeNull();
    await expect(service.download(manager, contract.id)).rejects.toMatchObject({ code: "studentContractNotFound" });
  });
  it("keeps identifiers unique beyond six digits", async () => {
    await mocks.pool.query("ALTER SEQUENCE academy_student_contract_number_seq RESTART WITH 1000000");
    const contract = await service.create(manager, { studentId: 21 });
    expect(contract.number).toMatch(/-1000000$/);
  });
  it("rolls back file metadata and keeps the prior attachment when a database-side operation fails", async () => {
    const contract = await service.create(manager, { studentId: 21 });
    const upload = path.join(directory, "rollback-upload");
    await fs.writeFile(upload, "%PDF-1.7\noriginal contract");
    const original = await service.upload(manager, contract.id, 1, upload, "original.pdf");
    await fs.writeFile(upload, "%PDF-1.7\nuncommitted replacement");
    mocks.audit.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(service.upload(manager, contract.id, original.version, upload, "replacement.pdf")).rejects.toThrow("audit unavailable");
    expect((await service.get(manager, contract.id)).file?.name).toBe("original.pdf");
    const download = await service.download(manager, contract.id);
    expect(await fs.readFile(download.path, "utf8")).toContain("original contract");
  });
});
