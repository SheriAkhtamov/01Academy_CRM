// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SystemManagementPage from '../client/src/pages/admin/SystemManagementPage';
import { i18n } from '../client/src/lib/i18n';

const mocks = vi.hoisted(() => ({
  sendEmployeeBroadcast: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../client/src/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 7, fullName: 'Sherzod Akhtamov' } }),
}));
vi.mock('../client/src/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock('../client/src/features/employee-broadcast/api', () => ({
  sendEmployeeBroadcast: mocks.sendEmployeeBroadcast,
}));

const renderBroadcast = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { queryFn: async () => [], retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(['/api/users'], [
    { id: 7, fullName: 'Sherzod Akhtamov', module: 'administration', isActive: true, isArchived: false },
    { id: 8, fullName: 'First Employee', module: 'sales', isActive: true, isArchived: false },
    { id: 9, fullName: 'Inactive Employee', module: 'sales', isActive: false, isArchived: false },
    { id: 10, fullName: 'Archived Employee', module: 'sales', isActive: true, isArchived: true },
  ]);
  render(
    <QueryClientProvider client={queryClient}>
      <SystemManagementPage section="employee-notifications" />
    </QueryClientProvider>,
  );
  return { invalidateQueries: vi.spyOn(queryClient, 'invalidateQueries') };
};

describe('employee broadcast recipient selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    i18n.setLanguage('en');
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
});
