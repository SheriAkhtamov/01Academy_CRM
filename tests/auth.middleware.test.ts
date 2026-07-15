import express from "express";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockStorage = {
  getUser: vi.fn(),
};

vi.mock("../server/storage", () => ({
  storage: mockStorage,
}));

describe("auth middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createApp = async () => {
    const {
      requireAuth,
      requireAdministration,
      requireFinanceAccess,
    } = await import("../server/middleware/auth.middleware");

    const app = express();
    app.use(express.json());
    app.use(
      session({
        secret: "test-secret",
        resave: false,
        saveUninitialized: false,
      }),
    );

    app.post("/test/session", (req, res) => {
      Object.assign(req.session, req.body);
      req.session.save(() => res.json({ ok: true }));
    });

    app.get("/auth-only", requireAuth, (_req, res) => res.json({ ok: true }));
    app.post("/auth-only", requireAuth, (_req, res) => res.json({ ok: true }));
    app.get("/admin-only", requireAdministration, (_req, res) => res.json({ ok: true }));
    app.get("/finance-only", requireFinanceAccess, (_req, res) => res.json({ ok: true }));
    return app;
  };

  it("rejects unauthenticated requests", async () => {
    const app = await createApp();

    const response = await request(app).get("/auth-only");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Unauthorized" });
  });

  it("blocks non-admin users from admin routes", async () => {
    mockStorage.getUser.mockResolvedValue({
      id: 7,
      fullName: "Teacher User",
      email: "teacher@example.com",
      password: "hashed",
      workspace: "teacher",
      isActive: true,
      hasReportAccess: false,
    });

    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/test/session").send({ userId: 7 });

    const response = await agent.get("/admin-only");

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "Admin access required" });
  });

  it("allows all-module leadership users through admin routes", async () => {
    mockStorage.getUser.mockResolvedValue({
      id: 9,
      fullName: "Leadership User",
      email: "leadership@example.com",
      password: "hashed",
      workspace: "administration",
      workspaces: ["administration", "sales", "teacher", "marketing"],
      isActive: true,
      hasReportAccess: true,
    });

    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/test/session").send({ userId: 9 });

    const response = await agent.get("/admin-only");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it("allows users with an administration module through admin routes", async () => {
    mockStorage.getUser.mockResolvedValue({
      id: 11,
      fullName: "Teacher Admin",
      email: "teacher-admin@example.com",
      password: "hashed",
      workspace: "teacher",
      workspaces: ["teacher", "administration"],
      isActive: true,
      hasReportAccess: true,
    });

    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/test/session").send({ userId: 11 });

    const response = await agent.get("/admin-only");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it("does not grant finance access through the administration module", async () => {
    mockStorage.getUser.mockResolvedValue({
      id: 12,
      fullName: "Administrator",
      email: "administrator@example.com",
      password: "hashed",
      workspace: "administration",
      workspaces: ["administration"],
      isActive: true,
      hasReportAccess: true,
    });

    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/test/session").send({ userId: 12 });

    const response = await agent.get("/finance-only");

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "Finance access required" });
  });

  it("allows finance access only when the module is assigned", async () => {
    mockStorage.getUser.mockResolvedValue({
      id: 13,
      fullName: "Finance Manager",
      email: "finance@example.com",
      password: "hashed",
      workspace: "sales",
      workspaces: ["sales", "finance"],
      isActive: true,
      hasReportAccess: false,
    });

    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/test/session").send({ userId: 13 });

    const response = await agent.get("/finance-only");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });
});
