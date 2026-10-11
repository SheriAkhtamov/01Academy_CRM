import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config";
import { createLearningRuntime } from "./lms-runtime";
import { configureLearningDateParsing } from "./learning-pool";
import { createLearningExecutionPools } from "./learning-execution-pools";
import {
  resolveLearningWorkerOptions,
  type LearningWorkerOptions,
} from "./learning-execution";
import { logger } from "../lib/logger";

import type { LearningWorkerHealth as WorkerHealth } from "./learning-worker-health";
export { checkLearningWorkerHealth } from "./learning-worker-health";

export async function startLearningWorker(
  config: AppConfig,
  options: LearningWorkerOptions = resolveLearningWorkerOptions(),
) {
  if (options.healthCheck)
    throw new Error("Healthcheck cannot start an LMS worker");
  if (!config.portal?.enabled)
    throw new Error("LMS worker is unavailable while portal.enabled=false");
  configureLearningDateParsing();
  const database = createLearningExecutionPools(null, config, options, {
    max: options.poolMax,
    applicationName: "academy_lms_worker",
  });
  let runtime: ReturnType<typeof createLearningRuntime> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let heartbeat: Promise<void> = Promise.resolve();
  let writing = false;
  let stopping: Promise<void> | undefined;
  let stopped = false;
  const writeHealth = async (ready?: boolean) => {
    const health = runtime!.health();
    const state: WorkerHealth = {
      version: 1,
      pid: process.pid,
      roles: options.roles,
      ready: ready ?? health.ready,
      updatedAt: Date.now(),
      lastFlagRefreshAt: health.lastFlagRefreshAt,
    };
    const temporary = `${options.healthFile}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await fs.chmod(temporary, 0o600);
    await fs.rename(temporary, options.healthFile);
  };
  const stop = () =>
    (stopping ??= (async () => {
      stopped = true;
      if (timer) clearInterval(timer);
      try {
        const closing = runtime?.stop();
        const saving = (async () => {
          await heartbeat.catch(() => undefined);
          if (runtime) await writeHealth(false);
        })();
        const finished = await Promise.allSettled([closing, saving]);
        const failed = finished.find((result) => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
      } finally {
        await database.close();
        try {
          const current = JSON.parse(
            await fs.readFile(options.healthFile, "utf8"),
          ) as WorkerHealth;
          if (current.pid === process.pid) await fs.unlink(options.healthFile);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT")
            logger.warn("Could not remove LMS worker health state", { error });
        }
      }
    })());
  try {
    runtime = createLearningRuntime(database.pool, config, {
      ...options,
      runJob: database.runJob,
      strictInitialization: true,
    });
    await database.pool.query("SELECT 1");
    await runtime.start();
    await fs.mkdir(path.dirname(options.healthFile), {
      recursive: true,
      mode: 0o700,
    });
    await writeHealth();
    timer = setInterval(() => {
      if (stopped || writing) return;
      writing = true;
      heartbeat = writeHealth()
        .catch((error) => {
          logger.error("LMS worker heartbeat failed", { error });
        })
        .finally(() => {
          writing = false;
        });
    }, 15_000);
    return { stop, roles: options.roles };
  } catch (error) {
    await stop().catch((closingError) =>
      logger.error("LMS worker startup cleanup failed", {
        error: closingError,
      }),
    );
    throw error;
  }
}
