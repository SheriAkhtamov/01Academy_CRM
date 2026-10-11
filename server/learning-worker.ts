import { appConfig } from "./config";
import { resolveLearningWorkerOptions } from "./infrastructure/learning-execution";

async function main() {
  const options = resolveLearningWorkerOptions();
  if (options.healthCheck) {
    const { checkLearningWorkerHealth } =
      await import("./infrastructure/learning-worker-health");
    await checkLearningWorkerHealth(options);
    return;
  }
  if (!appConfig.portal?.enabled)
    throw new Error("LMS worker is unavailable while portal.enabled=false");
  const [
    { startLearningWorker },
    { installLearningShutdownHandlers },
    { logger },
  ] = await Promise.all([
    import("./infrastructure/learning-worker-bootstrap"),
    import("./infrastructure/learning-execution-shutdown"),
    import("./lib/logger"),
  ]);
  const runtime = await startLearningWorker(appConfig, options);
  installLearningShutdownHandlers(runtime);
  logger.info("LMS worker started", { roles: runtime.roles });
}
void main().catch((error) => {
  console.error(
    "LMS worker startup failed:",
    error instanceof Error ? error.message : "Unknown startup error",
  );
  process.exit(1);
});
