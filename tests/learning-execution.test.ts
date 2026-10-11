import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  LEARNING_PROCESS_ROLES,
  resolveLearningExecution,
  resolveLearningApiOptions,
  resolveLearningWorkerOptions,
  learningApiScopeGuard,
  minimumLearningPoolSize,
} from "../server/infrastructure/learning-execution";

describe("explicit learning process contracts", () => {
  it("keeps the full CRM embedded default and isolates the independent API default", () => {
    expect(resolveLearningExecution({ environment: {} })).toEqual({
      mode: "api",
      roles: LEARNING_PROCESS_ROLES,
      fileWrites: "local",
    });
    expect(resolveLearningApiOptions({ args: [], environment: {} })).toEqual({
      mode: "api",
      roles: ["api"],
      fileWrites: "local",
      scope: "all",
      poolMax: 10,
    });
    expect(
      resolveLearningExecution({ environment: { LMS_PROCESS_ROLES: "api" } })
        .roles,
    ).toEqual(["api"]);
  });
  it.each(["", "api,", "api,api", "api,unknown", "lifecycle", "API", "*"])(
    "rejects invalid HTTP role declaration %s before initialization",
    (roles) => {
      expect(() =>
        resolveLearningExecution({ environment: { LMS_PROCESS_ROLES: roles } }),
      ).toThrow();
    },
  );
  it("requires explicit workers and reserves one business connection for nested live checks", () => {
    expect(() =>
      resolveLearningWorkerOptions({ args: [], environment: {} }),
    ).toThrow();
    expect(
      resolveLearningWorkerOptions({
        args: ["--roles=files"],
        environment: {},
      }),
    ).toMatchObject({ roles: ["files"], poolMax: 2, healthCheck: false });
    expect(
      resolveLearningWorkerOptions({ args: ["--roles=email"], environment: {} })
        .poolMax,
    ).toBe(3);
    expect(
      resolveLearningWorkerOptions({
        args: ["--roles=notifications,email"],
        environment: {},
      }).poolMax,
    ).toBe(4);
    expect(minimumLearningPoolSize(LEARNING_PROCESS_ROLES)).toBe(7);
    expect(() =>
      resolveLearningWorkerOptions({
        args: ["--roles=email", "--pool-max=2"],
        environment: {},
      }),
    ).toThrow();
  });
  it.each(
    [
      ["--roles=api"],
      ["--roles=files,files"],
      ["--roles=files,"],
      ["--roles=unknown"],
      ["--roles=files", "--roles=email"],
      ["--roles=files", "--pool-max=0"],
      ["--roles=files", "--pool-max=11"],
      ["--roles=files", "--pool-max=2.5"],
      ["--roles=files", "--health-file=relative.json"],
      ["--roles=files", "--other=1"],
    ].map((args) => ({ args })),
  )("rejects malformed worker CLI %j", ({ args }) => {
    expect(() =>
      resolveLearningWorkerOptions({ args, environment: {} }),
    ).toThrow();
  });
  it("lets healthcheck inspect an existing worker without selecting jobs or touching a database", () => {
    expect(
      resolveLearningWorkerOptions({
        args: ["--healthcheck"],
        environment: {},
      }),
    ).toMatchObject({
      roles: [],
      healthCheck: true,
      healthFile: "/tmp/academy-lms-worker-health.json",
    });
  });
  it("validates reports/files isolation and explicit file writer ownership", () => {
    expect(
      resolveLearningApiOptions({
        args: ["--scope=reports", "--pool-max=2"],
        environment: {},
      }),
    ).toMatchObject({ roles: ["api"], scope: "reports", poolMax: 2 });
    expect(
      resolveLearningApiOptions({ args: ["--scope=files"], environment: {} })
        .scope,
    ).toBe("files");
    expect(() =>
      resolveLearningApiOptions({
        args: ["--scope=files"],
        environment: { LMS_FILE_WRITES: "external" },
      }),
    ).toThrow();
    expect(() =>
      resolveLearningApiOptions({
        args: ["--scope=reports", "--roles=api,email"],
        environment: {},
      }),
    ).toThrow();
    expect(() =>
      resolveLearningApiOptions({ args: ["--scope=unknown"], environment: {} }),
    ).toThrow();
    expect(() =>
      resolveLearningApiOptions({
        args: ["--scope=reports", "--scope=all"],
        environment: {},
      }),
    ).toThrow();
    expect(() =>
      resolveLearningExecution({ environment: { LMS_FILE_WRITES: "invalid" } }),
    ).toThrow();
  });
  it.each(["all", "reports", "files"])(
    "refuses a single business connection in %s API scope before startup",
    (scope) => {
      expect(() =>
        resolveLearningApiOptions({
          args: [`--scope=${scope}`, "--pool-max=1"],
          environment: {},
        }),
      ).toThrow("at least 2 business connections");
      expect(
        resolveLearningApiOptions({
          args: [`--scope=${scope}`, "--pool-max=2"],
          environment: {},
        }).poolMax,
      ).toBe(2);
    },
  );
});

describe("learning HTTP scope gates before body/auth work", () => {
  const scoped = (
    scope: "all" | "reports" | "files",
    fileWrites: "local" | "external" = "local",
  ) => {
    const work = vi.fn();
    const app = express();
    app.use(learningApiScopeGuard(scope, { fileWrites }));
    app.use(express.json());
    app.use((_req, res) => {
      work();
      res.json({ ok: true });
    });
    return { app, work };
  };
  it("allows only existing report endpoints and health while rejecting other bodies before parsing", async () => {
    const { app, work } = scoped("reports");
    for (const path of [
      "/api/lms-management/analytics",
      "/api/lms-management/results?runId=1",
      "/api/lms-management/reports?runId=1",
      "/health/live",
      "/health/ready",
    ])
      await request(app).get(path).expect(200);
    await request(app)
      .post("/api/lms-management/reports")
      .send({ runId: 1 })
      .expect(200);
    expect(work).toHaveBeenCalledTimes(6);
    for (const path of [
      "/api/portal/auth/session",
      "/api/lms-management/materials",
      "/api/lms-management/reports-extra",
      "/learn",
      "/api/legacy/session",
    ])
      await request(app).post(path).type("json").send("{").expect(404);
    expect(work).toHaveBeenCalledTimes(6);
  });
  it("allows only the singleton physical writer endpoints in files scope", async () => {
    const { app, work } = scoped("files");
    for (const path of [
      "/api/portal/files",
      "/api/lms-management/files",
      "/api/lms-management/assignments",
    ])
      await request(app).post(path).send({}).expect(200);
    await request(app).get("/health/ready").expect(200);
    await request(app)
      .put("/api/lms-management/assignments/1")
      .type("json")
      .send("{")
      .expect(404);
    await request(app).get("/api/portal/auth/session").expect(404);
    expect(work).toHaveBeenCalledTimes(4);
  });
  it("fails closed before parsing physical writes on horizontally replicated APIs", async () => {
    const { app, work } = scoped("all", "external");
    for (const path of [
      "/api/portal/files",
      "/api/lms-management/files/",
      "/api/lms-management/assignments",
    ])
      await request(app).post(path).type("json").send("{").expect(503);
    expect(work).not.toHaveBeenCalled();
    await request(app)
      .put("/api/portal/subjects/1/assignments/1/draft")
      .send({})
      .expect(200);
    await request(app).get("/api/portal/files/1").expect(200);
    await request(app)
      .post("/api/academy/students/1/portal-access")
      .send({})
      .expect(200);
    expect(work).toHaveBeenCalledTimes(3);
  });
});
