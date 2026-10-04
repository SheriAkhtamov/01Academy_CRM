// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateTaskDialog } from '../client/src/components/ux/board/CreateTaskDialog';
import { TaskDetailSheet } from '../client/src/components/ux/board/TaskDetailSheet';
import { i18n } from '../client/src/lib/i18n';
import type { TaskDetail, UserMini } from '../client/src/lib/boardTypes';

const mocks = vi.hoisted(() => ({ api: vi.fn(), upload: vi.fn(), toast: vi.fn(), user: { id: 7, module: 'sales', modules: ['sales'] } }));
vi.mock('../client/src/lib/queryClient', () => ({ apiRequest: mocks.api }));
vi.mock('../client/src/features/board/attachment-upload', () => ({ uploadTaskAttachment: mocks.upload }));
vi.mock('../client/src/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../client/src/features/board/photo-preview', () => ({ photoPreviewBlob: async (file: File) => file, attachmentBlob: vi.fn() }));

const employee: UserMini = { id: 7, fullName: 'Creator', module: 'sales', position: null };
const provider = (children: React.ReactNode, client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) =>
  <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
  vi.clearAllMocks(); i18n.setLanguage('en');
  mocks.api.mockResolvedValue({ id: 100 }); mocks.upload.mockResolvedValue({ id: 5 });
  Object.assign(mocks.user, { id: 7, module: 'sales', modules: ['sales'] });
  URL.createObjectURL = vi.fn(() => 'blob:photo'); URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

describe('task creation with attachments', () => {
  const setup = () => {
    const close = vi.fn();
    const view = render(provider(<CreateTaskDialog open onOpenChange={close} users={[employee]} currentUser={employee} canAssignUsers />));
    return { ...view, close, input: view.container.ownerDocument.querySelector('input[type=file]') as HTMLInputElement };
  };
  it('saves multiple files and keeps the dialog open until every upload finishes', async () => {
    const { close, input } = setup();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Task title' }), 'Send documents');
    const files = [new File(['a'], 'report.pdf'), new File(['b'], 'table.xlsx'), new File(['c'], 'letter.docx')];
    await user.upload(input, files);
    expect(screen.getByText('report.pdf')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(close).toHaveBeenCalledWith(false));
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(mocks.api).toHaveBeenCalledWith('POST', '/api/board/tasks', expect.objectContaining({ requestKey: expect.any(String), assigneeId: 7 }));
    expect(mocks.upload.mock.calls.map((args) => args[1].name)).toEqual(files.map((file) => file.name));
  });
  it.each([false, true])('finishes attachments before handing a new task to another employee (lost response: %s)', async (loseResponse) => {
    const colleague = { ...employee, id: 8, fullName: 'Teammate' };
    let assigneeId = 7;
    mocks.api.mockImplementation(async (method: string) => {
      if (method === 'GET') return { id: 100, assigneeId };
      if (method === 'PATCH') {
        assigneeId = 8;
        if (loseResponse) throw new Error('offline');
      }
      return { id: 100 };
    });
    const close = vi.fn();
    const view = render(provider(<CreateTaskDialog open onOpenChange={close} users={[employee, colleague]} currentUser={employee} canAssignUsers />));
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Task title' }), 'Delegate with files');
    await user.click(screen.getByRole('combobox', { name: i18n.t('assigneeLabel') }));
    await user.click(screen.getByRole('option', { name: colleague.fullName }));
    await user.upload(view.container.ownerDocument.querySelector('input[type=file]') as HTMLInputElement, new File(['file'], 'report.pdf'));
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    if (loseResponse) {
      await user.click(await screen.findByRole('button', { name: 'Retry saving' }));
    }
    await waitFor(() => expect(close).toHaveBeenCalledWith(false));
    expect(mocks.api).toHaveBeenCalledWith('POST', '/api/board/tasks', expect.objectContaining({ assigneeId: 7 }));
    expect(mocks.upload).toHaveBeenCalledOnce();
    const handovers = mocks.api.mock.calls.filter(([method]) => method === 'PATCH');
    expect(handovers).toEqual([['PATCH', '/api/board/tasks/100', { assigneeId: 8 }]]);
    expect(mocks.upload.mock.invocationCallOrder[0]).toBeLessThan(mocks.api.mock.invocationCallOrder[2]);
  });

  it('retries only pending files without recreating the task', async () => {
    const { close, input } = setup();
    mocks.upload.mockResolvedValueOnce({ id: 5 }).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ id: 6 });
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Task title' }), 'Retry documents');
    await user.upload(input, [new File(['a'], 'one.pdf'), new File(['b'], 'two.xlsx')]);
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    await screen.findByText(/The task was created. Retry uploading the remaining files./);
    expect(close).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox', { name: 'Task title' }) as HTMLInputElement).matches(':disabled')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Retry saving' }));
    await waitFor(() => expect(close).toHaveBeenCalledWith(false));
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(mocks.upload.mock.calls.map((args) => args[1].name)).toEqual(['one.pdf', 'two.xlsx', 'two.xlsx']);
  });
  it('retains the create retry key after a lost response', async () => {
    setup(); mocks.api.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ id: 100 });
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Task title' }), 'Lost response');
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    await screen.findByText(/Saving did not finish/);
    await user.click(screen.getByRole('button', { name: 'Retry saving' }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api.mock.calls[0][2].requestKey).toBe(mocks.api.mock.calls[1][2].requestKey);
  });
  it('shows photo thumbnails and a real dialog preview, and asks before discarding', async () => {
    const { input, close } = setup();
    const user = userEvent.setup();
    await user.upload(input, new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(screen.getByAltText('photo.jpg')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'View photo: photo.jpg' }));
    expect(screen.getByRole('dialog', { name: 'photo.jpg' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'photo.jpg' }), { key: 'Escape' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
  });
  it('rejects oversized files before making any requests', async () => {
    const { input } = setup();
    const file = new File(['large'], 'large.pdf');
    Object.defineProperty(file, 'size', { value: 50 * 1024 * 1024 + 1 });
    fireEvent.change(input, { target: { files: [file] } });
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'File is too large (maximum 50 MB)' }));
    expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.api).not.toHaveBeenCalled();
  });
});

describe('miniapp task creation', () => {
  it('keeps extra fields behind a toggle and submits the chosen deadline', async () => {
    const user = userEvent.setup();
    render(provider(<CreateTaskDialog open onOpenChange={vi.fn()} users={[employee]} currentUser={employee} canAssignUsers miniMode />));
    expect(screen.queryByRole('textbox', { name: 'Description' })).toBeNull();
    await user.type(screen.getByRole('textbox', { name: 'Task title' }), 'Prepare lessons');
    await user.click(screen.getByRole('button', { name: 'Tomorrow' }));
    await user.click(screen.getByRole('button', { name: 'Description, files and colour' }));
    await user.type(screen.getByRole('textbox', { name: 'Description' }), 'For the new group');
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('POST', '/api/board/tasks', expect.objectContaining({
      title: 'Prepare lessons', description: 'For the new group', dueAt: expect.any(String),
    })));
  });
});

describe('task acceptance UI', () => {
  it.each([{ id: 7, admin: false, enabled: false }, { id: 8, admin: false, enabled: true }, { id: 8, admin: true, enabled: true }, { id: 1, admin: true, enabled: false }])(
    'assignee-only acceptance for $id with admin=$admin', ({ id, admin, enabled }) => {
      Object.assign(mocks.user, { id, module: admin ? 'administration' : 'sales', modules: [admin ? 'administration' : 'sales'] });
      const task: TaskDetail = { id: 100, boardId: 1, title: 'Task', description: null, status: 'done', priority: 'normal', color: null,
        position: 0, creatorId: 7, assigneeId: 8, creator: employee, assignee: { ...employee, id: 8 }, leadId: null, lead: null,
        dueAt: null, acceptedAt: null, acceptedBy: null, createdAt: '2026-09-03T10:00:00Z', updatedAt: '2026-09-03T10:00:00Z',
        comments: [], checklist: [], attachments: [], activity: [] };
      const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
      client.setQueryData(['/api/board/tasks/100'], task);
      render(provider(<TaskDetailSheet taskId={100} open onOpenChange={() => undefined} users={[employee]} />, client));
      const accept = screen.queryByRole('button', { name: 'Accept task' }) as HTMLButtonElement | null;
      if (enabled) {
        expect(accept).not.toBeNull();
        expect(accept?.disabled).toBe(false);
      } else {
        expect(accept).toBeNull();
      }
    },
  );
});

describe('read-only task details', () => {
  it.each([{ id: 7, module: 'sales' }, { id: 1, module: 'administration' }])('keeps foreign tasks readable without changing or deleting them for $module', async ({ id, module }) => {
    Object.assign(mocks.user, { id, module, modules: [module] });
    const task: TaskDetail = { id: 100, boardId: 1, title: 'Foreign task', description: 'Task details', status: 'todo', priority: 'normal', color: null,
      position: 0, creatorId: 7, assigneeId: 8, creator: employee, assignee: { ...employee, id: 8 }, leadId: null, lead: null,
      dueAt: null, acceptedAt: null, acceptedBy: null, createdAt: '2026-09-03T10:00:00Z', updatedAt: '2026-09-03T10:00:00Z',
      comments: [{ id: 2, taskId: 100, author: employee, body: 'Existing comment', createdAt: '2026-09-03T10:00:00Z', updatedAt: '2026-09-03T10:00:00Z' }],
      checklist: [{ id: 3, taskId: 100, content: 'Existing item', isDone: false, position: 0, createdBy: 7, createdAt: '2026-09-03T10:00:00Z' }],
      attachments: [], activity: [] };
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    client.setQueryData(['/api/board/tasks/100'], task);
    render(provider(<TaskDetailSheet taskId={100} open onOpenChange={vi.fn()} users={[employee]} />, client));
    expect(screen.getByText('Foreign task')).toBeTruthy();
    expect(screen.getByText('Existing comment')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: i18n.t('status') })).toBeNull();
    expect(screen.queryByRole('button', { name: i18n.t('edit') })).toBeNull();
    expect(screen.queryByRole('button', { name: i18n.t('deleteTaskTitle') })).toBeNull();
    expect(screen.queryByRole('button', { name: i18n.t('delete') })).toBeNull();
    expect(screen.queryByPlaceholderText(i18n.t('addCommentPlaceholder'))).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: new RegExp(i18n.t('checklistLabel')) }));
    expect((screen.getByRole('checkbox', { name: 'Existing item' }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByPlaceholderText(i18n.t('addChecklistPlaceholder'))).toBeNull();
    expect(screen.queryByRole('button', { name: i18n.t('delete') })).toBeNull();
    await user.click(screen.getByRole('tab', { name: i18n.t('attachmentsLabel') }));
    expect(screen.queryByRole('button', { name: i18n.t('attachFile') })).toBeNull();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});

describe('miniapp task progress', () => {
  it('offers the next action and sends its status change', async () => {
    const task: TaskDetail = { id: 100, boardId: 1, title: 'Task', description: null, status: 'todo', priority: 'normal', color: null,
      position: 0, creatorId: 7, assigneeId: 7, creator: employee, assignee: employee, leadId: null, lead: null,
      dueAt: null, acceptedAt: null, acceptedBy: null, createdAt: '2026-09-03T10:00:00Z', updatedAt: '2026-09-03T10:00:00Z',
      comments: [], checklist: [], attachments: [], activity: [] };
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    client.setQueryData(['/api/board/tasks/100'], task);
    mocks.api.mockResolvedValue(task);
    render(provider(<TaskDetailSheet taskId={100} open onOpenChange={vi.fn()} users={[employee]} tasksOnly />, client));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start this task' }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('PATCH', '/api/board/tasks/100/status', { status: 'in_progress' }));
  });
});

describe('task drafts and pending submissions', () => {
  const setupTask = () => {
    const task: TaskDetail = { id: 100, boardId: 1, title: 'Task', description: null, status: 'todo', priority: 'normal', color: null,
      position: 0, creatorId: 7, assigneeId: 7, creator: employee, assignee: employee, leadId: null, lead: null,
      dueAt: null, acceptedAt: null, acceptedBy: null, createdAt: '2026-09-03T10:00:00Z', updatedAt: '2026-09-03T10:00:00Z',
      comments: [], checklist: [], attachments: [], activity: [] };
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    client.setQueryData(['/api/board/tasks/100'], task);
    const close = vi.fn();
    mocks.api.mockResolvedValue(task);
    render(provider(<TaskDetailSheet taskId={100} open onOpenChange={close} users={[employee]} />, client));
    return { close, task };
  };
  it('submits one comment and preserves text typed while that request is pending', async () => {
    const { task } = setupTask();
    let resolve!: (value: unknown) => void;
    mocks.api.mockImplementation((method: string) => method === 'POST' ? new Promise((done) => { resolve = done; }) : Promise.resolve(task));
    const input = screen.getByPlaceholderText(i18n.t('addCommentPlaceholder')) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'First' } });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { value: 'Next draft' } });
    resolve({ id: 1 });
    await waitFor(() => expect((screen.getByRole('button', { name: i18n.t('send') }) as HTMLButtonElement).disabled).toBe(false));
    expect(input.value).toBe('Next draft');
    expect(mocks.api.mock.calls.filter(([method]) => method === 'POST')).toHaveLength(1);
  });
  it('confirms closing and cancelling an edited task, and names the title input', async () => {
    const { close } = setupTask(); const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: i18n.t('edit') }));
    const title = screen.getByRole('textbox', { name: i18n.t('taskTitle') });
    fireEvent.change(title, { target: { value: 'Edited task' } });
    await user.keyboard('{Escape}');
    await screen.findByRole('alertdialog');
    expect(close).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: i18n.t('keepEditing') }));
    expect((title as HTMLInputElement).value).toBe('Edited task');
    await user.click(screen.getByRole('button', { name: i18n.t('cancel') }));
    await screen.findByRole('alertdialog');
    expect(close).not.toHaveBeenCalled();
  });
});
