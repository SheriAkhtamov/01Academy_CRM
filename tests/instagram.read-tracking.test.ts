import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
}));

vi.mock('../server/db', () => ({
  pool: {
    query: mocks.poolQuery,
  },
}));

import {
  listInstagramConversations,
  markInstagramConversationRead,
} from '../server/services/instagram';
import { countUnreadInstagramMessages } from '../server/services/instagram-conversation-count';

describe('Instagram per-user read tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calculates unread messages from the current employee read cursor', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [] });

    await listInstagramConversations({ id: 7, module: 'sales', modules: ['sales'] });

    const [sql, params] = mocks.poolQuery.mock.calls[0];
    expect(String(sql)).toContain('instagram_conversation_reads conversation_read');
    expect(String(sql)).toContain('conversation_read.user_id = $1');
    expect(String(sql)).toContain('unread_message.id > COALESCE(conversation_read.last_read_message_id, 0)');
    expect(String(sql)).toContain('auto_lead_distribution_enabled = true');
    expect(params).toEqual([7]);
  });

  it('counts unread inbox messages using the same employee cursor and visibility rules', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [{ count: 5 }] });

    const count = await countUnreadInstagramMessages({ id: 7, module: 'sales', modules: ['sales'] });

    expect(count).toBe(5);
    const [sql, params] = mocks.poolQuery.mock.calls[0];
    expect(String(sql)).toContain('conversation_read.user_id = $1');
    expect(String(sql)).toContain('unread_message.id > COALESCE(conversation_read.last_read_message_id, 0)');
    expect(String(sql)).toContain('auto_lead_distribution_enabled = true');
    expect(String(sql)).toContain("a.status = 'connected'");
    expect(params).toEqual([7]);
  });

  it('advances only the current employee cursor instead of clearing a shared counter', async () => {
    mocks.poolQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 9,
          manager_id: 7,
          account_status: 'connected',
          access_token_encrypted: 'token',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 9, unread_count: 0, updated_at: new Date('2026-07-11T00:00:00Z') }],
      });

    const result = await markInstagramConversationRead(
      9,
      { id: 7, module: 'sales', modules: ['sales'] },
      31,
    );

    expect(result).toMatchObject({ id: 9, unreadCount: 0 });
    const [sql, params] = mocks.poolQuery.mock.calls[1];
    expect(String(sql)).toContain('INSERT INTO instagram_conversation_reads');
    expect(String(sql)).not.toContain('SET unread_count = 0');
    expect(String(sql)).toContain('conversation_id = $1 AND id = $3');
    expect(String(sql)).not.toContain('MAX(id)');
    expect(params).toEqual([9, 7, 31]);
  });

  it('keeps a newer, unreceived message unread instead of acknowledging the current maximum', async () => {
    mocks.poolQuery
      .mockResolvedValueOnce({ rows: [{ id: 9, manager_id: 7, account_status: 'connected' }] })
      .mockResolvedValueOnce({ rows: [{ id: 9, last_read_message_id: 31, unread_count: 1 }] });

    await expect(markInstagramConversationRead(9, { id: 7, module: 'sales' }, 31))
      .resolves.toMatchObject({ lastReadMessageId: 31, unreadCount: 1 });
    const [sql] = mocks.poolQuery.mock.calls[1];
    expect(sql).toContain('unread_message.id > read_cursor.last_read_message_id');
    expect(sql).toContain('GREATEST(');
  });

  it('rejects an absent, optimistic or invalid message cursor before changing state', async () => {
    for (const id of [undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(markInstagramConversationRead(9, { id: 7, module: 'sales' }, id as number))
        .rejects.toMatchObject({ statusCode: 400, message: 'invalidData' });
    }
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it('rejects a message that does not belong to the authorized conversation', async () => {
    mocks.poolQuery
      .mockResolvedValueOnce({ rows: [{ id: 9, manager_id: 7, account_status: 'connected' }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(markInstagramConversationRead(9, { id: 7, module: 'sales' }, 99))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});
