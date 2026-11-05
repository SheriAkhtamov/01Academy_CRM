import { randomUUID } from 'node:crypto';
import { taskNotices } from '../../domain/board-task-notices';
import { boardTaskEmployeeArchiveSql } from '../../lib/board-task-archive';

/** Runs SQL inside the caller's transaction and returns the result rows. */
export type SystemTaskSql = (sql: string, params: any[]) => Promise<Array<Record<string, any>>>;

export type SystemBoardTaskInput = {
  title: string;
  description?: string | null;
  assigneeId: number | null | undefined;
  /** The employee who asked for the card; the CRM itself when absent. */
  creatorId?: number | null;
  leadId?: number | null;
  dueAt?: Date | null;
  /** Stored on the creation activity so the origin of the card stays visible. */
  source: string;
  /**
   * Skip creation while an open card with this key already exists. The key is
   * stored on the creation activity, so renaming the card does not repeat it.
   */
  onceKey?: string;
};

/**
 * Work the CRM discovers by itself (three absences in a row) becomes an ordinary
 * card on the shared task board. Like other system cards, the CRM files it on
 * behalf of the administration, so a finished card is accepted as usual; it
 * follows the lead when the lead changes hands. The card joins the caller's
 * transaction: a rollback also discards it and its notices.
 */
export async function createSystemBoardTask(run: SystemTaskSql, input: SystemBoardTaskInput) {
  const assigneeId = Number(input.assigneeId);
  if (!Number.isSafeInteger(assigneeId) || assigneeId <= 0) return null;
  const [assignee] = await run(
    `SELECT id FROM users WHERE id = $1 AND is_active = true AND is_archived = false FOR SHARE`,
    [assigneeId],
  );
  if (!assignee) return null;
  // Without an active administrator the assignee owns the card outright.
  const creatorId = input.creatorId ?? Number((await run(
    `SELECT account.id FROM users account
     WHERE account.is_active = true AND account.is_archived = false
       AND (account.module = 'administration' OR EXISTS (SELECT 1 FROM user_modules granted
         WHERE granted.user_id = account.id AND granted.module = 'administration'))
     ORDER BY account.id LIMIT 1 FOR SHARE`,
    [],
  ))[0]?.id ?? assigneeId);
  const title = input.title.trim().slice(0, 255);
  if (input.onceKey) {
    // A card archived together with its employee is no longer anybody's work.
    const [existing] = await run(
      `SELECT task.id FROM board_tasks task
       WHERE task.status IN ('backlog', 'todo', 'in_progress')
         AND NOT ${boardTaskEmployeeArchiveSql('task')}
         AND EXISTS (SELECT 1 FROM board_task_activity activity
           WHERE activity.task_id = task.id AND activity.type = 'created' AND activity.meta->>'onceKey' = $1)
       LIMIT 1`,
      [input.onceKey],
    );
    if (existing) return null;
  }
  const [board] = await run(
    `SELECT id FROM boards WHERE is_archived = false ORDER BY is_default DESC, id LIMIT 1 FOR SHARE`,
    [],
  );
  if (!board) return null;
  const [task] = await run(
    `INSERT INTO board_tasks
       (board_id, title, description, status, priority, position, creator_id, assignee_id, lead_id, due_at)
     VALUES ($1, $2, $3, 'todo', 'normal',
       (SELECT COALESCE(MAX(position), 0) + 1 FROM board_tasks WHERE board_id = $1 AND status = 'todo'),
       $4, $5, $6, $7)
     RETURNING id, title, description, status, priority, due_at`,
    [board.id, title, input.description ?? null, creatorId, assigneeId, input.leadId ?? null, input.dueAt ?? null],
  );
  // Only an employee who asked for the card acted; otherwise the CRM did.
  await run(
    `INSERT INTO board_task_activity (task_id, actor_id, type, to_value, meta)
     VALUES ($1, $2, 'created', 'todo', $3::jsonb)`,
    [task.id, input.creatorId ?? null, JSON.stringify(input.onceKey ? { source: input.source, onceKey: input.onceKey } : { source: input.source })],
  );
  const dueAt = task.due_at ?? task.dueAt ?? null;
  // The assignee is told about the new work; the author is not told about it.
  const notices = taskNotices('created', {
    id: Number(task.id), title: String(task.title), creatorId, assigneeId,
    status: String(task.status), description: task.description ?? null, priority: task.priority,
    dueAt: dueAt ? new Date(dueAt) : null,
  }, creatorId === assigneeId ? null : creatorId);
  for (const notice of notices) {
    await run(
      `INSERT INTO telegram_task_events (recipient_id, event_key, payload) VALUES ($1, $2, $3::jsonb)`,
      [notice.recipientId, randomUUID(), JSON.stringify(notice)],
    );
  }
  return { id: Number(task.id) };
}
