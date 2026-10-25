import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { boards, boardTaskActivity, boardTasks, onlinePbxLicenseIssues, onlinePbxLicenseTasks, users } from '../db/schema';
import { queueTaskNotices } from './board-telegram-events';
import type { OnlinePbxLicenseCoverage } from '../domain/onlinepbx-licenses';

type RenewalTaskInput = { domain: string; endStamp: number; userId: number; title: string; description: string; coverage?: OnlinePbxLicenseCoverage };
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function createOnlinePbxTask(tx: Transaction, input: { userId: number; title: string; description: string; dueAt: Date | null; meta: object }) {
  const [assignee] = await tx.select({ id: users.id }).from(users)
    .where(and(eq(users.id, input.userId), eq(users.isActive, true), eq(users.isArchived, false))).for('share');
  if (!assignee) return null;
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
    title: input.title, description: input.description, status: 'todo', priority: 'urgent', dueAt: input.dueAt,
    position: sql`(SELECT COALESCE(MAX(position), -1) + 1 FROM board_tasks WHERE board_id = ${board.id} AND status = 'todo')`,
  }).returning();
  await tx.insert(boardTaskActivity).values({ taskId: task.id, actorId: actor.id, type: 'created', toValue: 'todo', meta: input.meta });
  return task;
}

/** One renewal task per recipient and paid period, even after restarts/deletion. */
export async function ensureOnlinePbxLicenseTask(input: RenewalTaskInput, now = new Date()) {
  return db.transaction(async (tx) => {
    const key = `onlinepbx-task:${input.domain}:${input.endStamp}:${input.userId}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    const [existing] = await tx.select({ task: boardTasks, period: onlinePbxLicenseTasks }).from(onlinePbxLicenseTasks)
      .leftJoin(boardTasks, eq(boardTasks.id, onlinePbxLicenseTasks.taskId))
      .where(and(eq(onlinePbxLicenseTasks.domain, input.domain), eq(onlinePbxLicenseTasks.endStamp, input.endStamp),
        eq(onlinePbxLicenseTasks.userId, input.userId))).limit(1);
    const windowStart = (input.endStamp - 7 * 86_400) * 1000;
    // An operator-created task deleted weeks early must not suppress the newly
    // requested seven-day schedule. Deletions inside that window stay suppressed.
    const prematureDeletedTask = existing && !existing.task && existing.period.createdAt.getTime() < windowStart
      && now.getTime() >= windowStart && now.getTime() <= input.endStamp * 1000;
    if (existing && !prematureDeletedTask) return { task: existing.task, created: false };
    const task = await createOnlinePbxTask(tx, {
      ...input, dueAt: new Date(input.endStamp * 1000),
      meta: { source: 'onlinepbx_license', domain: input.domain, endStamp: input.endStamp },
    });
    if (!task) return { task: null, created: false };
    await tx.insert(onlinePbxLicenseTasks).values({ domain: input.domain, endStamp: input.endStamp, userId: input.userId,
      taskId: task.id, coverage: input.coverage, createdAt: now })
      .onConflictDoUpdate({ target: [onlinePbxLicenseTasks.domain, onlinePbxLicenseTasks.endStamp, onlinePbxLicenseTasks.userId],
        set: { taskId: task.id, coverage: input.coverage, createdAt: now } });
    // The license worker delivers the task link through its durable reminder
    // ledger. A second generic creation notification would duplicate it.
    return { task, created: true };
  });
}

type LicenseIssueInput = { domain: string; extension: string; userId: number; needsLicense: boolean; title: string; description: string };

/** Missing/expired licenses are absent from the billing API, so track the
 * disabled required extension separately from dated renewal tasks. */
export async function reconcileOnlinePbxLicenseIssue(input: LicenseIssueInput, now = new Date()) {
  return db.transaction(async (tx) => {
    const where = and(eq(onlinePbxLicenseIssues.domain, input.domain), eq(onlinePbxLicenseIssues.extension, input.extension), eq(onlinePbxLicenseIssues.userId, input.userId));
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`onlinepbx-issue:${input.domain}:${input.extension}:${input.userId}`}, 0))`);
    const [existing] = await tx.select().from(onlinePbxLicenseIssues).where(where).limit(1);
    if (!input.needsLicense) {
      if (existing && !existing.resolvedAt) await tx.update(onlinePbxLicenseIssues).set({ resolvedAt: now }).where(where);
      return { task: null, created: false };
    }
    if (existing && !existing.resolvedAt) {
      const [task] = existing.taskId ? await tx.select().from(boardTasks).where(eq(boardTasks.id, existing.taskId)).limit(1) : [];
      return { task: task ?? null, created: false };
    }
    // Adopt the initial operator-created task, without creating a duplicate.
    const seedKey = `onlinepbx-license-activation:${input.domain}:${input.extension}`;
    const [seed] = existing ? [] : await tx.select({ task: boardTasks }).from(boardTaskActivity)
      .innerJoin(boardTasks, eq(boardTasks.id, boardTaskActivity.taskId))
      .where(and(eq(boardTasks.assigneeId, input.userId), eq(boardTaskActivity.type, 'created'),
        sql`${boardTaskActivity.meta}->>'requestKey' = ${seedKey}`)).limit(1);
    const task = seed?.task ?? await createOnlinePbxTask(tx, {
      ...input, dueAt: null, meta: { source: 'onlinepbx_license_issue', domain: input.domain, extension: input.extension },
    });
    if (!task) return { task: null, created: false };
    await tx.insert(onlinePbxLicenseIssues).values({ domain: input.domain, extension: input.extension, userId: input.userId, taskId: task.id, openedAt: now })
      .onConflictDoUpdate({ target: [onlinePbxLicenseIssues.domain, onlinePbxLicenseIssues.extension, onlinePbxLicenseIssues.userId],
        set: { taskId: task.id, openedAt: now, resolvedAt: null } });
    if (!seed) await queueTaskNotices(tx, 'created', task, task.creatorId);
    return { task, created: !seed };
  });
}
