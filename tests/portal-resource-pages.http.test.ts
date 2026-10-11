import express from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
import {
  createPortalResourceRouter,
  createStaffResourceRouter,
} from "../server/modules/portal-resources/http/router";
import type { PortalResourceService } from "../server/modules/portal-resources/application/resource-service";
import type { PortalActorContext } from "../server/modules/portal-identity/domain/actor-context";
const actor: PortalActorContext = {
  portalAccountId: 1,
  studentId: 2,
  linkId: 3,
  kind: "self",
  studentClassification: "adult",
  sessionId: "fixture",
  permissions: ["learning.read", "finance.read"],
};
const methods = [
  "projectsPage",
  "payments",
  "financeQuestionsPage",
  "notifications",
  "staffFinanceQuestionsPage",
  "unallocatedPayments",
] as const;
const mocks = Object.fromEntries(
  methods.map((method) => [method, vi.fn()]),
) as Record<(typeof methods)[number], ReturnType<typeof vi.fn>>;
const routes = [
  ["/api/portal/subjects/3/projects", "projectsPage"],
  ["/api/portal/subjects/3/payments", "payments"],
  ["/api/portal/subjects/3/finance-questions", "financeQuestionsPage"],
  ["/api/portal/notifications", "notifications"],
  ["/api/lms-management/finance-questions", "staffFinanceQuestionsPage"],
  ["/api/lms-management/payments/needs-review", "unallocatedPayments"],
] as const;
function app() {
  const application = express();
  const service = mocks as unknown as PortalResourceService;
  application.use(
    "/api/portal",
    createPortalResourceRouter(
      service,
      { actor: async () => actor, account: async () => actor.portalAccountId },
      (_request, _response, next) => next(),
    ),
  );
  application.use(
    "/api/lms-management",
    createStaffResourceRouter(
      service,
      async () => ({ userId: 1, modules: ["finance"], isLeadership: false }),
      (_request, _response, next) => next(),
    ),
  );
  return application;
}
beforeEach(() => {
  vi.clearAllMocks();
  for (const method of methods)
    mocks[method].mockResolvedValue({ items: [{ id: 9 }], nextCursor: 9 });
});
it.each(routes)(
  "returns items/nextCursor/hasMore with default30 for %s",
  async (path, method) => {
    const response = await request(app()).get(path).expect(200);
    expect(response.body).toEqual({
      items: [{ id: 9 }],
      nextCursor: 9,
      hasMore: true,
    });
    expect(response.headers["x-next-cursor"]).toBeUndefined();
    expect(mocks[method]).toHaveBeenCalledWith(expect.anything(), null, 30);
  },
);
it.each(routes)(
  "accepts limit1/100 and forwards the cursor for %s",
  async (path, method) => {
    for (const limit of [1, 100]) {
      await request(app()).get(`${path}?cursor=9&limit=${limit}`).expect(200);
      expect(mocks[method]).toHaveBeenLastCalledWith(
        expect.anything(),
        9,
        limit,
      );
    }
  },
);
it.each(routes)(
  "rejects invalid limits and cursors before reading %s",
  async (path, method) => {
    for (const query of [
      "limit=0",
      "limit=101",
      "limit=1.5",
      "cursor=0",
      "cursor=bad",
    ])
      await request(app()).get(`${path}?${query}`).expect(400);
    expect(mocks[method]).not.toHaveBeenCalled();
  },
);
it("keeps financial totals/state and notification unread counts with final-page metadata", async () => {
  const payments = {
    items: [{ id: 9 }],
    nextCursor: null,
    state: "needs_review",
    summary: null,
  };
  mocks.payments.mockResolvedValue(payments);
  const finance = await request(app())
    .get("/api/portal/subjects/3/payments")
    .expect(200);
  expect(finance.body).toEqual({ ...payments, hasMore: false });
  mocks.notifications.mockResolvedValue({
    items: [],
    nextCursor: null,
    unreadCount: 7,
  });
  const notifications = await request(app())
    .get("/api/portal/notifications")
    .expect(200);
  expect(notifications.body).toEqual({
    items: [],
    nextCursor: null,
    hasMore: false,
    unreadCount: 7,
  });
});
