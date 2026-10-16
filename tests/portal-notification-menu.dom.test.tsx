// @vitest-environment jsdom
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation, useSearch } from 'wouter';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PortalSessionDto } from '../shared/contracts/portal-identity';
import type { PortalNotificationDto } from '../shared/contracts/portal-resources';
import { PortalNotificationCenter } from '../client/src/features/portal-app/PortalNotificationCenter';
import { createPortalQueryClient } from '../client/src/features/portal-app/PortalApp';
import { PortalSessionProvider, portalGrantFingerprint, portalSessionKey, usePortal } from '../client/src/features/portal-app/context';
import { i18n } from '../client/src/lib/i18n';
import { setActivePlatformRealm } from '../client/src/lib/platformSession';

vi.mock('../client/src/features/portal-app/realtime', () => ({ usePortalRealtime: vi.fn() }));
const toasts = vi.hoisted(() => vi.fn());
vi.mock('../client/src/hooks/use-toast', () => ({ toast: toasts }));
const session: PortalSessionDto = {
  account: { id: 50, fullName: 'Learner', login: 'learner', email: null, phone: null, locale: 'en', status: 'active' },
  csrfToken: 'bell-token',
  subjects: [{ linkId: 10, studentId: 20, studentName: 'Learner', kind: 'self', relationship: null, status: 'active', studentClassification: 'adult', permissions: ['learning.read'] }],
};
function notice(id: number, title: string, linkId = 10): PortalNotificationDto {
  return { id, linkId, category: 'learning', code: 'portalNoticeAssignmentPublished', params: { title }, href: `/learn/assignments/${id}`, readAt: null, createdAt: '2026-10-16T10:00:00Z' };
}
let client: QueryClient;
let activeSession: PortalSessionDto;
let notices: Record<number, PortalNotificationDto[]>;
let requests: { path: string; method: string; accountId: number; search: string }[];
let pageSize: number;
let pageError: number;
let finishClear: (() => void) | null;
let pendingClear: Promise<void> | null;
let finishList: (() => void) | null;
let pendingList: Promise<void> | null;
let waitingList: number;
let abortedList: number;
let removeError: number;
let pendingRemove: Promise<void> | null;
let finishRemove: (() => void) | null;
function Probe() {
  const [path] = useLocation();
  const search = useSearch();
  const { setUnsaved } = usePortal();
  const [draft, setDraft] = useState('Unsent work');
  return <><PortalNotificationCenter navigationKey={`${path}?${search}`} />
    <label>Workspace<input value={draft} onChange={(event) => { setDraft(event.target.value); setUnsaved(true); }} /></label>
    <p data-testid="route">{path}</p></>;
}
function mount(value = session, path = '/student-module') {
  activeSession = value;
  history.replaceState(null, '', path);
  client.setQueryData(portalSessionKey, value);
  return render(<QueryClientProvider client={client}><PortalSessionProvider><Probe /></PortalSessionProvider></QueryClientProvider>);
}
const unreadLabel = (count: number) => i18n.t('unreadNotificationCount').replace('{count}', String(count));
async function open(count = 1) {
  await userEvent.click(await screen.findByRole('button', { name: unreadLabel(count) }));
  await screen.findByRole('menu');
}
const mutations = () => requests.filter((request) => request.method !== 'GET');
const noStaffApi = () => expect(requests.filter((request) => !request.path.startsWith('/api/portal/'))).toEqual([]);
beforeEach(() => {
  i18n.setLanguage('en'); localStorage.clear(); sessionStorage.clear(); toasts.mockClear();
  setActivePlatformRealm('portal');
  activeSession = session; notices = { 50: [notice(3, 'Practice')] };
  requests = []; pageSize = 30; pageError = 0; finishClear = null; pendingClear = null;
  finishList = null; pendingList = null; waitingList = 0; abortedList = 0;
  removeError = 0; pendingRemove = null; finishRemove = null;
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn(); Element.prototype.releasePointerCapture = vi.fn(); Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    const accountId = activeSession.account!.id;
    requests.push({ path: url.pathname, method, accountId, search: url.search });
    let body: unknown = { success: true };
    let status = 200;
    if (url.pathname === '/api/portal/auth/session') body = activeSession;
    else if (url.pathname === '/api/portal/notifications' && method === 'GET') {
      if (pendingList) {
        waitingList += 1;
        init?.signal?.addEventListener('abort', () => { abortedList += 1; });
        await pendingList;
      }
      status = pageError || 200;
      const rows = notices[accountId] ?? [];
      const cursor = Number(url.searchParams.get('cursor'));
      const start = cursor ? rows.findIndex((item) => item.id === cursor) + 1 : 0;
      const items = rows.slice(start, start + pageSize);
      const nextCursor = start + items.length < rows.length ? items.at(-1)!.id : null;
      body = pageError ? { code: 'portalUnavailable' } : { items, nextCursor, hasMore: nextCursor !== null, unreadCount: rows.filter((item) => !item.readAt).length };
    } else if (url.pathname === '/api/portal/notifications/read-all') {
      notices[accountId] = notices[accountId].map((item) => ({ ...item, readAt: 'now' }));
    } else if (url.pathname.endsWith('/read')) {
      const id = Number(url.pathname.split('/').at(-2));
      notices[accountId] = notices[accountId].map((item) => item.id === id ? { ...item, readAt: 'now' } : item);
    } else if (url.pathname === '/api/portal/notifications' && method === 'DELETE') {
      const deletedCount = notices[accountId].length; notices[accountId] = [];
      if (pendingClear) await pendingClear;
      body = { success: true, deletedCount };
    } else if (method === 'DELETE') {
      if (pendingRemove) await pendingRemove;
      if (removeError) { status = removeError; body = { code: 'portalUnavailable' }; }
      else {
        const id = Number(url.pathname.split('/').at(-1));
        notices[accountId] = notices[accountId].filter((item) => item.id !== id); body = { success: true, deletedCount: 1 };
      }
    } else { status = 404; body = { code: 'portalNotFound' }; }
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });

it('opens the CRM dropdown with the same compact actions and marks all read without a Sheet', async () => {
  mount(); await open();
  await screen.findByText('New assignment: Practice');
  expect(screen.queryByRole('dialog')).toBeNull();
  const read = screen.getByRole('menuitem', { name: i18n.t('markAllRead') });
  const clear = screen.getByRole('menuitem', { name: i18n.t('clearNotifications') });
  expect(read.parentElement).toBe(clear.parentElement);
  expect(read.className).toBe(clear.className);
  await userEvent.click(read);
  await waitFor(() => expect(screen.queryByRole('menuitem', { name: i18n.t('markAllRead') })).toBeNull());
  expect(screen.getByRole('menu')).toBeTruthy();
  expect(screen.getByRole('button', { name: i18n.t('notifications') })).toBeTruthy();
  expect(mutations()).toEqual([expect.objectContaining({ path: '/api/portal/notifications/read-all', method: 'POST' })]);
  noStaffApi();
});

it('confirms removal of one notification and never deletes on the first click', async () => {
  mount(); await open(); await screen.findByText('New assignment: Practice');
  await userEvent.click(screen.getByRole('menuitem', { name: i18n.t('delete') }));
  const dialog = await screen.findByRole('alertdialog', { name: i18n.t('deleteNotificationTitle') });
  expect(mutations()).toEqual([]);
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('delete') }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: i18n.t('notifications') })));
  expect(mutations()).toEqual([expect.objectContaining({ path: '/api/portal/notifications/3', method: 'DELETE' })]);
  await userEvent.click(screen.getByRole('button', { name: i18n.t('notifications') }));
  await screen.findByText(i18n.t('noNotifications')); noStaffApi();
});

it('cancels clear and confirms it separately before removing visible notifications', async () => {
  mount(); await open(); await screen.findByText('New assignment: Practice');
  await userEvent.click(screen.getByRole('menuitem', { name: i18n.t('clearNotifications') }));
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('cancel') }));
  expect(mutations()).toEqual([]);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: unreadLabel(1) })));
  await open();
  await userEvent.click(screen.getByRole('menuitem', { name: i18n.t('clearNotifications') }));
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('clearNotificationsAction') }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(mutations()).toEqual([expect.objectContaining({ path: '/api/portal/notifications', method: 'DELETE' })]);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: i18n.t('notifications') })));
  await userEvent.click(screen.getByRole('button', { name: i18n.t('notifications') }));
  await screen.findByText(i18n.t('noNotifications')); noStaffApi();
});

it('keeps deletion pending and retry errors inside confirmation, then restores the bell after success', async () => {
  pendingRemove = new Promise<void>((resolve) => { finishRemove = resolve; });
  removeError = 500;
  mount(); await open(); await screen.findByText('New assignment: Practice');
  await userEvent.click(screen.getByRole('menuitem', { name: i18n.t('delete') }));
  const dialog = screen.getByRole('alertdialog');
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('delete') }));
  await waitFor(() => expect(mutations()).toHaveLength(1));
  const saving = within(dialog).getByRole('button', { name: i18n.t('saving') });
  expect(saving.hasAttribute('disabled')).toBe(true);
  expect(dialog.contains(document.activeElement)).toBe(true);
  await userEvent.click(saving);
  expect(mutations()).toHaveLength(1);
  await act(async () => finishRemove!());
  await within(dialog).findByRole('alert');
  expect(screen.getByRole('alertdialog')).toBe(dialog);
  expect(dialog.contains(document.activeElement)).toBe(true);
  removeError = 0; pendingRemove = null;
  await userEvent.click(within(dialog).getByRole('button', { name: i18n.t('delete') }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: i18n.t('notifications') })));
  expect(mutations()).toHaveLength(2); noStaffApi();
});

it('keeps menu, route and mutation state after cancelled dirty navigation, then opens the authorized parent result', async () => {
  const parent = { ...session, subjects: [{ ...session.subjects[0], kind: 'representative' as const, relationship: 'parent' as const, permissions: ['feedback.read' as const] }] };
  mount(parent, '/parent-module');
  fireEvent.change(screen.getByLabelText('Workspace'), { target: { value: 'Changed work' } });
  await open();
  await userEvent.click(await screen.findByRole('menuitem', { name: /New assignment: Practice/ }));
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('portalCancel') }));
  expect(mutations()).toEqual([]);
  expect(location.pathname).toBe('/parent-module');
  expect((screen.getByLabelText('Workspace') as HTMLInputElement).value).toBe('Changed work');
  await userEvent.click(screen.getByRole('menuitem', { name: /New assignment: Practice/ }));
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('portalLeave') }));
  await waitFor(() => expect(location.pathname + location.search).toBe('/parent-module/progress?linkId=10'));
  await waitFor(() => expect(mutations()).toEqual([expect.objectContaining({ path: '/api/portal/notifications/3/read' })]));
  noStaffApi();
});

it('reads a notification without offering an unauthorized destination', async () => {
  mount({ ...session, subjects: [{ ...session.subjects[0], permissions: ['finance.read'] }] });
  await open();
  const row = await screen.findByRole('menuitem', { name: /New assignment: Practice/ });
  expect(within(row).queryByText(i18n.t('openRelatedRecord'))).toBeNull();
  await userEvent.click(row);
  await waitFor(() => expect(mutations()).toHaveLength(1));
  expect(location.pathname).toBe('/student-module'); noStaffApi();
});

it('retries an older page without dropping already loaded notifications', async () => {
  pageSize = 1; notices[50] = [notice(3, 'Newest'), notice(2, 'Older'), notice(1, 'Oldest')];
  mount(); await open(3); await screen.findByText('New assignment: Newest');
  pageError = 500;
  await userEvent.click(screen.getByRole('menuitem', { name: i18n.t('loadOlderNotifications') }));
  await screen.findByRole('alert');
  expect(screen.getByText('New assignment: Newest')).toBeTruthy();
  pageError = 0;
  await userEvent.click(screen.getByRole('menuitem', { name: i18n.t('retry') }));
  await screen.findByText('New assignment: Older');
  expect(screen.getByText('New assignment: Newest')).toBeTruthy(); noStaffApi();
});

it.each([401, 403, 404])('hides cached notification rows and disables read-all after %s', async (status) => {
  mount(); await open(); await screen.findByText('New assignment: Practice');
  pageError = status;
  await act(async () => { await client.refetchQueries({ queryKey: ['portal-account', 50, 'notifications'] }); });
  await waitFor(() => expect(screen.queryByText('New assignment: Practice')).toBeNull());
  expect(screen.getByRole('menuitem', { name: i18n.t('markAllRead') }).hasAttribute('disabled')).toBe(true);
  expect(mutations()).toEqual([]); noStaffApi();
});

it('opens an old notification URL as the CRM dropdown and replaces only its route when dismissed', async () => {
  mount(session, '/student-module/notifications?tab=active');
  await screen.findByRole('menu'); await screen.findByText('New assignment: Practice');
  const length = history.length;
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(location.pathname + location.search).toBe('/student-module?tab=active'));
  expect(history.length).toBe(length);
  expect((screen.getByLabelText('Workspace') as HTMLInputElement).value).toBe('Unsent work');
  expect(screen.queryByRole('dialog')).toBeNull(); noStaffApi();
});

it('does not overwrite or refetch a replacement account after a pending clear finishes', async () => {
  pendingClear = new Promise<void>((resolve) => { finishClear = resolve; });
  mount(); await open(); await screen.findByText('New assignment: Practice');
  await userEvent.click(screen.getByRole('menuitem', { name: i18n.t('clearNotifications') }));
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('clearNotificationsAction') }));
  await waitFor(() => expect(mutations()).toHaveLength(1));
  notices[99] = [notice(91, 'New account')];
  await act(async () => {
    activeSession = { ...session, account: { ...session.account!, id: 99 } };
    client.setQueryData(portalSessionKey, activeSession);
  });
  await waitFor(() => expect(requests.some((request) => request.accountId === 99)).toBe(true));
  const newAccountRequests = requests.filter((request) => request.accountId === 99).length;
  await act(async () => finishClear!());
  expect(requests.filter((request) => request.accountId === 99)).toHaveLength(newAccountRequests);
  const badgeKey = ['portal-account', 99, 'notifications-badge', portalGrantFingerprint(session.subjects)];
  expect(client.getQueryData<{ unreadCount: number }>(badgeKey)?.unreadCount).toBe(1);
  await open(); await screen.findByText('New assignment: New account'); noStaffApi();
});

it('does not cancel a new grant-scoped notification request when an old clear response arrives', async () => {
  pendingClear = new Promise<void>((resolve) => { finishClear = resolve; });
  mount(); await open(); await screen.findByText('New assignment: Practice');
  await userEvent.click(screen.getByRole('menuitem', { name: i18n.t('clearNotifications') }));
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: i18n.t('clearNotificationsAction') }));
  await waitFor(() => expect(mutations()).toHaveLength(1));
  notices[50] = [notice(91, 'New grant')];
  pendingList = new Promise<void>((resolve) => { finishList = resolve; });
  await act(async () => {
    activeSession = { ...session, subjects: [{ ...session.subjects[0], permissions: ['learning.read', 'feedback.read'] }] };
    client.setQueryData(portalSessionKey, activeSession);
  });
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  await userEvent.click(screen.getByRole('button', { name: /notifications/i }));
  await waitFor(() => expect(waitingList).toBe(2));
  const key = ['portal-account', 50, 'notifications', portalGrantFingerprint(activeSession.subjects)];
  expect(client.getQueryState(key)?.fetchStatus).toBe('fetching');
  await act(async () => finishClear!());
  expect(abortedList).toBe(0);
  expect(client.getQueryState(key)?.fetchStatus).toBe('fetching');
  await act(async () => finishList!());
  await screen.findByText('New assignment: New grant');
  expect(screen.queryByText('New assignment: Practice')).toBeNull();
  noStaffApi();
});

it('aborts a queued read locally without refetching a replacement session through the real mutation cache', async () => {
  client.clear(); client = createPortalQueryClient();
  mount(); await open(); await screen.findByText('New assignment: Practice');
  let release: () => void = () => {};
  const paused = new Promise<void>((resolve) => { release = resolve; });
  const cancel = client.cancelQueries.bind(client);
  let held = false;
  vi.spyOn(client, 'cancelQueries').mockImplementation((filters, options) => {
    if (!held && filters?.exact && filters.queryKey?.[2] === 'notifications') {
      held = true;
      return paused;
    }
    return cancel(filters, options);
  });
  await userEvent.click(screen.getByRole('menuitem', { name: i18n.t('markAllRead') }));
  expect(held).toBe(true);
  notices[99] = [notice(91, 'Replacement session')];
  await act(async () => {
    activeSession = { ...session, account: { ...session.account!, id: 99 } };
    client.setQueryData(portalSessionKey, activeSession);
  });
  const badgeKey = ['portal-account', 99, 'notifications-badge', portalGrantFingerprint(session.subjects)];
  await waitFor(() => expect(client.getQueryData(badgeKey)).toBeDefined());
  const sessionRequests = requests.filter((request) => request.path === '/api/portal/auth/session').length;
  await act(async () => release());
  await waitFor(() => expect(client.getMutationCache().getAll()[0].state.status).toBe('error'));
  expect(client.getMutationCache().getAll()[0].state.error).toMatchObject({ name: 'AbortError' });
  expect(mutations()).toEqual([]);
  expect(requests.filter((request) => request.path === '/api/portal/auth/session')).toHaveLength(sessionRequests);
  expect(client.getQueryData<PortalSessionDto>(portalSessionKey)?.account?.id).toBe(99);
  expect(toasts).not.toHaveBeenCalled(); noStaffApi();
});
