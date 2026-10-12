import {
  mkdtemp,
  chmod,
  readFile,
  stat,
  symlink,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  assertAcceptanceTarget,
  parseAcceptanceArguments,
  readAcceptanceManifest,
  safeAcceptanceFailure,
  writeAcceptanceManifest,
} from "../scripts/lms-api-acceptance-guard";
import { readAcceptanceRuntimeConfiguration } from "../scripts/lms-api-acceptance";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
it.each([
  "academy",
  "production",
  "academy_lms",
  "academy_lms_test%2fproduction",
  "lms_staging-production",
])(
  "refuses unsafe or ambiguous database name %s before opening a connection",
  (name) => {
    expect(() =>
      assertAcceptanceTarget(
        {
          connectionString: `postgresql://fixture:placeholder_password@127.0.0.1/${name}`,
        },
        "http://127.0.0.1:5007",
      ),
    ).toThrow("ACCEPTANCE_DATABASE_REFUSED");
  },
);
it.each([
  "database.production.invalid",
  "138.249.248.3",
  "127.0.0.1.production.invalid",
])("refuses a non-staging database host %s", (host) => {
  expect(() =>
    assertAcceptanceTarget(
      {
        connectionString: `postgresql://fixture:placeholder_password@${host}/academy_lms_test`,
      },
      "http://127.0.0.1:5007",
    ),
  ).toThrow("ACCEPTANCE_DATABASE_HOST_REFUSED");
});
it.each([
  "host=production.invalid",
  "dbname=production",
  "options=-c%20search_path=production",
])("refuses database query overrides: %s", (options) => {
  expect(() =>
    assertAcceptanceTarget(
      {
        connectionString: `postgresql://fixture:placeholder_password@127.0.0.1/academy_lms_test?${options}`,
      },
      "http://127.0.0.1:5007",
    ),
  ).toThrow("ACCEPTANCE_DATABASE_OPTIONS_REFUSED");
});
it.each([
  "https://crm.production.invalid",
  "http://127.0.0.1.production.invalid",
  "http://fixture:password@127.0.0.1:5007",
  "http://127.0.0.1:5007/api",
  "http://127.0.0.1:5007/?target=prod",
])("refuses non-local or ambiguous HTTP target %s", (baseUrl) => {
  expect(() =>
    assertAcceptanceTarget(
      {
        connectionString:
          "postgresql://fixture:placeholder_password@127.0.0.1/academy_lms_test",
      },
      baseUrl,
    ),
  ).toThrow("ACCEPTANCE_HTTP_TARGET_REFUSED");
});
it("accepts only the local HTTP origin and a named isolated database", () => {
  expect(
    assertAcceptanceTarget(
      {
        connectionString:
          "postgresql://fixture:placeholder_password@127.0.0.1:55431/academy_lms_release",
      },
      "http://127.0.0.1:5007",
    ),
  ).toEqual({
    databaseName: "academy_lms_release",
    baseUrl: "http://127.0.0.1:5007",
  });
});
it("requires a private manifest for seeding without the HTTP server and rejects unsupported arguments", () => {
  expect(() => parseAcceptanceArguments(["--seed-only"])).toThrow(
    "ACCEPTANCE_MANIFEST_REQUIRED",
  );
  expect(() => parseAcceptanceArguments(["--production"])).toThrow(
    "ACCEPTANCE_ARGUMENT_INVALID",
  );
  expect(
    parseAcceptanceArguments([
      "--seed-only",
      "--manifest",
      "/tmp/acceptance.json",
      "--load",
    ]).load,
  ).toBe(true);
});
it("never includes an unexpected error body, cookie, credentials or stack in the public failure report", () => {
  const secret = "password-cookie-token-project-body";
  const error = Object.assign(new Error(secret), {
    body: secret,
    cookie: secret,
    token: secret,
  });
  expect(JSON.stringify(safeAcceptanceFailure(error))).not.toContain(secret);
  expect(safeAcceptanceFailure(error)).toEqual({
    status: "failed",
    code: "ACCEPTANCE_FAILED",
  });
});
it("requires a prepared synthetic cohort for load-only and keeps file scanning mandatory by default", () => {
  expect(() => parseAcceptanceArguments(["--load-only"])).toThrow(
    "ACCEPTANCE_LOAD_FIXTURE_REQUIRED",
  );
  expect(() =>
    parseAcceptanceArguments([
      "--load-only",
      "--seed-only",
      "--manifest",
      "/tmp/fixture.json",
    ]),
  ).toThrow("ACCEPTANCE_LOAD_FIXTURE_REQUIRED");
  const arguments_ = parseAcceptanceArguments([
    "--load-only",
    "--fixture",
    "/tmp/fixture.json",
  ]);
  expect(arguments_.loadOnly).toBe(true);
  expect(arguments_.load).toBe(true);
  expect(arguments_.withoutFiles).toBe(false);
  expect(parseAcceptanceArguments(["--without-files"]).withoutFiles).toBe(true);
});
it("refuses disabled learning, short secrets and mismatched server configuration before accessing a database", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "lms-acceptance-runtime-"),
  );
  directories.push(directory);
  const location = path.join(directory, "runtime.json");
  const valid = {
    server: { appUrl: "http://127.0.0.1:5007", port: 5007 },
    portal: {
      enabled: true,
      learningEnabled: true,
      allowInvitations: true,
      publicPortfolioEnabled: true,
      sessionSecret: "synthetic-runtime-secret-with-32-characters",
    },
  };
  const read = () =>
    readAcceptanceRuntimeConfiguration(
      "http://127.0.0.1:5007",
      { APP_CONFIG_PATH: location },
      directory,
    );
  await writeFile(location, JSON.stringify(valid));
  expect(read()).toEqual({ sessionSecret: valid.portal.sessionSecret });
  for (const portal of [
    { ...valid.portal, learningEnabled: false },
    { ...valid.portal, allowInvitations: false },
    { ...valid.portal, publicPortfolioEnabled: false },
  ]) {
    await writeFile(location, JSON.stringify({ ...valid, portal }));
    expect(read).toThrow("ACCEPTANCE_RUNTIME_CONFIG_REFUSED");
  }
  await writeFile(
    location,
    JSON.stringify({
      ...valid,
      portal: { ...valid.portal, sessionSecret: "short" },
    }),
  );
  expect(read).toThrow("ACCEPTANCE_SESSION_CONFIG_INVALID");
  await writeFile(
    location,
    JSON.stringify({ ...valid, server: { ...valid.server, port: 5008 } }),
  );
  expect(read).toThrow("ACCEPTANCE_HTTP_CONFIG_MISMATCH");
  await writeFile(
    location,
    JSON.stringify({
      ...valid,
      server: { ...valid.server, appUrl: "https://production.invalid" },
    }),
  );
  expect(read).toThrow("ACCEPTANCE_HTTP_CONFIG_MISMATCH");
});
it("creates a mode-600 manifest without overwriting an existing file and refuses symlinks or public permissions", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "lms-acceptance-guard-"),
  );
  directories.push(directory);
  const manifest = path.join(directory, "fixture.json");
  await writeAcceptanceManifest(manifest, { password: "fixture-only-secret" });
  expect((await stat(manifest)).mode & 0o777).toBe(0o600);
  await expect(
    writeAcceptanceManifest(manifest, { password: "replacement" }),
  ).rejects.toThrow();
  expect(await readAcceptanceManifest(manifest)).toEqual({
    password: "fixture-only-secret",
  });
  const link = path.join(directory, "linked.json");
  await symlink(manifest, link);
  await expect(readAcceptanceManifest(link)).rejects.toThrow(
    "ACCEPTANCE_MANIFEST_PERMISSIONS",
  );
  await chmod(manifest, 0o644);
  await expect(readAcceptanceManifest(manifest)).rejects.toThrow(
    "ACCEPTANCE_MANIFEST_PERMISSIONS",
  );
  expect(await readFile(manifest, "utf8")).toContain("fixture-only-secret");
});
