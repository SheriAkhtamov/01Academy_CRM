import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { expect, it } from "vitest";
it("exits a config-disabled worker process before importing logger/storage or creating any directory", async () => {
  const workspace = process.cwd(),
    directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "learning-disabled-process-"),
    );
  try {
    const configuration = JSON.parse(
      await fs.readFile(
        path.join(workspace, "config/app.config.example.json"),
        "utf8",
      ),
    );
    configuration.database.url =
      "postgresql://fixture:placeholder-password@127.0.0.1:1/unused";
    configuration.portal.enabled = false;
    const configPath = path.join(directory, "config.json");
    await fs.writeFile(configPath, JSON.stringify(configuration), {
      mode: 0o600,
    });
    const child = spawn(
      process.execPath,
      [
        path.join(workspace, "node_modules/tsx/dist/cli.mjs"),
        "--tsconfig",
        path.join(workspace, "tsconfig.json"),
        path.join(workspace, "server/learning-worker.ts"),
        "--roles=files",
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          APP_CONFIG_PATH: configPath,
          LMS_PROCESS_ROLES: undefined,
          LMS_WORKER_POOL_MAX: undefined,
          LMS_WORKER_HEALTH_FILE: path.join(directory, "state", "health.json"),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (data) => {
      output += String(data);
    });
    child.stderr.on("data", (data) => {
      output += String(data);
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    expect(code).toBe(1);
    expect(output).toContain("portal.enabled=false");
    expect(await fs.readdir(directory)).toEqual(["config.json"]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}, 10_000);
