import { readFileSync } from "node:fs";
import path from "node:path";
import type { PoolConfig } from "pg";

const failure = (code: string) => Object.assign(new Error(code), { code });
/** Kept separate from the executable migration runner so bundling a CLI cannot run SQL migrations. */
export function readLmsOperationConfiguration(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): PoolConfig {
  let config: { database?: { url?: string; ssl?: PoolConfig["ssl"] } };
  try {
    config = JSON.parse(readFileSync(path.resolve(cwd, env.APP_CONFIG_PATH?.trim() || "config/app.config.json"), "utf8").replace(/^\uFEFF/, ""));
  } catch { throw failure("IMPORT_CONFIG_INVALID"); }
  const url = env.DATABASE_URL?.trim() || config.database?.url?.trim();
  if (!url) throw failure("IMPORT_DATABASE_MISSING");
  return { connectionString: url, ssl: config.database?.ssl, max: 1, connectionTimeoutMillis: 2_000, application_name: "01academy-crm-legacy-import", options: "-c timezone=UTC -c lock_timeout=15000 -c statement_timeout=120000 -c idle_in_transaction_session_timeout=120000" };
}
export function lmsOperationFailureCode(error: unknown): string {
  let current = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if (typeof current !== "object") break;
    const value = current as { code?: unknown; cause?: unknown };
    if (typeof value.code === "string" && /^[A-Z0-9_]{5,60}$/.test(value.code)) return value.code;
    current = value.cause;
  }
  return "IMPORT_FAILED";
}
