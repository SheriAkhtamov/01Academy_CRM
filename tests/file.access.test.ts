import fs from "fs/promises";
import path from "path";
import express from "express";
import session from "express-session";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockStorage = {
  getUser: vi.fn(),
};

vi.mock("../server/storage", () => ({
  storage: mockStorage,
}));

const uploadsRoot = path.resolve(process.cwd(), "uploads");
const photoFileName = "test-logo.txt";
const documentFileName = "test-document.txt";
const photoFilePath = path.join(uploadsRoot, "photos", photoFileName);
const documentFilePath = path.join(uploadsRoot, documentFileName);

describe("file access routes", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await fs.mkdir(path.dirname(photoFilePath), { recursive: true });
    await fs.mkdir(uploadsRoot, { recursive: true });
    await fs.writeFile(photoFilePath, "logo-content", "utf8");
    await fs.writeFile(documentFilePath, "document-content", "utf8");
  });

  afterEach(async () => {
    await Promise.all([
      fs.rm(photoFilePath, { force: true }),
      fs.rm(documentFilePath, { force: true }),
    ]);
  });

  const createApp = async () => {
    const { requireFileAccess } = await import("../server/middleware/auth.middleware");
    const { default: fileRoutes, uploadsMiddleware } = await import("../server/routes/file.routes");

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
    app.use("/api/files", fileRoutes);
    app.use("/uploads", requireFileAccess, uploadsMiddleware);
    return app;
  };

  it("rejects anonymous access to protected files", async () => {
    const app = await createApp();

    const response = await request(app).get(`/api/files/${documentFileName}`);

    expect(response.status).toBe(401);
  });

  it("allows an authenticated active user session to read files", async () => {
    mockStorage.getUser.mockResolvedValue({
      id: 7,
      email: "admin@example.com",
      fullName: "Admin User",
      role: "admin",
      isActive: true,
      hasReportAccess: true,
    });

    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/test/session").send({
      userId: 7,
    });

    const response = await agent.get(`/api/files/${documentFileName}`);

    expect(response.status).toBe(200);
    expect(response.text).toBe("document-content");
  });

  it("allows an authenticated user session to read uploads", async () => {
    mockStorage.getUser.mockResolvedValue({
      id: 7,
      email: "admin@example.com",
      fullName: "Admin User",
      role: "admin",
      isActive: true,
      hasReportAccess: true,
    });

    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/test/session").send({
      userId: 7,
    });

    const response = await agent.get(`/uploads/photos/${photoFileName}`);
    expect(response.status).toBe(200);
    expect(response.text).toBe("logo-content");
  });

  it("rejects access for an inactive user session", async () => {
    mockStorage.getUser.mockResolvedValue({
      id: 7,
      email: "admin@example.com",
      fullName: "Admin User",
      role: "admin",
      isActive: false,
      hasReportAccess: true,
    });

    const app = await createApp();
    const agent = request.agent(app);

    await agent.post("/test/session").send({
      userId: 7,
    });

    const response = await agent.get(`/api/files/${documentFileName}`);

    expect(response.status).toBe(401);
  });
});
