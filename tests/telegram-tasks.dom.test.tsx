// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../client/src/components/ui/tooltip';
import { i18n } from '../client/src/lib/i18n';
import { TasksApp } from '../client/src/miniapp/TasksApp';
const mocks = vi.hoisted(() => ({ board: vi.fn(), mini: vi.fn(), detail: vi.fn(), create: vi.fn() }));
vi.mock('../client/src/features/board/transport', () => ({ boardRequest: mocks.board }));
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
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks(); i18n.setLanguage('en');
  mocks.board.mockImplementation(async (_method, url) => ({ tasks: url.includes('archived=true') ? [{ ...task, id: 3, title: 'Archived task', status: 'accepted' }] : [task, { ...task, id: 2, title: 'Delegated task', creator: task.assignee, assignee: task.creator }] }));
  mocks.mini.mockResolvedValue([{ id: 7, fullName: 'Employee' }]);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); });
const setup = () => render(<QueryClientProvider client={client}><TooltipProvider><TasksApp /></TooltipProvider></QueryClientProvider>);
describe('Mobile tasks interface', () => {
  it('shows only assigned work by default with three bottom navigation actions', async () => {
    setup(); await screen.findByText('My assigned task');
    expect(screen.queryByText('Delegated task')).toBeNull();
    expect(screen.getByRole('navigation').querySelectorAll('button')).toHaveLength(3);
    expect(screen.queryByText('Sales')).toBeNull();
  });
  it('switches to delegated tasks and accepted archive tasks', async () => {
    setup(); await screen.findByText('My assigned task');
    fireEvent.click(screen.getByRole('button', { name: 'Assigned by me' }));
    await screen.findByText('Delegated task'); expect(screen.queryByText('My assigned task')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await screen.findByText('Archived task'); expect(screen.queryByRole('combobox')).toBeNull();
  });
  it('keeps task detail and task creation in modals, with lead navigation disabled', async () => {
    setup(); fireEvent.click(await screen.findByText('My assigned task'));
    expect(mocks.detail).toHaveBeenLastCalledWith(expect.objectContaining({ open: true, taskId: 1, tasksOnly: true }));
    const create = screen.getByRole('button', { name: 'Create task' }); await waitFor(() => expect((create as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(create); expect(mocks.create).toHaveBeenLastCalledWith(expect.objectContaining({ open: true, canAssignUsers: true }));
    const onCreated = (mocks.create.mock.lastCall?.[0] as { onCreated: () => void }).onCreated;
    act(() => onCreated());
    expect(screen.getByRole('heading', { name: 'Assigned by me' })).toBeTruthy();
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
