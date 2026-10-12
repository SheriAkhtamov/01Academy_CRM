import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../server/config";
import { resolveLearningWorkerOptions } from "../server/infrastructure/learning-execution";
import { checkLearningWorkerHealth } from "../server/infrastructure/learning-worker-health";
const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  close: vi.fn(),
  createPools: vi.fn(),
  createRuntime: vi.fn(),
  dates: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  health: vi.fn(),
  logger: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock("../server/lib/logger", () => ({ logger: mocks.logger }));
vi.mock("../server/infrastructure/learning-pool", () => ({
  configureLearningDateParsing: mocks.dates,
}));
vi.mock("../server/infrastructure/learning-execution-pools", () => ({
  createLearningExecutionPools: mocks.createPools,
}));
vi.mock("../server/infrastructure/lms-runtime", () => ({
  createLearningRuntime: mocks.createRuntime,
}));
import { startLearningWorker } from "../server/infrastructure/learning-worker-bootstrap";
let directory: string;
let worker: Awaited<ReturnType<typeof startLearningWorker>> | undefined;
const config = (enabled = true) =>
  ({
    portal: { enabled },
    database: { url: "postgresql://fixture.invalid/unused" },
  }) as AppConfig;
const options = () =>
  resolveLearningWorkerOptions({
    args: [
      "--roles=files",
      `--health-file=${path.join(directory, "health.json")}`,
    ],
    environment: {},
  });
beforeEach(async () => {
  vi.clearAllMocks();
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "learning-worker-"));
  mocks.poolQuery.mockResolvedValue({ rows: [] });
  mocks.close.mockResolvedValue(undefined);
  mocks.createPools.mockReturnValue({
    pool: { query: mocks.poolQuery },
    close: mocks.close,
    runJob: vi.fn(),
  });
  mocks.start.mockResolvedValue(undefined);
  mocks.stop.mockResolvedValue(undefined);
  mocks.health.mockImplementation(() => ({
    ready: true,
    roles: ["files"],
    lastFlagRefreshAt: Date.now(),
  }));
  mocks.createRuntime.mockReturnValue({
    start: mocks.start,
    stop: mocks.stop,
    health: mocks.health,
  });
});
afterEach(async () => {
  await worker?.stop().catch(() => undefined);
  worker = undefined;
  vi.useRealTimers();
  await fs.rm(directory, { recursive: true, force: true });
});
describe("worker startup, private heartbeat and graceful ownership", () => {
  it("refuses disabled startup before any new pool, health directory or timer", async () => {
    const mkdir = vi.spyOn(fs, "mkdir");
    await expect(startLearningWorker(config(false), options())).rejects.toThrow(
      "unavailable",
    );
    expect(mocks.createPools).not.toHaveBeenCalled();
    expect(mocks.dates).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
    mkdir.mockRestore();
  });
  it("creates a private heartbeat only after strict startup and closes its owned runtime/pools once", async () => {
    worker = await startLearningWorker(config(), options());
    expect(mocks.createPools).toHaveBeenCalledWith(
      null,
      config(),
      expect.objectContaining({ roles: ["files"] }),
      { max: 2, applicationName: "academy_lms_worker" },
    );
    const state = JSON.parse(await fs.readFile(options().healthFile, "utf8"));
    expect(state).toMatchObject({
      pid: process.pid,
      roles: ["files"],
      ready: true,
    });
    expect((await fs.stat(options().healthFile)).mode & 0o777).toBe(0o600);
    await checkLearningWorkerHealth(options());
    await Promise.all([worker.stop(), worker.stop()]);
    expect(mocks.stop).toHaveBeenCalledTimes(1);
    expect(mocks.close).toHaveBeenCalledTimes(1);
    await expect(fs.stat(options().healthFile)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("waits for actual outstanding jobs before closing the pool and withdraws readiness immediately", async () => {
    vi.useFakeTimers();
    worker = await startLearningWorker(config(), options());
    let finish!: () => void;
    mocks.stop.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const stopping = worker.stop();
    await vi.waitFor(async () =>
      expect(
        JSON.parse(await fs.readFile(options().healthFile, "utf8")).ready,
      ).toBe(false),
    );
    expect(mocks.close).not.toHaveBeenCalled();
    const writes = mocks.health.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.health).toHaveBeenCalledTimes(writes);
    await expect(checkLearningWorkerHealth(options())).rejects.toThrow();
    finish();
    await stopping;
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
  it("closes pools on schema/connection initialization failure", async () => {
    mocks.start.mockRejectedValueOnce(new Error("missing schema"));
    await expect(startLearningWorker(config(), options())).rejects.toThrow(
      "missing schema",
    );
    expect(mocks.stop).toHaveBeenCalledTimes(1);
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
  it("rejects stale, stopped or role-mismatched heartbeat records without database probes", async () => {
    worker = await startLearningWorker(config(), options());
    const state = JSON.parse(await fs.readFile(options().healthFile, "utf8"));
    await fs.writeFile(
      options().healthFile,
      JSON.stringify({ ...state, lastFlagRefreshAt: Date.now() - 46_000 }),
    );
    await expect(checkLearningWorkerHealth(options())).rejects.toThrow();
    await fs.writeFile(
      options().healthFile,
      JSON.stringify({ ...state, ready: false }),
    );
    await expect(checkLearningWorkerHealth(options())).rejects.toThrow();
    await fs.writeFile(options().healthFile, JSON.stringify(state));
    await expect(
      checkLearningWorkerHealth({ ...options(), roles: ["credentials"] }),
    ).rejects.toThrow();
    expect(mocks.poolQuery).toHaveBeenCalledTimes(1);
  });
});
