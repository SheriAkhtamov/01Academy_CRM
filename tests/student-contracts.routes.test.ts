import express, { type RequestHandler } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLeadStudentRequestSchema } from "../shared/contracts/academy-leads";

vi.mock("../server/modules/academy/academy-core", () => ({
  query: vi.fn(), queryOne: vi.fn(), withTransaction: vi.fn(), createAudit: vi.fn(),
}));
vi.mock("../server/middleware/rateLimiter", () => ({
  attachmentUploadLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../server/lib/logger", () => ({ logger: { error: vi.fn() } }));
import { registerStudentContractRoutes } from "../server/modules/academy/student-contracts.router";
import { StudentContractError } from "../server/modules/academy/student-contracts";

const contractId = "51e08276-4354-4c37-bb91-89bf701ad5c0";
const contract = { id: contractId, number: "01A-26-000123", version: 2, studentId: 21, file: null, createdAt: "", updatedAt: "" };
const service = {
  list: vi.fn(), get: vi.fn(), forStudent: vi.fn(), create: vi.fn(), changeNumber: vi.fn(),
  cancel: vi.fn(), upload: vi.fn(), download: vi.fn(),
};
const parser = vi.fn<RequestHandler>((_request, _response, next) => next());
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.actor = { userId: 7, primaryModule: "sales", modules: ["sales"], isLeadership: false };
  next();
});
registerStudentContractRoutes(app, service, parser);
describe("student contract HTTP boundary", () => {
  let directory: string;
  beforeAll(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), "contract-route-")); });
  afterAll(async () => { await fs.rm(directory, { recursive: true, force: true }); });
  beforeEach(() => {
    vi.clearAllMocks();
    service.get.mockResolvedValue(contract);
    service.forStudent.mockResolvedValue(contract);
    service.create.mockResolvedValue(contract);
    service.changeNumber.mockResolvedValue(contract);
    service.cancel.mockResolvedValue(undefined);
  });
  it("preserves a contract draft in the shared create-student request and rejects malformed references", () => {
    const input = { studentName: "Ученик", contractDraftId: contractId };
    expect(createLeadStudentRequestSchema.parse(input).contractDraftId).toBe(contractId);
    expect(createLeadStudentRequestSchema.safeParse({ ...input, contractDraftId: "other" }).success).toBe(false);
  });
  it("generates and reserves numbers on the authenticated actor and requested student/lead", async () => {
    expect((await request(app).post("/students/21/contract").send({})).status).toBe(201);
    expect(service.create).toHaveBeenLastCalledWith(expect.objectContaining({ userId: 7 }), { studentId: 21 });
    expect((await request(app).post("/leads/11/contract-drafts").send({})).status).toBe(201);
    expect(service.create).toHaveBeenLastCalledWith(expect.objectContaining({ userId: 7 }), { leadId: 11 });
  });
  it("lists contracts with validated pagination, literal search and the authenticated actor", async () => {
    const page = { items: [{ contract, student: { id: 21, contactName: "Student", status: "studying" } }], total: 1, page: 1, pageSize: 25 };
    service.list.mockResolvedValueOnce(page);
    const response = await request(app).get("/student-contracts").query({ q: " А-07/01 " });
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body).toEqual(page);
    expect(service.list).toHaveBeenCalledWith(expect.objectContaining({ userId: 7 }), { q: "А-07/01", status: "all", page: 1, pageSize: 25 });
    await request(app).get("/student-contracts").query({ status: "missing", page: 2 });
    expect(service.list).toHaveBeenLastCalledWith(expect.objectContaining({ userId: 7 }), { q: "", status: "missing", page: 2, pageSize: 25 });
    service.list.mockClear();
    for (const query of [{ page: 0 }, { pageSize: 101 }, { q: "a".repeat(121) }, { page: "invalid" }, { status: "invalid" }, { status: ["created", "missing"] }]) {
      expect((await request(app).get("/student-contracts").query(query)).status).toBe(400);
    }
    expect(service.list).not.toHaveBeenCalled();
    service.list.mockRejectedValueOnce(new StudentContractError("accessDenied", 403));
    expect((await request(app).get("/student-contracts")).status).toBe(403);
  });
  it("requires a valid version for regenerate and cancellation and trims historical numbers", async () => {
    expect((await request(app).post(`/student-contracts/${contractId}/regenerate`).send({})).status).toBe(400);
    expect((await request(app).delete(`/student-contracts/${contractId}`).send({ version: 0 })).status).toBe(400);
    expect(service.cancel).not.toHaveBeenCalled();
    expect((await request(app).patch(`/student-contracts/${contractId}`).send({ version: 2, number: " 225/26 " })).status).toBe(200);
    expect(service.changeNumber).toHaveBeenCalledWith(expect.anything(), contractId, 2, "225/26");
    expect((await request(app).delete(`/student-contracts/${contractId}`).send({ version: 2 })).status).toBe(204);
  });
  it("rejects access before reading multipart data and returns only public error codes", async () => {
    service.get.mockRejectedValueOnce(new StudentContractError("accessDenied", 403));
    const response = await request(app).post(`/student-contracts/${contractId}/file`).attach("file", Buffer.from("secret"), "contract.pdf");
    expect(response.status).toBe(403);
    expect(parser).not.toHaveBeenCalled();
    expect(service.upload).not.toHaveBeenCalled();
    service.get.mockRejectedValueOnce(new Error("SQL secret path database password"));
    const failure = await request(app).get(`/student-contracts/${contractId}`);
    expect(failure.status).toBe(500);
    expect(failure.body).toEqual({ error: "studentContractSaveFailed" });
  });
  it("serves authorized files as private non-executable downloads", async () => {
    const file = path.join(directory, "file");
    await fs.writeFile(file, "%PDF-1.7");
    service.download.mockResolvedValueOnce({ path: file, file: { name: "contract.pdf", mime: "application/pdf", size: 8 } });
    const response = await request(app).get(`/student-contracts/${contractId}/file`);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-security-policy"]).toContain("sandbox");
    expect(response.headers["content-disposition"]).toContain('attachment; filename="contract.pdf"');
    expect(response.headers["content-type"]).toBe("application/octet-stream");
  });
  it("rejects malformed IDs before calling resource methods", async () => {
    expect((await request(app).get("/student-contracts/not-a-uuid")).status).toBe(404);
    expect(service.get).not.toHaveBeenCalled();
    expect((await request(app).get("/students/-1/contract")).status).toBe(404);
    expect(service.forStudent).not.toHaveBeenCalled();
  });
});
