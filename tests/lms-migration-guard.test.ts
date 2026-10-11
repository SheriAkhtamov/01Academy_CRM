import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Pool, type PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  applyMigrations,
  readMigrationConfiguration,
  migrationFailureCode,
  type MigrationConfiguration,
} from "../apply-migrations.js";
const configuration: MigrationConfiguration = {
  configPath: "config/app.config.json",
  migrationsFolder: "migrations",
  lockTimeoutMs: 15000,
  statementTimeoutMs: 120000,
  advisoryWaitMs: 0,
  poolOptions: {},
};

describe("exclusive migration runner", () => {
  it("does not execute any migration when another runner holds the lock", async () => {
    const query = vi.fn(async (_sql: string) => ({
      rows: [{ acquired: false }],
    }));
    const release = vi.fn();
    const end = vi.fn();
    const run = vi.fn();
    const pool = {
      connect: async () => ({ query, release }),
      end,
    } as unknown as Pool;
    await expect(
      applyMigrations(configuration, {
        poolFactory: () => pool,
        migrateDatabase: run,
      }),
    ).rejects.toMatchObject({ code: "MIGRATION_ALREADY_RUNNING" });
    expect(run).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledOnce();
  });
  it("releases its connection and advisory lock after failed migration SQL", async () => {
    const query = vi.fn(async (_sql: string) => ({
      rows: [{ acquired: true }],
    }));
    const release = vi.fn();
    const end = vi.fn();
    const failure = Object.assign(new Error("private SQL value"), {
      code: "23514",
    });
    const pool = {
      connect: async () => ({ query, release }),
      end,
    } as unknown as Pool;
    await expect(
      applyMigrations(configuration, {
        poolFactory: () => pool,
        migrateDatabase: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(
      query.mock.calls.some((call) =>
        String(call[0]).includes("pg_advisory_unlock"),
      ),
    ).toBe(true);
    expect(release).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledOnce();
    expect(migrationFailureCode(failure)).toBe("23514");
    expect(
      migrationFailureCode({
        message: "postgres://secret:password@server/database",
      }),
    ).toBe("MIGRATION_FAILED");
  });
  it("loads an explicit BOM configuration without printing credentials and rejects unbounded timeouts", () => {
    const root = mkdtempSync(join(tmpdir(), "lms-migration-config-"));
    try {
      mkdirSync(join(root, "settings"));
      writeFileSync(
        join(root, "settings", "stage.json"),
        "\uFEFF" +
          JSON.stringify({
            database: {
              url: "postgres://fixture:placeholder-password@localhost/test",
              ssl: false,
            },
          }),
      );
      const value = readMigrationConfiguration({
        cwd: root,
        env: {
          APP_CONFIG_PATH: "settings/stage.json",
          DATABASE_URL: " ",
          MIGRATION_LOCK_TIMEOUT_MS: "500",
        },
      });
      expect(value.configPath).toBe(join(root, "settings", "stage.json"));
      expect(value.poolOptions.connectionString).toBe(
        "postgres://fixture:placeholder-password@localhost/test",
      );
      expect(value.poolOptions.options).toContain("lock_timeout=500");
      expect(() =>
        readMigrationConfiguration({
          cwd: root,
          env: {
            APP_CONFIG_PATH: "settings/stage.json",
            MIGRATION_LOCK_TIMEOUT_MS: "0;DROP TABLE users",
          },
        }),
      ).toThrow("MIGRATION_TIMEOUT_INVALID");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)(
  "migration advisory lock on isolated local PostgreSQL",
  () => {
    it("serializes two independent runner connections and lets the next run succeed after release", async () => {
      const url = databaseUrl!;
      if (
        !["localhost", "127.0.0.1", "::1", "[::1]"].includes(
          new URL(url).hostname,
        )
      )
        throw new Error("Migration guard tests require local PostgreSQL");
      const config = {
        ...configuration,
        poolOptions: {
          connectionString: url,
          max: 1,
          options: "-c lock_timeout=500 -c statement_timeout=2000",
        },
      };
      let finish!: () => void;
      const hold = new Promise<void>((resolve) => {
        finish = resolve;
      });
      let enter!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const seen: PoolClient[] = [];
      const first = applyMigrations(config, {
        migrateDatabase: async (client) => {
          seen.push(client);
          enter();
          await hold;
        },
      });
      await entered;
      try {
        await expect(
          applyMigrations(config, {
            migrateDatabase: async () => {
              throw new Error("Must not run");
            },
          }),
        ).rejects.toMatchObject({ code: "MIGRATION_ALREADY_RUNNING" });
      } finally {
        finish();
        await first;
      }
      await applyMigrations(config, {
        migrateDatabase: async (client) => {
          seen.push(client);
          await client.query("SELECT 1");
        },
      });
      expect(seen).toHaveLength(2);
    });
  },
);
