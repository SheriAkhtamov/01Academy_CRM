import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { MarketingBotConfig, MarketingBotEvent, TelegramMethod } from '../application/ports';

const id = z.number().int().positive().safe();
const senderSchema = z.object({ id, is_bot: z.boolean().optional() });
const messageSchema = z.object({
  message_id: id,
  chat: z.discriminatedUnion('type', [
    z.object({ id, type: z.literal('private') }),
    z.object({ id: z.number().int().negative().safe(), type: z.enum(['group', 'supergroup']) }),
  ]),
  from: senderSchema.optional(),
  text: z.string().max(4096).optional(),
  new_chat_members: z.array(senderSchema).optional(),
  reply_to_message: z.object({ from: senderSchema.optional() }).optional(),
});
const updateSchema = z.object({
  update_id: z.number().int().nonnegative().safe(),
  message: messageSchema.optional(),
  callback_query: z.object({
    id: z.string().min(1).max(256),
    from: senderSchema,
    data: z.string().max(64),
    message: messageSchema,
  }).optional(),
});

export function marketingEvent(raw: unknown, config: Pick<MarketingBotConfig, 'botToken' | 'botUsername'>): MarketingBotEvent | null {
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) return null;
  const callback = parsed.data.callback_query;
  const message = callback?.message ?? parsed.data.message;
  const sender = callback?.from ?? message?.from;
  if (!message || !sender || sender.is_bot) return null;
  const group = message.chat.type !== 'private';
  if (!group && sender.id !== message.chat.id) return null;
  if (callback && !callback.data.startsWith('mr:')) return null;
  let text = callback?.data ?? message.text?.trim() ?? '';
  if (!callback) {
    const botId = config.botToken.split(':')[0];
    const added = group && message.new_chat_members?.some((member) => String(member.id) === botId);
    const command = /^\/(\w+)(?:@([A-Za-z0-9_]+))?(?:\s|$)/.exec(text);
    if (added) text = '/start';
    else if (command) {
      if (command[2] && command[2].toLowerCase() !== config.botUsername?.toLowerCase()) return null;
      if (group && !['start', 'report', 'logout'].includes(command[1])) return null;
      text = `/${command[1]}`;
    } else if (group) {
      // Privacy mode forwards replies even when ordinary group messages are hidden.
      const repliedTo = message.reply_to_message?.from;
      if (!repliedTo?.is_bot || String(repliedTo.id) !== botId) return null;
    }
    if (!text) return null;
  }
  return {
    userId: String(sender.id), chatId: message.chat.id,
    text,
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
    const event = marketingEvent(request.body, config);
    if (!event) return void response.json({ ok: true });
    try {
      const result = await deps.handle(config, event);
      // A password change while the report was loading must prevent delivery.
      if (deps.config()?.passwordHash !== config.passwordHash) {
        return void response.json({ method: 'sendMessage', chat_id: event.chatId, text: '🔐 Введите новый пароль доступа.',
          ...(event.chatId < 0 ? { reply_markup: { force_reply: true } } : {}) });
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
