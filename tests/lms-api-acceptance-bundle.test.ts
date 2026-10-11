import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { expect, it } from "vitest";

it("bundles the acceptance runner and prints help without configuration reads, migration bootstrap or database access", async () => {
  const directory = await mkdtemp(
    path.join(process.cwd(), "node_modules/.lms-acceptance-bundle-"),
  );
  try {
    const file = path.join(directory, "acceptance.mjs");
    await build({
      entryPoints: ["scripts/lms-api-acceptance.ts"],
      outfile: file,
      platform: "node",
      packages: "external",
      bundle: true,
      format: "esm",
      logLevel: "silent",
    });
    const output = execFileSync(process.execPath, [file, "--help"], {
      encoding: "utf8",
      env: {
        ...process.env,
        APP_CONFIG_PATH: path.join(directory, "missing-config.json"),
        DATABASE_URL: "postgresql://unused.invalid:1/production",
      },
    });
    expect(output).toContain("Local isolated LMS HTTP acceptance");
    expect(output).not.toContain("Applying database migrations");
    expect(output).not.toContain("production");
    expect(output).not.toContain("seed_tagged_fake_cohort");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
