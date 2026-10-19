import { describe, expect, it } from 'vitest';
import { taskNotices } from '../server/domain/board-task-notices';
import { readTelegramTaskDestination, telegramTaskUrl } from '../shared/telegram-task-links';

const task = { id: 50, title: 'Отчёт', creatorId: 7, assigneeId: 8, status: 'todo', description: null, priority: 'normal', dueAt: null };

describe('task event audience and destinations', () => {
  it('notifies the new assignee when the author creates a task, without a self notification', () => {
    expect(taskNotices('created', task, 7)).toMatchObject([{ kind: 'created', recipientId: 8, destination: { taskId: 50, view: 'mine' } }]);
    expect(taskNotices('created', { ...task, assigneeId: 7 }, 7)).toEqual([]);
  });
  it.each(['started', 'done', 'status', 'reopened'] as const)('notifies the author about %s', (kind) => {
    expect(taskNotices(kind, task, 8)).toMatchObject([{ kind, recipientId: 7, destination: { taskId: 50, view: 'assigned' } }]);
  });
  it('notifies the assignee of acceptance and opens the archived task', () => {
    expect(taskNotices('accepted', { ...task, status: 'accepted' }, 7)).toMatchObject([{ recipientId: 8, destination: { view: 'archive', taskId: 50 } }]);
  });
  it('notifies both assignees after reassignment, giving the former assignee a list button', () => {
    const notices = taskNotices('updated', { ...task, assigneeId: 9 }, 7, { previous: task });
    expect(notices).toMatchObject([
      { kind: 'assigned', recipientId: 9, destination: { taskId: 50 } },
      { kind: 'unassigned', recipientId: 8, destination: { view: 'mine' } },
    ]);
    expect(notices[1].destination.taskId).toBeUndefined();
  });
  it('combines actual field changes in one message and ignores unchanged dates and unrelated colour', () => {
    expect(taskNotices('updated', { ...task }, 7, { previous: task })).toEqual([]);
    const previous = { ...task, dueAt: new Date('2026-10-19T10:00:00Z') };
    expect(taskNotices('updated', { ...previous, dueAt: new Date(previous.dueAt) }, 7, { previous })).toEqual([]);
    expect(taskNotices('updated', { ...task, title: 'План', description: 'Новый', priority: 'urgent', dueAt: new Date() }, 7, { previous: task }))
      .toMatchObject([{ recipientId: 8, fields: ['title', 'description', 'priority', 'dueAt'] }]);
  });
  it('directs comments and files to the exact item and never notifies unrelated employees', () => {
    expect(taskNotices('comment', task, 7, { commentId: 22 })).toMatchObject([{ recipientId: 8, destination: { section: 'comments', commentId: 22 } }]);
    expect(taskNotices('attachment', task, 8, { attachmentId: 23 })).toMatchObject([{ recipientId: 7, destination: { section: 'attachments', attachmentId: 23 } }]);
    expect(taskNotices('deleted', task, 7)).toMatchObject([{ recipientId: 8, destination: { view: 'mine' } }]);
    expect(taskNotices('deleted', task, 7)[0].destination.taskId).toBeUndefined();
  });
});

it('round-trips safe notification locations, discards malformed IDs and keeps credentials out of links', () => {
  const destination = { taskId: 5, view: 'archive' as const, section: 'attachments' as const, attachmentId: 22 };
  const url = new URL(telegramTaskUrl('https://crm.example.test/miniapp/tasks?token=old#private', destination));
  expect(readTelegramTaskDestination(url.search)).toMatchObject(destination);
  expect(url.search).not.toContain('token');
  expect(url.hash).toBe('');
  expect(readTelegramTaskDestination('?task=-1&view=unknown&section=files&comment=3')).toEqual({ view: 'mine', ownerId: undefined });
  expect(readTelegramTaskDestination('?task=9007199254740992').taskId).toBeUndefined();
});
