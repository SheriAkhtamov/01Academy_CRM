import bcrypt from "bcrypt";
import express from "express";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockStorage = {
  getUserByLoginOrEmail: vi.fn(),
  getUsersByLoginOrEmail: vi.fn(),
  getWorkspace: vi.fn(),
  getSuperAdminByUsername: vi.fn(),
  getUser: vi.fn(),
  getSuperAdmin: vi.fn(),
};

vi.mock("../server/storage", () => ({
  storage: mockStorage,
}));

describe("auth session routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.getUsersByLoginOrEmail.mockResolvedValue([]);
    mockStorage.getWorkspace.mockResolvedValue(undefined);
  });

  const createApp = async () => {
    const { default: authRoutes } = await import("../server/routes/auth.routes");
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
    app.use("/api/auth", authRoutes);
    return app;
  };

  it("returns anonymous session when no auth exists", async () => {
    const app = await createApp();

    const response = await request(app).get("/api/auth/session");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ kind: "anonymous" });
  });

  it("resolves a user session after login", async () => {
    const password = "Secret123";
    const hashedPassword = await bcrypt.hash(password, 1);
    mockStorage.getUserByLoginOrEmail.mockResolvedValue({
      id: 7,
      workspaceId: 3,
      email: "admin@example.com",
      password: hashedPassword,
      fullName: "Admin User",
      role: "admin",
      hasReportAccess: true,
      isActive: true,
    });
    mockStorage.getUsersByLoginOrEmail.mockResolvedValue([
      {
        id: 7,
        workspaceId: 3,
        email: "admin@example.com",
        password: hashedPassword,
        fullName: "Admin User",
        role: "admin",
        hasReportAccess: true,
        isActive: true,
      },
    ]);
    mockStorage.getUser.mockResolvedValue({
      id: 7,
      workspaceId: 3,
      email: "admin@example.com",
      password: hashedPassword,
      fullName: "Admin User",
      role: "admin",
      hasReportAccess: true,
      isActive: true,
    });

    const app = await createApp();
    const agent = request.agent(app);

    const loginResponse = await agent
      .post("/api/auth/login")
      .send({ login: "admin@example.com", password });

    expect(loginResponse.status).toBe(200);

    const sessionResponse = await agent.get("/api/auth/session");

    expect(sessionResponse.status).toBe(200);
    expect(sessionResponse.body).toMatchObject({
      kind: "user",
      workspaceId: 3,
      user: {
        id: 7,
        email: "admin@example.com",
        fullName: "Admin User",
      },
    });
    expect(sessionResponse.body.user.password).toBeUndefined();
  });

  it("resolves a super admin session after super admin login", async () => {
    const password = "Secret123";
    const hashedPassword = await bcrypt.hash(password, 1);
    mockStorage.getSuperAdminByUsername.mockResolvedValue({
      id: 11,
      username: "Sheri",
      password: hashedPassword,
      fullName: "Sheri Super Admin",
      isActive: true,
    });
    mockStorage.getSuperAdmin.mockResolvedValue({
      id: 11,
      username: "Sheri",
      password: hashedPassword,
      fullName: "Sheri Super Admin",
      isActive: true,
    });

    const app = await createApp();
    const agent = request.agent(app);

    const loginResponse = await agent
      .post("/api/auth/super-admin/login")
      .send({ username: "Sheri", password });

    expect(loginResponse.status).toBe(200);

    const sessionResponse = await agent.get("/api/auth/session");

    expect(sessionResponse.status).toBe(200);
    expect(sessionResponse.body).toEqual({
      kind: "super_admin",
      superAdmin: {
        id: 11,
        username: "Sheri",
        fullName: "Sheri Super Admin",
        isActive: true,
      },
      isViewMode: false,
    });
  });

  it("fully logs out a super admin view-mode session", async () => {
    mockStorage.getSuperAdmin.mockResolvedValue({
      id: 11,
      username: "Sheri",
      password: "hashed-password",
      fullName: "Sheri Super Admin",
      isActive: true,
    });
    mockStorage.getUser.mockResolvedValue({
      id: 7,
      workspaceId: 3,
      email: "admin@example.com",
      password: "hashed-password",
      fullName: "Admin User",
      role: "admin",
      hasReportAccess: true,
      isActive: true,
    });

    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/test/session").send({
      superAdminId: 11,
      userId: 7,
      workspaceId: 3,
      isSuperAdminView: true,
    });

    const initialSession = await agent.get("/api/auth/session");
    expect(initialSession.status).toBe(200);
    expect(initialSession.body).toMatchObject({
      kind: "super_admin",
      workspaceId: 3,
      isViewMode: true,
      user: {
        id: 7,
        email: "admin@example.com",
      },
    });

    const logoutResponse = await agent.post("/api/auth/logout");
    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.body).toEqual({ success: true });

    const sessionAfterLogout = await agent.get("/api/auth/session");
    expect(sessionAfterLogout.status).toBe(200);
    expect(sessionAfterLogout.body).toEqual({ kind: "anonymous" });
  });

  it("does not expose the removed super admin logout alias", async () => {
    const app = await createApp();

    const response = await request(app).post("/api/auth/super-admin/logout");

    expect(response.status).toBe(404);
  });
});
