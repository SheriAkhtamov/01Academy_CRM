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
  it('retries only pending files without recreating the task', async () => {
    const { close, input } = setup();
    mocks.upload.mockResolvedValueOnce({ id: 5 }).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ id: 6 });
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Task title' }), 'Retry documents');
    await user.upload(input, [new File(['a'], 'one.pdf'), new File(['b'], 'two.xlsx')]);
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    await screen.findByText(/The task is saved, but some files/);
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

describe('task acceptance UI', () => {
  it.each([{ id: 7, admin: false, enabled: true }, { id: 8, admin: false, enabled: false }, { id: 8, admin: true, enabled: false }])(
    'creator-only acceptance for $id with admin=$admin', ({ id, admin, enabled }) => {
      Object.assign(mocks.user, { id, module: admin ? 'administration' : 'sales', modules: [admin ? 'administration' : 'sales'] });
      const task: TaskDetail = { id: 100, boardId: 1, title: 'Task', description: null, status: 'done', priority: 'normal', color: null,
        position: 0, creatorId: 7, assigneeId: 8, creator: employee, assignee: { ...employee, id: 8 }, leadId: null, lead: null,
        dueAt: null, acceptedAt: null, acceptedBy: null, createdAt: '2026-09-03T10:00:00Z', updatedAt: '2026-09-03T10:00:00Z',
        comments: [], checklist: [], attachments: [], activity: [] };
      const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
      client.setQueryData(['/api/board/tasks/100'], task);
      render(provider(<TaskDetailSheet taskId={100} open onOpenChange={() => undefined} users={[employee]} />, client));
      const accept = screen.getByRole('button', { name: 'Accept task' }) as HTMLButtonElement;
      expect(accept.disabled).toBe(!enabled);
    },
  );
});
