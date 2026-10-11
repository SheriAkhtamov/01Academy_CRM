import type { Pool, PoolClient, PoolConfig } from "pg";
export class MigrationGuardError extends Error {
  readonly code: string;
  constructor(code: string);
}
export type MigrationConfiguration = {
  configPath: string;
  migrationsFolder: string;
  lockTimeoutMs: number;
  statementTimeoutMs: number;
  advisoryWaitMs: number;
  poolOptions: PoolConfig;
};
export function readMigrationConfiguration(input?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}): MigrationConfiguration;
export function applyMigrations(
  configuration: MigrationConfiguration,
  dependencies?: {
    poolFactory?: (options: PoolConfig) => Pool;
    migrateDatabase?: (client: PoolClient, folder: string) => Promise<void>;
    now?: () => number;
    wait?: (milliseconds: number) => Promise<void>;
  },
): Promise<{ durationMs: number }>;
export function migrationFailureCode(error: unknown): string;
export function main(): Promise<void>;
