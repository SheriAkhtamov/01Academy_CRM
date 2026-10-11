import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

describe("Bundled legacy import executable", () => {
  it("prints help without reading deployment secrets or executing the migration runner", async () => {
    const directory = await mkdtemp(path.join(process.cwd(), "node_modules/.lms-import-bundle-"));
    try {
      const file = path.join(directory, "import.mjs");
      await build({ entryPoints: ["scripts/lms-import-legacy.ts"], outfile: file, platform: "node", packages: "external", bundle: true, format: "esm", logLevel: "silent" });
      const output = execFileSync(process.execPath, [file, "--help"], { encoding: "utf8", env: { ...process.env, APP_CONFIG_PATH: path.join(directory, "missing-config.json"), DATABASE_URL: "postgresql://unusable.invalid:1/unusable" } });
      expect(output).toContain("defaults to a read-only dry-run");
      expect(output).not.toContain("Applying database migrations");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("bundles the read-only health command without startup migrations or secret reads on --help", async () => {
    const directory = await mkdtemp(path.join(process.cwd(), "node_modules/.lms-health-bundle-"));
    try {
      const file = path.join(directory, "health.mjs");
      await build({ entryPoints: ["scripts/lms-health.ts"], outfile: file, platform: "node", packages: "external", bundle: true, format: "esm", logLevel: "silent" });
      const output = execFileSync(process.execPath, [file, "--help"], { encoding: "utf8", env: { ...process.env, APP_CONFIG_PATH: path.join(directory, "missing-config.json"), DATABASE_URL: "postgresql://unusable.invalid:1/unusable" } });
      expect(output).toContain("Read-only LMS health JSON");
      expect(output).not.toContain("Applying database migrations");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
