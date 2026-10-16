import express from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
import { portalCsrfProtection } from "../server/infrastructure/portal-session";
import { PortalError } from "../server/modules/portal-identity/domain/access-policy";
import type { PortalResourceService } from "../server/modules/portal-resources/application/resource-service";
import { createPortalResourceRouter } from "../server/modules/portal-resources/http/router";

const csrf = "a".repeat(43);
const remove = vi.fn();
function app(accountId: number | null = 7) {
  const application = express();
  application.use(express.json());
  application.use((req, _res, next) => {
    req.portalSession = {
      id: "fixture", accountId, authVersion: 1, createdAt: Date.now(),
      lastSeenAt: Date.now(), absoluteExpiresAt: Date.now() + 60_000,
      csrfToken: csrf, reauthenticatedAt: null,
    };
    next();
  });
  application.use("/api/portal", portalCsrfProtection, createPortalResourceRouter(
    { deleteNotification: remove } as unknown as PortalResourceService,
    {
      actor: async () => { throw new Error("No subject actor is needed"); },
      account: async (req) => {
        if (!req.portalSession?.accountId) throw new PortalError("portalSessionRequired", 401);
        return req.portalSession.accountId;
      },
    },
    (_req, _res, next) => next(),
  ));
  return application;
}
beforeEach(() => { remove.mockReset().mockResolvedValue(1); });

it.each([
  ["/api/portal/notifications/12", 12],
  ["/api/portal/notifications", null],
] as const)("deletes %s using the authenticated account, ignoring a forged account id", async (path, id) => {
  const response = await request(app()).delete(`${path}?accountId=999`)
    .set("X-Portal-CSRF", csrf).send({ accountId: 999 }).expect(200);
  expect(response.body).toEqual({ success: true, deletedCount: 1 });
  expect(remove).toHaveBeenCalledExactlyOnceWith(7, id);
});

it.each(["/api/portal/notifications/12", "/api/portal/notifications"])("requires CSRF and a signed-in portal account for %s", async (path) => {
  for (const token of [null, "b".repeat(43), "invalid"]) {
    const attempt = request(app()).delete(path);
    if (token) attempt.set("X-Portal-CSRF", token);
    await attempt.expect(403);
  }
  await request(app(null)).delete(path).set("X-Portal-CSRF", csrf).expect(401);
  expect(remove).not.toHaveBeenCalled();
});

it.each(["0", "-1", "1.5", "unknown", "preferences"])("rejects an invalid notification id %s before deletion", async (id) => {
  await request(app()).delete(`/api/portal/notifications/${id}`)
    .set("X-Portal-CSRF", csrf).expect(400);
  expect(remove).not.toHaveBeenCalled();
});

it("does not disclose whether an unavailable notification exists", async () => {
  remove.mockResolvedValue(0);
  const response = await request(app()).delete("/api/portal/notifications/999")
    .set("X-Portal-CSRF", csrf).expect(200);
  expect(response.body).toEqual({ success: true, deletedCount: 0 });
});
