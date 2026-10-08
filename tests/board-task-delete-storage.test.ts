import { expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { boardTaskAttachments, boardTasks } from '../server/db/schema';
const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('../server/db', () => ({ db: mocks }));
import { boardStorage } from '../server/storage/board.storage';
it('locks the parent, collects cascade attachment names and commits deletion together', async () => {
  const order: string[] = [];
  let parentWhere: unknown;
  const tx = {
    select: vi.fn(() => ({ from: (table: unknown) => ({ where: (filter: unknown) => {
      if (table === boardTasks) {
        parentWhere = filter;
        return { for: async (lock: string) => { order.push(lock); return [{ id: 100 }]; } };
      }
      expect(table).toBe(boardTaskAttachments); order.push('filenames');
      return Promise.resolve([{ fileName: 'owned.pdf' }]);
    } }) })),
    delete: vi.fn((table: unknown) => ({ where: async () => { expect(table).toBe(boardTasks); order.push('delete'); } })),
  };
  mocks.transaction.mockImplementation(async (work) => { const result = await work(tx); order.push('commit'); return result; });
  expect(await boardStorage.deleteTask(100, 7)).toEqual(['owned.pdf']);
  expect(order).toEqual(['update', 'filenames', 'delete', 'commit']);
  expect(new PgDialect().sqlToQuery(parentWhere as any).params).toEqual([100, 7]);
});
