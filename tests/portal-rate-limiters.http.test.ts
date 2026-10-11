import { createHmac, randomBytes } from "node:crypto";
import http, { type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipKeyGenerator } from "express-rate-limit";
import {
  createPortalRateLimiters,
  isPortalRateLimitRealm,
  PORTAL_RATE_LIMIT_DEFAULTS,
  type PortalRateLimitBudgets,
} from "../server/infrastructure/portal-rate-limiters";
import {
  createPortalSessionMiddleware,
  portalCsrfProtection,
} from "../server/infrastructure/portal-session";
import { PortalIdentityService } from "../server/modules/portal-identity/application/identity-service";
import { createPortalCrypto } from "../server/modules/portal-identity/infrastructure/crypto";
import type { PortalSession } from "../server/modules/portal-identity/application/ports";
import type { PortalActorContext } from "../server/modules/portal-identity/domain/actor-context";
import type { LmsDraftInput } from "@shared/contracts/lms";
import { createLmsPortalRouter } from "../server/modules/lms/http/portal.router";
import { LmsService } from "../server/modules/lms/application/lms-service";
import type { LmsPorts } from "../server/modules/lms/application/ports";
import { MemoryPortalRepository } from "./portal-identity-memory";
import { createHttpApp } from "../server/app/http-app";
import {
  globalMutationLimiter,
  readLimiter,
} from "../server/middleware/rateLimiter";

vi.mock("../server/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/config")>()),
  isProductionEnvironment: true,
}));
vi.mock("../server/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const secret = "portal-rate-limiter-test-secret-".repeat(2);
const signedCookie = (id: string) =>
  `academy.portal.sid=${id}.${createHmac("sha256", secret).update(id).digest("base64url")}`;
const fixture = (
  limits: Partial<PortalRateLimitBudgets> = {},
  enabled: boolean | (() => boolean) = true,
) => {
  const repository = new MemoryPortalRepository();
  const sessions: PortalSession[] = [];
  const now = Date.now();
  for (let id = 1; id <= 100; id++) {
    repository.accounts.set(id, {
      id,
      login: `pupil.${id}`,
      fullName: `Pupil ${id}`,
      email: null,
      phone: null,
      locale: "ru",
      status: "active",
      passwordHash: null,
      authVersion: 1,
      emailVerifiedAt: null,
      pendingEmail: null,
    });
    repository.students.set(id, {
      id,
      studentName: `Pupil ${id}`,
      managerId: null,
      classification: "adult",
      verifiedBirthDate: null,
    });
    repository.links.set(id, {
      id,
      accountId: id,
      studentId: id,
      kind: "self",
      relationship: null,
      permissions: [],
      status: "active",
      verifiedAt: now,
      verifiedBy: 1,
      expiresAt: null,
    });
    const session: PortalSession = {
      id: randomBytes(32).toString("base64url"),
      accountId: id,
      authVersion: 1,
      createdAt: now,
      lastSeenAt: now,
      absoluteExpiresAt: now + 3600000,
      csrfToken: randomBytes(32).toString("base64url"),
      reauthenticatedAt: null,
    };
    sessions.push(session);
    repository.sessions.set(session.id, session);
  }
  const identity = new PortalIdentityService(repository, createPortalCrypto(), {
    appUrl: "https://academy.example",
    emailEnabled: false,
    allowInvitations: false,
  });
  const drafts = vi.fn(
    async (_actor: PortalActorContext, _id: number, input: LmsDraftInput) => ({
      version: input.version + 1,
      savedAt: new Date().toISOString(),
    }),
  );
  const ports = {
    assignments: { saveDraft: drafts },
    learning: { materials: vi.fn(async () => []) },
  } as unknown as LmsPorts;
  const limiters = createPortalRateLimiters({ enabled, limits });
  const app = createHttpApp({ beforeBodyParser: (req,res,next) => {
    if (/^\/api\/portal(?:\/|$)/.test(req.path)) return limiters.edge(req,res,next);
    if (/^\/api\/public\/portfolio(?:\/|$)/.test(req.path)) return limiters.publicPortfolio(req,res,next);
    next();
  } });
  app.post("/api/staff/budget", (_req, res) => res.json({ ok: true }));
  app.get("/api/staff/budget", (_req, res) => res.json({ ok: true }));
  app.use(
    "/api/portal",
    limiters.edge,
    createPortalSessionMiddleware({ secret, secure: false, service: identity }),
    limiters.account,
    portalCsrfProtection,
  );
  app.get("/api/portal/auth/session", (req, res) =>
    res.json({ accountId: req.portalSession?.accountId ?? null }),
  );
  app.post("/api/portal/files", (req, res) =>
    res.status(201).json({ accountId: req.portalSession?.accountId ?? null }),
  );
  app.use(
    "/api/portal/subjects",
    createLmsPortalRouter(
      new LmsService(ports),
      (req, linkId) =>
        identity.resolveActor(req.portalSession?.id ?? "", linkId),
      () => true,
    ),
  );
  app.get(
    "/api/public/portfolio/:token",
    limiters.publicPortfolio,
    (_req, res) => res.json({ title: "Published project" }),
  );
  return { app, repository, identity, sessions, drafts };
};
const draft = (
  app: express.Express | http.Server,
  session: PortalSession,
  id = session.accountId!,
) =>
  request(app)
    .put(`/api/portal/subjects/${id}/assignments/1/draft`)
    .set("Cookie", signedCookie(session.id))
    .set("X-Portal-CSRF", session.csrfToken)
    .set("X-Requested-With", "XMLHttpRequest")
    .send({ version: 0, text: "Current answer", links: [], fileIds: [] });
const read = (
  app: express.Express | http.Server,
  session: PortalSession,
  id = session.accountId!,
) =>
  request(app)
    .get(`/api/portal/subjects/${id}/materials`)
    .set("Cookie", signedCookie(session.id));

beforeEach(async () => {
  for (const ip of ["127.0.0.1", "::ffff:127.0.0.1", "::1"]) {
    await globalMutationLimiter.resetKey(ipKeyGenerator(ip));
    await readLimiter.resetKey(ipKeyGenerator(ip));
  }
});

describe("production portal rate-limit realms", () => {
  it('rejects excess traffic before decoding an oversized body and counts a request only once across mounts',async()=>{
    const limiters=createPortalRateLimiters({limits:{mutationPerIp:1}}),handled=vi.fn();
    const app=createHttpApp({beforeBodyParser:limiters.edge});
    app.use('/api/portal',limiters.edge);
    app.post('/api/portal/probe',(req,res)=>{handled(req.body);res.json({ok:true});});
    await request(app).post('/api/portal/probe').set('X-Requested-With','XMLHttpRequest').send({value:'small'}).expect(200);
    await request(app).post('/api/portal/probe').set('X-Requested-With','XMLHttpRequest').send({value:'x'.repeat(600_000)}).expect(429);
    expect(handled).toHaveBeenCalledExactlyOnceWith({value:'small'});
  });
  it("allows 100 validated pupils behind one IP without consuming the staff read or mutation budget", async () => {
    const { app, sessions, drafts } = fixture();
    // Share one real listener across concurrent pupils; per-request test listeners can exhaust sockets in the full suite.
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
    const staffWrites = await Promise.all(
      Array.from({ length: 101 }, () =>
        request(server)
          .post("/api/staff/budget")
          .set("X-Requested-With", "XMLHttpRequest")
          .send({}),
      ),
    );
    expect(staffWrites.filter((res) => res.status === 200)).toHaveLength(100);
    expect(staffWrites.filter((res) => res.status === 429)).toHaveLength(1);
    for (let iteration = 0; iteration < 12; iteration++) {
      const responses = await Promise.all(
        sessions.map((session) => read(server, session)),
      );
      expect(responses.every((res) => res.status === 200)).toBe(true);
    }
    for (let iteration = 0; iteration < 2; iteration++) {
      const responses = await Promise.all(
        sessions.map((session) => draft(server, session)),
      );
      expect(responses.every((res) => res.status === 200)).toBe(true);
    }
    expect(drafts).toHaveBeenCalledTimes(200);
    await request(server).get("/api/staff/budget").expect(200);
    await request(server)
      .post("/api/staff/budget")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({})
      .expect(429);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }, 20_000);

  it("limits one account across rotated cookies and subjects while preserving other shared-IP accounts", async () => {
    const { app, repository, sessions } = fixture({
      readPerAccount: 2,
      mutationPerAccount: 2,
    });
    const rotated = {
      ...sessions[0],
      id: randomBytes(32).toString("base64url"),
    };
    repository.sessions.set(rotated.id, rotated);
    await read(app, sessions[0]).expect(200);
    await read(app, rotated).expect(200);
    const rejectedRead = await read(app, sessions[0], 999);
    expect(rejectedRead.status).toBe(429);
    expect(rejectedRead.body.code).toBe("portalTooManyRequests");
    expect(Number(rejectedRead.headers["retry-after"])).toBeGreaterThan(0);
    await draft(app, sessions[0]).expect(200);
    await draft(app, rotated).expect(200);
    await draft(app, sessions[0], 999).expect(429);
    for (const session of sessions.slice(1, 11)) {
      await read(app, session).expect(200);
      await read(app, session).expect(200);
      await draft(app, session).expect(200);
      await draft(app, session).expect(200);
    }
  });

  it("keeps forged identifiers and anonymous signed cookies in the bounded anonymous IP realm", async () => {
    const { app, identity, repository, sessions } = fixture({
      anonymousReadPerIp: 3,
    });
    const resolve = vi.spyOn(identity, "resolveSession");
    for (let index = 0; index < 3; index++) {
      await request(app)
        .get(`/api/portal/auth/session?accountId=${index + 1}`)
        .set(
          "Cookie",
          `academy.portal.sid=${sessions[index].id}.forged-signature`,
        )
        .set("X-Portal-Account", String(index + 1))
        .set("X-Forwarded-For", `192.0.2.${index + 1}`)
        .expect(200, { accountId: null });
    }
    expect(resolve).not.toHaveBeenCalled();
    const anonymous = {
      ...sessions[0],
      id: randomBytes(32).toString("base64url"),
      accountId: null,
      authVersion: 0,
    };
    repository.sessions.set(anonymous.id, anonymous);
    await request(app)
      .get("/api/portal/auth/session")
      .set("Cookie", signedCookie(anonymous.id))
      .expect(429);
    await read(app, sessions[1]).expect(200);
  });

  it("rechecks revocation before assigning an account budget", async () => {
    const { app, repository, sessions } = fixture({ anonymousReadPerIp: 1 });
    await read(app, sessions[0]).expect(200);
    repository.accounts.get(1)!.authVersion++;
    await read(app, sessions[0]).expect(401);
    await read(app, sessions[0]).expect(429);
    await read(app, sessions[1]).expect(200);
  });

  it("enforces the coarse IP budget before live session validation without using cookie or account identifiers", async () => {
    const { app, identity, sessions } = fixture({
      readPerIp: 2,
      mutationPerIp: 2,
    });
    const resolve = vi.spyOn(identity, "resolveSession");
    await read(app, sessions[0]).expect(200);
    await read(app, sessions[1]).expect(200);
    const beforeRejectedRead = resolve.mock.calls.length;
    expect(beforeRejectedRead).toBeGreaterThan(0);
    await read(app, sessions[2]).expect(429);
    expect(resolve).toHaveBeenCalledTimes(beforeRejectedRead);
    await draft(app, sessions[0]).expect(200);
    await draft(app, sessions[1]).expect(200);
    const beforeRejectedMutation = resolve.mock.calls.length;
    expect(beforeRejectedMutation).toBeGreaterThan(beforeRejectedRead);
    await draft(app, sessions[2]).expect(429);
    expect(resolve).toHaveBeenCalledTimes(beforeRejectedMutation);
  });

  it("keeps development budgets disabled without spending a later production budget", async () => {
    let enabled = false;
    const { app, sessions } = fixture(
      { readPerAccount: 1, mutationPerAccount: 1 },
      () => enabled,
    );
    for (let index = 0; index < 3; index++) {
      await read(app, sessions[0]).expect(200);
      await draft(app, sessions[0]).expect(200);
    }
    enabled = true;
    await read(app, sessions[0]).expect(200);
    await read(app, sessions[0]).expect(429);
    await draft(app, sessions[0]).expect(200);
    await draft(app, sessions[0]).expect(429);
  });

  it("separates public portfolio traffic and caps authenticated uploads before parsing", async () => {
    const { app, sessions } = fixture({
      publicPortfolioReadPerIp: 2,
      uploadsPerAccount: 2,
    });
    await request(app).get("/api/public/portfolio/first").expect(200);
    await request(app).get("/api/public/portfolio/second").expect(200);
    await request(app).get("/api/public/portfolio/third").expect(429);
    await read(app, sessions[0]).expect(200);
    await request(app).get("/api/staff/budget").expect(200);
    const upload = (session: PortalSession) =>
      request(app)
        .post("/api/portal/files")
        .set("Cookie", signedCookie(session.id))
        .set("X-Portal-CSRF", session.csrfToken)
        .set("X-Requested-With", "XMLHttpRequest")
        .send({});
    await upload(sessions[0]).expect(201);
    await upload(sessions[0]).expect(201);
    await upload(sessions[0]).expect(429);
    await upload(sessions[1]).expect(201);
    await draft(app, sessions[0]).expect(200);
  });

  it("matches only complete portal/public portfolio path boundaries and derives bounded defaults", () => {
    for (const path of [
      "/api/portal",
      "/api/portal/auth/login",
      "/api/public/portfolio",
      "/api/public/portfolio/token/files/1",
    ])
      expect(isPortalRateLimitRealm(path)).toBe(true);
    for (const path of [
      "/api/portals",
      "/api/portal-admin",
      "/api/public/portfolio-admin",
      "/api/lms-management",
      "/api/academy/students/1/portal-access",
    ])
      expect(isPortalRateLimitRealm(path)).toBe(false);
    expect(PORTAL_RATE_LIMIT_DEFAULTS.mutationPerIp).toBe(
      100 * PORTAL_RATE_LIMIT_DEFAULTS.mutationPerAccount,
    );
    expect(PORTAL_RATE_LIMIT_DEFAULTS.readPerIp).toBe(
      100 * PORTAL_RATE_LIMIT_DEFAULTS.readPerAccount,
    );
    expect(PORTAL_RATE_LIMIT_DEFAULTS.maxInFlight).toBe(200);
    expect(() =>
      createPortalRateLimiters({ limits: { mutationPerAccount: 0 } }),
    ).toThrow();
  });
});

const nativeGet = (port: number, path: string, forwardedIp = "192.0.2.1") => {
  let response!: IncomingMessage;
  const req = http.get({
    host: "127.0.0.1",
    port,
    path,
    headers: { "X-Forwarded-For": forwardedIp },
  });
  const result = new Promise<{ status: number; body: string }>(
    (resolve, reject) => {
      req.once("response", (incoming) => {
        response = incoming;
        let body = "";
        incoming.on("data", (chunk) => {
          body += chunk;
        });
        incoming.once("end", () =>
          resolve({ status: incoming.statusCode ?? 0, body }),
        );
      });
      req.once("error", reject);
    },
  );
  void result.catch(() => {});
  return { req, result, response: () => response };
};

describe("portal preauthentication in-flight bounds", () => {
  it("rejects before session/database work and releases each slot once after finish or disconnect", async () => {
    const limiter = createPortalRateLimiters({
      limits: { maxInFlight: 3, maxInFlightPerIp: 2 },
    });
    const app = express();
    app.set("trust proxy", "loopback");
    const held: express.Response[] = [];
    const entered = vi.fn();
    app.use("/api/portal", limiter.edge, (_req, res) => {
      entered();
      held.push(res);
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const port = (server.address() as AddressInfo).port;
    const first = nativeGet(port, "/api/portal/auth/session");
    const second = nativeGet(port, "/api/portal/auth/session");
    try {
      await vi.waitFor(() => expect(held).toHaveLength(2));
      expect(
        (await nativeGet(port, "/api/portal/auth/session").result).status,
      ).toBe(429);
      expect(entered).toHaveBeenCalledTimes(2);
      const third = nativeGet(port, "/api/portal/auth/session", "192.0.2.2");
      await vi.waitFor(() => expect(held).toHaveLength(3));
      expect(
        (await nativeGet(port, "/api/portal/auth/session", "192.0.2.3").result)
          .status,
      ).toBe(429);
      first.req.destroy();
      await expect(first.result).rejects.toBeDefined();
      await vi.waitFor(() => expect(held[0].destroyed).toBe(true));
      const afterDisconnect = nativeGet(port, "/api/portal/auth/session");
      await vi.waitFor(() => expect(held).toHaveLength(4));
      held[1].json({ ok: true });
      held[2].json({ ok: true });
      held[3].json({ ok: true });
      expect((await second.result).status).toBe(200);
      expect((await third.result).status).toBe(200);
      expect((await afterDisconnect.result).status).toBe(200);
      const subsequent = [0, 1, 2].map((index) =>
        nativeGet(port, "/api/portal/auth/session", `192.0.2.${index + 1}`),
      );
      await vi.waitFor(() => expect(held).toHaveLength(7));
      held.slice(4).forEach((response) => response.json({ ok: true }));
      expect(
        (await Promise.all(subsequent.map((item) => item.result))).map(
          (item) => item.status,
        ),
      ).toEqual([200, 200, 200]);
    } finally {
      first.req.destroy();
      second.req.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
