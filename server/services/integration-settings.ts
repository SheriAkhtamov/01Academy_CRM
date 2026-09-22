import crypto from 'node:crypto';
import { appConfig, validateConfig, type AppConfig } from '../config';
import { pool } from '../db';
import { onlinePbxClient } from './onlinepbx';

export type ManagedIntegration = 'telegramTasks' | 'website' | 'instagram' | 'metaAds' | 'onlinePbx';

export class IntegrationSettingsValidationError extends Error {
  constructor() {
    super('integrationInvalidSettings');
  }
}

export const getTelegramTaskBindingCount = async (botId: string): Promise<number> => {
  const { rows } = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM telegram_task_bindings WHERE bot_id = $1',
    [botId],
  );
  return Number(rows[0]?.count ?? 0);
};

export const getConnectedInstagramAccountCount = async (): Promise<number> => {
  const { rows } = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM instagram_accounts WHERE status = 'connected'",
  );
  return Number(rows[0]?.count ?? 0);
};

const encryptionKey = () => crypto.createHash('sha256')
  .update(`academy-integration-settings:${appConfig.session.secret}`)
  .digest();

const encrypt = (value: object) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64url')).join('.');
};

const decrypt = (value: string): Record<string, unknown> => {
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('Invalid saved integration settings');
  const [iv, tag, data] = parts.map((part) => Buffer.from(part, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  const result = JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('Invalid saved integration settings');
  }
  return result;
};

const apply = (provider: ManagedIntegration, settings: Record<string, unknown>) => {
  const integrations = appConfig.integrations as Record<string, Record<string, unknown>>;
  Object.assign(integrations[provider] ??= {}, settings);
  if (provider === 'onlinePbx') onlinePbxClient.resetAuthentication();
};

export const loadIntegrationSettings = async () => {
  const { rows } = await pool.query<{ provider: ManagedIntegration; encrypted_config: string }>(
    'SELECT provider, encrypted_config FROM academy_integration_settings',
  );
  const loaded = rows.filter((row) =>
    ['telegramTasks', 'website', 'instagram', 'metaAds', 'onlinePbx'].includes(row.provider)
  ).map((row) => ({ provider: row.provider, settings: decrypt(row.encrypted_config) }));
  const candidate: AppConfig = {
    ...appConfig,
    integrations: { ...appConfig.integrations },
  };
  for (const row of loaded) {
    const candidateIntegrations = candidate.integrations as Record<string, Record<string, unknown>>;
    candidateIntegrations[row.provider] = {
      ...candidateIntegrations[row.provider],
      ...row.settings,
    };
  }
  validateConfig(candidate);
  for (const row of loaded) apply(row.provider, row.settings);
};

export const saveIntegrationSettings = async (
  provider: ManagedIntegration,
  patch: Record<string, unknown>,
) => {
  const current = (appConfig.integrations as Record<string, Record<string, unknown>>)[provider] ?? {};
  const settings = { ...current, ...patch };
  const candidate: AppConfig = {
    ...appConfig,
    integrations: { ...appConfig.integrations, [provider]: settings },
  };
  try {
    validateConfig(candidate);
  } catch {
    throw new IntegrationSettingsValidationError();
  }
  await pool.query(
    `INSERT INTO academy_integration_settings (provider, encrypted_config)
     VALUES ($1, $2)
     ON CONFLICT (provider) DO UPDATE SET encrypted_config = EXCLUDED.encrypted_config, updated_at = NOW()`,
    [provider, encrypt(settings)],
  );
  apply(provider, settings);
};
