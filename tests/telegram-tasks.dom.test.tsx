// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../client/src/components/ui/tooltip';
import { i18n } from '../client/src/lib/i18n';
import { TasksApp } from '../client/src/miniapp/TasksApp';
import { boardQueryKeys } from '../client/src/features/board/api';
const mocks = vi.hoisted(() => ({ board: vi.fn(), mini: vi.fn(), detail: vi.fn(), create: vi.fn(), photo: vi.fn() }));
vi.mock('../client/src/features/board/transport', async (importOriginal) => ({
  ...await importOriginal<typeof import('../client/src/features/board/transport')>(), boardRequest: mocks.board,
}));
vi.mock('../client/src/features/board/user-photo', () => ({ fetchMiniBoardUserPhoto: mocks.photo }));
vi.mock('../client/src/features/board/telegram', () => ({
  miniRequest: mocks.mini,
  telegramApp: () => undefined,
  hapticImpact: () => undefined,
  hapticNotify: () => undefined,
  hapticSelect: () => undefined,
  syncTelegramTheme: () => undefined,
}));
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 7, fullName: 'Employee', module: 'teacher' }, isLoading: false }) }));
vi.mock('../client/src/components/ux/board/TaskDetailSheet', () => ({ TaskDetailSheet: (props: unknown) => { mocks.detail(props); return null; } }));
vi.mock('../client/src/components/ux/board/CreateTaskDialog', () => ({ CreateTaskDialog: (props: unknown) => { mocks.create(props); return null; } }));
const task = { id: 1, title: 'My assigned task', status: 'todo', priority: 'normal', color: null, creator: { id: 8, fullName: 'Creator' }, assignee: { id: 7, fullName: 'Employee' }, lead: null, dueAt: null, acceptedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', commentCount: 0, attachmentCount: 0, checklistTotal: 0, checklistDone: 0 };
const delegatedTask = { ...task, id: 2, title: 'Delegated task', creator: task.assignee, assignee: task.creator };
let client: QueryClient;
beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
  vi.clearAllMocks(); i18n.setLanguage('en');
  mocks.board.mockImplementation(async (_method, url) => ({ tasks: url.includes('archived=true') ? [{ ...task, id: 3, title: 'Archived task', status: 'accepted' }] : [task, delegatedTask] }));
  mocks.mini.mockResolvedValue([{ id: 7, fullName: 'Employee' }]);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });
const setup = () => render(<QueryClientProvider client={client}><TooltipProvider><TasksApp /></TooltipProvider></QueryClientProvider>);
describe('Mobile tasks interface', () => {
  const assertPeople = (title: string, creator: string, assignee: string) => {
    const card = screen.getByText(title).closest('button')!;
    const creatorRow = within(card).getByTitle(`Creator: ${creator}`);
    const assigneeRow = within(card).getByTitle(`Assignee: ${assignee}`);
    expect(within(creatorRow).getByText(creator)).toBeTruthy();
    expect(within(assigneeRow).getByText(assignee)).toBeTruthy();
    expect(creatorRow.querySelector('[aria-hidden="true"]')).toBeTruthy();
    expect(assigneeRow.querySelector('[aria-hidden="true"]')).toBeTruthy();
    expect(creatorRow.compareDocumentPosition(assigneeRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(creatorRow.classList.contains('text-xs')).toBe(true);
    expect(card.querySelectorAll('button, a, [role="button"]')).toHaveLength(0);
    return card;
  };

  it('shows author and assignee in the same order on mine, delegated and archive cards', async () => {
    setup(); await screen.findByText('My assigned task');
    assertPeople('My assigned task', 'Creator', 'Employee');
    fireEvent.click(screen.getByRole('button', { name: 'Assigned by me' }));
    await screen.findByText('Delegated task');
    const delegated = assertPeople('Delegated task', 'Employee', 'Creator');
    fireEvent.click(within(delegated).getByText('Creator'));
    expect(mocks.detail).toHaveBeenLastCalledWith(expect.objectContaining({ open: true, taskId: 2 }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await screen.findByText('Archived task');
    assertPeople('Archived task', 'Creator', 'Employee');
  });

  it('keeps both roles for self-assignment and distinguishes missing people in the archive', async () => {
    mocks.board.mockImplementation(async (_method, url) => ({ tasks: url.includes('archived=true') ? [
      { ...task, id: 4, title: 'Unassigned archived task', creator: task.assignee, assignee: null, status: 'accepted' },
      { ...task, id: 5, title: 'Missing author archived task', creator: null, status: 'accepted' },
    ] : [{ ...task, title: 'Personal task', creator: task.assignee }] }));
    setup(); await screen.findByText('Personal task');
    const personal = assertPeople('Personal task', 'Employee', 'Employee');
    expect(within(personal).getAllByText('E')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await screen.findByText('Unassigned archived task');
    const unassigned = assertPeople('Unassigned archived task', 'Employee', 'Unassigned');
    const missing = assertPeople('Missing author archived task', 'Unknown author', 'Employee');
    expect(within(unassigned).getByTitle('Assignee: Unassigned').querySelector('svg')).toBeTruthy();
    expect(within(missing).getByTitle('Creator: Unknown author').querySelector('svg')).toBeTruthy();
  });

  it('shows real miniapp photos from the shared authenticated avatar loader', async () => {
    const { configureBoardTransport } = await import('../client/src/features/board/transport');
    configureBoardTransport({ token: () => 'test-mini-session', download: vi.fn() });
    const images: Array<EventTarget & { src: string; complete: boolean; naturalWidth: number }> = [];
    vi.stubGlobal('Image', class extends EventTarget {
      src = ''; complete = false; naturalWidth = 0;
      constructor() { super(); images.push(this); }
    });
    const NativeURL = URL;
    let imageId = 0;
    vi.stubGlobal('URL', class extends NativeURL {
      static createObjectURL = vi.fn(() => `blob:mini-photo-${++imageId}`);
      static revokeObjectURL = vi.fn();
    });
    const creatorUrl = '/api/users/photos/aaaaaaaaaaaaaaaaaaaaa';
    const assigneeUrl = '/api/users/photos/bbbbbbbbbbbbbbbbbbbbb';
    mocks.photo.mockResolvedValue(new Blob(['pixels'], { type: 'image/png' }));
    mocks.board.mockResolvedValue({ tasks: [{ ...task, creator: { ...task.creator, avatarUrl: creatorUrl }, assignee: { ...task.assignee, avatarUrl: assigneeUrl } }] });
    setup(); await screen.findByText('My assigned task');
    const card = assertPeople('My assigned task', 'Creator', 'Employee');
    await waitFor(() => expect(images).toHaveLength(2));
    act(() => {
      for (const image of images) { image.complete = true; image.naturalWidth = 80; image.dispatchEvent(new Event('load')); }
    });
    expect(card.querySelectorAll('img')).toHaveLength(2);
    for (const image of card.querySelectorAll('img')) {
      expect(image.src).toMatch(/^blob:mini-photo-/);
      expect(image.src).not.toContain('test-mini-session');
      expect(image.draggable).toBe(false);
    }
    expect(mocks.photo).toHaveBeenCalledWith(creatorUrl, expect.any(AbortSignal));
    expect(mocks.photo).toHaveBeenCalledWith(assigneeUrl, expect.any(AbortSignal));
  });

  it('shows only assigned work by default with three bottom navigation actions', async () => {
    setup(); await screen.findByText('My assigned task');
    expect(screen.queryByText('Delegated task')).toBeNull();
    expect(screen.getByRole('navigation').querySelectorAll('button')).toHaveLength(3);
    expect(screen.queryByText('Sales')).toBeNull();
  });
  it('shows a selected employee tasks and opens their detail without changing the signed-in user', async () => {
    setup();
    await screen.findByText('My assigned task');
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Show tasks of' }));
    await user.click(screen.getByRole('option', { name: 'Creator' }));
    expect(screen.getByText('Delegated task')).toBeTruthy();
    assertPeople('Delegated task', 'Employee', 'Creator');
    expect(screen.queryByText('My assigned task')).toBeNull();
    expect(screen.getByText('Total tasks: 1')).toBeTruthy();
    await user.click(screen.getByText('Delegated task'));
    expect(mocks.detail).toHaveBeenLastCalledWith(expect.objectContaining({ open: true, taskId: 2, tasksOnly: true }));
    expect(mocks.create).toHaveBeenLastCalledWith(expect.objectContaining({ currentUser: expect.objectContaining({ id: 7 }) }));
  });
  it('includes employees with no tasks, clears filters when choosing them and returns to my tasks from navigation', async () => {
    mocks.mini.mockResolvedValue([{ id: 7, fullName: 'Employee' }, { id: 9, fullName: 'No assignments' }]);
    setup();
    await screen.findByText('My assigned task');
    const filters = within(screen.getByRole('group', { name: 'Quick filters' }));
    fireEvent.click(filters.getByRole('button', { name: /Done/ }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'unmatched' } });
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Show tasks of' }));
    await user.click(screen.getByRole('option', { name: 'No assignments' }));
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
    expect(filters.getByRole('button', { name: /All statuses/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Total tasks: 0')).toBeTruthy();
    expect(screen.getByText('No tasks here yet')).toBeTruthy();
    await user.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'My tasks' }));
    await screen.findByText('My assigned task');
    expect(screen.getByRole('combobox', { name: 'Show tasks of' }).textContent).toContain('My tasks');
    expect(screen.queryByText('Delegated task')).toBeNull();
  });
  it('switches to delegated tasks and accepted archive tasks', async () => {
    setup(); await screen.findByText('My assigned task');
    fireEvent.click(screen.getByRole('button', { name: 'Assigned by me' }));
    await screen.findByText('Delegated task'); expect(screen.queryByText('My assigned task')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await screen.findByText('Archived task'); expect(screen.queryByRole('combobox')).toBeNull();
  });
  it('keeps self-assigned work in my tasks and excludes it from delegated work and its counter', async () => {
    const selfAssigned = ['backlog', 'todo', 'in_progress', 'done'].map((status, index) => ({
      ...task, id: 10 + index, title: `Personal ${status}`, creator: task.assignee, status,
    }));
    mocks.board.mockResolvedValue({ tasks: [
      task, delegatedTask, ...selfAssigned,
      { ...delegatedTask, id: 20, title: 'Unassigned task', assignee: null },
      { ...delegatedTask, id: 21, title: 'Accepted delegation', status: 'accepted' },
      { ...delegatedTask, id: 22, title: 'Another author task', creator: { id: 9, fullName: 'Other author' } },
    ] });
    setup();
    await screen.findByText('Personal done');
    for (const personal of selfAssigned) expect(screen.getByText(personal.title)).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Completed task awaiting acceptance' })).toBeNull();
    const navigation = within(screen.getByRole('navigation'));
    expect(within(navigation.getByRole('button', { name: 'My tasks' })).getByText('5')).toBeTruthy();
    const delegatedButton = navigation.getByRole('button', { name: 'Assigned by me' });
    expect(within(delegatedButton).getByText('1')).toBeTruthy();
    fireEvent.click(delegatedButton);
    await screen.findByText('Delegated task');
    for (const personal of selfAssigned) expect(screen.queryByText(personal.title)).toBeNull();
    expect(screen.queryByText('Unassigned task')).toBeNull();
    expect(screen.queryByText('Accepted delegation')).toBeNull();
    expect(screen.queryByText('Another author task')).toBeNull();
    expect(screen.getByText('Total tasks: 1')).toBeTruthy();
  });
  it('marks completed delegated cards and turns their counter red until rework or acceptance', async () => {
    const otherDelegation = { ...delegatedTask, id: 4, title: 'Another delegated task' };
    const receivedDone = { ...task, status: 'done' };
    mocks.board.mockResolvedValue({ tasks: [receivedDone, delegatedTask, otherDelegation] });
    setup();
    await screen.findByText('My assigned task');
    const delegatedButton = screen.getByRole('button', { name: 'Assigned by me' });
    const badge = () => delegatedButton.querySelector('.mini-badge')!;
    expect(badge().textContent).toBe('2');
    expect(badge().classList.contains('mini-badge-alert')).toBe(false);
    expect(screen.queryByRole('img', { name: 'Completed task awaiting acceptance' })).toBeNull();
    const updateStatus = (status: string) => act(() => {
      client.setQueryData([...boardQueryKeys.all, 'mini', false], {
        tasks: [receivedDone, { ...delegatedTask, status }, otherDelegation],
      });
    });
    updateStatus('done');
    await waitFor(() => expect(badge().classList.contains('mini-badge-alert')).toBe(true));
    expect(screen.getByRole('button', { name: 'My tasks' }).querySelector('.mini-badge-alert')).toBeNull();
    fireEvent.click(delegatedButton);
    await screen.findByText('Delegated task');
    const card = screen.getByText('Delegated task').closest('button')!;
    expect(within(card).getByRole('img', { name: 'Completed task awaiting acceptance' }).classList.contains('mini-task-completion-dot')).toBe(true);
    expect(screen.getAllByRole('img', { name: 'Completed task awaiting acceptance' })).toHaveLength(1);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Another delegated' } });
    await waitFor(() => expect(screen.queryByText('Delegated task')).toBeNull());
    expect(badge().classList.contains('mini-badge-alert')).toBe(true);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    await screen.findByText('Delegated task');
    updateStatus('in_progress');
    await waitFor(() => expect(badge().classList.contains('mini-badge-alert')).toBe(false));
    expect(screen.queryByRole('img', { name: 'Completed task awaiting acceptance' })).toBeNull();
    expect(screen.getByText('Delegated task')).toBeTruthy();
    updateStatus('done');
    await screen.findByRole('img', { name: 'Completed task awaiting acceptance' });
    updateStatus('accepted');
    await waitFor(() => expect(badge().textContent).toBe('1'));
    expect(badge().classList.contains('mini-badge-alert')).toBe(false);
    expect(screen.queryByText('Delegated task')).toBeNull();
    expect(screen.queryByRole('img', { name: 'Completed task awaiting acceptance' })).toBeNull();
  });
  it('keeps the delegation counter current while viewing the archive', async () => {
    setup();
    await screen.findByText('My assigned task');
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await screen.findByText('Archived task');
    const delegatedButton = screen.getByRole('button', { name: 'Assigned by me' });
    act(() => {
      client.setQueryData([...boardQueryKeys.all, 'mini', false], { tasks: [task, { ...delegatedTask, status: 'done' }] });
    });
    await waitFor(() => expect(delegatedButton.querySelector('.mini-badge-alert')).toBeTruthy());
    act(() => {
      client.setQueryData([...boardQueryKeys.all, 'mini', false], { tasks: [task, { ...delegatedTask, status: 'accepted' }] });
    });
    await waitFor(() => expect(delegatedButton.querySelector('.mini-badge')).toBeNull());
    expect(screen.getByText('Archived task')).toBeTruthy();
  });
  it('keeps task detail and task creation in modals, with lead navigation disabled', async () => {
    setup(); fireEvent.click(await screen.findByText('My assigned task'));
    expect(mocks.detail).toHaveBeenLastCalledWith(expect.objectContaining({ open: true, taskId: 1, tasksOnly: true }));
    const create = screen.getByRole('button', { name: 'Create task' }); await waitFor(() => expect((create as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(create); expect(mocks.create).toHaveBeenLastCalledWith(expect.objectContaining({ open: true, canAssignUsers: true, miniMode: true }));
    const onCreated = (mocks.create.mock.lastCall?.[0] as { onCreated: (task: { assigneeId: number }) => void }).onCreated;
    act(() => onCreated({ assigneeId: 8 }));
    expect(screen.getByRole('heading', { name: 'Assigned by me' })).toBeTruthy();
  });
  it('opens my tasks after creating self-assigned work', async () => {
    setup();
    await screen.findByText('My assigned task');
    fireEvent.click(screen.getByRole('button', { name: 'Assigned by me' }));
    const onCreated = (mocks.create.mock.lastCall?.[0] as { onCreated: (task: { assigneeId: number }) => void }).onCreated;
    act(() => onCreated({ assigneeId: 7 }));
    expect(screen.getByRole('combobox', { name: 'Show tasks of' }).textContent).toContain('My tasks');
    expect(screen.getByText('My assigned task')).toBeTruthy();
  });
  it('filters by text and offers a clear empty state', async () => {
    setup(); await screen.findByText('My assigned task');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'unmatched' } });
    await screen.findByText('Nothing found'); expect(screen.queryByText('My assigned task')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await screen.findByText('My assigned task');
  });
  it('puts overdue tasks first while filtering by the existing stage names', async () => {
    const late = { ...task, id: 4, title: 'Late task', dueAt: '2025-01-01T10:00:00.000Z', priority: 'urgent' };
    const complete = { ...task, id: 5, title: 'Completed task', status: 'done' };
    mocks.board.mockResolvedValue({ tasks: [task, complete, late] });
    setup(); await screen.findByText('Late task');
    expect(screen.getByRole('heading', { name: /Overdue tasks/ })).toBeTruthy();
    const filters = within(screen.getByRole('group', { name: 'Quick filters' }));
    fireEvent.click(filters.getByRole('button', { name: /To do/ }));
    expect(screen.getByText('Late task')).toBeTruthy();
    expect(screen.getByText('My assigned task')).toBeTruthy();
    expect(screen.queryByText('Completed task')).toBeNull();
    fireEvent.click(filters.getByRole('button', { name: /Done/ }));
    expect(screen.getByText('Completed task')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Assigned by me' }));
    expect(screen.getByText('All statuses')).toBeTruthy();
  });
  it('keeps the Russian stage and section names', async () => {
    i18n.setLanguage('ru');
    mocks.board.mockResolvedValue({ tasks: [{ ...task, status: 'done' }] });
    setup(); await screen.findByText('My assigned task');
    expect(screen.getByRole('button', { name: 'Порученные' })).toBeTruthy();
    expect(screen.getAllByText('Выполнено').length).toBeGreaterThan(0);
    expect(screen.queryByText('Готово')).toBeNull();
    expect(screen.queryByText('Ждут приёмки')).toBeNull();
  });
});
