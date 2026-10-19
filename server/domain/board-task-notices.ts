import type { TelegramTaskDestination } from '@shared/telegram-task-links';

export type NoticeTask = {
  id: number; title: string; creatorId: number | null; assigneeId: number | null;
  status: string; description?: string | null; priority?: string; dueAt?: Date | null;
};
export type TaskNoticeKind = 'created' | 'assigned' | 'unassigned' | 'updated' | 'started' | 'done' | 'accepted' | 'reopened' | 'status' | 'deleted' | 'comment' | 'attachment';
export type TaskNotice = {
  kind: TaskNoticeKind; taskId: number; title: string; actorId: number | null;
  recipientId: number; destination: TelegramTaskDestination; fields?: string[];
};

export function taskNotices(
  kind: TaskNoticeKind, task: NoticeTask, actorId: number | null,
  options: { previous?: NoticeTask; commentId?: number; attachmentId?: number } = {},
): TaskNotice[] {
  const fields = options.previous ? ['title', 'description', 'priority', 'dueAt'].filter((field) => {
    const key = field as 'title' | 'description' | 'priority' | 'dueAt';
    const value = (item: NoticeTask) => item[key] instanceof Date ? (item[key] as Date).toISOString() : item[key] ?? null;
    return value(task) !== value(options.previous!);
  }) : [];
  const assigned = options.previous && options.previous.assigneeId !== task.assigneeId;
  if (assigned) fields.push('assigneeId');
  const recipients = new Set([task.creatorId, task.assigneeId, ...(assigned ? [options.previous?.assigneeId] : [])]);
  return [...recipients].flatMap((recipientId): TaskNotice[] => {
    if (!recipientId || recipientId === actorId) return [];
    const removed = assigned && recipientId === options.previous?.assigneeId && recipientId !== task.creatorId;
    const noticeKind = kind === 'updated' && assigned
      ? removed ? 'unassigned' : recipientId === task.assigneeId ? 'assigned' : 'updated'
      : kind;
    if (noticeKind === 'updated' && !fields.length && !assigned) return [];
    const view = task.status === 'accepted' ? 'archive' : recipientId === task.creatorId && recipientId !== task.assigneeId ? 'assigned' : 'mine';
    return [{
      kind: noticeKind, taskId: task.id, title: task.title, actorId, recipientId, fields,
      destination: kind === 'deleted' || removed ? { view: 'mine' } : {
        view, taskId: task.id,
        ...(kind === 'comment' ? { section: 'comments', commentId: options.commentId } : {}),
        ...(kind === 'attachment' ? { section: 'attachments', attachmentId: options.attachmentId } : {}),
      },
    }];
  });
}
