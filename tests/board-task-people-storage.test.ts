import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { boardTasks, boardTaskComments, boardTaskChecklistItems, boardTaskAttachments, boardTaskActivity, users } from '../server/db/schema';

const mocks = vi.hoisted(() => ({ select: vi.fn(), unread: vi.fn() }));
vi.mock('../server/db', () => ({ db: { select: mocks.select } }));
vi.mock('../server/storage/board-comment-reads', () => ({
  COMMENT_READ_ACTIVITY: 'comments_read', unreadBoardCommentIds: mocks.unread,
  saveBoardCommentRead: vi.fn(), markBoardCommentsRead: vi.fn(),
}));
import { boardStorage } from '../server/storage/board.storage';

const creator = { id: 7, fullName: 'Task Author', avatarUrl: '/api/users/photos/aaaaaaaaaaaaaaaaaaaaa', position: null, module: 'sales' };
const assignee = { id: 8, fullName: 'Task Assignee', avatarUrl: '/api/users/photos/bbbbbbbbbbbbbbbbbbbbb', position: null, module: 'teacher' };
const nullPerson = { id: null, fullName: null, avatarUrl: null, position: null, module: null };
let taskRows: Array<Record<string, unknown>>;
let projections: Array<{ table: unknown; selection?: Record<string, any> }>;

beforeEach(() => {
  vi.clearAllMocks();
  taskRows = [{ id: 100, creator, assignee, lead: { id: null } }];
  projections = [];
  mocks.unread.mockResolvedValue(new Map());
  mocks.select.mockImplementation((selection?: Record<string, any>) => ({
    from: (table: unknown) => {
      projections.push({ table, selection });
      const rows = table === boardTasks ? taskRows : [];
      const chain = {
        leftJoin: () => chain,
        where: () => chain,
        orderBy: async () => rows,
        groupBy: async () => rows,
        then: (resolve: (result: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
      };
      return chain;
    },
  }));
});

function assertPeopleProjection() {
  const selection = projections.find(({ table }) => table === boardTasks)!.selection!;
  const dialect = new PgDialect();
  expect(dialect.sqlToQuery(sql`${selection.creator.avatarUrl}`).sql).toBe('"creator"."avatar_url"');
  expect(dialect.sqlToQuery(sql`${selection.assignee.avatarUrl}`).sql).toBe('"assignee"."avatar_url"');
  expect(projections.some(({ table }) => table === users)).toBe(false);
}

describe('embedded task people photos', () => {
  it.each([false, true])('includes creator and assignee photos in the current joined list for archived=%s', async (archived) => {
    const tasks = await boardStorage.getTasks(1, undefined, archived, 7);
    expect(tasks[0].creator).toEqual(creator);
    expect(tasks[0].assignee).toEqual(assignee);
    assertPeopleProjection();
    expect(projections.map(({ table }) => table)).toEqual([boardTasks, boardTaskComments, boardTaskAttachments, boardTaskChecklistItems]);
  });

  it('retains both photo fields in task detail without a separate user/profile query', async () => {
    const detail = await boardStorage.getTaskDetail(100, 7);
    expect(detail!.creator).toEqual(creator);
    expect(detail!.assignee).toEqual(assignee);
    assertPeopleProjection();
    expect(projections.map(({ table }) => table)).toEqual([boardTasks, boardTaskComments, boardTaskChecklistItems, boardTaskAttachments, boardTaskActivity]);
  });

  it('keeps absent joined people null and existing people without photos valid', async () => {
    taskRows = [{ id: 100, creator: nullPerson, assignee: nullPerson, lead: { id: null } },
      { id: 101, creator: { ...creator, avatarUrl: null }, assignee: { ...assignee, avatarUrl: null }, lead: { id: null } }];
    const tasks = await boardStorage.getTasks(1);
    expect(tasks[0]).toMatchObject({ creator: null, assignee: null });
    expect(tasks[1]).toMatchObject({ creator: { id: 7, avatarUrl: null }, assignee: { id: 8, avatarUrl: null } });
    taskRows = [taskRows[0]];
    expect(await boardStorage.getTaskDetail(100)).toMatchObject({ creator: null, assignee: null });
  });
});
