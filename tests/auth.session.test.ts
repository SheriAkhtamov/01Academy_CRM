import bcrypt from "bcrypt";
import express from "express";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockStorage = {
  getUserByLoginOrEmail: vi.fn(),
  getUsersByLoginOrEmail: vi.fn(),
  getUser: vi.fn(),
  createAuditLog: vi.fn(),
};

const mockPool = {
  query: vi.fn(),
  connect: vi.fn(),
};

vi.mock("../server/storage", () => ({
  storage: mockStorage,
}));
vi.mock("../server/db", () => ({ pool: mockPool }));

describe("auth session routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.getUsersByLoginOrEmail.mockResolvedValue([]);
    mockStorage.createAuditLog.mockResolvedValue(undefined);
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
    const user = {
      id: 7,
      email: "admin@example.com",
      password: hashedPassword,
      fullName: "Admin User",
      workspace: "administration",
      hasReportAccess: true,
      isActive: true,
    };
    mockStorage.getUserByLoginOrEmail.mockResolvedValue(user);
    mockStorage.getUser.mockResolvedValue(user);

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
      user: {
        id: 7,
        email: "admin@example.com",
        fullName: "Admin User",
      },
    });
    expect(sessionResponse.body.user.password).toBeUndefined();
  });

  it("normalizes surrounding whitespace and email case before authentication", async () => {
    const password = "Secret123";
    const hashedPassword = await bcrypt.hash(password, 1);
    mockStorage.getUserByLoginOrEmail.mockResolvedValue({
      id: 7,
      email: "admin@example.com",
      password: hashedPassword,
      fullName: "Admin User",
      workspace: "administration",
      hasReportAccess: true,
      isActive: true,
    });

    const app = await createApp();
    const response = await request(app)
      .post("/api/auth/login")
      .send({ login: "  Admin@Example.COM  ", password });

    expect(response.status).toBe(200);
    expect(mockStorage.getUserByLoginOrEmail).toHaveBeenCalledWith("admin@example.com");
  });

  it("rejects login with invalid credentials", async () => {
    const password = "Secret123";
    const hashedPassword = await bcrypt.hash(password, 1);
    mockStorage.getUserByLoginOrEmail.mockResolvedValue({
      id: 7,
      email: "admin@example.com",
      password: hashedPassword,
      fullName: "Admin User",
      workspace: "administration",
      hasReportAccess: true,
      isActive: true,
    });

    const app = await createApp();

    const response = await request(app)
      .post("/api/auth/login")
      .send({ login: "admin@example.com", password: "wrong-password" });

    expect(response.status).toBe(401);
  });

  it("rejects non-string credentials without invoking password verification", async () => {
    const app = await createApp();

    const response = await request(app)
      .post("/api/auth/login")
      .send({ login: { email: "admin@example.com" }, password: 12345678 });

    expect(response.status).toBe(400);
    expect(mockStorage.getUserByLoginOrEmail).not.toHaveBeenCalled();
  });

  it("logs out and clears the session", async () => {
    const password = "Secret123";
    const hashedPassword = await bcrypt.hash(password, 1);
    const user = {
      id: 7,
      email: "admin@example.com",
      password: hashedPassword,
      fullName: "Admin User",
      workspace: "administration",
      hasReportAccess: true,
      isActive: true,
    };
    mockStorage.getUserByLoginOrEmail.mockResolvedValue(user);
    mockStorage.getUser.mockResolvedValue(user);

    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/api/auth/login").send({ login: "admin@example.com", password });
    const logoutResponse = await agent.post("/api/auth/logout");
    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.body).toEqual({ success: true });

    const sessionAfterLogout = await agent.get("/api/auth/session");
    expect(sessionAfterLogout.status).toBe(200);
    expect(sessionAfterLogout.body).toEqual({ kind: "anonymous" });
  });

  it("updates profile and password in one database transaction", async () => {
    const password = "Secret123";
    const hashedPassword = await bcrypt.hash(password, 1);
    const user = {
      id: 7,
      email: "admin@example.com",
      password: hashedPassword,
      fullName: "Admin User",
      workspace: "administration",
      workspaces: ["administration"],
      hasReportAccess: true,
      isActive: true,
    };
    const updatedUser = { ...user, email: "owner@example.com", fullName: "Owner" };
    mockStorage.getUserByLoginOrEmail.mockResolvedValue(user);
    mockStorage.getUser.mockResolvedValueOnce(user).mockResolvedValueOnce(updatedUser);
    const clientQuery = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT password, email, has_report_access")) {
        return { rows: [{ password: hashedPassword, email: user.email, has_report_access: true }] };
      }
      return { rows: [] };
    });
    const release = vi.fn();
    mockPool.connect.mockResolvedValue({ query: clientQuery, release });

    const app = await createApp();
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ login: user.email, password });
    const response = await agent.put("/api/auth/me/settings").send({
      fullName: "Owner",
      email: "owner@example.com",
      position: "CEO",
      phone: "+998901234567",
      hasReportAccess: true,
      currentPassword: password,
      newPassword: "NewSecret123",
      confirmNewPassword: "NewSecret123",
    });

    expect(response.status).toBe(200);
    expect(clientQuery).toHaveBeenCalledWith("BEGIN");
    expect(clientQuery.mock.calls.some(([sql]) => String(sql).includes("UPDATE users"))).toBe(true);
    expect(clientQuery.mock.calls.some(([sql]) => String(sql).includes("UPDATE academy_teachers"))).toBe(true);
    expect(clientQuery).toHaveBeenCalledWith("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });
});
