import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createLmsPortalRouter } from "../server/modules/lms/http/portal.router";
import { createLmsManagementRouter } from "../server/modules/lms/http/management.router";
import { LmsService } from "../server/modules/lms/application/lms-service";
import type { LmsPorts } from "../server/modules/lms/application/ports";
import type { PortalActorContext } from "../server/modules/portal-identity/domain/actor-context";
import { LmsError } from "../server/modules/lms/domain/policy";
const actor: PortalActorContext = {
  portalAccountId: 5,
  sessionId: "session",
  linkId: 8,
  studentId: 9,
  kind: "self",
  studentClassification: "adult",
  permissions: [
    "learning.read",
    "feedback.read",
    "attendance.read",
    "assignments.submit",
    "quizzes.attempt",
    "communication.create",
  ],
};
const create = (actorOverride = actor, enabled = true) => {
  const unavailable = vi.fn(async () => {
    throw new LmsError("lmsNotFound", 404);
  });
  const ports = {
    learning: {
      course: unavailable,
      unit: unavailable,
      readMaterial: unavailable,
      schedule: vi.fn(async () => []),
      progress: vi.fn(),
      materials: vi.fn(async () => []),
    },
    assignments: {
      detail: unavailable,
      feedbackItem: unavailable,
      submit: unavailable,
      saveDraft: unavailable,
      withdraw: unavailable,
    },
    quizzes: {
      start: unavailable,
      get: unavailable,
      answer: unavailable,
      finish: unavailable,
    },
    engagement: {
      threadDetail: unavailable,
      addComment: unavailable,
      readAnnouncement: unavailable,
      beginMakeup: unavailable,
    },
  } as unknown as LmsPorts;
  const resolver = vi.fn(async (_request: unknown, linkId: number) => {
    if (linkId !== actorOverride.linkId) throw new LmsError("lmsNotFound", 404);
    return actorOverride;
  });
  const app = express();
  app.use(express.json());
  app.use(
    "/api/portal/subjects",
    createLmsPortalRouter(new LmsService(ports), resolver, () => enabled),
  );
  return { app, resolver, ports, unavailable };
};
describe("LMS HTTP policy boundaries", () => {
  it("default-off router does not access identity or new tables", async () => {
    const resolver = vi.fn();
    const app = express();
    app.use(createLmsPortalRouter({} as LmsService, resolver));
    const result = await request(app).get("/8/courses");
    expect(result.status).toBe(404);
    expect(resolver).not.toHaveBeenCalled();
  });
  it.each([
    "courses/123",
    "lessons/123",
    "assignments/123",
    "attempts/123",
    "threads/123",
  ])("rejects forged link before reading %s", async (path) => {
    const { app, unavailable } = create();
    const result = await request(app).get(`/api/portal/subjects/999/${path}`);
    expect(result.status).toBe(404);
    expect(unavailable).not.toHaveBeenCalled();
  });
  it.each([
    "courses/123",
    "lessons/123",
    "assignments/123",
    "attempts/123",
    "threads/123",
  ])("propagates concealed foreign object error for %s", async (path) => {
    const { app } = create();
    const result = await request(app).get(`/api/portal/subjects/8/${path}`);
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ code: "lmsNotFound" });
  });
  it("blocks representatives from answer submission before repository work", async () => {
    const { app, unavailable } = create({ ...actor, kind: "representative" });
    const result = await request(app)
      .post("/api/portal/subjects/8/assignments/1/submissions")
      .send({
        text: "Own answer",
        assignmentVersionId: 1,
        draftVersion: 0,
        idempotencyKey: "retry-key-123",
      });
    expect(result.status).toBe(403);
    expect(unavailable).not.toHaveBeenCalled();
  });
  it("strips reviews and comments when feedback permission was revoked", async () => {
    const { app, ports } = create({
      ...actor,
      kind: "representative",
      permissions: ["learning.read"],
    });
    vi.mocked(ports.assignments.detail).mockResolvedValue({
      comments: [{ body: "Private feedback" }],
      submissions: [{ id: 1, review: { comment: "Review" } }],
    } as never);
    const result = await request(app).get(
      "/api/portal/subjects/8/assignments/1",
    );
    expect(result.status).toBe(200);
    expect(result.body.comments).toEqual([]);
    expect(result.body.submissions[0].review).toBe(null);
  });
  it("checks the schedule range and draft versions at the HTTP boundary", async () => {
    const { app, ports } = create();
    const range = await request(app).get(
      "/api/portal/subjects/8/schedule?from=2026-01-01T00:00:00Z&to=2026-12-01T00:00:00Z",
    );
    expect(range.status).toBe(400);
    expect(ports.learning.schedule).not.toHaveBeenCalled();
    const draft = await request(app)
      .put("/api/portal/subjects/8/assignments/1/draft")
      .send({ version: -1, text: "Answer" });
    expect(draft.status).toBe(400);
    expect(ports.assignments.saveDraft).not.toHaveBeenCalled();
  });
  it("reports version conflicts as 409 without disclosing implementation errors", async () => {
    const { app, ports } = create();
    vi.mocked(ports.assignments.saveDraft).mockRejectedValue(
      new LmsError("lmsVersionConflict", 409),
    );
    const result = await request(app)
      .put("/api/portal/subjects/8/assignments/1/draft")
      .send({ version: 1, text: "Answer" });
    expect(result.status).toBe(409);
    expect(result.body).toEqual({ code: "lmsVersionConflict" });
  });
  it("staff router is disabled by default too", async () => {
    const resolver = vi.fn();
    const app = express();
    app.use(createLmsManagementRouter({} as LmsService, resolver));
    const result = await request(app).get("/runs");
    expect(result.status).toBe(404);
    expect(resolver).not.toHaveBeenCalled();
  });
  it("uses the current employee actor and private caching for teacher homepage summary", async () => {
    const teacherSummary = vi.fn(async () => ({
      pendingReviews: 1,
      openHelp: 0,
      unpreparedLessons: 0,
      runs: [],
    }));
    const staff = { userId: 2, modules: ["teacher"], isLeadership: false };
    const app = express();
    app.use(
      createLmsManagementRouter(
        new LmsService({ learning: { teacherSummary } } as unknown as LmsPorts),
        async () => staff,
        () => true,
      ),
    );
    const response = await request(app).get("/summary?studentId=999");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(teacherSummary).toHaveBeenCalledWith(staff);
    expect(response.body.pendingReviews).toBe(1);
  });
  it("allows learning analytics only for administration and validates its period before repository work", async () => {
    const analytics = vi.fn(async () => ({
      periodFrom: "2026-10-01T00:00:00Z",
      periodTo: "2026-10-08T00:00:00Z",
    }));
    const ports = { learning: { analytics } } as unknown as LmsPorts;
    let staff = { userId: 1, modules: ["teacher"], isLeadership: false };
    const app = express();
    app.use(
      createLmsManagementRouter(
        new LmsService(ports),
        async () => staff,
        () => true,
      ),
    );
    expect((await request(app).get("/analytics?days=7")).status).toBe(403);
    expect(analytics).not.toHaveBeenCalled();
    staff = { userId: 1, modules: ["administration"], isLeadership: true };
    expect((await request(app).get("/analytics?days=14")).status).toBe(400);
    expect(analytics).not.toHaveBeenCalled();
    const response = await request(app).get("/analytics?days=30&runId=12");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(analytics).toHaveBeenCalledWith(staff, { days: 30, runId: 12 });
  });
});
