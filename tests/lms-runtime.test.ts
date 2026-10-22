import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import { createHmac } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import session from "express-session";
import request from "supertest";
import type { Pool } from "pg";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
  type MockInstance,
} from "vitest";
import type { AppConfig } from "../server/config";
import { DEFAULT_LEARNING_SCHOOL_SETTINGS } from "@shared/contracts/learning-settings";
const mocks = vi.hoisted(() => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  getUser: vi.fn(),
  gateway: { create: vi.fn(), refresh: vi.fn(), close: vi.fn() },
}));
vi.mock("../server/lib/logger", () => ({ logger: mocks.logger }));
vi.mock("../server/storage", () => ({ storage: { getUser: mocks.getUser } }));
vi.mock("../server/realtime/portal-websocket-gateway", () => ({
  createPortalWebSocketGateway: mocks.gateway.create,
}));
import { createHttpApp } from "../server/app/http-app";
import { createLearningRuntime } from "../server/infrastructure/lms-runtime";
import { requireAuth } from "../server/middleware/auth.middleware";
import { PortalCredentialProvisioning } from "../server/modules/portal-identity/infrastructure/credential-provisioning";
import { PortalNotificationWorker } from "../server/modules/portal-resources/infrastructure/notification-worker";
import { PortalResourceService } from "../server/modules/portal-resources/application/resource-service";
import { PgQuizRepository } from "../server/modules/lms/infrastructure/quiz-repository";
import { PgLearningRepository } from "../server/modules/lms/infrastructure/learning-repository";
import type { LmsSql } from "../server/modules/lms/infrastructure/postgres-base";
import { LmsService } from "../server/modules/lms/application/lms-service";
import { PortalError } from "../server/modules/portal-identity";
import type { LearningJobRunner } from "../server/infrastructure/learning-job-runner";
import type { LearningProcessRole } from "../server/infrastructure/learning-execution";
import * as reservations from "../server/modules/portal-resources/infrastructure/storage-reservation";

const configuration = (enabled: boolean): AppConfig => {
  const config = JSON.parse(
    readFileSync("config/app.config.example.json", "utf8"),
  ) as AppConfig;
  config.portal = {
    enabled,
    learningEnabled: true,
    publicPortfolioEnabled: true,
    allowInvitations: true,
    sessionSecret: "runtime-portal-session-fixture-".repeat(2),
    tokenEncryptionKey: Buffer.alloc(32, 13).toString("base64"),
  };
  return config;
};
let missing: boolean;
let query: Mock<
  (sql: string) => Promise<{ rows: unknown[]; rowCount: number }>
>;
let runtime: ReturnType<typeof createLearningRuntime> | undefined;
let inApp: Mock<() => Promise<typeof result>>;
let credentials: MockInstance<PortalCredentialProvisioning["runOnce"]>;
let scanning: MockInstance<PortalResourceService["validateFiles"]>;
let cleanup: MockInstance<PortalResourceService["cleanupFiles"]>;
let quizzes: MockInstance<PgQuizRepository["finishExpired"]>;
let lifecycle: MockInstance<PgLearningRepository["reconcileGroupLifecycle"]>;
const result = { queued: 0, delivered: 0, cancelled: 0, failed: 0 };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};
const fakePool = () =>
  ({ query, connect: vi.fn(), end: vi.fn() }) as unknown as Pool;
const http = () => {
  const app = createHttpApp();
  app.use(
    session({
      name: "academy.sid",
      secret: "runtime-staff-session-fixture",
      resave: false,
      saveUninitialized: false,
    }),
  );
  runtime!.registerRoutes(app);
  app.post("/api/legacy/login", (req, res) => {
    req.session.userId = 1;
    res.json({ success: true });
  });
  app.get("/api/legacy/students", requireAuth, (_req, res) =>
    res.json({ items: [{ id: 1, name: "Existing student" }] }),
  );
  app.use((_req, res) => res.status(404).json({ code: "notFound" }));
  return app;
};
beforeEach(() => {
  missing = false;
  query = vi.fn(async (sql: string) => {
    if (missing && /lms_|portal_/.test(sql))
      throw Object.assign(new Error("new tables unavailable"), {
        code: "42P01",
      });
    if (sql.includes("FROM lms_feature_flags"))
      return {
        rows: ["learning", "invitations", "public_portfolio"].map(
          (key) => ({
            key,
            enabled: true,
            all_groups: true,
            group_ids: [],
            version: 0,
            updated_at: new Date(),
          }),
        ),
        rowCount: 3,
      };
    if (sql.includes("FROM lms_school_settings"))
      return {
        rows: [
          {
            settings: structuredClone(DEFAULT_LEARNING_SCHOOL_SETTINGS),
            version: 0,
            updated_by: null,
          },
        ],
        rowCount: 1,
      };
    return { rows: [], rowCount: 0 };
  });
  mocks.getUser.mockResolvedValue({
    id: 1,
    module: "administration",
    modules: ["administration"],
    isActive: true,
    isArchived: false,
  });
  mocks.logger.error.mockClear();
  mocks.gateway.refresh.mockReset().mockResolvedValue(undefined);
  mocks.gateway.close.mockReset().mockResolvedValue(undefined);
  mocks.gateway.create.mockReset().mockReturnValue({
    refresh: mocks.gateway.refresh,
    close: mocks.gateway.close,
    size: 0,
  });
  inApp = vi.fn(async () => result);
  vi.spyOn(PortalNotificationWorker.prototype, "runOnce").mockImplementation(() => inApp());
  credentials = vi.spyOn(PortalCredentialProvisioning.prototype, "runOnce").mockResolvedValue({ prepared: 0 });
  scanning = vi
    .spyOn(PortalResourceService.prototype, "validateFiles")
    .mockResolvedValue(0);
  cleanup = vi
    .spyOn(PortalResourceService.prototype, "cleanupFiles")
    .mockResolvedValue(undefined);
  quizzes = vi
    .spyOn(PgQuizRepository.prototype, "finishExpired")
    .mockResolvedValue({ finished: 0 });
  lifecycle = vi
    .spyOn(PgLearningRepository.prototype, "reconcileGroupLifecycle")
    .mockResolvedValue({ completed: 0 });
  vi.spyOn(reservations, "cleanupResourceQuarantine").mockResolvedValue(0);
});
afterEach(async () => {
  await runtime?.stop();
  runtime = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LMS composition default-off isolation and background scheduling", () => {
  it("refreshes the portal after a successful CRM payment and ignores a rejected payment", async () => {
    runtime = createLearningRuntime(fakePool(), configuration(true), { mode: "api", roles: ["api"] });
    await runtime.start();
    runtime.attachWebSocket({} as Server);
    const app = express();
    runtime.registerRoutes(app);
    let status = 201;
    app.post("/api/academy/payments", (_req, res) => res.status(status).json({ id: 1 }));
    await request(app).post("/api/academy/payments").send({}).expect(201);
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(mocks.gateway.refresh).toHaveBeenCalledExactlyOnceWith({ force: true });
    status = 400;
    await request(app).post("/api/academy/payments").send({}).expect(400);
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(mocks.gateway.refresh).toHaveBeenCalledTimes(1);
  });
  it("stops timers and awaits outstanding jobs even when gateway shutdown rejects", async () => {
    vi.useFakeTimers();
    const held = deferred<typeof result>();
    inApp.mockReturnValue(held.promise);
    runtime = createLearningRuntime(fakePool(), configuration(true));
    await runtime.start();
    runtime.attachWebSocket({} as Server);
    await vi.advanceTimersByTimeAsync(15_000);
    mocks.gateway.close.mockRejectedValueOnce(
      new Error("gateway shutdown failure"),
    );
    const current = runtime,
      done = vi.fn(),
      stopping = current.stop().then(done);
    void stopping.catch(() => undefined);
    try {
      await vi.advanceTimersByTimeAsync(30_000);
      expect(done).not.toHaveBeenCalled();
      expect(inApp).toHaveBeenCalledTimes(1);
      held.resolve(result);
      await expect(stopping).rejects.toThrow("gateway shutdown failure");
    } finally {
      held.resolve(result);
      await stopping.catch(() => undefined);
      runtime = undefined;
    }
  });
  it("keeps API flags and WebSocket refresh active while all background roles are external", async () => {
    vi.useFakeTimers();
    runtime = createLearningRuntime(fakePool(), configuration(true), {
      mode: "api",
      roles: ["api"],
    });
    await runtime.start();
    runtime.attachWebSocket({} as Server);
    const firstRefresh = runtime.health().lastFlagRefreshAt;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runtime.health()).toMatchObject({ ready: true, roles: ["api"] });
    expect(runtime.health().lastFlagRefreshAt).toBeGreaterThan(firstRefresh!);
    expect(mocks.gateway.refresh).toHaveBeenCalledTimes(2);
    for (const work of [
      inApp,
      credentials,
      scanning,
      cleanup,
      lifecycle,
      quizzes,
    ])
      expect(work).not.toHaveBeenCalled();
    missing = true;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(runtime.health().ready).toBe(false);
  });
  it.each([
    "lifecycle",
    "notifications",
    "credentials",
    "files",
    "maintenance",
  ] as LearningProcessRole[])(
    "runs only the selected %s worker role and retains per-process flag refresh",
    async (role) => {
      vi.useFakeTimers();
      const runJob = vi.fn<LearningJobRunner>(async (_name, work) => {
        await work(new AbortController().signal);
        return true;
      });
      runtime = createLearningRuntime(fakePool(), configuration(true), {
        mode: "worker",
        roles: [role],
        runJob,
      });
      await runtime.start();
      expect(() => runtime!.registerRoutes(express())).toThrow();
      expect(() => runtime!.attachWebSocket({} as Server)).toThrow();
      await vi.advanceTimersByTimeAsync(
        role === "maintenance" ? 3_600_000 : 30_000,
      );
      const names = [...new Set(runJob.mock.calls.map(([name]) => name))];
      expect(names).toEqual(
        [role],
      );
      expect(runtime.health().lastFlagRefreshAt).not.toBeNull();
      for (const [active, work] of [
        [role === "notifications", inApp],
        [role === "credentials", credentials],
        [role === "files", scanning],
        [role === "maintenance", cleanup],
        [role === "lifecycle", lifecycle],
        [role === "lifecycle", quizzes],
      ] as const) {
        if (active) expect(work).toHaveBeenCalled();
        else expect(work).not.toHaveBeenCalled();
      }
      expect(mocks.gateway.create).not.toHaveBeenCalled();
    },
  );
  it("observes a lost lifecycle lease before moving to the next business mutation", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    lifecycle.mockImplementation(async () => {
      controller.abort();
      return { completed: 0 };
    });
    const runJob: LearningJobRunner = async (_name, work) => {
      await work(controller.signal);
      return true;
    };
    runtime = createLearningRuntime(fakePool(), configuration(true), {
      mode: "worker",
      roles: ["lifecycle"],
      runJob,
    });
    await runtime.start();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(lifecycle).toHaveBeenCalledTimes(1);
    expect(quizzes).not.toHaveBeenCalled();
    expect(mocks.logger.error).toHaveBeenCalled();
  });
  it("initializes worker flags strictly and stops before any timer or job if the new schema is unavailable", async () => {
    vi.useFakeTimers();
    missing = true;
    runtime = createLearningRuntime(fakePool(), configuration(true), {
      mode: "worker",
      roles: ["files"],
    });
    await expect(runtime.start()).rejects.toMatchObject({ code: "42P01" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(scanning).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("validates each HTTP session and link once per request and observes a revoked link on the next request", async () => {
    const config = configuration(true);
    runtime = createLearningRuntime(fakePool(), config);
    await runtime.start();
    const id = Buffer.alloc(32, 17).toString("base64url"),
      csrf = Buffer.alloc(32, 18).toString("base64url");
    const cookie = `academy.portal.sid=${id}.${createHmac("sha256", config.portal!.sessionSecret!).update(id).digest("base64url")}`;
    const session = {
      id,
      accountId: 7,
      authVersion: 1,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      absoluteExpiresAt: Date.now() + 3600000,
      csrfToken: csrf,
      reauthenticatedAt: null,
    };
    const checkedSession = vi
      .spyOn(runtime.identity, "resolveSession")
      .mockResolvedValue(session);
    let revoked = false;
    const current = vi
      .spyOn(runtime.identity, "resolveAccountActor")
      .mockImplementation(async (accountId, linkId, _permission, sessionId) => {
        if (revoked && linkId === 8)
          throw new PortalError("portalNotFound", 404);
        return {
          portalAccountId: accountId,
          linkId,
          studentId: linkId + 10,
          sessionId: sessionId!,
          kind: "self",
          studentClassification: "adult",
          permissions: ["learning.read"],
        };
      });
    const allowed = vi
      .spyOn(runtime.flags, "enabledForStudent")
      .mockResolvedValue(true);
    const dashboard = vi
      .spyOn(LmsService.prototype, "dashboard")
      .mockImplementation(
        async (context) => ({ studentId: context.studentId }) as never,
      );
    const app = http();
    await request(app)
      .get("/api/portal/subjects/8/dashboard")
      .set("Cookie", cookie)
      .expect(200, { studentId: 18 });
    expect(checkedSession).toHaveBeenCalledTimes(1);
    expect(current).toHaveBeenCalledTimes(1);
    expect(allowed).toHaveBeenCalledTimes(1);
    await request(app)
      .get("/api/portal/subjects/9/dashboard")
      .set("Cookie", cookie)
      .expect(200, { studentId: 19 });
    revoked = true;
    await request(app)
      .get("/api/portal/subjects/8/dashboard")
      .set("Cookie", cookie)
      .expect(404);
    expect(checkedSession).toHaveBeenCalledTimes(3);
    expect(current).toHaveBeenCalledTimes(3);
    expect(dashboard).toHaveBeenCalledTimes(2);
  });
  it("debounces mutations to their affected students and does not refresh on a denied mutation", async () => {
    const config = configuration(true);
    runtime = createLearningRuntime(fakePool(), config);
    await runtime.start();
    runtime.attachWebSocket({} as Server);
    const id = Buffer.alloc(32, 21).toString("base64url"),
      csrf = Buffer.alloc(32, 22).toString("base64url");
    const cookie = `academy.portal.sid=${id}.${createHmac("sha256", config.portal!.sessionSecret!).update(id).digest("base64url")}`;
    vi.spyOn(runtime.identity, "resolveSession").mockResolvedValue({
      id,
      accountId: 7,
      authVersion: 1,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      absoluteExpiresAt: Date.now() + 3600000,
      csrfToken: csrf,
      reauthenticatedAt: null,
    });
    vi.spyOn(runtime.identity, "resolveAccountActor").mockImplementation(
      async (accountId, linkId, _permission, sessionId) => ({
        portalAccountId: accountId,
        linkId,
        studentId: linkId + 10,
        sessionId: sessionId!,
        kind: "self",
        studentClassification: "adult",
        permissions: ["learning.read"],
      }),
    );
    vi.spyOn(runtime.flags, "enabledForStudent").mockResolvedValue(true);
    const read = vi
      .spyOn(LmsService.prototype, "readMaterial")
      .mockResolvedValue({ success: true } as never);
    const app = http();
    for (const linkId of [8, 9])
      await request(app)
        .put(`/api/portal/subjects/${linkId}/materials/1/read`)
        .set("Cookie", cookie)
        .set("X-Portal-CSRF", csrf)
        .set("X-Requested-With", "XMLHttpRequest")
        .send({})
        .expect(200);
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(mocks.gateway.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.gateway.refresh).toHaveBeenCalledWith({
      force: true,
      studentIds: [18, 19],
      accountIds: [],
    });
    read.mockRejectedValue(new PortalError("portalAccessDenied", 403));
    await request(app)
      .put("/api/portal/subjects/8/materials/1/read")
      .set("Cookie", cookie)
      .set("X-Portal-CSRF", csrf)
      .set("X-Requested-With", "XMLHttpRequest")
      .send({})
      .expect(403);
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(mocks.gateway.refresh).toHaveBeenCalledTimes(1);
  });
  it("preserves the review request correlation when first-project achievements are revoked or awarded", async () => {
    vi.useFakeTimers();
    let afterReview: PgLearningRepository["policy"]["afterReview"];
    lifecycle.mockImplementation(async function (this: PgLearningRepository) {
      afterReview = this.policy.afterReview;
      return { completed: 0 };
    });
    runtime = createLearningRuntime(fakePool(), configuration(true));
    await runtime.start();
    await vi.advanceTimersByTimeAsync(15_000);
    const reviewQuery = vi.fn(async (sql: string) => ({
      rows: sql.startsWith("UPDATE lms_achievements") ? [{ id: "41" }] : [],
      rowCount: 1,
    }));
    const actor = {
      userId: 1,
      modules: ["teacher"],
      isLeadership: false,
      requestId: "corrected-review-request",
    };
    await afterReview!({ query: reviewQuery } as unknown as LmsSql, actor, {
      studentId: 2,
      runId: 3,
      submissionId: 4,
      decision: "revision_required",
      reason: "Corrected evidence",
    });
    expect(
      reviewQuery.mock.calls.find(([sql]) =>
        sql.startsWith("INSERT INTO lms_learning_audit"),
      ),
    ).toEqual([
      expect.stringContaining("request_id"),
      [1, 3, "41", "Corrected evidence", actor.requestId],
    ]);
    const award = vi
      .spyOn(PgLearningRepository.prototype, "awardAutomatic")
      .mockResolvedValue({ id: 81, awarded: true });
    reviewQuery.mockImplementation(async (sql: string) => ({
      rows: sql.startsWith("SELECT project.id") ? [{ id: "81" }] : [],
      rowCount: 1,
    }));
    const sql = { query: reviewQuery } as unknown as LmsSql;
    await afterReview!(sql, actor, {
      studentId: 2,
      runId: 3,
      submissionId: 4,
      decision: "accepted",
      reason: "Confirmed evidence",
    });
    expect(award).toHaveBeenCalledWith(
      sql,
      2,
      3,
      "first_project",
      "first-project:2:3",
      "lmsAchievementFirstProject",
      "lmsAchievementFirstProjectReason",
      actor.userId,
      actor.requestId,
    );
  });
  it("keeps legacy authenticated HTTP available and closes portal endpoints without touching new tables or directories", async () => {
    const mkdir = vi.spyOn(fs, "mkdir");
    runtime = createLearningRuntime(fakePool(), configuration(false));
    await runtime.start();
    const agent = request.agent(http());
    await agent
      .post("/api/legacy/login")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({})
      .expect(200);
    await agent.get("/api/legacy/students").expect(200);
    for (const path of [
      "/api/portal/auth/session",
      "/api/portal/subjects",
      "/api/public/portfolio/test-share",
      "/api/academy/students/1/portal-access",
      "/api/lms-management/access-directory",
      "/api/lms-management/runs",
    ])
      await agent.get(path).expect(404);
    const status = await agent.get("/api/lms-management/status").expect(200);
    expect(status.body).toMatchObject({
      portalEnabled: false,
      learningEnabled: false,
    });
    expect(query).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
    expect(inApp).not.toHaveBeenCalled();
    expect(credentials).not.toHaveBeenCalled();
    expect(scanning).not.toHaveBeenCalled();
  });
  it("does not stop the CRM when enabled startup cannot read the new schema and keeps portal authentication closed", async () => {
    missing = true;
    runtime = createLearningRuntime(fakePool(), configuration(true));
    await expect(runtime.start()).resolves.toBeUndefined();
    expect(runtime.flags.capabilities().portalEnabled).toBe(false);
    const agent = request.agent(http());
    await agent
      .post("/api/legacy/login")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({})
      .expect(200);
    await agent.get("/api/legacy/students").expect(200);
    await agent.get("/api/portal/auth/session").expect(404);
    expect(mocks.logger.error).toHaveBeenCalled();
    expect(inApp).not.toHaveBeenCalled();
    expect(
      query.mock.calls.filter(([sql]) =>
        String(sql).includes("portal_sessions"),
      ),
    ).toHaveLength(0);
  });
  it("recovers readiness on the next publishing pass and closes it again after a schema read failure", async () => {
    vi.useFakeTimers();
    missing = true;
    runtime = createLearningRuntime(fakePool(), configuration(true));
    await runtime.start();
    expect(runtime.flags.capabilities().portalEnabled).toBe(false);
    missing = false;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(runtime.flags.capabilities().learningEnabled).toBe(true);
    expect(inApp).toHaveBeenCalledTimes(1);
    missing = true;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(runtime.flags.capabilities().portalEnabled).toBe(false);
    expect(inApp).toHaveBeenCalledTimes(1);
  });
  it("continues in-app publishing independently while credential preparation and file validation are all unresolved", async () => {
    vi.useFakeTimers();
    const heldIdentity = deferred<{ prepared: number }>();
    const heldScan = deferred<number>();
    credentials.mockReturnValue(heldIdentity.promise);
    scanning.mockReturnValue(heldScan.promise);
    runtime = createLearningRuntime(fakePool(), configuration(true));
    await runtime.start();
    try {
      await vi.advanceTimersByTimeAsync(90_000);
      expect(inApp).toHaveBeenCalledTimes(6);
      expect(quizzes).toHaveBeenCalledTimes(6);
      expect(lifecycle).toHaveBeenCalledTimes(6);
      expect(credentials).toHaveBeenCalledTimes(1);
      expect(scanning).toHaveBeenCalledTimes(1);
      expect(cleanup).not.toHaveBeenCalled();
    } finally {
      heldIdentity.resolve({ prepared: 0 });
      heldScan.resolve(0);
    }
  });
  it("does not overlap a publishing pass, stops timers immediately and waits for its outstanding work", async () => {
    vi.useFakeTimers();
    const held = deferred<typeof result>();
    inApp.mockReturnValue(held.promise);
    runtime = createLearningRuntime(fakePool(), configuration(true));
    await runtime.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(inApp).toHaveBeenCalledTimes(1);
    const finished = vi.fn(),
      stopping = runtime.stop().then(finished);
    try {
      await vi.advanceTimersByTimeAsync(60_000);
      expect(inApp).toHaveBeenCalledTimes(1);
      expect(finished).not.toHaveBeenCalled();
    } finally {
      held.resolve(result);
      await stopping;
    }
    expect(finished).toHaveBeenCalledTimes(1);
    runtime = undefined;
  });
  it("releases a failed job mutex so a later publishing pass can retry", async () => {
    vi.useFakeTimers();
    inApp.mockRejectedValueOnce(new Error("temporary delivery outage"));
    runtime = createLearningRuntime(fakePool(), configuration(true));
    await runtime.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(inApp).toHaveBeenCalledTimes(2);
    expect(mocks.logger.error).toHaveBeenCalled();
  });
});
