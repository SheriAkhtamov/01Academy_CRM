import express from "express";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  createAuditLog: vi.fn(),
  poolQuery: vi.fn(),
  poolConnect: vi.fn(),
}));

vi.mock("../server/storage", () => ({
  storage: {
    getUser: mocks.getUser,
    createAuditLog: mocks.createAuditLog,
  },
}));

vi.mock("../server/db", () => ({
  pool: {
    query: mocks.poolQuery,
    connect: mocks.poolConnect,
  },
}));

const staffUser = {
  id: 7,
  fullName: "Sales User",
  email: "sales@example.com",
  password: "hashed",
  workspace: "sales",
  workspaces: ["sales"],
  isActive: true,
  hasReportAccess: false,
};

const createApp = async () => {
  const { default: academyRoutes } = await import("../server/routes/academy.routes");
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: "test-secret",
    resave: false,
    saveUninitialized: false,
  }));
  app.post("/test/session", (req, res) => {
    Object.assign(req.session, req.body);
    req.session.save(() => res.json({ ok: true }));
  });
  app.use("/api/academy", academyRoutes);
  return app;
};

describe("academy task ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue(staffUser);
    mocks.createAuditLog.mockResolvedValue({});
    mocks.poolQuery.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (/INSERT INTO "academy_tasks"/i.test(sql)) {
        return {
          rows: [{
            id: 101,
            title: values[0],
            responsible_id: staffUser.id,
            status: "new",
          }],
        };
      }
      if (/SELECT \* FROM "academy_tasks" WHERE id = \$1/i.test(sql)) {
        return {
          rows: [{
            id: 101,
            title: "Owned task",
            responsible_id: staffUser.id,
            status: "new",
          }],
        };
      }
      throw new Error(`Unexpected query in test: ${sql}`);
    });
  });

  it("assigns a staff-created task to the current user when responsibleId is omitted", async () => {
    const app = await createApp();
    const agent = request.agent(app);
    await agent.post("/test/session").send({ userId: staffUser.id });

    const response = await agent.post("/api/academy/tasks").send({ title: "My task" });

    expect(response.status).toBe(201);
    const insertCall = mocks.poolQuery.mock.calls.find(([sql]) => /INSERT INTO "academy_tasks"/i.test(String(sql)));
    expect(insertCall).toBeDefined();
    expect(String(insertCall?.[0])).toContain('"responsible_id"');
    expect(insertCall?.[1]).toContain(staffUser.id);
  });

  it("does not let a staff owner reassign an existing task to another user", async () => {
    const app = await createApp();
    const agent = request.agent(app);
    await agent.post("/test/session").send({ userId: staffUser.id });

    const response = await agent.patch("/api/academy/tasks/101").send({ responsibleId: 99 });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "Task mutation access required" });
    expect(mocks.poolQuery.mock.calls.some(([sql]) => /^\s*UPDATE/i.test(String(sql)))).toBe(false);
  });
});
