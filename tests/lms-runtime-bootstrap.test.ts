import bcrypt from "bcrypt";
import { Router, type Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryPortalRepository } from "./portal-identity-memory";
import {
  PortalIdentityService,
  createPortalCrypto,
  createPortalIdentityRouter,
} from "../server/modules/portal-identity";
import {
  createPortalSessionMiddleware,
  portalCsrfProtection,
} from "../server/infrastructure/portal-session";
import type { ApplicationRuntime } from "../server/app/bootstrap";

const mocks = vi.hoisted(() => ({
  config: {
    database: { url: "postgresql://fixture.invalid/unused" },
    server: {
      environment: "development",
      host: "127.0.0.1",
      port: 0,
      appUrl: "http://127.0.0.1:5000",
      trustedProxies: false,
    },
    session: { secret: "bootstrap-staff-fixture-secret", cookieSecure: false },
    email: {},
  },
  sessionPaths: [] as string[],
  createRuntime: vi.fn(),
  startScheduler: vi.fn(),
  stopScheduler: vi.fn(),
  closeWebSocket: vi.fn(),
  poolEnd: vi.fn(),
  poolQuery: vi.fn(),
  getUser: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../server/config", () => ({
  appConfig: mocks.config,
  isDevelopmentEnvironment: false,
  isProductionEnvironment: false,
  secureSessionCookies: false,
  trustedProxyConfig: false,
}));
vi.mock("../server/db", () => ({
  pool: { query: mocks.poolQuery, end: mocks.poolEnd },
}));
vi.mock("../server/lib/logger", () => ({ logger: mocks.logger }));
vi.mock("../server/storage", () => ({ storage: { getUser: mocks.getUser } }));
vi.mock("../server/infrastructure/database-health", () => ({
  assertDatabaseConnection: vi.fn(async () => undefined),
}));
vi.mock("../server/services/integration-settings", () => ({
  loadIntegrationSettings: vi.fn(async () => undefined),
}));
vi.mock("../server/services/scheduler", () => ({
  startScheduler: mocks.startScheduler,
  stopScheduler: mocks.stopScheduler,
}));
vi.mock("../server/routes/telegram-tasks.routes", () => ({
  registerTelegramTaskRoutes: vi.fn(),
}));
vi.mock("../server/vite", () => ({
  serveStatic: vi.fn(),
  setupVite: vi.fn(),
  log: vi.fn(),
}));
vi.mock("../server/realtime/websocket-gateway", () => ({
  attachWebSocketGateway: vi.fn(async () => ({ close: mocks.closeWebSocket })),
}));
vi.mock("../server/infrastructure/lms-runtime", () => ({
  createLearningRuntime: mocks.createRuntime,
}));
vi.mock("../server/infrastructure/session", async () => {
  const { default: session } = await import("express-session");
  return {
    createSessionMiddleware: () => {
      const middleware = session({
        name: "academy.sid",
        secret: mocks.config.session.secret,
        resave: false,
        saveUninitialized: false,
        cookie: { httpOnly: true, sameSite: "lax" },
      });
      return ((req, res, next) => {
        mocks.sessionPaths.push(req.path);
        middleware(req, res, next);
      }) as ReturnType<typeof session>;
    },
  };
});
vi.mock("../server/routes", () => ({
  registerApiRoutes: (app: Express) => {
    app.post("/api/legacy/login", (req, res) => {
      req.session.userId = 11;
      res.json({ success: true });
    });
    app.get("/api/legacy/session", (req, res) =>
      res.json({
        staffUserId: req.session.userId ?? null,
        portalAccountId: req.portalSession?.accountId ?? null,
      }),
    );
    app.post("/api/legacy/logout", (req, res) =>
      req.session.destroy(() => {
        res.clearCookie("academy.sid");
        res.json({ success: true });
      }),
    );
  },
}));

let runtime: ApplicationRuntime | undefined;
let identity: PortalIdentityService;
const credentials = {
  identifier: "portal.login",
  password: "Bootstrap-secret-123",
};
const cookies = (headers: Record<string, unknown>, name: string) => {
  const values = headers["set-cookie"] as string[];
  return (
    [...(values ?? [])]
      .reverse()
      .find((value) => value.startsWith(`${name}=`))
      ?.split(";", 1)[0] ?? ""
  );
};
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.sessionPaths.length = 0;
  const repository = new MemoryPortalRepository();
  repository.accounts.set(1, {
    id: 1,
    login: "portal.login",
    fullName: "Portal learner",
    email: null,
    phone: null,
    locale: "en",
    status: "active",
    passwordHash: await bcrypt.hash(credentials.password, 1),
    authVersion: 1,
    emailVerifiedAt: null,
    pendingEmail: null,
  });
  repository.students.set(10, {
    id: 10,
    studentName: "Portal learner",
    managerId: 11,
    classification: "adult",
    verifiedBirthDate: null,
  });
  repository.links.set(12, {
    id: 12,
    accountId: 1,
    studentId: 10,
    kind: "self",
    relationship: null,
    permissions: ["learning.read"],
    status: "active",
    verifiedAt: Date.now(),
    verifiedBy: 11,
    expiresAt: null,
  });
  identity = new PortalIdentityService(
    repository,
    createPortalCrypto(Buffer.alloc(32, 31).toString("base64")),
    {
      appUrl: mocks.config.server.appUrl,
      allowInvitations: false,
      emailEnabled: false,
    },
  );
  mocks.createRuntime.mockImplementation(() => ({
    registerRoutes: (app: Express) => {
      const router = Router();
      router.use(
        createPortalSessionMiddleware({
          secret: "bootstrap-independent-portal-session-secret",
          secure: false,
          service: identity,
        }),
        portalCsrfProtection,
        createPortalIdentityRouter({ service: identity }),
      );
      app.use("/api/portal", router);
      app.get("/api/public/portfolio/:share", (req, res) =>
        res.json({
          hasStaffSession: Boolean(req.session),
          hasPortalSession: Boolean(req.portalSession),
        }),
      );
    },
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  }));
  const { startApplication } = await import("../server/app/bootstrap");
  runtime = await startApplication();
});
afterEach(async () => {
  await runtime?.stop();
  runtime = undefined;
});

describe("Actual HTTP bootstrap separates staff and portal authentication", () => {
  it("closes the core pool after a learning shutdown error rather than abandoning ownership", async () => {
    const actual = mocks.createRuntime.mock.results[0].value as {
      stop: ReturnType<typeof vi.fn>;
    };
    actual.stop.mockRejectedValueOnce(new Error("learning shutdown failure"));
    const current = runtime!;
    try {
      await expect(current.stop()).rejects.toThrow("learning shutdown failure");
      expect(mocks.poolEnd).toHaveBeenCalledTimes(1);
    } finally {
      await current.stop().catch(() => undefined);
      runtime = undefined;
    }
  });
  it("skips staff middleware for portal and public requests and never accepts a cookie from the other account namespace", async () => {
    const staff = await request(runtime!.server)
      .post("/api/legacy/login")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({})
      .expect(200);
    const staffCookie = cookies(staff.headers, "academy.sid");
    expect(staffCookie).toContain("academy.sid=");
    const boot = await request(runtime!.server)
      .get("/api/portal/auth/session")
      .set("Cookie", staffCookie)
      .expect(200);
    expect(boot.body.account).toBeNull();
    expect(boot.body.subjects).toEqual([]);
    const anonymousPortalCookie = cookies(boot.headers, "academy.portal.sid");
    expect(anonymousPortalCookie).toContain("academy.portal.sid=");
    expect(cookies(boot.headers, "academy.sid")).toBe("");
    const logged = await request(runtime!.server)
      .post("/api/portal/auth/login")
      .set("Cookie", anonymousPortalCookie)
      .set("X-Portal-CSRF", boot.body.csrfToken)
      .set("X-Requested-With", "XMLHttpRequest")
      .send(credentials)
      .expect(200);
    expect(logged.body.account.id).toBe(1);
    const portalCookie = cookies(logged.headers, "academy.portal.sid");
    expect(cookies(logged.headers, "academy.sid")).toBe("");
    await request(runtime!.server)
      .get("/api/portal/me")
      .set("Cookie", staffCookie)
      .expect(401);
    const staffWithPortal = await request(runtime!.server)
      .get("/api/legacy/session")
      .set("Cookie", portalCookie)
      .expect(200);
    expect(staffWithPortal.body).toEqual({
      staffUserId: null,
      portalAccountId: null,
    });
    const mixed = await request(runtime!.server)
      .get("/api/legacy/session")
      .set("Cookie", `${staffCookie}; ${portalCookie}`)
      .expect(200);
    expect(mixed.body).toEqual({ staffUserId: 11, portalAccountId: null });
    const publicPage = await request(runtime!.server)
      .get("/api/public/portfolio/opaque-share")
      .set("Cookie", `${staffCookie}; ${portalCookie}`)
      .expect(200);
    expect(publicPage.body).toEqual({
      hasStaffSession: false,
      hasPortalSession: false,
    });
    expect(
      mocks.sessionPaths.some(
        (path) =>
          path.startsWith("/api/portal") ||
          path.startsWith("/api/public/portfolio"),
      ),
    ).toBe(false);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });
  it("logs out each account independently and keeps no-referrer/no-store headers on activation pages", async () => {
    const staffAgent = request.agent(runtime!.server);
    const staff = await staffAgent
      .post("/api/legacy/login")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({})
      .expect(200);
    const staffCookie = cookies(staff.headers, "academy.sid");
    const portalAgent = request.agent(runtime!.server);
    const boot = await portalAgent.get("/api/portal/auth/session").expect(200);
    const portal = await portalAgent
      .post("/api/portal/auth/login")
      .set("X-Portal-CSRF", boot.body.csrfToken)
      .set("X-Requested-With", "XMLHttpRequest")
      .send(credentials)
      .expect(200);
    const portalCookie = cookies(portal.headers, "academy.portal.sid");
    const logout = await request(runtime!.server)
      .post("/api/portal/auth/logout")
      .set("Cookie", `${staffCookie}; ${portalCookie}`)
      .set("X-Portal-CSRF", portal.body.csrfToken)
      .set("X-Requested-With", "XMLHttpRequest")
      .send({})
      .expect(200);
    expect(cookies(logout.headers, "academy.sid")).toBe("");
    expect(
      (await staffAgent.get("/api/legacy/session").expect(200)).body
        .staffUserId,
    ).toBe(11);
    const newBoot = await portalAgent
      .get("/api/portal/auth/session")
      .expect(200);
    const loggedAgain = await portalAgent
      .post("/api/portal/auth/login")
      .set("X-Portal-CSRF", newBoot.body.csrfToken)
      .set("X-Requested-With", "XMLHttpRequest")
      .send(credentials)
      .expect(200);
    await staffAgent
      .post("/api/legacy/logout")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({})
      .expect(200);
    expect(
      (await portalAgent.get("/api/portal/auth/session").expect(200)).body
        .account.id,
    ).toBe(1);
    expect(loggedAgain.body.account.id).toBe(1);
    const activation = await request(runtime!.server)
      .get("/learn/activate")
      .expect(404);
    expect(activation.headers["referrer-policy"]).toBe("no-referrer");
    expect(activation.headers["cache-control"]).toBe("private, no-store");
    expect(activation.headers["x-robots-tag"]).toBe("noindex, nofollow");
  });
});
