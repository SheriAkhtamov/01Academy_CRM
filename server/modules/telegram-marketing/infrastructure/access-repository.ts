import type { Pool } from 'pg';
import type { MarketingBotAccess } from '../application/ports';
import { marketingAccessVersion, verifyMarketingPassword } from './password';

// The legacy telegram_user_id column stores the private chat or the shared negative group ID.
export const createMarketingBotAccess = (pool: Pick<Pool, 'query' | 'connect'>): MarketingBotAccess => ({
  async get(botId, chatId, passwordHash) {
    const { rows } = await pool.query<{ state: unknown }>(
      `SELECT state FROM telegram_marketing_sessions
       WHERE bot_id = $1 AND telegram_user_id = $2 AND access_version = $3
         AND authenticated_at IS NOT NULL
         AND (telegram_user_id LIKE '-%' OR authenticated_at > timezone('UTC', now()) - interval '30 days')`,
      [botId, chatId, marketingAccessVersion(passwordHash)],
    );
    return rows[0] ?? null;
  },
  async authenticate(botId, chatId, password, passwordHash) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO telegram_marketing_sessions (bot_id, telegram_user_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`, [botId, chatId],
      );
      const { rows: [session] } = await client.query<{ failures: number; locked: boolean }>(
        `SELECT CASE WHEN locked_until <= timezone('UTC', now()) THEN 0 ELSE failures END AS failures,
           COALESCE(locked_until > timezone('UTC', now()), false) AS locked
         FROM telegram_marketing_sessions WHERE bot_id = $1 AND telegram_user_id = $2 FOR UPDATE`,
        [botId, chatId],
      );
      if (session.locked) {
        await client.query('COMMIT');
        return 'locked';
      }
      const correct = await verifyMarketingPassword(password, passwordHash);
      if (correct) {
        await client.query(
          `UPDATE telegram_marketing_sessions SET access_version = $3, authenticated_at = timezone('UTC', now()),
             failures = 0, locked_until = NULL, state = '{}', updated_at = timezone('UTC', now())
           WHERE bot_id = $1 AND telegram_user_id = $2`, [botId, chatId, marketingAccessVersion(passwordHash)],
        );
      } else {
        await client.query(
          `UPDATE telegram_marketing_sessions SET failures = $3,
             locked_until = CASE WHEN $3::int >= 5 THEN timezone('UTC', now()) + interval '15 minutes' END,
             updated_at = timezone('UTC', now()) WHERE bot_id = $1 AND telegram_user_id = $2`,
          [botId, chatId, session.failures + 1],
        );
      }
      await client.query('COMMIT');
      return correct ? 'ok' : session.failures + 1 >= 5 ? 'locked' : 'denied';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  },
  async saveState(botId, chatId, passwordHash, state) {
    await pool.query(
      `UPDATE telegram_marketing_sessions SET state = $4::jsonb, updated_at = timezone('UTC', now())
       WHERE bot_id = $1 AND telegram_user_id = $2 AND access_version = $3`,
      [botId, chatId, marketingAccessVersion(passwordHash), JSON.stringify(state)],
    );
  },
  async logout(botId, chatId) {
    await pool.query(
      `UPDATE telegram_marketing_sessions SET access_version = NULL, authenticated_at = NULL, state = '{}'
       WHERE bot_id = $1 AND telegram_user_id = $2`, [botId, chatId],
    );
  },
});
