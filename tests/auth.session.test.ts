import bcrypt from "bcrypt";
import express from "express";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockStorage = {
  getUserByLoginOrEmail: vi.fn(),
  getUsersByLoginOrEmail: vi.fn(),
  getUser: vi.fn(),
};

vi.mock("../server/storage", () => ({
  storage: mockStorage,
}));

describe("auth session routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.getUsersByLoginOrEmail.mockResolvedValue([]);
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
      role: "admin",
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

  it("rejects login with invalid credentials", async () => {
    const password = "Secret123";
    const hashedPassword = await bcrypt.hash(password, 1);
    mockStorage.getUserByLoginOrEmail.mockResolvedValue({
      id: 7,
      email: "admin@example.com",
      password: hashedPassword,
      fullName: "Admin User",
      role: "admin",
      hasReportAccess: true,
      isActive: true,
    });

    const app = await createApp();

    const response = await request(app)
      .post("/api/auth/login")
      .send({ login: "admin@example.com", password: "wrong-password" });

    expect(response.status).toBe(401);
  });

  it("logs out and clears the session", async () => {
    const password = "Secret123";
    const hashedPassword = await bcrypt.hash(password, 1);
    const user = {
      id: 7,
      email: "admin@example.com",
      password: hashedPassword,
      fullName: "Admin User",
      role: "admin",
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
});
