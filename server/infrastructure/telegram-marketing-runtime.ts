import { pool } from '../db';
import { appConfig } from '../config';
import { createMarketingBotRouter } from '../modules/telegram-marketing/http/bot-router';
import { createMarketingBotService } from '../modules/telegram-marketing/application/bot-service';
import { createMarketingBotAccess } from '../modules/telegram-marketing/infrastructure/access-repository';
import { createMarketingLeadFactsReader } from '../modules/telegram-marketing/infrastructure/report-repository';
import { marketingTelegramApi } from '../modules/telegram-marketing/infrastructure/telegram-api';

export const telegramMarketingRouter = () => createMarketingBotRouter({
  config: () => {
    const config = appConfig.integrations?.telegramMarketing;
    return config?.webhookReady && config.botToken && config.webhookSecret && config.passwordHash
      ? { botToken: config.botToken, botUsername: config.botUsername,
        webhookSecret: config.webhookSecret, passwordHash: config.passwordHash } : null;
  },
  handle: createMarketingBotService({
    access: createMarketingBotAccess(pool), facts: createMarketingLeadFactsReader(pool), telegram: marketingTelegramApi, now: () => new Date(),
  }),
});
