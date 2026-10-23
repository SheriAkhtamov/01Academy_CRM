import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createMarketingBotRouter, marketingEvent } from '../server/modules/telegram-marketing/http/bot-router';

describe('marketing webhook boundary', () => {
  const update = { update_id: 1, message: { message_id: 3, chat: { id: 42, type: 'private' }, from: { id: 42 }, text: '/start' } };
  it('rejects group chats, forged sender/chat identities, bots and malformed payloads', () => {
    expect(marketingEvent(update)).toMatchObject({ userId: '42' });
    expect(marketingEvent({ ...update, message: { ...update.message, chat: { id: -42, type: 'group' } } })).toBeNull();
    expect(marketingEvent({ ...update, message: { ...update.message, from: { id: 43 } } })).toBeNull();
    expect(marketingEvent({ ...update, message: { ...update.message, from: { id: 42, is_bot: true } } })).toBeNull();
    expect(marketingEvent({})).toBeNull();
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
