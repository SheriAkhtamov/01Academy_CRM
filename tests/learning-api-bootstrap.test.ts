import crypto from "node:crypto";
import session from "express-session";
import type { Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../server/config";
import type { LmsPorts } from "../server/modules/lms/application/ports";
import { LmsService } from "../server/modules/lms/application/lms-service";
import { createLmsManagementRouter } from "../server/modules/lms/http/management.router";
import { resolveLearningApiOptions } from "../server/infrastructure/learning-execution";
const mocks = vi.hoisted(() => ({
  coreQuery: vi.fn(),
  coreClose: vi.fn(),
  learningQuery: vi.fn(),
  learningClose: vi.fn(),
  createPools: vi.fn(),
  createRuntime: vi.fn(),
  runtimeStop: vi.fn(),
  runtimeStart: vi.fn(),
  attach: vi.fn(),
  closeWs: vi.fn(),
  health: vi.fn(),
  static: vi.fn(),
  getUser: vi.fn(),
  analytics: vi.fn(),
  results: vi.fn(),
  legacy: vi.fn(),
  config: {
    database: { url: "postgresql://fixture.invalid/unused", pool: { max: 5 } },
    server: {
      host: "127.0.0.1",
      port: 0,
      appUrl: "http://127.0.0.1:5000",
      environment: "test",
    },
    session: { secret: "independent-learning-api-staff-secret" },
    portal: { enabled: true },

  },
}));
vi.mock("../server/config", () => ({
  appConfig: mocks.config,
  isProductionEnvironment: false,
  isDevelopmentEnvironment: false,
  trustedProxyConfig: false,
  secureSessionCookies: false,
}));
vi.mock("../server/db", () => ({
  pool: { query: mocks.coreQuery, end: mocks.coreClose },
}));
vi.mock("../server/storage", () => ({ storage: { getUser: mocks.getUser } }));
vi.mock("../server/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
vi.mock("../server/infrastructure/learning-execution-pools", () => ({
  createLearningExecutionPools: mocks.createPools,
}));
vi.mock("../server/infrastructure/lms-runtime", () => ({
  createLearningRuntime: mocks.createRuntime,
}));
vi.mock("../server/services/scheduler", () => {
  mocks.legacy();
  throw new Error("Standalone API loaded the CRM scheduler");
});
vi.mock("../server/services/integration-settings", () => {
  mocks.legacy();
  throw new Error("Standalone API loaded CRM integration fetch");
});
vi.mock("../server/realtime/websocket-gateway", () => {
  mocks.legacy();
  throw new Error("Standalone API loaded staff presence/WebSocket");
});
vi.mock("../server/vite", () => ({ serveStatic: mocks.static }));
const memory = new session.MemoryStore();
vi.mock("../server/infrastructure/session", () => ({
  createSessionMiddleware: () =>
    session({
      secret: mocks.config.session.secret,
      name: "academy.sid",
      resave: false,
      saveUninitialized: false,
      store: memory,
    }),
}));
import { requireAuth } from "../server/middleware/auth.middleware";
import { startLearningApi } from "../server/app/learning-bootstrap";
let api: Awaited<ReturnType<typeof startLearningApi>> | undefined;
let cookies: string[];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.coreClose.mockResolvedValue(undefined);
  mocks.learningClose.mockResolvedValue(undefined);
  mocks.learningQuery.mockResolvedValue({ rows: [] });
  mocks.createPools.mockReturnValue({
    pool: { query: mocks.learningQuery },
    close: mocks.learningClose,
    runJob: vi.fn(),
  });
  mocks.runtimeStart.mockResolvedValue(undefined);
  mocks.runtimeStop.mockResolvedValue(undefined);
  mocks.closeWs.mockResolvedValue(undefined);
  mocks.health.mockImplementation(() => ({
    ready: true,
    lastFlagRefreshAt: Date.now(),
  }));
  mocks.getUser.mockImplementation(async (id: number) => ({
    id,
    module: id === 1 ? "administration" : "teacher",
    modules: [id === 1 ? "administration" : "teacher"],
    isActive: true,
    isArchived: false,
  }));
  mocks.analytics.mockResolvedValue({ checked: true });
  mocks.results.mockResolvedValue([{ id: 1, studentId: 11 }]);
  const ports = {
    learning: { analytics: mocks.analytics, results: mocks.results },
  } as unknown as LmsPorts;
  mocks.createRuntime.mockReturnValue({
    beforeBodyParser: (_req: unknown, _res: unknown, next: () => void) =>
      next(),
    health: mocks.health,
    start: mocks.runtimeStart,
    stop: mocks.runtimeStop,
    attachWebSocket: mocks.attach,
    closeWebSocket: mocks.closeWs,
    registerRoutes: (app: Express) => {
      app.use(
        "/api/lms-management",
        requireAuth,
        createLmsManagementRouter(
          new LmsService(ports),
          async (req) => ({
            userId: req.user!.id,
            modules: [req.user!.module!],
            isLeadership: req.user!.id === 1,
          }),
          () => true,
        ),
      );
    },
  });
  cookies = [1, 2].map((id) => {
    const sid = crypto.randomBytes(16).toString("hex");
    memory.set(sid, {
      userId: id,
      cookie: {
        expires: new Date(Date.now() + 3600000),
        originalMaxAge: 3600000,
        httpOnly: true,
        path: "/",
      },
    } as session.SessionData);
    const sig = crypto
      .createHmac("sha256", mocks.config.session.secret)
      .update(sid)
      .digest("base64")
      .replace(/=+$/, "");
    return `academy.sid=${encodeURIComponent(`s:${sid}.${sig}`)}`;
  });
});
afterEach(async () => {
  await api?.stop();
  api = undefined;
});
describe("independent learning HTTP launchers", () => {
  it("serves reports through existing staff auth/leadership rules with no static assets, staff WS, cron or integration initialization", async () => {
    api = await startLearningApi({
      options: resolveLearningApiOptions({
        args: ["--scope=reports", "--pool-max=2"],
        environment: {},
      }),
    });
    await request(api.server).get("/health/ready").expect(200, { ok: true });
    await request(api.server).get("/api/lms-management/analytics").expect(401);
    await request(api.server)
      .get("/api/lms-management/analytics")
      .set("Cookie", cookies[1])
      .expect(403);
    expect(mocks.analytics).not.toHaveBeenCalled();
    await request(api.server)
      .get("/api/lms-management/analytics?days=30")
      .set("Cookie", cookies[0])
      .expect(200, { checked: true });
    expect(mocks.analytics).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, isLeadership: true }),
      { days: 30 },
    );
    await request(api.server)
      .get("/api/lms-management/results?runId=3")
      .set("Cookie", cookies[0])
      .expect(200);
    const queries = mocks.getUser.mock.calls.length;
    await request(api.server)
      .post("/api/portal/files")
      .set("X-Requested-With", "XMLHttpRequest")
      .type("json")
      .send("{")
      .expect(404);
    expect(mocks.getUser).toHaveBeenCalledTimes(queries);
    expect(mocks.attach).not.toHaveBeenCalled();
    expect(mocks.static).not.toHaveBeenCalled();
    expect(mocks.legacy).not.toHaveBeenCalled();
    mocks.health.mockReturnValue({
      ready: false,
      lastFlagRefreshAt: Date.now(),
    });
    await request(api.server).get("/health/ready").expect(503, { ok: false });
  });
  it("keeps the single physical writer scope authenticated and fails all other routes before parsing", async () => {
    api = await startLearningApi({
      options: resolveLearningApiOptions({
        args: ["--scope=files"],
        environment: {},
      }),
    });
    await request(api.server)
      .post("/api/lms-management/files")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({})
      .expect(401);
    await request(api.server)
      .post("/api/lms-management/reports")
      .set("X-Requested-With", "XMLHttpRequest")
      .type("json")
      .send("{")
      .expect(404);
    expect(mocks.attach).not.toHaveBeenCalled();
    expect(mocks.static).not.toHaveBeenCalled();
  });
  it("retains portal WebSocket/static capability only in the regular dedicated API", async () => {
    api = await startLearningApi({
      options: resolveLearningApiOptions({
        args: [],
        environment: { LMS_FILE_WRITES: "external" },
      }),
    });
    expect(mocks.attach).toHaveBeenCalledTimes(1);
    expect(mocks.static).toHaveBeenCalledTimes(1);
    await request(api.server)
      .post("/api/lms-management/assignments")
      .set("X-Requested-With", "XMLHttpRequest")
      .type("json")
      .send("{")
      .expect(503);
    await request(api.server).get("/api/legacy/session").expect(404);
    await Promise.all([api.stop(), api.stop()]);
    expect(mocks.runtimeStop).toHaveBeenCalledTimes(1);
    expect(mocks.learningClose).toHaveBeenCalledTimes(1);
    expect(mocks.coreClose).toHaveBeenCalledTimes(1);
  });
  it("refuses disabled startup without pools and closes all owned pools on strict initialization failure", async () => {
    const options = resolveLearningApiOptions({
      args: ["--scope=reports"],
      environment: {},
    });
    await expect(
      startLearningApi({
        config: { ...mocks.config, portal: { enabled: false } } as AppConfig,
        options,
      }),
    ).rejects.toThrow("unavailable");
    expect(mocks.createPools).not.toHaveBeenCalled();
    mocks.runtimeStart.mockRejectedValueOnce(new Error("missing schema"));
    await expect(startLearningApi({ options })).rejects.toThrow(
      "missing schema",
    );
    expect(mocks.runtimeStop).toHaveBeenCalledTimes(1);
    expect(mocks.learningClose).toHaveBeenCalledTimes(1);
    expect(mocks.coreClose).toHaveBeenCalledTimes(1);
  });
  it("closes core ownership if private pool initialization fails before a runtime exists", async () => {
    mocks.createPools.mockImplementationOnce(() => {
      throw new Error("private pool failure");
    });
    await expect(
      startLearningApi({
        options: resolveLearningApiOptions({
          args: ["--scope=reports"],
          environment: {},
        }),
      }),
    ).rejects.toThrow("private pool failure");
    expect(mocks.coreClose).toHaveBeenCalledTimes(1);
    expect(mocks.learningClose).not.toHaveBeenCalled();
    expect(mocks.createRuntime).not.toHaveBeenCalled();
  });
  it("awaits active runtime jobs after WebSocket close failure before closing either pool", async () => {
    api = await startLearningApi({
      options: resolveLearningApiOptions({ args: [], environment: {} }),
    });
    const current = api;
    let finish!: () => void;
    mocks.runtimeStop.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    mocks.closeWs.mockRejectedValueOnce(new Error("WebSocket close failure"));
    const stopping = current.stop();
    void stopping.catch(() => undefined);
    try {
      await vi.waitFor(() =>
        expect(mocks.runtimeStop).toHaveBeenCalledTimes(1),
      );
      expect(mocks.learningClose).not.toHaveBeenCalled();
      expect(mocks.coreClose).not.toHaveBeenCalled();
      finish();
      await expect(stopping).rejects.toThrow("WebSocket close failure");
      expect(mocks.learningClose).toHaveBeenCalledTimes(1);
      expect(mocks.coreClose).toHaveBeenCalledTimes(1);
    } finally {
      finish();
      await stopping.catch(() => undefined);
      api = undefined;
    }
  });
  it("attempts both pool closures and reports a pool failure after the runtime has stopped", async () => {
    api = await startLearningApi({
      options: resolveLearningApiOptions({
        args: ["--scope=reports"],
        environment: {},
      }),
    });
    const current = api;
    mocks.learningClose.mockRejectedValueOnce(
      new Error("learning pool close failure"),
    );
    try {
      await expect(current.stop()).rejects.toThrow(
        "learning pool close failure",
      );
      expect(mocks.runtimeStop).toHaveBeenCalledTimes(1);
      expect(mocks.coreClose).toHaveBeenCalledTimes(1);
    } finally {
      await current.stop().catch(() => undefined);
      api = undefined;
    }
  });
});
