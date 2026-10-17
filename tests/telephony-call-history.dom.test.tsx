// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TelephonyCallHistory } from '../client/src/components/telephony/TelephonyCallHistory';
import { i18n } from '../client/src/lib/i18n';
import type { CallHistoryItem } from '../client/src/features/telephony/api';

let queryClient: QueryClient;
let missedCalls: ReturnType<typeof makeCall>[];
let historyFailure: boolean;
let recentCalls: CallHistoryItem[];
let writes: Array<{ url: string; body: unknown }>;

const makeCall = (id: number, direction: 'incoming' | 'outgoing' = 'incoming'): CallHistoryItem => ({
  id, source: 'manager', clientCallId: null, providerCallId: null, direction,
  status: direction === 'incoming' ? 'missed' : 'ended',
  phone: `+998901234${String(id).padStart(3, '0')}`,
  contactType: null, contactId: null, contactName: `${direction === 'incoming' ? 'Missed' : 'Recent'} call ${id}`,
  leadId: null, startedAt: '2026-10-05T11:30:00Z', answeredAt: null, endedAt: '2026-10-05T11:31:00Z',
  durationSeconds: 60, talkSeconds: direction === 'incoming' ? 0 : 30,
  hangupCause: null, note: null, hasRecording: false,
});
const reminderId = '11111111-1111-4111-8111-111111111111';
const reminderCall = (): CallHistoryItem => ({
  ...makeCall(900, 'outgoing'), id: reminderId, source: 'voice_reminder', voiceReminderCallId: reminderId,
  contactName: 'Reminder contact', reminderOutcome: 'delivered_no_response', hasRecording: true,
});

beforeEach(() => {
  i18n.setLanguage('ru');
  historyFailure = false;
  missedCalls = Array.from({ length: 6 }, (_, index) => makeCall(index + 1));
  recentCalls = Array.from({ length: 50 }, (_, index) => makeCall(index + 100, 'outgoing'));
  writes = [];
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname.endsWith('/recording')) {
      return new Response(JSON.stringify({ url: `${url.pathname}/media` }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      writes.push({ url: url.pathname, body });
      return new Response(JSON.stringify({ id: Number(url.pathname.split('/').at(-2)), note: body.note }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname.endsWith('/missed/unread')) {
      return new Response(JSON.stringify({ count: missedCalls.length }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (historyFailure) return new Response('Unavailable', { status: 503 });
    const calls = url.searchParams.get('filter') === 'missed'
      ? missedCalls
      : recentCalls;
    const offset = Number(url.searchParams.get('offset'));
    return new Response(JSON.stringify(calls.slice(offset, offset + 50)), { status: 200, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => { cleanup(); queryClient.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const renderHistory = () => render(<QueryClientProvider client={queryClient}>
  <TelephonyCallHistory onCallBack={vi.fn()} onCollapse={vi.fn()} />
</QueryClientProvider>);

it('shows all six callback candidates even when none is in the latest fifty calls', async () => {
  const user = userEvent.setup();
  renderHistory();
  await screen.findByText('Recent call 100');
  await user.click(await screen.findByRole('button', { name: new RegExp(`${i18n.t('telephonyFilterMissed')}\\s*6$`) }));
  await screen.findByText('Missed call 1');
  missedCalls.forEach((call) => expect(screen.getByText(call.contactName || call.phone)).toBeTruthy());
  expect(screen.queryByText('Recent call 100')).toBeNull();
  expect(screen.getAllByRole('button', { name: i18n.t('telephonyCallBack') })).toHaveLength(6);
  expect(screen.queryByText(i18n.t('telephonyNoCallsFound'))).toBeNull();
});

it('loads the remaining missed calls without returning to the latest-call window', async () => {
  missedCalls = Array.from({ length: 56 }, (_, index) => makeCall(index + 1));
  const user = userEvent.setup();
  renderHistory();
  await user.click(await screen.findByRole('button', { name: new RegExp(`${i18n.t('telephonyFilterMissed')}\\s*56$`) }));
  await screen.findByText('Missed call 50');
  expect(screen.queryByText('Missed call 51')).toBeNull();
  await user.click(screen.getByRole('button', { name: i18n.t('loadMoreResults') }));
  await screen.findByText('Missed call 56');
  expect(screen.getAllByRole('button', { name: i18n.t('telephonyCallBack') })).toHaveLength(56);
  await waitFor(() => expect(screen.queryByRole('button', { name: i18n.t('loadMoreResults') })).toBeNull());
});

it('shows a failed request separately from an empty history and allows retrying', async () => {
  historyFailure = true;
  const user = userEvent.setup();
  renderHistory();
  await screen.findByText(i18n.t('failedToLoadData'));
  expect(screen.queryByText(i18n.t('telephonyNoCalls'))).toBeNull();
  historyFailure = false;
  await user.click(screen.getByRole('button', { name: i18n.t('retry') }));
  await screen.findByText('Recent call 100');
  expect(screen.queryByText(i18n.t('failedToLoadData'))).toBeNull();
});

it('shows a genuine reminder result and recording without exposing bot notes or sending its UUID to manager endpoints', async () => {
  recentCalls = [{ ...reminderCall(), note: 'Injected bot note' }, { ...makeCall(71, 'outgoing'), note: 'Manager note' }];
  const onCallBack = vi.fn();
  const view = render(<QueryClientProvider client={queryClient}>
    <TelephonyCallHistory onCallBack={onCallBack} onCollapse={vi.fn()} />
  </QueryClientProvider>);
  const botRow = (await screen.findByText('Reminder contact')).closest('article')!;
  expect(within(botRow).getByText('Автоинформатор')).toBeTruthy();
  expect(within(botRow).getByText('Напоминание доставлено, ответ не получен')).toBeTruthy();
  expect(within(botRow).queryByRole('button', { name: i18n.t('telephonyAddNote') })).toBeNull();
  expect(screen.queryByText('Injected bot note')).toBeNull();
  expect(screen.getByText('Manager note')).toBeTruthy();
  const user = userEvent.setup();
  await user.click(within(botRow).getByRole('button', { name: i18n.t('telephonyPlayRecording') }));
  await waitFor(() => expect(view.container.querySelector('audio')?.getAttribute('src'))
    .toBe(`/api/telephony/reminder-calls/${reminderId}/recording/media`));
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url) === `/api/telephony/reminder-calls/${reminderId}/recording`)).toBe(true);
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes(`/api/telephony/calls/${reminderId}`))).toBe(false);
  await user.click(within(botRow).getByRole('button', { name: i18n.t('telephonyCallBack') }));
  expect(onCallBack).toHaveBeenCalledExactlyOnceWith(reminderCall().phone);

  const managerRow = screen.getByText('Recent call 71').closest('article')!;
  await user.click(within(managerRow).getByRole('button', { name: i18n.t('telephonyAddNote') }));
  const note = within(managerRow).getByRole('textbox', { name: i18n.t('telephonyNote') });
  await user.clear(note);
  await user.type(note, 'Updated manager note');
  await user.click(within(managerRow).getByRole('button', { name: i18n.t('telephonyNote') }));
  await waitFor(() => expect(writes).toEqual([{ url: '/api/telephony/calls/71/note', body: { note: 'Updated manager note' } }]));
});

it.each([['ru', 'yes', 'Придёт'], ['ru', 'no', 'Не придёт'], ['en', 'yes', 'Will attend'], ['en', 'no', 'Will not attend']] as const)
  ('shows the actual %s %s reminder reply ahead of no-response delivery', async (language, reminderResponse, label) => {
    i18n.setLanguage(language);
    recentCalls = [{ ...reminderCall(), reminderResponse, hasRecording: false }];
    renderHistory();
    expect(await screen.findByText(label)).toBeTruthy();
    expect(screen.queryByText(i18n.t('voiceRemindersDeliveredNoResponse'))).toBeNull();
    expect(screen.queryByRole('button', { name: i18n.t('telephonyPlayRecording') })).toBeNull();
  });

it('keeps reminder callbacks disabled while the bot owns the manager line', async () => {
  recentCalls = [{ ...reminderCall(), hasRecording: false }];
  const onCallBack = vi.fn();
  render(<QueryClientProvider client={queryClient}>
    <TelephonyCallHistory onCallBack={onCallBack} onCollapse={vi.fn()} isLineBusyWithReminder />
  </QueryClientProvider>);
  const button = await screen.findByRole('button', { name: i18n.t('telephonyLineBusyWithReminder') });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  await userEvent.setup().click(button);
  expect(onCallBack).not.toHaveBeenCalled();
});

it('includes a reminder on a later mixed page without duplicating it', async () => {
  recentCalls.push({ ...reminderCall(), hasRecording: false });
  renderHistory();
  await screen.findByText('Recent call 100');
  expect(screen.queryByText('Автоинформатор')).toBeNull();
  await userEvent.setup().click(screen.getByRole('button', { name: i18n.t('loadMoreResults') }));
  expect(await screen.findByText('Автоинформатор')).toBeTruthy();
  expect(screen.getAllByRole('article')).toHaveLength(51);
  expect(screen.queryByRole('button', { name: i18n.t('loadMoreResults') })).toBeNull();
});

it('polls for background reminder calls without losing a manager note draft and stops polling after unmount', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  recentCalls = [makeCall(71, 'outgoing')];
  const view = renderHistory();
  await screen.findByText('Recent call 71');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: i18n.t('telephonyAddNote') }));
  await user.type(screen.getByRole('textbox', { name: i18n.t('telephonyNote') }), 'Unsaved manager draft');
  recentCalls = [{ ...reminderCall(), hasRecording: false }, ...recentCalls];
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(await screen.findByText('Автоинформатор')).toBeTruthy();
  expect((screen.getByRole('textbox', { name: i18n.t('telephonyNote') }) as HTMLTextAreaElement).value).toBe('Unsaved manager draft');
  view.unmount();
  const requestsAfterUnmount = vi.mocked(fetch).mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(fetch).toHaveBeenCalledTimes(requestsAfterUnmount);
});
