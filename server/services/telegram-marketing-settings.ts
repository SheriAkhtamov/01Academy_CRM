import { randomBytes } from 'node:crypto';
import { appConfig } from '../config';
import { saveIntegrationSettings } from './integration-settings';
import { hashMarketingPassword } from '../modules/telegram-marketing/infrastructure/password';
import { marketingTelegramApi } from '../modules/telegram-marketing/infrastructure/telegram-api';

export function safeMarketingBotSettings() {
  const current = appConfig.integrations?.telegramMarketing;
  return {
    botUsername: current?.botUsername ?? '',
    botTokenConfigured: Boolean(current?.botToken),
    accessPasswordConfigured: Boolean(current?.passwordHash),
  };
}

export async function configureMarketingBot(input: { botToken?: string; accessPassword?: string }) {
  const current = appConfig.integrations?.telegramMarketing;
  const botToken = input.botToken?.trim() || current?.botToken;
  if (!botToken || !/^\d+:[A-Za-z0-9_-]{30,}$/.test(botToken)) {
    throw Object.assign(new Error('integrationInvalidBotToken'), { statusCode: 400 });
  }
  if (appConfig.integrations?.telegramTasks?.botToken?.split(':')[0] === botToken.split(':')[0]) {
    throw Object.assign(new Error('integrationBotAlreadyBound'), { statusCode: 409 });
  }
  const passwordHash = input.accessPassword?.trim()
    ? await hashMarketingPassword(input.accessPassword.trim()) : current?.passwordHash;
  if (!passwordHash) throw Object.assign(new Error('integrationSecretRequired'), { statusCode: 400 });
  const bot = await marketingTelegramApi<{ id: number; username: string }>(botToken, 'getMe');
  if (!bot?.id || !bot.username) throw new Error('integrationInvalidBotToken');
  const webhookUrl = new URL('/api/incoming/telegram-marketing', appConfig.server.appUrl).href;
  const existing = await marketingTelegramApi<{ url: string }>(botToken, 'getWebhookInfo');
  if (existing.url && existing.url !== webhookUrl) {
    throw Object.assign(new Error('integrationBotAlreadyBound'), { statusCode: 409 });
  }
  const sameBot = current?.botToken?.split(':')[0] === String(bot.id);
  const webhookSecret = (sameBot ? current?.webhookSecret : undefined) || randomBytes(32).toString('base64url');
  // Save before accepting webhook traffic; credentials are encrypted by the shared store.
  await saveIntegrationSettings('telegramMarketing', { botToken, passwordHash, webhookSecret, botUsername: bot.username, webhookReady: false });
  try {
    await marketingTelegramApi(botToken, 'setWebhook', {
      url: webhookUrl,
      secret_token: webhookSecret, allowed_updates: ['message', 'callback_query'],
      max_connections: 10, drop_pending_updates: false,
    });
    await marketingTelegramApi(botToken, 'setMyCommands', { commands: [
      { command: 'start', description: 'Отчёт по Meta-рекламе' },
      { command: 'report', description: 'Обновить отчёт' },
      { command: 'logout', description: 'Выйти' },
    ] });
  } catch {
    throw Object.assign(new Error('integrationWebhookFailed'), { statusCode: 502 });
  }
  await saveIntegrationSettings('telegramMarketing', { webhookReady: true });
  return safeMarketingBotSettings();
}
