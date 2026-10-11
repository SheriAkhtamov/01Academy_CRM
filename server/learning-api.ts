import { startLearningApi } from "./app/learning-bootstrap";
import { installLearningShutdownHandlers } from "./infrastructure/learning-execution-shutdown";
import { logger } from "./lib/logger";

void startLearningApi()
  .then(installLearningShutdownHandlers)
  .catch((error) => {
    logger.error("Standalone LMS API startup failed", { error });
    process.exit(1);
  });
