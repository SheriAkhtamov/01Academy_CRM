// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SalesDashboard from '../client/src/pages/sales-dashboard';
import { TooltipProvider } from '../client/src/components/ui/tooltip';
import { i18n } from '../client/src/lib/i18n';
import { salesQueryKeys } from '../client/src/features/sales/queries';

const onlinePbxCall = vi.hoisted(() => ({ startCall: vi.fn(), isPending: false, pendingPhone: null }));
vi.mock('../client/src/hooks/useOnlinePbxCall', () => ({ useOnlinePbxCall: () => onlinePbxCall }));
vi.mock('../client/src/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 7, fullName: 'Manager', module: 'sales' } }),
}));

Element.prototype.hasPointerCapture = () => false;
Element.prototype.setPointerCapture = () => undefined;
Element.prototype.releasePointerCapture = () => undefined;

const phones = ['+998901234567', '+998901234568', '+998901234569'];
let queryClient: QueryClient;

beforeEach(() => {
  i18n.setLanguage('ru');
  window.history.replaceState(null, '', '/sales/pipeline');
  window.localStorage.clear();
  onlinePbxCall.startCall.mockClear();
  onlinePbxCall.isPending = false;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  queryClient = new QueryClient({ defaultOptions: { queries: {
    retry: false, queryFn: async () => [], staleTime: Infinity,
  } } });
  queryClient.setQueryData(['/api/academy/sales-funnels'], [
    { id: 1, name: 'Main funnel', isActive: true, isDefault: true, workflowRole: 'hunter' },
  ]);
});
afterEach(() => { cleanup(); queryClient.clear(); vi.restoreAllMocks(); });

async function openCallMenu(phoneNumbers = phones) {
  queryClient.setQueryData(salesQueryKeys.module, {
    leads: [{ id: 15, contactName: 'Pipeline parent', statusCode: 'new_request', funnelId: 1,
      managerId: 7, phoneNumbers, createdAt: '2026-10-01T08:00:00Z' }],
    statuses: [{ code: 'new_request', funnelId: 1, name: 'New request', color: '#2563eb', sortOrder: 1 }],
  });
  render(<QueryClientProvider client={queryClient}>
    <TooltipProvider><SalesDashboard section="pipeline" /></TooltipProvider>
  </QueryClientProvider>);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: i18n.t('actions') }));
  await user.click(screen.getByRole('menuitem', { name: i18n.t('call') }));
  return user;
}

describe('calling from the sales pipeline card', () => {
  it('offers every saved number and calls the third number only after selection', async () => {
    const user = await openCallMenu();
    const dialog = screen.getByRole('dialog', { name: i18n.t('chooseLeadCallPhone') });
    expect(within(dialog).getByText('Pipeline parent')).toBeTruthy();
    phones.forEach((phone) => expect(within(dialog).getByRole('button', { name: phone })).toBeTruthy());
    expect(onlinePbxCall.startCall).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Pipeline parent' })).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: phones[2] }));
    expect(onlinePbxCall.startCall).toHaveBeenCalledExactlyOnceWith(phones[2]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cancels without starting a call', async () => {
    const user = await openCallMenu();
    await user.click(within(screen.getByRole('dialog', { name: i18n.t('chooseLeadCallPhone') }))
      .getByRole('button', { name: i18n.t('cancel') }));
    expect(onlinePbxCall.startCall).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('calls a single saved number immediately', async () => {
    await openCallMenu([phones[0]]);
    expect(onlinePbxCall.startCall).toHaveBeenCalledExactlyOnceWith(phones[0]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ignores a new call request while another number is being dialled', async () => {
    onlinePbxCall.isPending = true;
    await openCallMenu();
    expect(onlinePbxCall.startCall).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
