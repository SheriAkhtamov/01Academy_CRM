import { db, pool } from './db';
import { logger } from './lib/logger';
import fs from 'fs';
import path from 'path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

export async function initializeDatabase(): Promise<void> {
  if (!pool || !db) {
    logger.warn('Database pool or Drizzle instance is not initialized yet.');
    return;
  }

  try {
    const migrationsPath = path.join(process.cwd(), 'migrations');

    if (!fs.existsSync(migrationsPath)) {
      logger.warn(`Migrations folder not found at ${migrationsPath}. Skipping migration step.`);
    } else {
      await migrate(db as never, { migrationsFolder: migrationsPath });
      logger.info(`Applied database migrations from ${migrationsPath}`);
    }

    const result = await pool.query(
      'SELECT COUNT(*) as table_count FROM information_schema.tables WHERE table_schema = $1',
      ['public'],
    );
    logger.info(`Database initialized with ${result.rows[0]?.table_count || 0} tables`);
  } catch (error: any) {
    logger.error('Database initialization failed', {
      error,
      message: error?.message,
      code: error?.code,
    });
    throw error;
  }
}

export async function checkDatabaseConnection(): Promise<boolean> {
  if (!pool) {
    return false;
  }

  try {
    await pool.query('SELECT 1');
    return true;
  } catch (error) {
    logger.error('Database connection check failed', { error });
    return false;
  }
}
