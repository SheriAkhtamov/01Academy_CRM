import { Pool, defaults, types } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { logger } from './lib/logger';
import * as schema from "@shared/schema";
import { appConfig } from './config';

if (!appConfig.database.url) {
  logger.error('Database URL is not configured. Please update config/app.config.json.');
  throw new Error('database.url is not set');
}

let pool: Pool;
let db: NodePgDatabase<typeof schema>;

// The legacy schema uses `timestamp without time zone`. Treat those values as
// UTC consistently on both read and write so host/container local time cannot
// silently shift persisted instants.
types.setTypeParser(1114, (value: string) => new Date(`${value.replace(' ', 'T')}Z`));
defaults.parseInputDatesAsUTC = true;

try {
  pool = new Pool({
    connectionString: appConfig.database.url,
    ssl: appConfig.database.ssl,
    max: appConfig.database.pool?.max ?? 20,
    idleTimeoutMillis: appConfig.database.pool?.idleTimeoutMillis ?? 30000,
    connectionTimeoutMillis: appConfig.database.pool?.connectionTimeoutMillis ?? 2000,
    // Transactions in the CRM are expected to be short. These server-side
    // guards prevent a future lock-order bug from holding a request and its
    // row locks indefinitely even if application-level protection regresses.
    options: '-c timezone=UTC -c lock_timeout=15000 -c idle_in_transaction_session_timeout=60000',
  });

  db = drizzle(pool, { schema });

  pool.on('connect', () => {
    // Database connection established
  });

  pool.on('error', (err: Error) => {
    logger.error('Unexpected database error', { error: err });
  });
} catch (error) {
  logger.error('Failed to initialize database connection', { error });
  throw error;
}

export { pool, db };
