import fs from "node:fs/promises";
import type { LearningWorkerOptions } from "./learning-execution";

export type LearningWorkerHealth = {
  version: 1;
  pid: number;
  roles: readonly string[];
  ready: boolean;
  updatedAt: number;
  lastFlagRefreshAt: number | null;
};
export async function checkLearningWorkerHealth(
  options: Pick<LearningWorkerOptions, "healthFile" | "roles">,
) {
  const state = JSON.parse(
    await fs.readFile(options.healthFile, "utf8"),
  ) as LearningWorkerHealth;
  const now = Date.now(),
    maxAge = 45_000;
  if (
    state.version !== 1 ||
    !Number.isSafeInteger(state.pid) ||
    state.pid < 1 ||
    state.ready !== true ||
    !Number.isFinite(state.updatedAt) ||
    state.updatedAt > now + 5_000 ||
    now - state.updatedAt > maxAge ||
    typeof state.lastFlagRefreshAt !== "number" ||
    !Number.isFinite(state.lastFlagRefreshAt) ||
    state.lastFlagRefreshAt > now + 5_000 ||
    now - state.lastFlagRefreshAt > maxAge ||
    !Array.isArray(state.roles) ||
    !state.roles.length ||
    options.roles.some((role) => !state.roles.includes(role))
  )
    throw new Error("LMS worker is not ready");
  process.kill(state.pid, 0);
}
