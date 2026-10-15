// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelephonyProvider, useTelephony } from '../client/src/contexts/TelephonyContext';
import { TelephonyWidget } from '../client/src/components/telephony/TelephonyWidget';
import { useOnlinePbxCall } from '../client/src/hooks/useOnlinePbxCall';
import { telephonyQueryKeys } from '../client/src/features/telephony/api';
import { i18n } from '../client/src/lib/i18n';

const mocks = vi.hoisted(() => ({
  user: { id: 7, fullName: 'Manager', onlinePbxExtension: '100', onlinePbxIncomingEnabled: true },
  authenticated: true,
  visibility: 'visible' as DocumentVisibilityState,
  callbacks: null as any, value: null as any,
  fetch: vi.fn(), status: vi.fn(), priority: vi.fn(), reserve: vi.fn(),
  newCall: vi.fn(), opened: vi.fn(), closed: vi.fn(), microphone: vi.fn(), stop: vi.fn(), toast: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user, isAuthenticated: mocks.authenticated }) }));
vi.mock('@/hooks/use-toast', () => ({ toast: mocks.toast }));
vi.mock('@/lib/incomingCallRingtone', () => ({
  shouldPlayIncomingRingtone: () => false,
  IncomingCallRingtone: class { start() { return Promise.resolve(); } stop() {} destroy() {} unlock() { return Promise.resolve(true); } },
}));
vi.mock('@xswitch/rtc', () => ({ Verto: class {
  constructor(_options: unknown, callbacks: unknown) { mocks.opened(); mocks.callbacks = callbacks; }
  socketReady() { return true; }
  closeSocket() { mocks.closed(); }
  newCall(options: { callID: string }) { return mocks.newCall(options); }
} }));
const deferred = <Value,>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((done) => { resolve = done; });
  return { promise, resolve };
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const requestCount = (suffix: string) => mocks.fetch.mock.calls.filter(([url]) => String(url).endsWith(suffix)).length;
function CardCallButton({ index }: { index: number }) {
  const call = useOnlinePbxCall();
  return <button data-testid={`card-${index}`} disabled={call.isPending || call.isLineBusyWithReminder} onClick={() => call.startCall('+998901234567')}>{call.callButtonLabel}</button>;
}
function Probe() { mocks.value = useTelephony(); return null; }
async function renderPhone(login = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><TelephonyProvider>
    <CardCallButton index={1} /><CardCallButton index={2} /><CardCallButton index={3} /><Probe /><TelephonyWidget />
  </TelephonyProvider></QueryClientProvider>;
  const view = render(tree());
  await waitFor(() => expect(mocks.callbacks).toBeTruthy());
  if (login) await act(async () => mocks.callbacks.onWSLogin({}, true));
  return { ...view, client, refresh: () => view.rerender(tree()) };
}
const refetchStatus = (client: QueryClient) => client.refetchQueries({ queryKey: telephonyQueryKeys.lineStatus(mocks.user.id, mocks.user.onlinePbxExtension), exact: true, type: 'active' }, { cancelRefetch: false });

beforeEach(() => {
  vi.clearAllMocks(); window.localStorage.clear();
  mocks.user = { id: 7, fullName: 'Manager', onlinePbxExtension: '100', onlinePbxIncomingEnabled: true };
  mocks.authenticated = true; mocks.visibility = 'visible'; mocks.callbacks = null; mocks.value = null;
  i18n.setLanguage('ru');
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => mocks.visibility);
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('fetch', mocks.fetch);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  mocks.microphone.mockResolvedValue({ getTracks: () => [{ stop: mocks.stop }] });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: mocks.microphone } });
  mocks.status.mockResolvedValue(json({ busyWithReminder: false }));
  mocks.priority.mockImplementation(async () => json({ busyWithReminder: true }));
  mocks.reserve.mockImplementation(async () => json({ id: 'manager-lease' }));
  mocks.newCall.mockImplementation((options: { callID: string }) => ({
    callID: options.callID, direction: { name: 'outbound' }, state: { name: 'trying' },
    hangup: vi.fn(), answer: vi.fn(), setMute: vi.fn(), getMute: vi.fn(), toggleHold: vi.fn(), dtmf: vi.fn(), transfer: vi.fn(),
  }));
  mocks.fetch.mockImplementation(async (url: string, options?: { body?: string }) => {
    if (url.endsWith('/credentials')) return json({ extension: mocks.user.onlinePbxExtension, username: 'synthetic', password: 'synthetic', sipDomain: 'example.test', websocketUrl: 'wss://example.test' });
    if (url.endsWith('/lines/status')) return mocks.status();
    if (url.endsWith('/lines/request-priority')) return mocks.priority();
    if (url.endsWith('/lines/reserve')) return mocks.reserve();
    if (url.endsWith('/lines/authorize')) return json({ authorized: true });
    if (url.endsWith('/lines/release')) return json({ released: true });
    if (url.endsWith('/lines/renew')) return json({ alive: true });
    if (url.endsWith('/calls/events')) return json({ id: 11, ...JSON.parse(options?.body ?? '{}') });
    if (url.endsWith('/missed/unread')) return json({ count: 0 });
    if (url.includes('/contacts/lookup')) return json({ contact: null });
    if (url.includes('/calls?')) return json([{ id: 1, phone: '+998901234568', contactName: 'Historical contact', direction: 'outgoing', status: 'ended', startedAt: '2026-10-15T10:00:00Z', talkSeconds: 1, note: null, hasRecording: false }]);
    return json([]);
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('own reminder line status', () => {
  it.each(['ru', 'en'] as const)('disables shared call controls with visible %s copy and prevents direct/Enter dialing without microphone or admission', async language => {
    i18n.setLanguage(language);
    mocks.status.mockImplementation(async () => json({ busyWithReminder: true }));
    const view = await renderPhone();
    await waitFor(() => expect((screen.getByTestId('card-1') as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByTestId('card-1').textContent).toBe(i18n.t('telephonyLineBusyWithReminder'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: i18n.t('telephonyOpen') }));
    const panel = screen.getByRole('dialog', { name: i18n.t('telephonyTitle') });
    const number = within(panel).getByRole('textbox');
    fireEvent.change(number, { target: { value: '+998901234567' } });
    const call = within(panel).getByRole('button', { name: i18n.t('telephonyLineBusyWithReminder') }) as HTMLButtonElement;
    expect(call.disabled).toBe(true);
    await user.click(call);
    fireEvent.keyDown(number, { key: 'Enter' });
    await act(async () => mocks.value.startCall('+998901234567'));
    expect(mocks.microphone).not.toHaveBeenCalled();
    expect(mocks.newCall).not.toHaveBeenCalled();
    expect(requestCount('/lines/reserve')).toBe(0);
    expect(requestCount('/calls/events')).toBe(0);
    await waitFor(() => expect(mocks.priority).toHaveBeenCalledOnce());
    const request = mocks.fetch.mock.calls.find(([url]) => String(url).endsWith('/lines/request-priority'));
    expect(JSON.parse(request?.[1].body)).toEqual({});
    await act(async () => refetchStatus(view.client));
    expect(mocks.priority).toHaveBeenCalledOnce();
  });

  it('uses one provider poll for multiple cards and re-enables automatically without placing a call', async () => {
    const priority = deferred<Response>();
    mocks.priority.mockReturnValueOnce(priority.promise);
    mocks.status.mockImplementation(async () => json({ busyWithReminder: true }));
    await renderPhone(false);
    vi.useFakeTimers();
    await act(async () => mocks.callbacks.onWSLogin({}, true));
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(mocks.status).toHaveBeenCalledOnce();
    expect(mocks.priority).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(mocks.status).toHaveBeenCalledTimes(3);
    expect(mocks.priority).toHaveBeenCalledOnce();
    mocks.status.mockImplementation(async () => json({ busyWithReminder: false }));
    await act(async () => vi.advanceTimersByTimeAsync(2_500));
    expect((screen.getByTestId('card-1') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId('card-1').textContent).toBe(i18n.t('call'));
    expect(mocks.newCall).not.toHaveBeenCalled();
    expect(mocks.microphone).not.toHaveBeenCalled();
    expect(requestCount('/lines/reserve')).toBe(0);
  });

  it('does not recreate the SDK or credentials on login, duplicate login, or status polling', async () => {
    const view = await renderPhone();
    await act(async () => mocks.callbacks.onWSLogin({}, true));
    await act(async () => refetchStatus(view.client));
    expect(mocks.opened).toHaveBeenCalledOnce();
    expect(mocks.closed).not.toHaveBeenCalled();
    expect(requestCount('/credentials')).toBe(1);
    view.unmount();
    expect(mocks.closed).toHaveBeenCalledOnce();
  });

  it('does not let an old free GET erase a newer busy reserve refusal', async () => {
    const old = deferred<Response>();
    mocks.status.mockReturnValueOnce(old.promise).mockImplementation(async () => json({ busyWithReminder: true }));
    mocks.reserve.mockImplementation(async () => json({ error: 'onlinePbxLineBusyWithReminder' }, 409));
    const view = await renderPhone();
    await waitFor(() => expect(mocks.status).toHaveBeenCalledOnce());
    await act(async () => mocks.value.startCall('+998901234567').catch(() => undefined));
    await waitFor(() => expect((screen.getByTestId('card-1') as HTMLButtonElement).disabled).toBe(true));
    await act(async () => old.resolve(json({ busyWithReminder: false })));
    expect(mocks.value.isLineBusyWithReminder).toBe(true);
    expect(mocks.priority).not.toHaveBeenCalled();
    await act(async () => refetchStatus(view.client));
    await waitFor(() => expect(mocks.priority).toHaveBeenCalledOnce());
  });

  it('ignores a late priority busy ACK after a newer free GET', async () => {
    const oldPriority = deferred<Response>();
    mocks.priority.mockReturnValueOnce(oldPriority.promise);
    mocks.status.mockImplementation(async () => json({ busyWithReminder: true }));
    const view = await renderPhone();
    await waitFor(() => expect(mocks.priority).toHaveBeenCalledOnce());
    mocks.status.mockImplementation(async () => json({ busyWithReminder: false }));
    await act(async () => refetchStatus(view.client));
    await waitFor(() => expect(mocks.value.isLineBusyWithReminder).toBe(false));
    const reads = mocks.status.mock.calls.length;
    await act(async () => oldPriority.resolve(json({ busyWithReminder: true })));
    expect(mocks.value.isLineBusyWithReminder).toBe(false);
    expect(mocks.status).toHaveBeenCalledTimes(reads);
    expect(mocks.newCall).not.toHaveBeenCalled();
  });

  it.each(['actor', 'extension'] as const)('resets immediately on %s change and ignores the previous status and priority responses', async change => {
    const old = deferred<Response>();
    const oldPriority = deferred<Response>();
    mocks.status.mockImplementation(async () => json({ busyWithReminder: true }));
    mocks.priority.mockReturnValueOnce(oldPriority.promise);
    const view = await renderPhone();
    await waitFor(() => expect(mocks.value.isLineBusyWithReminder).toBe(true));
    mocks.status.mockReturnValueOnce(old.promise).mockImplementation(async () => json({ busyWithReminder: false }));
    await act(async () => window.dispatchEvent(new Event('focus')));
    const priorCallbacks = mocks.callbacks;
    mocks.user = change === 'actor' ? { ...mocks.user, id: 8 } : { ...mocks.user, onlinePbxExtension: '101' };
    await act(async () => view.refresh());
    expect(mocks.value.isLineBusyWithReminder).toBe(false);
    await waitFor(() => expect(mocks.callbacks).not.toBe(priorCallbacks));
    await act(async () => mocks.callbacks.onWSLogin({}, true));
    await act(async () => { old.resolve(json({ busyWithReminder: true })); oldPriority.resolve(json({ busyWithReminder: true })); });
    expect(mocks.value.isLineBusyWithReminder).toBe(false);
    expect((screen.getByTestId('card-1') as HTMLButtonElement).disabled).toBe(false);
    expect(mocks.priority).toHaveBeenCalledOnce();
  });

  it('expires stale busy after fifteen seconds of status failures and safely retries status without auto dialing', async () => {
    mocks.status.mockImplementation(async () => json({ busyWithReminder: true }));
    mocks.priority.mockReturnValueOnce(deferred<Response>().promise);
    await renderPhone(false);
    vi.useFakeTimers();
    await act(async () => mocks.callbacks.onWSLogin({}, true));
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(mocks.value.isLineBusyWithReminder).toBe(true);
    mocks.status.mockImplementation(async () => json({ error: 'onlinePbxUnavailable' }, 503));
    await act(async () => vi.advanceTimersByTimeAsync(14_000));
    expect(mocks.value.isLineBusyWithReminder).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(1_100));
    expect(mocks.value.isLineBusyWithReminder).toBe(false);
    expect((screen.getByTestId('card-1') as HTMLButtonElement).disabled).toBe(false);
    expect(mocks.newCall).not.toHaveBeenCalled();
    expect(mocks.microphone).not.toHaveBeenCalled();
    mocks.status.mockImplementation(async () => json({ busyWithReminder: true }));
    await act(async () => vi.advanceTimersByTimeAsync(2_500));
    expect(mocks.value.isLineBusyWithReminder).toBe(true);
  });

  it('bounds hanging status and priority requests without overlapping reads or duplicate priorities', async () => {
    const pending = deferred<Response>();
    mocks.status.mockReturnValueOnce(pending.promise).mockImplementation(async () => json({ busyWithReminder: true }));
    mocks.priority.mockReturnValueOnce(deferred<Response>().promise);
    await renderPhone(false);
    vi.useFakeTimers();
    await act(async () => mocks.callbacks.onWSLogin({}, true));
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(mocks.status).toHaveBeenCalledOnce();
    expect(mocks.priority).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(8_000));
    expect(mocks.status.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mocks.priority).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(mocks.priority).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(8_000));
    expect(mocks.priority).toHaveBeenCalledTimes(2);
    expect(mocks.newCall).not.toHaveBeenCalled();
  });

  it('refreshes on foreground, focus and online but does not poll or request priority in the background', async () => {
    mocks.visibility = 'hidden';
    mocks.status.mockImplementation(async () => json({ busyWithReminder: true }));
    const view = await renderPhone();
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.priority).not.toHaveBeenCalled();
    mocks.visibility = 'visible';
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(mocks.priority).toHaveBeenCalledOnce());
    await act(async () => window.dispatchEvent(new Event('focus')));
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(mocks.status.mock.calls.length).toBeGreaterThanOrEqual(3);
    mocks.visibility = 'hidden';
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    const reads = mocks.status.mock.calls.length;
    vi.useFakeTimers();
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(mocks.status).toHaveBeenCalledTimes(reads);
    view.unmount();
    await act(async () => { window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); });
    expect(mocks.status).toHaveBeenCalledTimes(reads);
  });

  it('disables history callbacks and finished-call redial while retaining phone and contact data', async () => {
    mocks.status.mockImplementation(async () => json({ busyWithReminder: true }));
    const view = await renderPhone();
    await waitFor(() => expect(mocks.value.isLineBusyWithReminder).toBe(true));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: i18n.t('telephonyOpen') }));
    await user.click(screen.getByRole('tab', { name: i18n.t('historyTab') }));
    await screen.findByText('Historical contact');
    const panel = screen.getByRole('dialog', { name: i18n.t('telephonyTitle') });
    expect((within(panel).getByRole('button', { name: i18n.t('telephonyLineBusyWithReminder') }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Historical contact')).toBeTruthy();
    mocks.status.mockImplementation(async () => json({ busyWithReminder: false }));
    await act(async () => refetchStatus(view.client));
    await waitFor(() => expect(mocks.value.isLineBusyWithReminder).toBe(false));
    await act(async () => mocks.value.startCall('+998901234567'));
    const session = mocks.newCall.mock.results[0].value;
    session.state.name = 'hangup';
    await act(async () => mocks.callbacks.onDialogState(session));
    mocks.status.mockImplementation(async () => json({ busyWithReminder: true }));
    await act(async () => refetchStatus(view.client));
    await waitFor(() => expect(mocks.value.isLineBusyWithReminder).toBe(true));
    const redial = within(panel).getByRole('button', { name: i18n.t('telephonyLineBusyWithReminder') }) as HTMLButtonElement;
    expect(redial.disabled).toBe(true);
    await user.click(redial);
    expect(mocks.newCall).toHaveBeenCalledOnce();
    expect(mocks.microphone).toHaveBeenCalledOnce();
  });

  it.each([{}, { busyWithReminder: 'true' }, { error: 'onlinePbxUnavailable' }])('never interprets an invalid or failed status as robot occupancy: %j', async payload => {
    mocks.status.mockImplementation(async () => json(payload, 'error' in payload ? 503 : 200));
    await renderPhone();
    await waitFor(() => expect(mocks.status).toHaveBeenCalledOnce());
    expect(mocks.value.isLineBusyWithReminder).toBe(false);
    expect((screen.getByTestId('card-1') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId('card-1').textContent).toBe(i18n.t('call'));
    expect(mocks.priority).not.toHaveBeenCalled();
    expect(mocks.microphone).not.toHaveBeenCalled();
    expect(requestCount('/lines/reserve')).toBe(0);
  });

  it('does not inspect or request a manager line while the CRM actor is unassigned', async () => {
    mocks.authenticated = false;
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><TelephonyProvider><Probe /></TelephonyProvider></QueryClientProvider>);
    expect(mocks.value.isManagerAssigned).toBe(false);
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.priority).not.toHaveBeenCalled();
  });


  it('requests priority again after a background gap only after a fresh busy GET', async () => {
    mocks.status.mockImplementation(async () => json({ busyWithReminder: true }));
    await renderPhone();
    await waitFor(() => expect(mocks.priority).toHaveBeenCalledOnce());
    mocks.visibility = 'hidden';
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    const resumed = deferred<Response>();
    mocks.status.mockReturnValueOnce(resumed.promise);
    mocks.visibility = 'visible';
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(mocks.priority).toHaveBeenCalledOnce();
    await act(async () => resumed.resolve(json({ busyWithReminder: true })));
    await waitFor(() => expect(mocks.priority).toHaveBeenCalledTimes(2));
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(mocks.priority).toHaveBeenCalledTimes(2);
    expect(mocks.newCall).not.toHaveBeenCalled();
  });

  it('requests priority for a fresh busy episode after old occupancy expired to unknown', async () => {
    mocks.status.mockImplementation(async () => json({ busyWithReminder: true }));
    await renderPhone(false);
    vi.useFakeTimers();
    await act(async () => mocks.callbacks.onWSLogin({}, true));
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(mocks.priority).toHaveBeenCalledOnce();
    mocks.status.mockImplementation(async () => json({ error: 'onlinePbxUnavailable' }, 503));
    await act(async () => vi.advanceTimersByTimeAsync(15_100));
    expect(mocks.value.isLineBusyWithReminder).toBe(false);
    mocks.status.mockImplementation(async () => json({ busyWithReminder: true }));
    await act(async () => vi.advanceTimersByTimeAsync(2_500));
    expect(mocks.value.isLineBusyWithReminder).toBe(true);
    expect(mocks.priority).toHaveBeenCalledTimes(2);
    expect(mocks.newCall).not.toHaveBeenCalled();
  });

  it('does not treat a priority false ACK as protection for the next fresh busy episode', async () => {
    mocks.status.mockImplementation(async () => json({ busyWithReminder: true }));
    mocks.priority.mockImplementationOnce(async () => json({ busyWithReminder: false }));
    await renderPhone(false);
    vi.useFakeTimers();
    await act(async () => mocks.callbacks.onWSLogin({}, true));
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(mocks.priority).toHaveBeenCalledOnce();
    expect(mocks.value.isLineBusyWithReminder).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(2_500));
    expect(mocks.priority).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(mocks.priority).toHaveBeenCalledTimes(2);
    expect(mocks.newCall).not.toHaveBeenCalled();
    expect(mocks.microphone).not.toHaveBeenCalled();
  });

});
