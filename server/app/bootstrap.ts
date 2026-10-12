import { publishReleaseUpdates } from '../infrastructure/platform-updates';
import { createServer, type Server } from "node:http";
import { pool } from "../db";
import {
  appConfig,
  isDevelopmentEnvironment,
  trustedProxyConfig,
} from "../config";
import { logger } from "../lib/logger";
import { errorHandler } from "../middleware/errorHandler";
import { registerApiRoutes } from "../routes";
import { serveStatic, setupVite, log } from "../vite";
import { startScheduler, stopScheduler } from "../services/scheduler";
import { assertDatabaseConnection } from "../infrastructure/database-health";
import { createSessionMiddleware } from "../infrastructure/session";
import { attachWebSocketGateway } from "../realtime/websocket-gateway";
import { createHttpApp } from "./http-app";
import { registerTelegramTaskRoutes } from "../routes/telegram-tasks.routes";
import { loadIntegrationSettings } from "../services/integration-settings";
import { createLearningRuntime } from "../infrastructure/lms-runtime";
import { upgradeClientIp } from "../infrastructure/upgrade-client-ip";
import { createLearningExecutionPools } from "../infrastructure/learning-execution-pools";
import { resolveLearningExecution } from "../infrastructure/learning-execution";
import { configureStudentProfileLearningPortfolioAvailability } from "../modules/academy/student-profile-data";

export type ApplicationRuntime = {
  server: Server;
  stop: () => Promise<void>;
};

export const startApplication = async (): Promise<ApplicationRuntime> => {
  const execution = resolveLearningExecution();
  log("Checking database connection...");
  await assertDatabaseConnection();
  await loadIntegrationSettings();
  log("Database connection successful");

  let databaseForCleanup:
    | ReturnType<typeof createLearningExecutionPools>
    | undefined;
  let runtimeForCleanup: ReturnType<typeof createLearningRuntime> | undefined;
  let server: Server | undefined;
  let closeStaffWebSocket: (() => Promise<void>) | undefined;
  let schedulerStarted = false;
  try {
    const learningDatabase = createLearningExecutionPools(
      pool,
      appConfig,
      execution,
    );
    databaseForCleanup = learningDatabase;
    const learningRuntime = createLearningRuntime(
      learningDatabase.pool,
      appConfig,
      {
        ...execution,
        runJob: learningDatabase.runJob,
        configureLegacyPortfolioAvailability:
          configureStudentProfileLearningPortfolioAvailability,
      },
    );
    runtimeForCleanup = learningRuntime;
    const app = createHttpApp({
      beforeBodyParser: learningRuntime.beforeBodyParser,
    });
    app.set("env", appConfig.server.environment);
    app.set("trust proxy", trustedProxyConfig);

    registerTelegramTaskRoutes(app);
    const sessionMiddleware = createSessionMiddleware();
    app.use((request, response, next) =>
      ["/api/portal", "/api/public/portfolio", "/learn", "/portfolio/p"].some(
        (prefix) =>
          request.path === prefix || request.path.startsWith(`${prefix}/`),
      )
        ? next()
        : sessionMiddleware(request, response, next),
    );
    learningRuntime.registerRoutes(app);
    registerApiRoutes(app);

    server = createServer(app);
    // 10 MB task uploads need time on mobile connections. Header timeout,
    // multipart size limits and per-user upload rate limits still apply.
    server.requestTimeout = 10 * 60_000;
    server.headersTimeout = 15_000;
    server.keepAliveTimeout = 5_000;
    server.maxHeadersCount = 100;
    const websocketGateway = await attachWebSocketGateway(
      server,
      sessionMiddleware,
    );
    closeStaffWebSocket = () => websocketGateway.close();
    learningRuntime.attachWebSocket?.(server, (request) =>
      upgradeClientIp(request, app),
    );

    app.all("/api/*", (_req, res) => {
      res.status(404).json({ error: "API endpoint not found" });
    });

    if (isDevelopmentEnvironment) {
      await setupVite(app, server);
    } else {
      serveStatic(app);
    }
    app.use(errorHandler);

    await publishReleaseUpdates();
    await learningRuntime.start();
    startScheduler();
    schedulerStarted = true;

    await new Promise<void>((resolve, reject) => {
      const current = server!;
      const handleError = (error: Error) => {
        current.off("listening", handleListening);
        reject(error);
      };
      const handleListening = () => {
        current.off("error", handleError);
        resolve();
      };
      current.once("error", handleError);
      current.once("listening", handleListening);
      current.listen({
        port: appConfig.server.port,
        host: appConfig.server.host,
      });
    });

    log(
      `Server running on http://${appConfig.server.host}:${appConfig.server.port}`,
    );

    let stopping: Promise<void> | undefined;
    const stop = async () => {
      if (stopping) return stopping;
      stopping = (async () => {
        const failures: unknown[] = [];
        const attempt = async (work: () => unknown) => {
          try {
            await work();
          } catch (error) {
            failures.push(error);
          }
        };
        await attempt(() =>
          Promise.allSettled([
            websocketGateway.close(),
            learningRuntime.closeWebSocket?.(),
          ]).then((results) => {
            for (const result of results)
              if (result.status === "rejected") failures.push(result.reason);
          }),
        );
        await Promise.all([
          attempt(
            () =>
              new Promise<void>((resolve, reject) => {
                server!.close((error) => {
                  if (error) reject(error);
                  else resolve();
                });
              }),
          ),
          attempt(() => (schedulerStarted ? stopScheduler() : undefined)),
          attempt(() => learningRuntime.stop()),
        ]);
        const closed = await Promise.allSettled([
          Promise.resolve().then(() => learningDatabase.close()),
          Promise.resolve().then(() => pool.end()),
        ]);
        for (const result of closed)
          if (result.status === "rejected") failures.push(result.reason);
        if (failures.length) throw failures[0];
      })();
      return stopping;
    };

    return { server, stop };
  } catch (error) {
    await Promise.allSettled([
      closeStaffWebSocket?.(),
      runtimeForCleanup?.closeWebSocket?.(),
      runtimeForCleanup?.stop(),
    ]);
    if (server?.listening)
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (schedulerStarted) await stopScheduler().catch(() => undefined);
    await Promise.allSettled([databaseForCleanup?.close(), pool.end()]);
    throw error;
  }
};

export const installShutdownHandlers = (runtime: ApplicationRuntime) => {
  const shutdown = (signal: NodeJS.Signals) => {
    logger.info("Graceful shutdown started", { signal });
    void runtime
      .stop()
      .then(() => {
        logger.info("Graceful shutdown completed", { signal });
        process.exit(0);
      })
      .catch((error) => {
        logger.error("Graceful shutdown failed", { signal, error });
        process.exit(1);
      });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
};
