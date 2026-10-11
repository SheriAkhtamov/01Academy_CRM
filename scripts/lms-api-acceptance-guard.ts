import { constants } from "node:fs";
import { open, lstat } from "node:fs/promises";
import path from "node:path";
import type { PoolConfig } from "pg";

export class LmsAcceptanceFailure extends Error {
  constructor(
    public readonly code: string,
    public readonly status?: number,
    public readonly responseCode?: string,
  ) {
    super(code);
  }
}
const localHttpHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
const stagingDatabaseHosts = new Set([
  ...localHttpHosts,
  "postgres",
  "lms-staging-db",
  "academy-lms-db",
]);
export type AcceptanceArguments = {
  baseUrl: string;
  load: boolean;
  loadOnly: boolean;
  withoutFiles: boolean;
  seedOnly: boolean;
  manifest?: string;
  fixture?: string;
  diagnostics?: string;
  scanTimeoutMs: number;
  help: boolean;
};
export function parseAcceptanceArguments(argv: string[]): AcceptanceArguments {
  const options: AcceptanceArguments = {
    baseUrl: "http://127.0.0.1:5007",
    load: false,
    loadOnly: false,
    withoutFiles: false,
    seedOnly: false,
    scanTimeoutMs: 120_000,
    help: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--load") {
      options.load = true;
      continue;
    }
    if (flag === "--without-files") {
      options.withoutFiles = true;
      continue;
    }
    if (flag === "--load-only") {
      options.load = true;
      options.loadOnly = true;
      continue;
    }
    if (flag === "--seed-only") {
      options.seedOnly = true;
      continue;
    }
    if (flag === "--help") {
      options.help = true;
      continue;
    }
    const value = argv[++index];
    if (!value || value.startsWith("--"))
      throw new LmsAcceptanceFailure("ACCEPTANCE_ARGUMENT_INVALID");
    if (flag === "--base-url") options.baseUrl = value;
    else if (flag === "--manifest") options.manifest = path.resolve(value);
    else if (flag === "--fixture") options.fixture = path.resolve(value);
    else if (flag === "--diagnostics")
      options.diagnostics = path.resolve(value);
    else if (flag === "--scan-timeout-ms")
      options.scanTimeoutMs = Number(value);
    else throw new LmsAcceptanceFailure("ACCEPTANCE_ARGUMENT_INVALID");
  }
  if (options.seedOnly && (!options.manifest || options.fixture))
    throw new LmsAcceptanceFailure("ACCEPTANCE_MANIFEST_REQUIRED");
  if (options.loadOnly && (options.seedOnly || !options.fixture))
    throw new LmsAcceptanceFailure("ACCEPTANCE_LOAD_FIXTURE_REQUIRED");
  if (
    !Number.isInteger(options.scanTimeoutMs) ||
    options.scanTimeoutMs < 1000 ||
    options.scanTimeoutMs > 300_000
  )
    throw new LmsAcceptanceFailure("ACCEPTANCE_ARGUMENT_INVALID");
  return options;
}
/** This pure guard runs before opening PostgreSQL or issuing HTTP requests. */
export function assertAcceptanceTarget(config: PoolConfig, baseUrl: string) {
  let database: URL;
  let http: URL;
  try {
    database = new URL(config.connectionString ?? "");
    http = new URL(baseUrl);
  } catch {
    throw new LmsAcceptanceFailure("ACCEPTANCE_TARGET_INVALID");
  }
  const databaseName = decodeURIComponent(database.pathname.slice(1));
  if (
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    !/^(academy_lms_[a-zA-Z0-9_]+|lms_staging(?:_[a-zA-Z0-9_]+)?)$/.test(
      databaseName,
    )
  )
    throw new LmsAcceptanceFailure("ACCEPTANCE_DATABASE_REFUSED");
  if (!stagingDatabaseHosts.has(database.hostname.toLowerCase()))
    throw new LmsAcceptanceFailure("ACCEPTANCE_DATABASE_HOST_REFUSED");
  for (const [key, value] of database.searchParams) {
    if (
      key !== "sslmode" ||
      !["disable", "prefer", "require", "verify-ca", "verify-full"].includes(
        value,
      )
    )
      throw new LmsAcceptanceFailure("ACCEPTANCE_DATABASE_OPTIONS_REFUSED");
  }
  if (
    !["http:", "https:"].includes(http.protocol) ||
    !localHttpHosts.has(http.hostname.toLowerCase()) ||
    http.username ||
    http.password ||
    http.pathname !== "/" ||
    http.search ||
    http.hash
  )
    throw new LmsAcceptanceFailure("ACCEPTANCE_HTTP_TARGET_REFUSED");
  if (config.host && config.host !== database.hostname)
    throw new LmsAcceptanceFailure("ACCEPTANCE_DATABASE_HOST_REFUSED");
  if (config.database && config.database !== databaseName)
    throw new LmsAcceptanceFailure("ACCEPTANCE_DATABASE_REFUSED");
  return { databaseName, baseUrl: http.origin };
}
export function safeAcceptanceFailure(error: unknown) {
  const value =
    error instanceof LmsAcceptanceFailure
      ? error
      : new LmsAcceptanceFailure("ACCEPTANCE_FAILED");
  return {
    status: "failed" as const,
    code: /^ACCEPTANCE_[A-Z_]{3,60}$/.test(value.code)
      ? value.code
      : "ACCEPTANCE_FAILED",
    ...(value.status ? { httpStatus: value.status } : {}),
  };
}
export async function writeAcceptanceManifest(
  filePath: string,
  fixture: unknown,
) {
  const file = await open(
    filePath,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await file.chmod(0o600);
    await file.writeFile(`${JSON.stringify(fixture)}\n`, "utf8");
  } finally {
    await file.close();
  }
}
export async function readAcceptanceManifest(
  filePath: string,
): Promise<unknown> {
  const stat = await lstat(filePath);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o777) !== 0o600 ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw new LmsAcceptanceFailure("ACCEPTANCE_MANIFEST_PERMISSIONS");
  const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await file.stat();
    if (
      stat.dev !== opened.dev ||
      stat.ino !== opened.ino ||
      (opened.mode & 0o777) !== 0o600
    )
      throw new LmsAcceptanceFailure("ACCEPTANCE_MANIFEST_PERMISSIONS");
    return JSON.parse(await file.readFile("utf8"));
  } finally {
    await file.close();
  }
}
