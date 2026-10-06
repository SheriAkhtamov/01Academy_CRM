import { and, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../db';
import { boardTaskActivity, boardTaskComments, boardTasks } from '../db/schema';

export const COMMENT_READ_ACTIVITY = 'comments_read';
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function unreadBoardCommentIds(taskIds: number[], userId?: number) {
  const unread = new Map<number, number[]>();
  if (!userId || !taskIds.length) return unread;
  const read = alias(boardTaskActivity, 'comment_read');
  const rows = await db.select({ taskId: boardTaskComments.taskId, id: boardTaskComments.id })
    .from(boardTaskComments)
    .innerJoin(boardTasks, eq(boardTasks.id, boardTaskComments.taskId))
    .where(and(
      inArray(boardTaskComments.taskId, taskIds),
      sql`(${boardTasks.creatorId} = ${userId} OR ${boardTasks.assigneeId} = ${userId})`,
      sql`${boardTaskComments.authorId} IS DISTINCT FROM ${userId}`,
      sql`${boardTaskComments.id} > COALESCE((
        SELECT MAX((${read.meta}->>'throughCommentId')::int) FROM ${boardTaskActivity} AS comment_read
        WHERE ${read.taskId} = ${boardTaskComments.taskId}
          AND ${read.actorId} = ${userId} AND ${read.type} = ${COMMENT_READ_ACTIVITY}
      ), 0)`,
    ));
  for (const row of rows) {
    const ids = unread.get(row.taskId) ?? [];
    ids.push(row.id);
    unread.set(row.taskId, ids);
  }
  return unread;
}

// Read receipts share the task's activity storage and stay out of its visible history.
export async function saveBoardCommentRead(tx: Transaction, taskId: number, userId: number, throughCommentId: number) {
  if (!throughCommentId) return;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`board:read:${taskId}:${userId}`}, 0))`);
  const [receipt] = await tx.select().from(boardTaskActivity).where(and(
    eq(boardTaskActivity.taskId, taskId), eq(boardTaskActivity.actorId, userId),
    eq(boardTaskActivity.type, COMMENT_READ_ACTIVITY),
  )).limit(1);
  const previous = Number((receipt?.meta as { throughCommentId?: number } | null)?.throughCommentId ?? 0);
  if (previous >= throughCommentId) return;
  const meta = { throughCommentId };
  if (receipt) {
    await tx.update(boardTaskActivity).set({ meta }).where(eq(boardTaskActivity.id, receipt.id));
  } else {
    await tx.insert(boardTaskActivity).values({ taskId, actorId: userId, type: COMMENT_READ_ACTIVITY, meta });
  }
}

export async function markBoardCommentsRead(taskId: number, userId: number, throughCommentId: number) {
  await db.transaction((tx) => saveBoardCommentRead(tx, taskId, userId, throughCommentId));
}
