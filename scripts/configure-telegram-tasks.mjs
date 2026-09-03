import fs from 'node:fs';
import path from 'node:path';

// Run explicitly after deployment. No token in argv, output, or repository.
const configPath = path.resolve('config/app.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
const integration = config.integrations?.telegramTasks;
const token = integration?.botToken;
const secret = integration?.webhookSecret;
const appUrl = new URL('/miniapp/tasks', config.server.appUrl).href;
const webhookUrl = new URL('/api/incoming/telegram-tasks', config.server.appUrl).href;
if (!token || !secret || !appUrl.startsWith('https://')) throw new Error('Configure Telegram Tasks and the public HTTPS URL first');
async function call(method, body = {}) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json();
    if (!result.ok) throw new Error();
    return result.result;
  } catch { throw new Error(`Telegram ${method} failed (details redacted)`); }
}
try {
  const bot = await call('getMe');
  const current = await call('getWebhookInfo');
  if (current.url && current.url !== webhookUrl) throw new Error('Bot already has a different webhook; explicit owner review required');
  if (integration.botUsername && bot.username !== integration.botUsername) throw new Error('Bot identity does not match configuration');
  await call('setMyCommands', { commands: [{ command: 'start', description: 'Вход и открытие задач' }] });
  await call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Задачи', web_app: { url: appUrl } } });
  await call('setWebhook', { url: webhookUrl, secret_token: secret, allowed_updates: ['message'], max_connections: 10, drop_pending_updates: false });
  const webhook = await call('getWebhookInfo');
  console.log(JSON.stringify({ bot: bot.username, webhookConfigured: webhook.url === webhookUrl, pendingUpdates: webhook.pending_update_count }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
