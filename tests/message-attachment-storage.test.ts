import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const mocks = vi.hoisted(() => ({ execute: vi.fn(), transaction: vi.fn() }));
vi.mock('../server/db', () => ({ db: mocks }));
import { messageStorage } from '../server/storage/message.storage';
beforeEach(() => { vi.clearAllMocks(); mocks.execute.mockResolvedValue({ rows: [] }); });

describe('private message attachment storage', () => {
  it('requires either sender or recipient ownership even with a known file id', async () => {
    expect(await messageStorage.getMessageAttachment('aaaaaaaaaaaaaaaaaaaaa', 7)).toBeNull();
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(query.sql).toContain('"messages"."sender_id"');
    expect(query.sql).toContain('"messages"."receiver_id"');
    expect(query.sql).toContain(' OR ');
    expect(query.sql).toContain("AND attachment->>'id'");
    expect(query.params).toEqual([7, 7, 'aaaaaaaaaaaaaaaaaaaaa']);
  });
  it('keeps message insertion and sender details inside the same transaction', async () => {
    const inserted = vi.fn().mockResolvedValue([{ id: 123 }]);
    const selection = vi.fn().mockRejectedValue(new Error('Lookup failed'));
    const tx = { insert: () => ({ values: () => ({ returning: inserted }) }), select: () => ({ from: () => ({ leftJoin: () => ({ where: selection }) }) }) };
    mocks.transaction.mockImplementation((fn) => fn(tx));
    await expect(messageStorage.createMessage({ senderId: 1, receiverId: 2, content: 'File', attachments: [] })).rejects.toThrow('Lookup failed');
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(inserted).toHaveBeenCalledTimes(1); expect(selection).toHaveBeenCalledTimes(1);
  });
});
