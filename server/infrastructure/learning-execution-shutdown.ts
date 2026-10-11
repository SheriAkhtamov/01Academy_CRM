import { logger } from "../lib/logger";

export function installLearningShutdownHandlers(runtime: {
  stop: () => Promise<void>;
}) {
  let stopping = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    logger.info("Learning process shutdown started", { signal });
    void runtime
      .stop()
      .then(() => process.exit(0))
      .catch((error) => {
        logger.error("Learning process shutdown failed", { signal, error });
        process.exit(1);
      });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return () => {
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
  };
}
