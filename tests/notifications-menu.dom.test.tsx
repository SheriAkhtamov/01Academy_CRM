// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { NotificationsMenu } from '../client/src/components/ux/NotificationsMenu';
import { i18n } from '../client/src/lib/i18n';

const toast = vi.hoisted(() => vi.fn());
vi.mock('../client/src/hooks/use-toast', () => ({ toast }));
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, module: 'sales', modules: ['sales'] } }) }));

let client: QueryClient;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});
beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
});
beforeEach(() => {
  i18n.setLanguage('ru'); toast.mockClear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); });
const mount = () => render(<QueryClientProvider client={client}><NotificationsMenu /></QueryClientProvider>);
const unreadLabel = () => i18n.t('unreadNotificationCount').replace('{count}', '3');

it('places matching compact header actions together, protects pending read-all and updates the count', async () => {
  let finishRead: (value: Response) => void = () => undefined;
  let read = false;
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (url === '/api/notifications/read-all') {
      await new Promise<Response>((resolve) => { finishRead = resolve; });
      read = true; return response({ success: true });
    }
    if (url === '/api/notifications/unread-count') return response({ count: read ? 0 : 3 });
    return response({ items: [{ id: 1, title: 'Notice', message: null, isRead: read }], total: 1, nextOffset: null });
  });
  mount();
  await userEvent.click(await screen.findByRole('button', { name: unreadLabel() }));
  await screen.findByText('Notice');
  const readAll = screen.getByRole('menuitem', { name: i18n.t('markAllRead') });
  const clear = screen.getByRole('menuitem', { name: i18n.t('clearNotifications') });
  expect(readAll.parentElement).toBe(clear.parentElement);
  expect(readAll.tagName).toBe('BUTTON');
  expect(clear.tagName).toBe('BUTTON');
  expect(readAll.className).toBe(clear.className);
  expect(readAll.textContent).toBe(i18n.t('markAllReadAction'));
  expect(screen.getAllByRole('menuitem', { name: i18n.t('markAllRead') })).toHaveLength(1);
  await userEvent.click(readAll);
  await waitFor(() => expect(readAll.hasAttribute('disabled')).toBe(true));
  expect(clear.hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: i18n.t('notifications') })).toBeTruthy();
  await userEvent.click(readAll);
  expect(fetch.mock.calls.filter(([url]) => url === '/api/notifications/read-all')).toHaveLength(1);
  finishRead(response({ success: true }));
  await waitFor(() => expect(screen.queryByRole('menuitem', { name: i18n.t('markAllRead') })).toBeNull());
  expect(screen.getByText('Notice')).toBeTruthy();
});

it('restores unread state and keeps read-all available after a failed mutation', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (url === '/api/notifications/read-all') return response({ error: 'updateFailed' }, 500);
    if (url === '/api/notifications/unread-count') return response({ count: 3 });
    return response({ items: [{ id: 1, title: 'Notice', message: null, isRead: false }], total: 1, nextOffset: null });
  });
  mount();
  await userEvent.click(await screen.findByRole('button', { name: unreadLabel() }));
  await screen.findByText('Notice');
  await userEvent.click(screen.getByRole('menuitem', { name: i18n.t('markAllRead') }));
  await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })));
  expect(await screen.findByRole('button', { name: unreadLabel() })).toBeTruthy();
  const retryAction = screen.getByRole('menuitem', { name: i18n.t('markAllRead') });
  expect(retryAction.hasAttribute('disabled')).toBe(false);
  expect(screen.getByText('Notice').closest('div')?.className).not.toContain('opacity-60');
});

it('reaches both header actions with arrow keys and activates read-all and Clear with Enter', async () => {
  i18n.setLanguage('en');
  let read = false;
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (url === '/api/notifications/read-all') { read = true; return response({ success: true }); }
    if (url === '/api/notifications/unread-count') return response({ count: read ? 0 : 3 });
    return response({ items: [{ id: 1, title: 'Notice', message: null, isRead: read }], total: 1, nextOffset: null });
  });
  const user = userEvent.setup(); mount();
  await screen.findByRole('button', { name: unreadLabel() });
  await user.tab();
  await user.keyboard('{Enter}');
  await screen.findByText('Notice');
  const readAll = screen.getByRole('menuitem', { name: i18n.t('markAllRead') });
  const clear = screen.getByRole('menuitem', { name: i18n.t('clearNotifications') });
  await waitFor(() => expect(document.activeElement).toBe(readAll));
  await user.keyboard('{ArrowDown}');
  await waitFor(() => expect(document.activeElement).toBe(clear));
  await user.keyboard('{ArrowUp}');
  await waitFor(() => expect(document.activeElement).toBe(readAll));
  await user.keyboard('cle');
  await waitFor(() => expect(document.activeElement).toBe(clear));
  await user.keyboard('{ArrowUp}{Enter}');
  await waitFor(() => expect(fetch.mock.calls.filter(([url]) => url === '/api/notifications/read-all')).toHaveLength(1));
  expect(screen.getByRole('menu')).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole('menuitem', { name: i18n.t('markAllRead') })).toBeNull());
  await user.keyboard('{Escape}');
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: i18n.t('notifications') })));
  await user.keyboard('{Enter}');
  const clearAfterRead = screen.getByRole('menuitem', { name: i18n.t('clearNotifications') });
  await waitFor(() => expect(document.activeElement).toBe(clearAfterRead));
  await user.keyboard('{Enter}');
  const dialog = await screen.findByRole('alertdialog', { name: i18n.t('clearNotifications') });
  expect(within(dialog).getByRole('button', { name: i18n.t('clearNotificationsAction') })).toBeTruthy();
  expect(fetch.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false);
});
