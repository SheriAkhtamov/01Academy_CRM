import { createServer, type Server } from "node:http";
import path from "node:path";
import { appConfig, trustedProxyConfig, type AppConfig } from "../config";
import { logger } from "../lib/logger";
import { errorHandler } from "../middleware/errorHandler";
import { createLearningRuntime } from "../infrastructure/lms-runtime";
import { createLearningExecutionPools } from "../infrastructure/learning-execution-pools";
import {
  resolveLearningApiOptions,
  learningApiScopeGuard,
  type LearningApiOptions,
} from "../infrastructure/learning-execution";
import { upgradeClientIp } from "../infrastructure/upgrade-client-ip";
import { createHttpApp } from "./http-app";

export async function startLearningApi({
  config = appConfig,
  options = resolveLearningApiOptions(),
}: { config?: AppConfig; options?: LearningApiOptions } = {}) {
  if (!config.portal?.enabled)
    throw new Error(
      "Standalone LMS API is unavailable while portal.enabled=false",
    );
  const { pool } = await import("../db");
  let database: ReturnType<typeof createLearningExecutionPools> | undefined;
  let runtime: ReturnType<typeof createLearningRuntime> | undefined;
  let server: Server | undefined;
  let stopping: Promise<void> | undefined;
  const stop = () =>
    (stopping ??= (async () => {
      const failures: unknown[] = [];
      const attempt = async (work: () => unknown) => {
        try {
          await work();
        } catch (error) {
          failures.push(error);
        }
      };
      await attempt(() => runtime?.closeWebSocket());
      await Promise.all([
        attempt(() =>
          server?.listening
            ? new Promise<void>((resolve, reject) =>
                server!.close((error) => (error ? reject(error) : resolve())),
              )
            : undefined,
        ),
        attempt(() => runtime?.stop()),
      ]);
      const closed = await Promise.allSettled([
        Promise.resolve().then(() => database?.close()),
        Promise.resolve().then(() => pool.end()),
      ]);
      for (const result of closed)
        if (result.status === "rejected") failures.push(result.reason);
      if (failures.length) throw failures[0];
    })());
  try {
    database = createLearningExecutionPools(pool, config, options, {
      max: options.poolMax,
      applicationName:
        options.scope === "reports"
          ? "academy_lms_reports"
          : options.scope === "files"
            ? "academy_lms_files_api"
            : "academy_lms_api",
    });
    runtime = createLearningRuntime(database.pool, config, {
      ...options,
      runJob: database.runJob,
      strictInitialization: true,
    });
    const guard = learningApiScopeGuard(options.scope, options);
    const scopedRuntime = runtime;
    const app = createHttpApp({
      beforeBodyParser: (req, res, next) =>
        guard(req, res, (error) =>
          error ? next(error) : scopedRuntime.beforeBodyParser(req, res, next),
        ),
    });
    app.set("env", config.server.environment);
    app.set("trust proxy", trustedProxyConfig);
    app.get("/health/live", (_req, res) => res.json({ ok: true }));
    app.get("/health/ready", (_req, res) => {
      const health = scopedRuntime.health();
      const ready =
        health.ready &&
        health.lastFlagRefreshAt !== null &&
        Date.now() - health.lastFlagRefreshAt <= 45_000;
      res.status(ready ? 200 : 503).json({ ok: ready });
    });
    const { createSessionMiddleware } =
      await import("../infrastructure/session");
    const staffSession = createSessionMiddleware();
    app.use((req, res, next) =>
      /^\/api\/lms-management(?:\/|$)/.test(req.path) ||
      /^\/api\/academy\/students\/[1-9]\d*\/portal-access(?:\/|$)/.test(
        req.path,
      )
        ? staffSession(req, res, next)
        : next(),
    );
    runtime.registerRoutes(app);
    app.all("/api/*", (_req, res) =>
      res.status(404).json({ code: "portalNotFound" }),
    );
    if (options.scope === "all") {
      const { serveStatic } = await import("../vite");
      serveStatic(app, path.resolve("dist/public"));
    }
    app.use(errorHandler);
    await database.pool.query("SELECT 1");
    await runtime.start();
    server = createServer(app);
    server.requestTimeout = 10 * 60_000;
    server.headersTimeout = 15_000;
    server.keepAliveTimeout = 5_000;
    server.maxHeadersCount = 100;
    if (options.scope === "all")
      runtime.attachWebSocket(server, (req) => upgradeClientIp(req, app));
    await new Promise<void>((resolve, reject) => {
      const current = server!;
      const fail = (error: Error) => {
        current.removeListener("listening", ready);
        reject(error);
      };
      const ready = () => {
        current.removeListener("error", fail);
        resolve();
      };
      current.once("error", fail);
      current.once("listening", ready);
      current.listen({ port: config.server.port, host: config.server.host });
    });
    logger.info("Standalone LMS API started", { scope: options.scope });
    return { server, stop };
  } catch (error) {
    await stop().catch((closingError) =>
      logger.error("Standalone LMS API startup cleanup failed", {
        error: closingError,
      }),
    );
    throw error;
  }
}
