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
import type { StudentContractListQuery } from "../shared/contracts/student-contracts";

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
      CREATE TABLE academy_leads(id integer PRIMARY KEY,manager_id integer,funnel_id integer,is_archived boolean DEFAULT false);
      CREATE TABLE academy_students(id integer PRIMARY KEY,lead_id integer REFERENCES academy_leads(id),
        student_name text,contact_name text DEFAULT 'Contact',phone text,status text DEFAULT 'studying',updated_at timestamptz DEFAULT now());
      CREATE TABLE academy_groups(id integer PRIMARY KEY,name text NOT NULL);
      CREATE TABLE academy_student_group_enrollments(student_id integer REFERENCES academy_students(id),
        group_id integer REFERENCES academy_groups(id),status text NOT NULL,is_primary boolean DEFAULT false);
      INSERT INTO users VALUES(7),(8),(9);
      INSERT INTO academy_leads(id,manager_id,funnel_id) VALUES(11,7,NULL),(12,8,NULL),(13,NULL,5);
      INSERT INTO academy_students(id,lead_id) VALUES(21,11),(22,11),(23,12),(24,NULL),(25,11),(26,11),(27,13);
      INSERT INTO academy_groups(id,name) VALUES(31,'CYP-VC-GRP-26-0001'),(32,'ONL-VC-GRP-26-0002');
    `);
    await mocks.pool.query(await fs.readFile("migrations/0159_student_contracts.sql", "utf8"));
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "student-contract-test-"));
    service = new StudentContractService(new LocalResourceFileStore(path.join(directory, "files"), directory));
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    await mocks.pool.query("TRUNCATE academy_student_contracts");
    await mocks.pool.query("TRUNCATE academy_student_group_enrollments");
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
  it("lists only attached contracts visible under lead and funnel permissions, including historical numbers without files", async () => {
    await service.create(manager, { leadId: 11 });
    const owned = await service.create(manager, { studentId: 21 });
    const other = await service.create(otherManager, { studentId: 23 });
    await service.create(administrator, { studentId: 24 });
    const historical = await service.changeNumber(manager, owned.id, owned.version, "А-07/01");
    await mocks.pool.query("UPDATE academy_students SET student_name='Марсель',phone='+998901234567' WHERE id=21");
    const list = (actor = manager, q = "", page = 1, pageSize = 25) => service.list(actor, { q, status: "all", page, pageSize });
    expect((await list()).items.map(row => row.contract?.id)).toEqual([owned.id]);
    const result = await list(manager, "а-07/01");
    expect(result.items).toMatchObject([{ contract: { id: historical.id, file: null }, student: { id: 21, studentName: "Марсель" } }]);
    expect(result.items[0].contract).not.toHaveProperty("fileKey");
    expect(result.items[0].student.updatedAt).toMatch(/Z$/);
    expect((await list(manager, "марсель")).total).toBe(1);
    expect((await list(manager, "901234")).total).toBe(1);
    expect((await list(manager, "%")).total).toBe(0);
    expect((await list(administrator)).total).toBe(3);
    expect((await list(actorContextFrom({ id: 9, modules: ["marketing"] }))).total).toBe(2);
    expect((await list(administrator, "", 999, 2))).toMatchObject({ page: 2, total: 3, pageSize: 2, items: [expect.anything()] });
    await expect(list(actorContextFrom({ id: 9, modules: ["teacher"] }))).rejects.toMatchObject({ code: "accessDenied" });
    await mocks.pool.query("UPDATE academy_leads SET manager_id=NULL,funnel_id=5 WHERE id=12");
    try {
      expect((await list()).total).toBe(1);
      expect((await list({ ...manager, salesWorkflow: { assignedFunnelIds: [5] } })).items.map(row => row.contract?.id)).toContain(other.id);
      await mocks.pool.query("UPDATE academy_leads SET funnel_id=NULL WHERE id=12");
      expect((await list()).total).toBe(2);
      await service.cancel(manager, historical.id, historical.version);
      expect((await list(manager, "марсель")).total).toBe(0);
    } finally {
      await mocks.pool.query("UPDATE academy_leads SET manager_id=8,funnel_id=NULL WHERE id=12");
      await mocks.pool.query("UPDATE academy_students SET student_name=NULL,phone=NULL WHERE id=21");
    }
  });
  it("filters enrolled students without contracts, counts each student once and applies the same visibility to rows and counts", async () => {
    await mocks.pool.query(`INSERT INTO academy_student_group_enrollments(student_id,group_id,status,is_primary) VALUES
      (21,31,'active',true),(22,31,'active',false),(22,32,'active',true),
      (23,31,'active',true),(24,31,'active',true),(25,31,'withdrawn',false),
      (26,31,'completed',false),(27,31,'active',true)`);
    const existing = await service.create(manager, { studentId: 21 });
    await service.create(manager, { leadId: 11 });
    const list = (status: StudentContractListQuery["status"] = "all", actor = manager, q = "", page = 1, pageSize = 25) =>
      service.list(actor, { q, status, page, pageSize });
    expect(await list()).toMatchObject({ total: 2, counts: { all: 2, created: 1, missing: 1 } });
    expect((await list("created")).items).toMatchObject([{ student: { id: 21 }, contract: { id: existing.id, file: null } }]);
    expect(await list("missing")).toMatchObject({ total: 1, items: [{ student: { id: 22 }, contract: null, groups: [
      { id: 32, name: "ONL-VC-GRP-26-0002" }, { id: 31, name: "CYP-VC-GRP-26-0001" },
    ] }] });
    expect(await list("missing", administrator)).toMatchObject({ total: 4, counts: { all: 5, created: 1, missing: 4 } });
    expect(await list("missing", actorContextFrom({ id: 9, modules: ["marketing"] }))).toMatchObject({ total: 3, counts: { all: 4, created: 1, missing: 3 } });
    expect(await list("missing", { ...manager, salesWorkflow: { assignedFunnelIds: [5] } })).toMatchObject({ total: 2, counts: { all: 3, created: 1, missing: 2 } });
    expect(await list("all", manager, "", 999, 1)).toMatchObject({ total: 2, page: 2, items: [{ student: { id: 22 }, contract: null }] });
    expect(await list("missing", manager, existing.number)).toMatchObject({ total: 0, counts: { all: 1, created: 1, missing: 0 } });
    expect(await list("all", manager, "%")).toMatchObject({ total: 0, counts: { all: 0, created: 0, missing: 0 } });
    const created = await service.create(manager, { studentId: 22 });
    expect(await list("missing")).toMatchObject({ total: 0, counts: { all: 2, created: 2, missing: 0 } });
    await service.cancel(manager, created.id, created.version);
    expect(await list("missing")).toMatchObject({ total: 1, counts: { all: 2, created: 1, missing: 1 } });
    await mocks.pool.query("UPDATE academy_student_group_enrollments SET status='withdrawn' WHERE student_id=22");
    expect(await list("missing")).toMatchObject({ total: 0, counts: { all: 1, created: 1, missing: 0 } });
    await service.create(manager, { studentId: 25 });
    expect((await list("created")).items.map(row => row.student.id).sort()).toEqual([21, 25]);
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
