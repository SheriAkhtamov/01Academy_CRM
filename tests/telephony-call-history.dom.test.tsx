// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TelephonyCallHistory } from '../client/src/components/telephony/TelephonyCallHistory';
import { i18n } from '../client/src/lib/i18n';

let queryClient: QueryClient;
let missedCalls: ReturnType<typeof makeCall>[];
let historyFailure: boolean;

const makeCall = (id: number, direction: 'incoming' | 'outgoing' = 'incoming') => ({
  id, clientCallId: null, providerCallId: null, userId: null, direction,
  status: direction === 'incoming' ? 'missed' : 'ended',
  phone: `+998901234${String(id).padStart(3, '0')}`,
  contactType: null, contactId: null, contactName: `${direction === 'incoming' ? 'Missed' : 'Recent'} call ${id}`,
  leadId: null, startedAt: '2026-10-05T11:30:00Z', answeredAt: null, endedAt: '2026-10-05T11:31:00Z',
  durationSeconds: 60, talkSeconds: direction === 'incoming' ? 0 : 30,
  hangupCause: null, note: null, hasRecording: false,
});

beforeEach(() => {
  i18n.setLanguage('ru');
  historyFailure = false;
  missedCalls = Array.from({ length: 6 }, (_, index) => makeCall(index + 1));
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname.endsWith('/missed/unread')) {
      return new Response(JSON.stringify({ count: missedCalls.length }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (historyFailure) return new Response('Unavailable', { status: 503 });
    const calls = url.searchParams.get('filter') === 'missed'
      ? missedCalls
      : Array.from({ length: 50 }, (_, index) => makeCall(index + 100, 'outgoing'));
    const offset = Number(url.searchParams.get('offset'));
    return new Response(JSON.stringify(calls.slice(offset, offset + 50)), { status: 200, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => { cleanup(); queryClient.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const renderHistory = () => render(<QueryClientProvider client={queryClient}>
  <TelephonyCallHistory onCallBack={vi.fn()} onCollapse={vi.fn()} />
</QueryClientProvider>);

it('shows all six callback candidates even when none is in the latest fifty calls', async () => {
  const user = userEvent.setup();
  renderHistory();
  await screen.findByText('Recent call 100');
  await user.click(await screen.findByRole('button', { name: new RegExp(`${i18n.t('telephonyFilterMissed')}\\s*6$`) }));
  await screen.findByText('Missed call 1');
  missedCalls.forEach((call) => expect(screen.getByText(call.contactName)).toBeTruthy());
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
