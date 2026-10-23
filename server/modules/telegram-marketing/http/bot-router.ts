import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { MarketingBotConfig, MarketingBotEvent, TelegramMethod } from '../application/ports';

const id = z.number().int().positive().safe();
const messageSchema = z.object({
  message_id: id,
  chat: z.object({ id, type: z.literal('private') }),
  from: z.object({ id, is_bot: z.boolean().optional() }).optional(),
  text: z.string().max(4096).optional(),
});
const updateSchema = z.object({
  update_id: z.number().int().nonnegative().safe(),
  message: messageSchema.optional(),
  callback_query: z.object({
    id: z.string().min(1).max(256),
    from: z.object({ id, is_bot: z.boolean().optional() }),
    data: z.string().max(64),
    message: messageSchema,
  }).optional(),
});

export function marketingEvent(raw: unknown): MarketingBotEvent | null {
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) return null;
  const callback = parsed.data.callback_query;
  const message = callback?.message ?? parsed.data.message;
  const sender = callback?.from ?? message?.from;
  if (!message || !sender || sender.is_bot || sender.id !== message.chat.id) return null;
  if (callback && !callback.data.startsWith('mr:')) return null;
  if (!callback && !message.text) return null;
  return {
    userId: String(sender.id), chatId: message.chat.id,
    text: callback?.data ?? message.text!.trim(),
    messageId: message.message_id, callbackId: callback?.id,
  };
}

export function createMarketingBotRouter(deps: {
  config(): MarketingBotConfig | null;
  handle(config: MarketingBotConfig, event: MarketingBotEvent): Promise<TelegramMethod>;
}) {
  const router = Router();
  router.post('/api/incoming/telegram-marketing', async (request, response) => {
    const config = deps.config();
    if (!config) return void response.sendStatus(503);
    const actual = Buffer.from(request.header('X-Telegram-Bot-Api-Secret-Token') ?? '');
    const expected = Buffer.from(config.webhookSecret);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return void response.sendStatus(403);
    const event = marketingEvent(request.body);
    if (!event) return void response.json({ ok: true });
    try {
      const result = await deps.handle(config, event);
      // A password change while the report was loading must prevent delivery.
      if (deps.config()?.passwordHash !== config.passwordHash) {
        return void response.json({ method: 'sendMessage', chat_id: event.chatId, text: '🔐 Введите новый пароль доступа.' });
      }
      response.json(result);
    } catch {
      // Do not log Telegram payloads, passwords, tokens or credential-bearing URLs.
      response.json({ method: 'sendMessage', chat_id: event.chatId,
        text: 'Отчёт временно недоступен. Попробуйте ещё раз.',
        reply_markup: { inline_keyboard: [[{ text: 'Повторить', callback_data: 'mr:refresh' }]] } });
    }
  });
  return router;
}
