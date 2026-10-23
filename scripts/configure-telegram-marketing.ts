import { marketingBotSettingsSchema } from '../shared/contracts/telegram-marketing';
import { loadIntegrationSettings } from '../server/services/integration-settings';
import { configureMarketingBot } from '../server/services/telegram-marketing-settings';
import { pool } from '../server/db';

// Explicit deployment utility. Credentials arrive on stdin, never argv or logs.
try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk.toString();
    if (input.length > 4096) throw new Error('Invalid input');
  }
  const settings = marketingBotSettingsSchema.parse(JSON.parse(input));
  await loadIntegrationSettings();
  const result = await configureMarketingBot(settings);
  console.log(JSON.stringify({ bot: result.botUsername, configured: true }));
} catch {
  console.error('Telegram marketing configuration failed (credentials redacted)');
  process.exitCode = 1;
} finally { await pool.end(); }
