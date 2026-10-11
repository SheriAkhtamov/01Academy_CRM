import { resolveLearningWorkerOptions } from "./infrastructure/learning-execution";
import { checkLearningWorkerHealth } from "./infrastructure/learning-worker-health";

try {
  await checkLearningWorkerHealth(
    resolveLearningWorkerOptions({
      args: ["--healthcheck", ...process.argv.slice(2)],
    }),
  );
} catch {
  process.exitCode = 1;
}
