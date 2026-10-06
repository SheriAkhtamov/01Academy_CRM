// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import ChatSheet from '../client/src/components/ux/ChatSheet';
import MarketingModule from '../client/src/pages/marketing-module';
import { allowNavigation } from '../client/src/lib/navigationGuard';
import { NotificationsMenu } from '../client/src/components/ux/NotificationsMenu';
import { CommandPalette } from '../client/src/components/ux/CommandPalette';
import { i18n } from '../client/src/lib/i18n';

vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, module: 'administration', modules: ['administration', 'sales'] } }) }));
beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
});
beforeEach(() => i18n.setLanguage('en'));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const mount = (content: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>{content}</QueryClientProvider>);

it('uses the complete unread count and loads notifications beyond the latest page', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (url === '/api/notifications/unread-count') return response({ count: 230 });
    if (String(url).includes('offset=25')) return response({ items: [{ id: 2, title: 'Older notification', message: null, isRead: true }], total: 26, nextOffset: null });
    return response({ items: [{ id: 1, title: 'Latest notification', message: null, isRead: false, relatedEntityType: 'lead', relatedEntityId: 7 }], total: 26, nextOffset: 25 });
  });
  mount(<NotificationsMenu />);
  const label = i18n.t('unreadNotificationCount').replace('{count}', '230');
  await userEvent.click(await screen.findByRole('button', { name: label }));
  expect(await screen.findByText('Latest notification')).toBeTruthy();
  expect(screen.getByText(i18n.t('openRelatedRecord'))).toBeTruthy();
  await userEvent.click(screen.getByRole('menuitem', { name: i18n.t('loadOlderNotifications') }));
  expect(await screen.findByText('Older notification')).toBeTruthy();
  expect(fetch.mock.calls.some(([url]) => String(url).includes('offset=25'))).toBe(true);
});

it('requires confirmation to clear notifications and resets the unread badge', async () => {
  let cleared=false;
  const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async(url,options)=>{
    if (options?.method==='DELETE') {cleared=true;return response({success:true,deletedCount:143});}
    if (url==='/api/notifications/unread-count') return response({count:cleared?0:143});
    return response({items:cleared?[]:[{id:1,title:'First notice',message:null,isRead:false}],total:cleared?0:143,nextOffset:cleared?null:25});
  });
  const user=userEvent.setup(); mount(<NotificationsMenu />);
  await user.click(await screen.findByRole('button',{name:/143 unread notifications/}));
  await screen.findByText('First notice');
  await user.click(screen.getByRole('button',{name:'Clear notifications'}));
  expect(fetch.mock.calls.some(([,options])=>options?.method==='DELETE')).toBe(false);
  const dialog=screen.getByRole('alertdialog');
  await user.click(within(dialog).getByRole('button',{name:'Clear'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Notifications'})).toBeTruthy());
  expect(fetch.mock.calls.filter(([,options])=>options?.method==='DELETE')).toHaveLength(1);
});

it('shows an error rather than an empty notification list after a failed request', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => url === '/api/notifications/unread-count' ? response({ count: 0 }) : response({ error: 'failedToLoadData' }, 500));
  mount(<NotificationsMenu />);
  await userEvent.click(screen.getByRole('button', { name: i18n.t('notifications') }));
  await screen.findByRole('alert');
  expect(screen.queryByText(i18n.t('noNotifications'))).toBeNull();
  expect(screen.getByRole('menuitem', { name: i18n.t('retry') })).toBeTruthy();
});

it('shows record search failures even when a navigation destination matches', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ error: 'failedToLoadData' }, 500));
  mount(<CommandPalette open onOpenChange={vi.fn()} />);
  fireEvent.change(screen.getByPlaceholderText(i18n.t('commandPalettePlaceholder')), { target: { value: i18n.t('employees') } });
  expect(await screen.findByText(i18n.t('navigation'))).toBeTruthy();
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy(), { timeout: 3000 });
});


it('opens the selected lead source directly inside its dialog', async () => {
  allowNavigation(() => history.replaceState(null, '', '/marketing-module/sources?source=5'));
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({
    sources: [{ id: 5, name: 'Chosen source', channel: 'Instagram' }], leads: [], students: [], expenses: [], referrals: [],
    analytics: { bySource: [{ sourceId: 5, sourceName: 'Chosen source', leads: 3, paidStudents: 2 }], funnel: [], summary: {} },
  }));
  mount(<MarketingModule section="sources" />);
  await screen.findByRole('dialog', { name: 'Chosen source' });
  fireEvent.click(screen.getAllByRole('button', { name: i18n.t('close') })[0]);
  await waitFor(() => expect(location.search).toBe(''));
});

it('formats employee chat time on the academy clock across midnight', async () => {
  const colleague = { id: 2, fullName: 'Colleague', position: 'Teacher', unreadCount: 0, isOnline: false };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (url === '/api/chat-groups') return response([]);
    if (url === '/api/messages/2') return response([{ id: 4, senderId: 2, receiverId: 1, content: 'Hello', isRead: true, createdAt: '2026-10-02T23:30:00Z' }]);
    return response([colleague]);
  });
  mount(<ChatSheet open onOpenChange={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Colleague/ }));
  await screen.findByText('Hello');
  expect(screen.getByText(/04:30/)).toBeTruthy();
});
