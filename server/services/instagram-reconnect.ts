import { appConfig } from '../config';
import { pool } from '../db';
import { logger } from '../lib/logger';
import { encryptInstagramToken } from './instagram';

const WEBHOOK_FIELDS = [
  'messages',
  'messaging_postbacks',
  'messaging_referral',
  'messaging_seen',
  'message_reactions',
];

const instagramApiConfig = () => {
  const config = appConfig.integrations?.instagram;
  return {
    apiVersion: config?.apiVersion?.trim() || 'v25.0',
    graphApiUrl: (config?.graphApiUrl?.trim() || 'https://graph.instagram.com').replace(/\/$/, ''),
  };
};

const fetchInstagramJson = async <T>(url: URL, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, { ...init, redirect: 'error' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.error) {
    const error = new Error(body?.error?.message || `Instagram API returned ${response.status}`);
    Object.assign(error, { statusCode: 502, instagramError: body?.error });
    throw error;
  }
  return body as T;
};

export const reconnectInstagramAccountWithAccessToken = async (accessTokenValue: string) => {
  const accessToken = accessTokenValue.trim();
  if (!accessToken) throw Object.assign(new Error('instagramAccessTokenMissing'), { statusCode: 400 });

  const config = instagramApiConfig();
  const profileUrl = new URL(`${config.graphApiUrl}/${config.apiVersion}/me`);
  profileUrl.searchParams.set('fields', 'user_id,username');
  profileUrl.searchParams.set('access_token', accessToken);
  const profile = await fetchInstagramJson<{ id?: string; user_id?: string; username?: string }>(profileUrl);
  const igUserId = String(profile.user_id ?? profile.id ?? '');
  if (!igUserId) throw Object.assign(new Error('instagramAccountIdMissing'), { statusCode: 502 });
  const username = String(profile.username || `instagram_${igUserId}`);

  const subscriptionUrl = new URL(`${config.graphApiUrl}/${config.apiVersion}/${igUserId}/subscribed_apps`);
  subscriptionUrl.searchParams.set('subscribed_fields', WEBHOOK_FIELDS.join(','));
  subscriptionUrl.searchParams.set('access_token', accessToken);
  await fetchInstagramJson<{ success?: boolean }>(subscriptionUrl, { method: 'POST' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query<{ connected_by: number | null }>(
      'SELECT connected_by FROM instagram_accounts WHERE ig_user_id = $1 FOR UPDATE',
      [igUserId],
    );
    const source = await client.query<{ id: number }>(
      `INSERT INTO academy_lead_sources (code, name, channel, is_system, is_active)
       VALUES ('instagram','Instagram','instagram',true,true)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name, channel = 'instagram', is_system = true, is_active = true, updated_at = NOW()
       RETURNING id`,
    );
    const connectedBy = existing.rows[0]?.connected_by ?? null;
    const sourceId = Number(source.rows[0].id);
    const { rows } = await client.query(
      `INSERT INTO instagram_accounts
        (ig_user_id, username, access_token_encrypted, token_expires_at, source_id, status, last_error, connected_by)
       VALUES ($1,$2,$3,NULL,$4,'connected',NULL,$5)
       ON CONFLICT (ig_user_id) DO UPDATE SET
         username = EXCLUDED.username, access_token_encrypted = EXCLUDED.access_token_encrypted,
         token_expires_at = NULL, source_id = EXCLUDED.source_id, status = 'connected', last_error = NULL,
         connected_by = COALESCE(instagram_accounts.connected_by, EXCLUDED.connected_by), updated_at = NOW()
       RETURNING id, ig_user_id, username, status, connected_by`,
      [igUserId, username, encryptInstagramToken(accessToken), sourceId, connectedBy],
    );
    await client.query(
      `INSERT INTO academy_integration_logs (provider, direction, status, payload, retry_count)
       VALUES ('instagram','oauth','connected',$1,0)`,
      [JSON.stringify({ igUserId, username, sourceId, method: 'access_token' })],
    );
    await client.query('COMMIT');
    const account = rows[0];
    logger.info('Instagram account reconnected with access token', { accountId: account.id, igUserId, username });
    return {
      id: Number(account.id),
      igUserId: String(account.ig_user_id),
      username: String(account.username),
      status: String(account.status),
      connectedBy: account.connected_by === null ? null : Number(account.connected_by),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
