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

describe('Instagram per-user read tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calculates unread messages from the current employee read cursor', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [] });

    await listInstagramConversations({ id: 7, workspace: 'sales', workspaces: ['sales'] });

    const [sql, params] = mocks.poolQuery.mock.calls[0];
    expect(String(sql)).toContain('instagram_conversation_reads conversation_read');
    expect(String(sql)).toContain('conversation_read.user_id = $1');
    expect(String(sql)).toContain('unread_message.id > COALESCE(conversation_read.last_read_message_id, 0)');
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
      { id: 7, workspace: 'sales', workspaces: ['sales'] },
    );

    expect(result).toMatchObject({ id: 9, unreadCount: 0 });
    const [sql, params] = mocks.poolQuery.mock.calls[1];
    expect(String(sql)).toContain('INSERT INTO instagram_conversation_reads');
    expect(String(sql)).not.toContain('SET unread_count = 0');
    expect(params).toEqual([9, 7]);
  });
});
