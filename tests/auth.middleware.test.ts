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
      requireAdmin,
      requireSalesAccess,
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
    app.get("/admin-only", requireAdmin, (_req, res) => res.json({ ok: true }));
    app.get("/sales-only", requireSalesAccess, (_req, res) => res.json({ ok: true }));
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
      role: "teacher",
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

  it("blocks teachers from sales routes", async () => {
    mockStorage.getUser.mockResolvedValue({
      id: 7,
      fullName: "Teacher User",
      email: "teacher@example.com",
      password: "hashed",
      role: "teacher",
      isActive: true,
      hasReportAccess: false,
    });

    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/test/session").send({ userId: 7 });

    const response = await agent.get("/sales-only");

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "Sales access required" });
  });
});
