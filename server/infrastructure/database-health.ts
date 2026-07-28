import { pool } from '../db';
import { logger } from '../lib/logger';

export const assertDatabaseConnection = async (): Promise<void> => {
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    logger.error('Database connection check failed', { error });
    throw Object.assign(new Error('Database connection failed'), { cause: error });
  }
};
