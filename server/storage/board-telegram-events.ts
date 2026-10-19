import { randomUUID } from 'node:crypto';
import type { db } from '../db';
import { telegramTaskEvents } from '../db/schema';
import { taskNotices, type NoticeTask, type TaskNoticeKind } from '../domain/board-task-notices';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Queue in the task transaction: rollback also discards its notifications.
export async function queueTaskNotices(
  tx: Transaction, kind: TaskNoticeKind, task: NoticeTask, actorId: number | null,
  options: Parameters<typeof taskNotices>[3] = {},
) {
  const notices = taskNotices(kind, task, actorId, options);
  if (!notices.length) return;
  await tx.insert(telegramTaskEvents).values(notices.map((notice) => ({
    recipientId: notice.recipientId, eventKey: randomUUID(), payload: notice,
  })));
}
