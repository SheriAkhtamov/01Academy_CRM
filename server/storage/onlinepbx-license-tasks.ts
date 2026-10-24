import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { boards, boardTaskActivity, boardTasks, onlinePbxLicenseTasks, users } from '../db/schema';

type RenewalTaskInput = { domain: string; endStamp: number; userId: number; title: string; description: string };

/** One renewal task per recipient and paid period, even after restarts/deletion. */
export async function ensureOnlinePbxLicenseTask(input: RenewalTaskInput) {
  return db.transaction(async (tx) => {
    const key = `onlinepbx-task:${input.domain}:${input.endStamp}:${input.userId}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    const [existing] = await tx.select({ task: boardTasks }).from(onlinePbxLicenseTasks)
      .leftJoin(boardTasks, eq(boardTasks.id, onlinePbxLicenseTasks.taskId))
      .where(and(eq(onlinePbxLicenseTasks.domain, input.domain), eq(onlinePbxLicenseTasks.endStamp, input.endStamp),
        eq(onlinePbxLicenseTasks.userId, input.userId))).limit(1);
    if (existing) return { task: existing.task, created: false };
    const [assignee] = await tx.select({ id: users.id }).from(users)
      .where(and(eq(users.id, input.userId), eq(users.isActive, true), eq(users.isArchived, false))).for('share');
    if (!assignee) return { task: null, created: false };
    const [actor] = await tx.select({ id: users.id }).from(users).where(and(
      eq(users.isActive, true), eq(users.isArchived, false),
      sql`(${users.module} = 'administration' OR EXISTS
        (SELECT 1 FROM user_modules module WHERE module.user_id = ${users.id} AND module.module = 'administration'))`,
    )).orderBy(asc(users.id)).limit(1).for('share');
    const [board] = await tx.select({ id: boards.id }).from(boards)
      .where(eq(boards.isArchived, false)).orderBy(desc(boards.isDefault), asc(boards.id)).limit(1).for('share');
    if (!actor || !board) throw new Error('OnlinePBX renewal tasks require an active administrator and task board');
    const [task] = await tx.insert(boardTasks).values({
      boardId: board.id, creatorId: actor.id, assigneeId: input.userId,
      title: input.title, description: input.description, status: 'todo', priority: 'urgent',
      dueAt: new Date(input.endStamp * 1000),
      position: sql`(SELECT COALESCE(MAX(position), -1) + 1 FROM board_tasks WHERE board_id = ${board.id} AND status = 'todo')`,
    }).returning();
    await tx.insert(boardTaskActivity).values({
      taskId: task.id, actorId: actor.id, type: 'created', toValue: 'todo',
      meta: { source: 'onlinepbx_license', domain: input.domain, endStamp: input.endStamp },
    });
    await tx.insert(onlinePbxLicenseTasks).values({ domain: input.domain, endStamp: input.endStamp, userId: input.userId, taskId: task.id });
    // The license worker delivers the task link through its durable reminder
    // ledger. A second generic creation notification would duplicate it.
    return { task, created: true };
  });
}
