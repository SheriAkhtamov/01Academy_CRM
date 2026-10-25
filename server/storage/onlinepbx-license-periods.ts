import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { boardTaskActivity, boardTasks, onlinePbxLicensePeriods, onlinePbxLicenseTasks } from '../db/schema';
import { isOnlinePbxRenewalPaid, type OnlinePbxLicense } from '../domain/onlinepbx-licenses';
import { queueTaskNotices } from './board-telegram-events';

/** Keep both the latest authoritative API response and every previously seen
 * period, including licenses that the provider stops returning after expiry. */
export async function saveOnlinePbxLicensePeriods(domain: string, licenses: readonly OnlinePbxLicense[], now: Date) {
  const periods = new Map<string, OnlinePbxLicense>();
  for (const license of licenses) {
    const key = `${license.serviceType}:${license.startStamp}:${license.endStamp}`;
    const previous = periods.get(key);
    periods.set(key, { ...license, serviceCount: license.serviceCount + (previous?.serviceCount ?? 0) });
  }
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`onlinepbx-periods:${domain}`}, 0))`);
    await tx.update(onlinePbxLicensePeriods).set({ isCurrent: false }).where(eq(onlinePbxLicensePeriods.domain, domain));
    if (!periods.size) return;
    await tx.insert(onlinePbxLicensePeriods).values([...periods.values()].map((period) => ({
      domain, ...period, isCurrent: true, firstSeenAt: now, lastSeenAt: now,
    }))).onConflictDoUpdate({
      target: [onlinePbxLicensePeriods.domain, onlinePbxLicensePeriods.serviceType, onlinePbxLicensePeriods.startStamp, onlinePbxLicensePeriods.endStamp],
      set: { serviceCount: sql`excluded.service_count`, isCurrent: true, lastSeenAt: now },
    });
  });
}

/** A confirmed paid continuation settles only the automatically created payment
 * task. Partial renewals, deleted/reassigned tasks and manual completion remain intact. */
export async function completePaidOnlinePbxLicenseTasks(domain: string, licenses: readonly OnlinePbxLicense[], now: Date) {
  return db.transaction(async (tx) => {
    const candidates = await tx.select({ task: boardTasks, period: onlinePbxLicenseTasks }).from(onlinePbxLicenseTasks)
      .innerJoin(boardTasks, eq(boardTasks.id, onlinePbxLicenseTasks.taskId))
      .where(and(eq(onlinePbxLicenseTasks.domain, domain), eq(boardTasks.assigneeId, onlinePbxLicenseTasks.userId),
        inArray(boardTasks.status, ['backlog', 'todo', 'in_progress']))).for('update');
    const completed: Array<{ id: number; boardId: number }> = [];
    for (const { task, period } of candidates) {
      if (!isOnlinePbxRenewalPaid(licenses, period.coverage, period.endStamp, now)) continue;
      const [updated] = await tx.update(boardTasks).set({ status: 'done', updatedAt: now }).where(eq(boardTasks.id, task.id)).returning();
      await tx.insert(boardTaskActivity).values({ taskId: task.id, actorId: task.creatorId, type: 'status_changed',
        fromValue: task.status, toValue: 'done', meta: { source: 'onlinepbx_renewed', endStamp: period.endStamp } });
      await queueTaskNotices(tx, 'done', updated, task.creatorId);
      completed.push({ id: task.id, boardId: task.boardId });
    }
    return completed;
  });
}
