import { beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ select: vi.fn(), transaction: vi.fn() }));
vi.mock('../server/db', () => ({ db: mock }));
import { saveBoardCommentRead, unreadBoardCommentIds } from '../server/storage/board-comment-reads';

beforeEach(() => vi.clearAllMocks());

it('does not move the read receipt backwards when older devices report later', async () => {
  let receipt: { id: number; meta: { throughCommentId: number } } | null = null;
  const insert = vi.fn(async (values) => { receipt = { id: 1, ...values }; });
  const update = vi.fn((values) => ({ where: async () => { receipt = { ...receipt!, ...values }; } }));
  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => receipt ? [receipt] : [] }) }) }),
    insert: () => ({ values: insert }),
    update: () => ({ set: update }),
  } as unknown as Parameters<typeof saveBoardCommentRead>[0];

  await saveBoardCommentRead(tx, 100, 7, 10);
  await saveBoardCommentRead(tx, 100, 7, 8);
  expect(insert).toHaveBeenCalledExactlyOnceWith({ taskId: 100, actorId: 7, type: 'comments_read', meta: { throughCommentId: 10 } });
  expect(update).not.toHaveBeenCalled();
  await saveBoardCommentRead(tx, 100, 7, 11);
  expect(update).toHaveBeenCalledExactlyOnceWith({ meta: { throughCommentId: 11 } });
});

it('does not return private unread markers when no viewer or tasks are provided', async () => {
  expect(await unreadBoardCommentIds([100])).toEqual(new Map());
  expect(await unreadBoardCommentIds([], 7)).toEqual(new Map());
  expect(mock.select).not.toHaveBeenCalled();
});
