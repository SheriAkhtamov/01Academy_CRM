import type { Pool, PoolClient } from 'pg';
import { pool } from '../db';

type QueryExecutor = Pick<Pool | PoolClient, 'query'>;

export const revokeUserSessions = async (
  userId: number,
  exceptSessionId: string | null = null,
  executor: QueryExecutor = pool,
) => {
  await executor.query(
    `DELETE FROM "session"
     WHERE sess ->> 'userId' = $1
       AND ($2::text IS NULL OR sid <> $2)`,
    [String(userId), exceptSessionId],
  );
};

export const revokeSavedAccountTokens = async (
  userId: number,
  executor: QueryExecutor = pool,
) => {
  await executor.query(
    `DELETE FROM saved_accounts
     WHERE owner_user_id = $1 OR account_user_id = $1`,
    [userId],
  );
};

export const revokeUserAuthenticationArtifacts = async (
  userId: number,
  options: {
    exceptSessionId?: string | null;
    executor?: QueryExecutor;
  } = {},
) => {
  const executor = options.executor ?? pool;
  await revokeUserSessions(
    userId,
    options.exceptSessionId ?? null,
    executor,
  );
  await revokeSavedAccountTokens(userId, executor);
};
