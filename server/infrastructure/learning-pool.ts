import { createHash } from "node:crypto";
import { Pool, defaults, types } from "pg";
import type { AppConfig } from "../config";
import { logger } from "../lib/logger";

const MAX_PREPARED_QUERIES = 128;

/** Standalone workers must interpret legacy timestamp columns exactly as the CRM. */
export function configureLearningDateParsing() {
  types.setTypeParser(
    1114,
    (value: string) => new Date(`${value.replace(" ", "T")}Z`),
  );
  defaults.parseInputDatesAsUTC = true;
}

/** Cache server query plans, never authorization decisions or result rows. */
export function prepareLearningReads(pool: Pool): Pool {
  const query = pool.query.bind(pool);
  const prepared = new Set<string>();
  pool.query = ((input: unknown, ...args: unknown[]) => {
    if (
      typeof input === "string" &&
      input.length >= 256 &&
      /^\s*(SELECT|WITH)\b/i.test(input) &&
      args.length <= 1 &&
      (args.length === 0 || Array.isArray(args[0]))
    ) {
      const name = `academy_lms_${createHash("sha256").update(input).digest("base64url")}`;
      if (prepared.has(name) || prepared.size < MAX_PREPARED_QUERIES) {
        prepared.add(name);
        return query({
          name,
          text: input,
          values: args[0] as unknown[] | undefined,
        });
      }
    }
    return (query as (...values: unknown[]) => unknown)(input, ...args);
  }) as Pool["query"];
  return pool;
}

/** Keep portal work within its own connection budget and leave the staff pool unchanged. */
export function createLearningPool(
  staffPool: Pool | null,
  config: AppConfig,
  execution: { max?: number; applicationName?: string } = {},
) {
  if (
    execution.max !== undefined &&
    (!Number.isInteger(execution.max) ||
      execution.max < 1 ||
      execution.max > 10)
  )
    throw new Error("Learning pool max must be an integer from 1 to 10");
  if (
    execution.applicationName !== undefined &&
    !/^[a-z][a-z0-9_-]{0,62}$/.test(execution.applicationName)
  )
    throw new Error("Invalid learning pool application name");
  if (!config.portal?.enabled) {
    if (!staffPool)
      throw new Error("Learning processes require portal.enabled=true");
    return { pool: staffPool, close: async () => undefined };
  }
  const pool = prepareLearningReads(
    new Pool({
      connectionString: config.database.url,
      ssl: config.database.ssl,
      max: Math.min(execution.max ?? 10, config.database.pool?.max ?? 10),
      idleTimeoutMillis: config.database.pool?.idleTimeoutMillis ?? 30_000,
      connectionTimeoutMillis:
        config.database.pool?.connectionTimeoutMillis ?? 2_000,
      application_name: execution.applicationName ?? "academy_lms",
      options:
        "-c timezone=UTC -c lock_timeout=15000 -c idle_in_transaction_session_timeout=60000",
    }),
  );
  pool.on("error", (error: Error) =>
    logger.error("Unexpected learning database error", { error }),
  );
  let closing: Promise<void> | undefined;
  return { pool, close: () => (closing ??= pool.end()) };
}
