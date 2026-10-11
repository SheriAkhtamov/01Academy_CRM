import type { Pool } from "pg";
import type { AppConfig } from "../config";
import {
  minimumLearningPoolSize,
  type LearningExecution,
} from "./learning-execution";
import { createLearningPool } from "./learning-pool";
import { createLearningJobRunner } from "./learning-job-runner";

export function createLearningExecutionPools(
  staffPool: Pool | null,
  config: AppConfig,
  execution: LearningExecution,
  options: { max?: number; applicationName?: string } = {},
) {
  if (
    config.portal?.enabled &&
    Math.min(options.max ?? 10, config.database.pool?.max ?? 10) <
      minimumLearningPoolSize(execution.roles)
  )
    throw new Error(
      `LMS process roles require at least ${minimumLearningPoolSize(execution.roles)} business connections`,
    );
  const business = createLearningPool(staffPool, config, options);
  const singleton =
    config.portal?.enabled &&
    execution.roles.some(
      (role) => role === "lifecycle" || role === "maintenance",
    );
  let lease: ReturnType<typeof createLearningPool> | undefined;
  try {
    if (singleton)
      lease = createLearningPool(staffPool, config, {
        max: 1,
        applicationName: "academy_lms_leases",
      });
  } catch (error) {
    void business.close().catch(() => undefined);
    throw error;
  }
  let closing: Promise<void> | undefined;
  return {
    pool: business.pool,
    runJob: createLearningJobRunner(lease?.pool ?? business.pool),
    close: () =>
      (closing ??= (async () => {
        const closed = await Promise.allSettled([
          business.close(),
          lease?.close(),
        ]);
        const failed = closed.find((result) => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
      })()),
  };
}
