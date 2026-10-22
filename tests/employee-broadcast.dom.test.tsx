// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SystemManagementPage from '../client/src/pages/admin/SystemManagementPage';
import { i18n } from '../client/src/lib/i18n';

const mocks = vi.hoisted(() => ({
  sendEmployeeBroadcast: vi.fn(),
  listBroadcastEmployees: vi.fn(),
  actor: { id: 7, fullName: 'Sherzod Akhtamov' },
  toast: vi.fn(),
}));

vi.mock('../client/src/hooks/useAuth', () => ({
  useAuth: () => ({ user: mocks.actor }),
}));
vi.mock('../client/src/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock('../client/src/features/employee-broadcast/api', () => ({
  sendEmployeeBroadcast: mocks.sendEmployeeBroadcast,
  listBroadcastEmployees: mocks.listBroadcastEmployees,
}));

const broadcastEmployees = [
  { id: 7, fullName: 'Sherzod Akhtamov', module: 'administration', isActive: true, isArchived: false },
  { id: 8, fullName: 'First Employee', module: 'sales', isActive: true, isArchived: false },
  { id: 9, fullName: 'Inactive Employee', module: 'sales', isActive: false, isArchived: false },
  { id: 10, fullName: 'Archived Employee', module: 'sales', isActive: true, isArchived: true },
];

const renderBroadcast = (seedCache = true) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { queryFn: async () => [], retry: false, staleTime: Infinity } },
  });
  if (seedCache) queryClient.setQueryData(['/api/users'], broadcastEmployees);
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SystemManagementPage section="employee-notifications" />
    </QueryClientProvider>,
  );
  return { queryClient, ...view, invalidateQueries: vi.spyOn(queryClient, 'invalidateQueries') };
};

describe('employee broadcast recipient selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listBroadcastEmployees.mockReset();
    i18n.setLanguage('en');
    mocks.actor = { id: 7, fullName: 'Sherzod Akhtamov' };
    mocks.sendEmployeeBroadcast.mockImplementation(async (broadcast) => ({
      channel: broadcast.channel,
      sentCount: broadcast.recipientIds.length,
    }));
  });

  afterEach(cleanup);

  it('sends a system notification to the current administrator and refreshes their notification list', async () => {
    const user = userEvent.setup();
    const { invalidateQueries } = renderBroadcast();

    expect(screen.queryByRole('checkbox', { name: 'Select Inactive Employee' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Select Archived Employee' })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Select Sherzod Akhtamov' }));
    await user.click(screen.getByRole('button', { name: 'Compose message' }));

    const dialog = within(screen.getByRole('dialog', { name: 'New system notification' }));
    await user.type(dialog.getByRole('textbox', { name: 'Notification title' }), 'Schedule update');
    await user.type(dialog.getByRole('textbox', { name: 'Message' }), 'Tomorrow starts at 10:00.');
    await user.click(dialog.getByRole('button', { name: 'Send to 1' }));

    await waitFor(() => expect(mocks.sendEmployeeBroadcast.mock.calls[0]?.[0]).toEqual({
      channel: 'notification',
      recipientIds: [7],
      title: 'Schedule update',
      content: 'Tomorrow starts at 10:00.',
    }));
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['/api/notifications'] }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('removes the current administrator when switching a selected broadcast to direct messages', async () => {
    const user = userEvent.setup();
    renderBroadcast();

    await user.click(screen.getByRole('checkbox', { name: 'Select all found employees' }));
    expect(screen.getByText('Employees selected: 2')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^Direct message/ }));
    expect(screen.queryByRole('checkbox', { name: 'Select Sherzod Akhtamov' })).toBeNull();
    expect(screen.getByText('Employees selected: 1')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Compose message' }));

    const dialog = within(screen.getByRole('dialog', { name: 'New direct message' }));
    await user.type(dialog.getByRole('textbox', { name: 'Message' }), 'Please check the schedule.');
    await user.click(dialog.getByRole('button', { name: 'Send to 1' }));

    await waitFor(() => expect(mocks.sendEmployeeBroadcast.mock.calls[0]?.[0]).toEqual({
      channel: 'message',
      recipientIds: [8],
      content: 'Please check the schedule.',
    }));
  });

  it('focuses missing fields and protects a draft through keep editing and confirmed discard', async () => {
    const user = userEvent.setup();
    renderBroadcast();
    await user.click(screen.getByRole('checkbox', { name: 'Select First Employee' }));
    await user.click(screen.getByRole('button', { name: 'Compose message' }));
    let dialog = screen.getByRole('dialog', { name: 'New system notification' });
    await user.click(within(dialog).getByRole('button', { name: 'Send to 1' }));
    const title = within(dialog).getByRole('textbox', { name: 'Notification title' });
    expect(document.activeElement).toBe(title);
    expect(title.getAttribute('aria-invalid')).toBe('true');
    await user.type(title, 'Schedule');
    await user.click(within(dialog).getByRole('button', { name: 'Send to 1' }));
    const content = within(dialog).getByRole('textbox', { name: 'Message' });
    expect(document.activeElement).toBe(content);
    await user.type(content, 'Keep this draft');
    await user.keyboard('{Escape}');
    let confirmation = screen.getByRole('alertdialog', { name: i18n.t('unsavedChangesTitle') });
    await user.click(within(confirmation).getByRole('button', { name: i18n.t('keepEditing') }));
    expect((content as HTMLTextAreaElement).value).toBe('Keep this draft');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    confirmation = screen.getByRole('alertdialog', { name: i18n.t('unsavedChangesTitle') });
    await user.click(within(confirmation).getByRole('button', { name: i18n.t('discardChanges') }));
    await user.click(screen.getByRole('button', { name: 'Compose message' }));
    dialog = screen.getByRole('dialog', { name: 'New system notification' });
    expect((within(dialog).getByRole('textbox', { name: 'Notification title' }) as HTMLInputElement).value).toBe('');
    expect((within(dialog).getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).value).toBe('');
    expect(mocks.sendEmployeeBroadcast).not.toHaveBeenCalled();
  });

  it('locks a pending send, reports a friendly failure and retries the unchanged message once', async () => {
    let reject!: (failure: Error) => void;
    mocks.sendEmployeeBroadcast.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const user = userEvent.setup();
    renderBroadcast();
    await user.click(screen.getByRole('checkbox', { name: 'Select First Employee' }));
    await user.click(screen.getByRole('button', { name: 'Compose message' }));
    const dialog = screen.getByRole('dialog', { name: 'New system notification' });
    const title = within(dialog).getByRole('textbox', { name: 'Notification title' });
    const content = within(dialog).getByRole('textbox', { name: 'Message' });
    await user.type(title, 'Schedule');
    await user.type(content, 'Draft text');
    const form = within(dialog).getByRole('button', { name: 'Send to 1' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(mocks.sendEmployeeBroadcast).toHaveBeenCalledTimes(1));
    expect((title as HTMLInputElement).disabled).toBe(true);
    expect((content as HTMLTextAreaElement).disabled).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'New system notification' })).toBeTruthy();
    await act(async () => { reject(new Error('SQL broadcast_id=951 internal failure')); });
    expect((await within(dialog).findByRole('alert')).textContent).toBe(i18n.t('employeeBroadcastFailedTitle'));
    expect(document.body.textContent).not.toContain('broadcast_id');
    expect((content as HTMLTextAreaElement).value).toBe('Draft text');
    expect((content as HTMLTextAreaElement).disabled).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Send to 1' }));
    await waitFor(() => expect(mocks.sendEmployeeBroadcast).toHaveBeenCalledTimes(2));
    expect(mocks.sendEmployeeBroadcast.mock.calls[1][0]).toEqual(mocks.sendEmployeeBroadcast.mock.calls[0][0]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it.each([403, 404])('hides cached recipients and the draft through a deferred retry after %s', async (status) => {
    const user = userEvent.setup();
    const { queryClient } = renderBroadcast();
    const authorizedEmployees = queryClient.getQueryData(['/api/users']);
    await user.click(screen.getByRole('checkbox', { name: 'Select First Employee' }));
    await user.click(screen.getByRole('button', { name: 'Compose message' }));
    await user.type(screen.getByRole('textbox', { name: 'Notification title' }), 'Private draft');
    mocks.listBroadcastEmployees.mockRejectedValueOnce(Object.assign(new Error('Internal access policy'), { status }));
    await act(async () => { await queryClient.refetchQueries({ queryKey: ['/api/users'] }); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Select First Employee' })).toBeNull();
    let finish!: (result: unknown) => void;
    mocks.listBroadcastEmployees.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await user.click(screen.getByRole('button', { name: i18n.t('retry') }));
    await waitFor(() => expect(mocks.listBroadcastEmployees).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('checkbox', { name: 'Select First Employee' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Compose message' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { finish(authorizedEmployees); });
    expect(await screen.findByRole('checkbox', { name: 'Select First Employee' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Select First Employee' }));
    await user.click(screen.getByRole('button', { name: 'Compose message' }));
    expect((screen.getByRole('textbox', { name: 'Notification title' }) as HTMLInputElement).value).toBe('');
  });

  it('does not close a new administrator composer or show an old send result after the actor changes', async () => {
    const user = userEvent.setup();
    let finish!: (result: { channel: 'notification'; sentCount: number }) => void;
    mocks.sendEmployeeBroadcast.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { queryClient, rerender } = renderBroadcast();
    mocks.listBroadcastEmployees.mockResolvedValue(queryClient.getQueryData(['/api/users']));
    await user.click(screen.getByRole('checkbox', { name: 'Select First Employee' }));
    await user.click(screen.getByRole('button', { name: 'Compose message' }));
    let dialog = screen.getByRole('dialog', { name: 'New system notification' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Notification title' }), 'Old actor title');
    await user.type(within(dialog).getByRole('textbox', { name: 'Message' }), 'Old actor message');
    await user.click(within(dialog).getByRole('button', { name: 'Send to 1' }));
    await waitFor(() => expect(mocks.sendEmployeeBroadcast).toHaveBeenCalledTimes(1));
    mocks.actor = { id: 11, fullName: 'Next Administrator' };
    rerender(<QueryClientProvider client={queryClient}><SystemManagementPage section="employee-notifications" /></QueryClientProvider>);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(await screen.findByRole('checkbox', { name: 'Select First Employee' }));
    await user.click(screen.getByRole('button', { name: 'Compose message' }));
    dialog = screen.getByRole('dialog', { name: 'New system notification' });
    await act(async () => { finish({ channel: 'notification', sentCount: 1 }); });
    await waitFor(() => expect((within(dialog).getByRole('textbox', { name: 'Notification title' }) as HTMLInputElement).disabled).toBe(false));
    expect(screen.getByRole('dialog', { name: 'New system notification' })).toBeTruthy();
    expect((within(dialog).getByRole('textbox', { name: 'Notification title' }) as HTMLInputElement).value).toBe('');
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('keeps the recipient selection and open draft when refreshing employees fails temporarily', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderBroadcast();
    await user.click(screen.getByRole('checkbox', { name: 'Select First Employee' }));
    await user.click(screen.getByRole('button', { name: 'Compose message' }));
    const dialog = screen.getByRole('dialog', { name: 'New system notification' });
    const title = within(dialog).getByRole('textbox', { name: 'Notification title' });
    await user.type(title, 'Preserve me');
    mocks.listBroadcastEmployees.mockRejectedValueOnce(Object.assign(new Error('Database failed'), { status: 500 }));
    await act(async () => { await queryClient.refetchQueries({ queryKey: ['/api/users'] }); });
    expect(screen.getByRole('dialog', { name: 'New system notification' })).toBeTruthy();
    expect((title as HTMLInputElement).value).toBe('Preserve me');
    expect((within(dialog).getByRole('button', { name: 'Send to 1' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each([
    { status: 403, seedCache: true },
    { status: 404, seedCache: true },
    { status: 403, seedCache: false },
    { status: 404, seedCache: false },
  ])('ignores the previous actor late $status GET after a fresh authorized session (cached: $seedCache)', async ({ status, seedCache }) => {
    const user = userEvent.setup();
    let rejectPrevious!: (failure: Error) => void;
    mocks.listBroadcastEmployees.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectPrevious = reject; }));
    const { queryClient, rerender } = renderBroadcast(seedCache);
    if (seedCache) {
      act(() => { void queryClient.refetchQueries({ queryKey: ['/api/users'] }); });
    }
    await waitFor(() => expect(mocks.listBroadcastEmployees).toHaveBeenCalledTimes(1));
    mocks.listBroadcastEmployees.mockResolvedValueOnce(broadcastEmployees);
    mocks.actor = { id: 11, fullName: 'Next Administrator' };
    rerender(<QueryClientProvider client={queryClient}><SystemManagementPage section="employee-notifications" /></QueryClientProvider>);
    // The new actor must start their own request even while a shared-key GET is pending.
    await waitFor(() => expect(mocks.listBroadcastEmployees).toHaveBeenCalledTimes(2));
    await user.click(await screen.findByRole('checkbox', { name: 'Select First Employee' }));
    await user.click(screen.getByRole('button', { name: 'Compose message' }));
    const dialog = screen.getByRole('dialog', { name: 'New system notification' });
    const title = within(dialog).getByRole('textbox', { name: 'Notification title' });
    const content = within(dialog).getByRole('textbox', { name: 'Message' });
    await user.type(title, 'New administrator title');
    await user.type(content, 'New administrator draft');
    await act(async () => {
      rejectPrevious(Object.assign(new Error('Previous actor access denied'), { status }));
    });
    expect(screen.getByRole('dialog', { name: 'New system notification' })).toBe(dialog);
    expect((title as HTMLInputElement).value).toBe('New administrator title');
    expect((content as HTMLTextAreaElement).value).toBe('New administrator draft');
    expect((within(dialog).getByRole('button', { name: 'Send to 1' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(mocks.sendEmployeeBroadcast).not.toHaveBeenCalled();
  });
});
