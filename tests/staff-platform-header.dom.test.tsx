// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Header from '../client/src/components/Header';
import { ThemeProvider } from '../client/src/components/ux/ThemeProvider';
import { conversationQueryOptions } from '../client/src/features/messages/api';
import { chatGroupQueryOptions } from '../client/src/features/messages/chat-groups-api';
import { i18n } from '../client/src/lib/i18n';

const mocks = vi.hoisted(() => ({ logout: vi.fn() }));
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, fullName: 'Staff employee', email: 'staff@example.test', module: 'sales' }, logout: mocks.logout }) }));
vi.mock('../client/src/hooks/useAccounts', () => ({ useAccounts: () => ({ accounts: [], switchToAccount: vi.fn(), removeAccount: vi.fn(), isSwitching: false, isRemoving: false }) }));
vi.mock('../client/src/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../client/src/components/ux/NotificationsMenu', () => ({ NotificationsMenu: () => <button>Staff notifications</button> }));
vi.mock('../client/src/components/ux/ChatSheet', () => ({ default: ({ open }: { open: boolean }) => open ? <div role="dialog" aria-label="Staff chat" /> : null }));
vi.mock('../client/src/components/ux/CommandPalette', () => ({ CommandPalette: ({ open }: { open: boolean }) => open ? <div role="dialog" aria-label="Staff search" /> : null }));
vi.mock('../client/src/components/modals/SettingsModal', () => ({ default: ({ open }: { open: boolean }) => open ? <div role="dialog" aria-label="Staff settings" /> : null }));
vi.mock('../client/src/components/modals/AddAccountModal', () => ({ default: () => null }));

let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  i18n.setLanguage('en');
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  history.replaceState(null, '', '/sales');
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(conversationQueryOptions.queryKey, [{ id: 2, unreadCount: 4 }, { id: 3, unreadCount: 7 }]);
  client.setQueryData(chatGroupQueryOptions.queryKey, [{ id: 8, unreadCount: 9 }]);
});
afterEach(() => { cleanup(); client.clear(); localStorage.clear(); vi.unstubAllGlobals(); });
function mount() {
  return render(<QueryClientProvider client={client}><ThemeProvider defaultTheme="light"><Header /></ThemeProvider></QueryClientProvider>);
}

it.each([0, 1])('opens the staff command palette from shared search control %s', async (index) => {
  mount();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(i18n.t('salesModule'));
  await userEvent.click(screen.getAllByRole('button', { name: i18n.t('search') })[index]);
  expect(screen.getByRole('dialog', { name: 'Staff search' })).toBeTruthy();
});

it('sums direct and group unread counts and opens the staff chat from the shared header', async () => {
  mount();
  const label = i18n.t('unreadMessageCount').replace('{count}', '20');
  await userEvent.click(screen.getByRole('button', { name: label }));
  expect(screen.getByRole('dialog', { name: 'Staff chat' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Staff notifications' })).toBeTruthy();
});

it('opens staff settings through the shared account slot', async () => {
  mount();
  await userEvent.click(screen.getByRole('button', { name: i18n.t('currentAccount') }));
  expect(screen.getByText('Staff employee')).toBeTruthy();
  await userEvent.click(screen.getByRole('menuitem', { name: i18n.t('settings') }));
  expect(screen.getByRole('dialog', { name: 'Staff settings' })).toBeTruthy();
});

it('keeps the staff logout handler in the account adapter', async () => {
  mount();
  await userEvent.click(screen.getByRole('button', { name: i18n.t('currentAccount') }));
  await userEvent.click(screen.getByRole('menuitem', { name: i18n.t('logout') }));
  expect(mocks.logout).toHaveBeenCalledOnce();
});
