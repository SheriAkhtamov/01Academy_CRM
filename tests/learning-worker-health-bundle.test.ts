import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { isBuiltin } from "node:module";
import os from "node:os";
import path from "node:path";
import { build, type Metafile } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("compiled standalone worker health check", () => {
  let directory: string, file: string, healthFile: string, metafile: Metafile;

  beforeAll(async () => {
    directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "learning-health-bundle-"),
    );
    file = path.join(directory, "learning-health.mjs");
    healthFile = path.join(directory, "worker-health.json");
    const built = await build({
      entryPoints: ["server/learning-health.ts"],
      outfile: file,
      platform: "node",
      packages: "external",
      bundle: true,
      format: "esm",
      metafile: true,
      logLevel: "silent",
    });
    metafile = built.metafile;
  });

  afterAll(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  const run = (args: readonly string[] = []) => {
    const child = spawn(process.execPath, [file, ...args], {
      cwd: directory,
      env: {
        ...process.env,
        APP_CONFIG_PATH: path.join(directory, "missing-config.json"),
        DATABASE_URL: "postgresql://unused.invalid:1/production",
        LMS_PROCESS_ROLES: undefined,
        LMS_WORKER_POOL_MAX: undefined,
        LMS_WORKER_HEALTH_FILE: healthFile,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (data) => {
      output += String(data);
    });
    child.stderr.on("data", (data) => {
      output += String(data);
    });
    return new Promise<{ code: number | null; output: string }>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => resolve({ code, output }));
      },
    );
  };

  const writeHealth = async (age = 0) => {
    const refreshedAt = Date.now() - age;
    await fs.writeFile(
      healthFile,
      JSON.stringify({
        version: 1,
        pid: process.pid,
        roles: ["files"],
        ready: true,
        updatedAt: refreshedAt,
        lastFlagRefreshAt: refreshedAt,
      }),
      { mode: 0o600 },
    );
  };

  it("loads only worker options and health file code with Node builtins in the actual bundle", () => {
    expect(Object.keys(metafile.inputs).sort()).toEqual([
      "server/infrastructure/learning-execution.ts",
      "server/infrastructure/learning-worker-health.ts",
      "server/learning-health.ts",
    ]);
    const imports = Object.values(metafile.outputs).flatMap(
      (output) => output.imports,
    );
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.every((dependency) => isBuiltin(dependency.path))).toBe(true);
  });

  it("succeeds without application configuration, database access or startup side effects", async () => {
    await writeHealth();
    expect(await run(["--roles=files"])).toEqual({ code: 0, output: "" });
    expect(await run()).toEqual({ code: 0, output: "" });
    expect((await fs.readdir(directory)).sort()).toEqual([
      "learning-health.mjs",
      "worker-health.json",
    ]);
  });

  it("fails silently for stale state, role mismatch and invalid options", async () => {
    await writeHealth(60_000);
    expect(await run()).toEqual({ code: 1, output: "" });
    await writeHealth();
    expect(await run(["--roles=email"])).toEqual({ code: 1, output: "" });
    expect(await run(["--health-file=relative.json"])).toEqual({
      code: 1,
      output: "",
    });
  });
});
