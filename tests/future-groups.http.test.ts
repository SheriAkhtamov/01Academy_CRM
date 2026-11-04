import express from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
import { createFutureGroupsRouter } from "../server/modules/future-groups/http/router";
import { createFutureGroupsService } from "../server/modules/future-groups/application/service";

const log = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("../server/lib/logger", () => ({ logger: log }));
vi.mock("../server/modules/leads/http/actor-context", () => ({
  actorContextFromRequest: (req: express.Request) => req.actor,
}));

const store = { list: vi.fn(), save: vi.fn(), candidates: vi.fn(), members: vi.fn(),
  changeMember: vi.fn(), archive: vi.fn() };
const input = { nameSuffix: "Sunday", courseId: 1, schoolId: 5, deliveryMode: "offline",
  maxStudents: 8, startDate: "2026-11-15", teacherId: 23, roomId: 7, lessonDurationMinutes: 120,
  schedule: [{ dayOfWeek: 7, startTime: "15:00", endTime: "17:00" }] };
const app = (sales = true) => {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    req.actor = { userId: 7, primaryModule: sales ? "sales" : "teacher",
      modules: sales ? ["sales"] : ["teacher"], isLeadership: false };
    next();
  });
  server.use("/api/academy", createFutureGroupsRouter(createFutureGroupsService(store)));
  return server;
};
beforeEach(() => {
  vi.resetAllMocks();
  store.save.mockResolvedValue({ id: 62 });
});

it("accepts the Sunday plan through the same API used by managers", async () => {
  const response = await request(app()).post("/api/academy/future-groups").send(input);
  expect(response.status).toBe(201);
  expect(response.body).toEqual({ id: 62 });
  expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ userId: 7 }), input, undefined);
});
it.each(["post", "patch"] as const)("logs unexpected %s failures without exposing internal details", async (method) => {
  const error = Object.assign(Error("academy_groups_course_lessons_array"), { code: "23514" });
  store.save.mockRejectedValue(error);
  const response = await request(app())[method]("/api/academy/future-groups" + (method === "patch" ? "/62" : ""))
    .send(input);
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ error: "futureGroupSaveFailed" });
  expect(log.error).toHaveBeenCalledWith("Future group request failed", expect.objectContaining({
    error, method: method.toUpperCase(),
  }));
  expect(log.error.mock.calls[0][1]).not.toHaveProperty("body");
});
it("preserves actionable resource errors without logging them as server faults", async () => {
  store.save.mockRejectedValue(Object.assign(Error("groupHasInactiveResources"), { statusCode: 400 }));
  const response = await request(app()).post("/api/academy/future-groups").send(input);
  expect(response.status).toBe(400);
  expect(response.body).toEqual({ error: "groupHasInactiveResources" });
  expect(log.error).not.toHaveBeenCalled();
});
it("rejects invalid times and unauthorized employees before persistence", async () => {
  const invalid = await request(app()).post("/api/academy/future-groups")
    .send({ ...input, schedule: [{ dayOfWeek: 7, startTime: "17:00", endTime: "15:00" }] });
  expect(invalid.status).toBe(400);
  expect(invalid.body).toEqual({ error: "invalidData" });
  const denied = await request(app(false)).post("/api/academy/future-groups").send(input);
  expect(denied.status).toBe(403);
  expect(store.save).not.toHaveBeenCalled();
});
