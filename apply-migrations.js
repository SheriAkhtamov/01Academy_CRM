import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const { Pool } = pg;
const MIGRATION_LOCK_NAME = "01academy-crm:migrations";
export class MigrationGuardError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const boundedInteger = (value, fallback, minimum, maximum) => {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(String(value)))
    throw new MigrationGuardError("MIGRATION_TIMEOUT_INVALID");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new MigrationGuardError("MIGRATION_TIMEOUT_INVALID");
  return parsed;
};
export function readMigrationConfiguration({
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  const configPath = path.resolve(
    cwd,
    env.APP_CONFIG_PATH?.trim() || path.join("config", "app.config.json"),
  );
  let appConfig;
  try {
    appConfig = JSON.parse(
      fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""),
    );
  } catch {
    throw new MigrationGuardError("MIGRATION_CONFIG_INVALID");
  }
  const databaseUrl =
    env.DATABASE_URL?.trim() || appConfig?.database?.url?.trim();
  if (!databaseUrl) throw new MigrationGuardError("MIGRATION_DATABASE_MISSING");
  const lockTimeoutMs = boundedInteger(
    env.MIGRATION_LOCK_TIMEOUT_MS,
    15_000,
    100,
    60_000,
  );
  const statementTimeoutMs = boundedInteger(
    env.MIGRATION_STATEMENT_TIMEOUT_MS,
    120_000,
    1_000,
    900_000,
  );
  const advisoryWaitMs = boundedInteger(
    env.MIGRATION_ADVISORY_WAIT_MS,
    0,
    0,
    600_000,
  );
  return {
    configPath,
    migrationsFolder: path.resolve(cwd, "migrations"),
    lockTimeoutMs,
    statementTimeoutMs,
    advisoryWaitMs,
    poolOptions: {
      connectionString: databaseUrl,
      ssl: appConfig?.database?.ssl,
      max: 1,
      connectionTimeoutMillis: boundedInteger(
        appConfig?.database?.pool?.connectionTimeoutMillis,
        2_000,
        100,
        60_000,
      ),
      application_name: "01academy-crm-migration",
      options: `-c timezone=UTC -c lock_timeout=${lockTimeoutMs} -c statement_timeout=${statementTimeoutMs} -c idle_in_transaction_session_timeout=${statementTimeoutMs}`,
    },
  };
}
/** All automatic and manual migration runners hold the same PostgreSQL session lock. */
export async function applyMigrations(
  configuration,
  {
    poolFactory = (options) => new Pool(options),
    migrateDatabase = (client, folder) =>
      migrate(drizzle(client), { migrationsFolder: folder }),
    now = Date.now,
    wait = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = {},
) {
  const started = now();
  const pool = poolFactory(configuration.poolOptions);
  let client;
  let locked = false;
  let operationError;
  try {
    client = await pool.connect();
    const waitUntil = started + configuration.advisoryWaitMs;
    do {
      locked = Boolean(
        (
          await client.query(
            "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
            [MIGRATION_LOCK_NAME],
          )
        ).rows[0]?.acquired,
      );
      if (locked) break;
      if (now() >= waitUntil)
        throw new MigrationGuardError("MIGRATION_ALREADY_RUNNING");
      await wait(Math.min(250, Math.max(1, waitUntil - now())));
    } while (!locked);
    await migrateDatabase(client, configuration.migrationsFolder);
    return { durationMs: now() - started };
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      if (client && locked)
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [
          MIGRATION_LOCK_NAME,
        ]);
    } catch (cleanupError) {
      if (!operationError) throw cleanupError;
    } finally {
      client?.release();
      try {
        await pool.end();
      } catch (cleanupError) {
        if (!operationError) throw cleanupError;
      }
    }
  }
}
export function migrationFailureCode(error) {
  for (let depth = 0; error && depth < 5; depth++, error = error.cause) {
    if (
      typeof error.code === "string" &&
      /^(?:[A-Z0-9_]{5,60})$/.test(error.code)
    )
      return error.code;
  }
  return "MIGRATION_FAILED";
}
export async function main() {
  console.log("Applying database migrations with an exclusive lock...");
  try {
    const result = await applyMigrations(readMigrationConfiguration());
    console.log(`Migrations applied successfully in ${result.durationMs} ms.`);
  } catch (error) {
    // SQL query text, connection URLs and PostgreSQL detail fields can contain private data.
    console.error(`Migration aborted: ${migrationFailureCode(error)}`);
    process.exitCode = 1;
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
