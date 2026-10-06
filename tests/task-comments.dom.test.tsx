// @vitest-environment jsdom
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TaskDetailSheet } from '../client/src/components/ux/board/TaskDetailSheet';
import { TaskCard } from '../client/src/components/ux/board/TaskCard';
import { TooltipProvider } from '../client/src/components/ui/tooltip';
import { i18n } from '../client/src/lib/i18n';
import type { TaskDetail, TaskSummary, UserMini } from '../client/src/lib/boardTypes';

const mocks = vi.hoisted(() => ({ api: vi.fn(), toast: vi.fn(), user: { id: 7, module: 'administration', modules: ['administration'] } }));
vi.mock('../client/src/lib/queryClient', () => ({ apiRequest: mocks.api }));
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../client/src/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
const creator: UserMini = { id: 7, fullName: 'Author', position: null, module: 'sales' };
const assignee: UserMini = { ...creator, id: 8, fullName: 'Assignee' };
let task: TaskDetail;
let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  i18n.setLanguage('ru');
  mocks.user.id = 7;
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  task = { id: 100, boardId: 1, title: 'Delegated task', description: null, status: 'todo', priority: 'normal', color: null,
    position: 0, creatorId: 7, assigneeId: 8, creator, assignee, leadId: null, lead: null, dueAt: null,
    acceptedAt: null, acceptedBy: null, createdAt: '2026-10-05T10:00:00Z', updatedAt: '2026-10-05T10:00:00Z',
    comments: [{ id: 10, taskId: 100, author: assignee, body: 'Question', isUnread: true,
      createdAt: '2026-10-05T10:00:00Z', updatedAt: '2026-10-05T10:00:00Z' }],
    checklist: [], attachments: [], activity: [] };
  mocks.api.mockImplementation(async (method: string, url: string, input?: { readThroughCommentId?: number }) => {
    if (method === 'GET') return structuredClone(task);
    if (url.endsWith('/comments')) {
      task.comments = task.comments.map((comment) => comment.id <= (input?.readThroughCommentId ?? 0) ? { ...comment, isUnread: false } : comment);
    }
    return {};
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); });

function OpenTask() {
  const [open, setOpen] = useState(true);
  return <TaskDetailSheet taskId={100} open={open} onOpenChange={setOpen} users={[creator, assignee]} />;
}
const setup = () => {
  client.setQueryData(['/api/board/tasks/100'], task);
  render(<QueryClientProvider client={client}><OpenTask /></QueryClientProvider>);
  return userEvent.setup();
};

it.each([{ actor: 7, canEdit: true }, { actor: 8, canEdit: false }, { actor: 1, canEdit: false }])(
  'shows the edit button only to the creator, including for administrators ($actor)', ({ actor, canEdit }) => {
    mocks.user.id = actor;
    setup();
    expect(Boolean(screen.queryByRole('button', { name: i18n.t('edit') }))).toBe(canEdit);
    expect(Boolean(screen.queryByPlaceholderText(i18n.t('addCommentPlaceholder')))).toBe(actor === 7 || actor === 8);
  },
);

it('keeps unread dots while viewing and marks the comments read only after closing', async () => {
  const user = setup();
  expect(screen.getAllByRole('img', { name: i18n.t('unreadTaskComment') })).toHaveLength(2);
  expect(mocks.api).not.toHaveBeenCalled();
  await user.click(screen.getByRole('tab', { name: i18n.t('checklistLabel') }));
  expect(mocks.api).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: i18n.t('close') }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('POST', '/api/board/tasks/100/comments/read', { throughCommentId: 10 }));
  expect(client.getQueryData<TaskDetail>(['/api/board/tasks/100'])?.comments[0].isUnread).toBe(false);
});

it('lets the author reply and clear the viewed incoming comments', async () => {
  const user = setup();
  await user.type(screen.getByPlaceholderText(i18n.t('addCommentPlaceholder')), 'Answer');
  await user.click(screen.getByRole('button', { name: i18n.t('send') }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('POST', '/api/board/tasks/100/comments', { body: 'Answer', readThroughCommentId: 10 }));
  await waitFor(() => expect(screen.queryByRole('img', { name: i18n.t('unreadTaskComment') })).toBeNull());
});

it('does not clear a comment that arrived while its tab was hidden', async () => {
  const user = setup();
  await user.click(screen.getByRole('tab', { name: i18n.t('checklistLabel') }));
  const newer = { ...task.comments[0], id: 11, body: 'New question' };
  client.setQueryData<TaskDetail>(['/api/board/tasks/100'], { ...task, comments: [...task.comments, newer] });
  await user.click(screen.getByRole('button', { name: i18n.t('close') }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('POST', '/api/board/tasks/100/comments/read', { throughCommentId: 10 }));
  expect(client.getQueryData<TaskDetail>(['/api/board/tasks/100'])?.comments.map((comment) => comment.isUnread)).toEqual([false, true]);
});

it('shows a red dot on the task card only for unread comments', () => {
  const summary: TaskSummary = { ...task, commentCount: 1, unreadCommentCount: 1, attachmentCount: 0, checklistTotal: 0, checklistDone: 0 };
  const view = render(<TooltipProvider><TaskCard task={summary} /></TooltipProvider>);
  expect(screen.getByRole('img', { name: i18n.t('unreadTaskComment') })).toBeTruthy();
  view.rerender(<TooltipProvider><TaskCard task={{ ...summary, unreadCommentCount: 0 }} /></TooltipProvider>);
  expect(screen.queryByRole('img', { name: i18n.t('unreadTaskComment') })).toBeNull();
});

it('marks completed tasks awaiting acceptance even without comments and removes the dot after acceptance', () => {
  const summary: TaskSummary = { ...task, status: 'done', awaitingAcceptance: true,
    commentCount: 0, unreadCommentCount: 0, attachmentCount: 0, checklistTotal: 0, checklistDone: 0 };
  const view = render(<TooltipProvider><TaskCard task={summary} /></TooltipProvider>);
  expect(screen.getByRole('img', { name: i18n.t('taskAwaitingAcceptance') })).toBeTruthy();
  view.rerender(<TooltipProvider><TaskCard task={{ ...summary, status: 'accepted' }} /></TooltipProvider>);
  expect(screen.queryByRole('img', { name: i18n.t('taskAwaitingAcceptance') })).toBeNull();
});
