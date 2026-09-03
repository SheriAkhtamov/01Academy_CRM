import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { boardTaskActivity, boardTaskAttachments, boardTasks } from '../server/db/schema';
const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('../server/db', () => ({ db: mocks }));
import { boardStorage } from '../server/storage/board.storage';

describe('board retry transactions', () => {
  const inserted: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  let matches: unknown[] = [];
  const filters: unknown[] = [];
  const tx = {
    execute: vi.fn(),
    select: vi.fn(() => ({ from: () => ({ innerJoin: () => ({ where: (filter: unknown) => {
      filters.push(filter);
      return { limit: async () => matches };
    } }) }) })),
    insert: vi.fn((table) => ({ values: (values: Record<string, unknown>) => {
      inserted.push({ table, values });
      return { returning: async () => [{ id: 100, ...values }] };
    } })),
  };
  const key = '9cc5e86c-45f9-43bc-94ea-a91d4ce30e5b';
  beforeEach(() => { vi.clearAllMocks(); matches = []; inserted.length = 0; filters.length = 0; mocks.transaction.mockImplementation((fn) => fn(tx)); });
  it('locks and creates the task and its retry key together', async () => {
    await boardStorage.createTaskWithActivity({ boardId: 1, title: 'Task', creatorId: 7 }, { actorId: 7, type: 'created' }, key);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(inserted.map((row) => row.table)).toEqual([boardTasks, boardTaskActivity]);
    expect(inserted[1].values.meta).toEqual({ requestKey: key });
    const query = new PgDialect().sqlToQuery(tx.execute.mock.calls[0][0]);
    expect(query.sql).toContain('pg_advisory_xact_lock');
    expect(query.params).toContain(`board:create:7:${key}`);
  });
  it('returns the original task on retry without another insert', async () => {
    matches = [{ task: { id: 50, creatorId: 7 } }];
    expect(await boardStorage.createTaskWithActivity({ boardId: 1, title: 'Task', creatorId: 7 }, { actorId: 7, type: 'created' }, key)).toEqual({ id: 50, creatorId: 7 });
    expect(inserted).toEqual([]);
  });
  it('stores long filenames safely with upload history in one transaction', async () => {
    const name = `${'name'.repeat(50)}.xlsx`;
    await boardStorage.createAttachmentWithActivity({ taskId: 50, uploadedBy: 7, originalName: name, fileName: 'random-file.xlsx' }, key);
    expect(inserted.map((row) => row.table)).toEqual([boardTaskAttachments, boardTaskActivity]);
    expect((inserted[1].values.toValue as string).length).toBe(120);
    expect(inserted[1].values.meta).toEqual({ attachmentId: 100, requestKey: key, originalName: name });
  });
  it('returns the original attachment and scopes its lookup by task, uploader and key', async () => {
    matches = [{ attachment: { id: 60, fileName: 'original.pdf' } }];
    const result = await boardStorage.createAttachmentWithActivity({ taskId: 50, uploadedBy: 7, originalName: 'file.pdf', fileName: 'retry-file.pdf' }, key);
    expect(result).toEqual({ id: 60, fileName: 'original.pdf' });
    expect(inserted).toEqual([]);
    const query = new PgDialect().sqlToQuery(filters[0] as Parameters<PgDialect['sqlToQuery']>[0]);
    expect(query.params).toEqual([50, 7, 'attachment_added', key]);
  });
});
