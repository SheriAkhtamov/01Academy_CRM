import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createMarketingBotRouter, marketingEvent } from '../server/modules/telegram-marketing/http/bot-router';

describe('marketing webhook boundary', () => {
  const config = { botToken: '100:test', botUsername: 'TargetBot' };
  const update = { update_id: 1, message: { message_id: 3, chat: { id: 42, type: 'private' }, from: { id: 42 }, text: '/start' } };
  const groupMessage = { ...update.message, chat: { id: -42, type: 'group' } };
  it('accepts groups and supergroups but rejects forged private identities, channels and bots', () => {
    expect(marketingEvent(update, config)).toMatchObject({ userId: '42' });
    for (const type of ['group', 'supergroup']) {
      expect(marketingEvent({ ...update, message: { ...groupMessage, chat: { id: -42, type } } }, config))
        .toMatchObject({ userId: '42', chatId: -42 });
    }
    expect(marketingEvent({ ...update, message: { ...update.message, from: { id: 43 } } }, config)).toBeNull();
    expect(marketingEvent({ ...update, message: { ...groupMessage, chat: { id: -42, type: 'channel' } } }, config)).toBeNull();
    expect(marketingEvent({ ...update, message: { ...groupMessage, from: { id: 42, is_bot: true } } }, config)).toBeNull();
    expect(marketingEvent({}, config)).toBeNull();
  });
  it('handles adding this bot, addressed commands and replies without reacting to group chatter', () => {
    const event = (message: object) => marketingEvent({ update_id: 2, message: { ...groupMessage, ...message } }, config);
    expect(event({ text: undefined, new_chat_members: [{ id: 100, is_bot: true }] })).toMatchObject({ text: '/start' });
    expect(event({ text: undefined, new_chat_members: [{ id: 200, is_bot: true }] })).toBeNull();
    expect(event({ text: '/report@targetbot' })).toMatchObject({ text: '/report' });
    expect(event({ text: '/report@OtherBot' })).toBeNull();
    expect(event({ text: '/unrelated' })).toBeNull();
    expect(event({ text: 'Обычная переписка' })).toBeNull();
    expect(event({ text: 'password', reply_to_message: { from: { id: 100, is_bot: true } } })).toMatchObject({ text: 'password' });
    expect(event({ text: 'password', reply_to_message: { from: { id: 200, is_bot: true } } })).toBeNull();
  });
  it('allows any human group member to use report buttons on messages sent by the bot', () => {
    expect(marketingEvent({ update_id: 3, callback_query: {
      id: 'cb', data: 'mr:refresh', from: { id: 99 },
      message: { ...groupMessage, from: { id: 100, is_bot: true } },
    } }, config)).toMatchObject({ userId: '99', chatId: -42, callbackId: 'cb' });
  });
  it('requires the webhook secret before any handler or report can run', async () => {
    const handle = vi.fn().mockResolvedValue({ method: 'sendMessage', text: 'safe' });
    const app = express(); app.use(express.json()); app.use(createMarketingBotRouter({
      config: () => ({ botToken: '100:test', passwordHash: 'hash', webhookSecret: 'secret' }), handle,
    }));
    await request(app).post('/api/incoming/telegram-marketing').send(update).expect(403);
    expect(handle).not.toHaveBeenCalled();
    await request(app).post('/api/incoming/telegram-marketing').set('X-Telegram-Bot-Api-Secret-Token', 'secret').send(update).expect(200);
    expect(handle).toHaveBeenCalledOnce();
  });
});
