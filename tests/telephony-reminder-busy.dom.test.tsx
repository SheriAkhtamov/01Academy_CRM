// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelephonyProvider, useTelephony } from '../client/src/contexts/TelephonyContext';
import { TelephonyWidget } from '../client/src/components/telephony/TelephonyWidget';
import { useOnlinePbxCall } from '../client/src/hooks/useOnlinePbxCall';
import { isReminderLineBusyError } from '../client/src/features/telephony/call-errors';
import { i18n } from '../client/src/lib/i18n';
import { Sheet, SheetContent, SheetTitle } from '../client/src/components/ui/sheet';

const mocks = vi.hoisted(() => ({
  stage: 'reserve' as 'reserve' | 'authorize' | 'free' | 'failed',
  admissionFailure: null as { error: string; status: number } | null,
  value: null as any,
  callbacks: null as any,
  fetch: vi.fn(), newCall: vi.fn(), microphone: vi.fn(), stop: vi.fn(), toast: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({
  isAuthenticated: true,
  user: { id: 7, fullName: 'Manager', onlinePbxExtension: '100', onlinePbxIncomingEnabled: true },
}) }));
vi.mock('@/hooks/use-toast', () => ({ toast: mocks.toast }));
vi.mock('@/lib/incomingCallRingtone', () => ({
  shouldPlayIncomingRingtone: () => false,
  IncomingCallRingtone: class { start() { return Promise.resolve(); } stop() {} destroy() {} unlock() { return Promise.resolve(true); } },
}));
vi.mock('@xswitch/rtc', () => ({ Verto: class {
  constructor(_options: unknown, callbacks: unknown) { mocks.callbacks = callbacks; }
  socketReady() { return true; }
  closeSocket() {}
  newCall(options: { callID: string }) { return mocks.newCall(options); }
} }));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const requestsTo = (suffix: string) => mocks.fetch.mock.calls.filter(([url]) => String(url).endsWith(suffix));

function CardCallButton() {
  const call = useOnlinePbxCall();
  return <button type="button" onClick={() => call.startCall('+998901234567')}>CRM card call</button>;
}
function Probe() { mocks.value = useTelephony(); return null; }
async function renderPhone(inSheet = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><TelephonyProvider>
    {inSheet ? <Sheet open><SheetContent aria-describedby={undefined}>
      <SheetTitle>CRM card</SheetTitle><CardCallButton />
    </SheetContent></Sheet> : <CardCallButton />}
    <Probe /><TelephonyWidget />
  </TelephonyProvider></QueryClientProvider>);
  await waitFor(() => expect(mocks.callbacks).toBeTruthy());
  await act(async () => mocks.callbacks.onWSLogin({}, true));
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mocks.stage = 'reserve';
  mocks.admissionFailure = null;
  mocks.value = null;
  mocks.callbacks = null;
  i18n.setLanguage('en');
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('fetch', mocks.fetch);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  mocks.microphone.mockResolvedValue({ getTracks: () => [{ stop: mocks.stop }] });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: mocks.microphone } });
  mocks.newCall.mockImplementation((options: { callID: string }) => ({
    callID: options.callID, direction: { name: 'outbound' }, state: { name: 'trying' },
    hangup: vi.fn(), answer: vi.fn(), setMute: vi.fn(), getMute: vi.fn(), toggleHold: vi.fn(), dtmf: vi.fn(), transfer: vi.fn(),
  }));
  mocks.fetch.mockImplementation(async (url: string, options?: { body?: string }) => {
    if (url.endsWith('/credentials')) return json({ extension: '100', username: 'synthetic', password: 'synthetic', sipDomain: 'example.test', websocketUrl: 'wss://example.test' });
    if (url.endsWith('/lines/status') || url.endsWith('/lines/request-priority')) {
      return json({ busyWithReminder: requestsTo('/lines/reserve').length > 0 && (mocks.stage === 'reserve' || mocks.stage === 'authorize') && !mocks.admissionFailure });
    }
    if (url.endsWith('/lines/reserve')) {
      if (mocks.admissionFailure) return json({ error: mocks.admissionFailure.error }, mocks.admissionFailure.status);
      if (mocks.stage === 'reserve') return json({ error: 'onlinePbxLineBusyWithReminder' }, 409);
      if (mocks.stage === 'failed') return json({ error: 'unrecognizedInternalFailure' }, 500);
      return json({ id: 'manager-lease' });
    }
    if (url.endsWith('/lines/authorize')) return mocks.stage === 'authorize'
      ? json({ error: 'onlinePbxLineBusyWithReminder' }, 409) : json({ authorized: true });
    if (url.endsWith('/lines/release')) return json({ released: true });
    if (url.endsWith('/lines/renew')) return json({ alive: true });
    if (url.endsWith('/calls/events')) return json({ id: 11, clientCallId: JSON.parse(options?.body ?? '{}').clientCallId });
    if (url.endsWith('/missed/unread')) return json({ count: 0 });
    if (url.includes('/contacts/lookup')) return json({ contact: null });
    return json([]);
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('reminder-busy feedback at call entry points', () => {
  it.each(['en', 'ru'] as const)('shows the localized refusal from a CRM card in %s without a generic toast or call event', async (language) => {
    i18n.setLanguage(language);
    const user = await renderPhone();
    await user.click(screen.getByRole('button', { name: 'CRM card call' }));
    const error = await screen.findByRole('alert');
    expect(error.textContent).toBe(i18n.t('onlinePbxLineBusyWithReminder'));
    const phone = screen.getByRole('dialog', { name: i18n.t('telephonyTitle') });
    expect(phone.contains(error)).toBe(true);
    expect((within(phone).getByRole('button', { name: i18n.t('telephonyLineBusyWithReminder') }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.value.activeCall.errorCode).toBe('onlinePbxLineBusyWithReminder');
    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(mocks.newCall).not.toHaveBeenCalled();
    expect(requestsTo('/calls/events')).toHaveLength(0);
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith({ title: i18n.t('onlinePbxLineBusyWithReminder'), variant: 'destructive' });
  });

  it('preserves an open CRM sheet and sends its exact refusal through the global toast entry point', async () => {
    const user = await renderPhone(true);
    const card = screen.getByRole('dialog', { name: 'CRM card' });
    await user.click(within(card).getByRole('button', { name: 'CRM card call' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledExactlyOnceWith({ title: i18n.t('onlinePbxLineBusyWithReminder'), variant: 'destructive' }));
    expect(screen.getByRole('dialog', { name: 'CRM card' })).toBe(card);
    expect(card.getAttribute('data-state')).toBe('open');
    expect(mocks.value.activeCall.errorCode).toBe('onlinePbxLineBusyWithReminder');
    expect(mocks.newCall).not.toHaveBeenCalled();
    expect(requestsTo('/calls/events')).toHaveLength(0);
  });

  it('does not toast a cancelled card attempt over its connected successor', async () => {
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>((resolvePromise) => { resolve = resolvePromise; });
    const user = await renderPhone(true);
    const ordinaryFetch = mocks.fetch.getMockImplementation()!;
    let reserved = false;
    mocks.fetch.mockImplementation((url: string, options?: { body?: string }) => {
      if (url.endsWith('/lines/reserve') && !reserved) { reserved = true; return pending; }
      return ordinaryFetch(url, options);
    });
    await user.click(screen.getByRole('button', { name: 'CRM card call' }));
    await waitFor(() => expect(requestsTo('/lines/reserve')).toHaveLength(1));
    await act(async () => mocks.value.hangupCall());
    mocks.stage = 'free';
    await act(async () => mocks.value.startCall('+998901234568'));
    const successor = mocks.newCall.mock.results[0].value;
    successor.state.name = 'active';
    await act(async () => mocks.callbacks.onDialogState(successor));
    await act(async () => resolve(json({ error: 'onlinePbxLineBusyWithReminder' }, 409)));
    expect(mocks.value.activeCall.clientCallId).toBe(successor.callID);
    expect(mocks.value.activeCall.status).toBe('connected');
    expect(mocks.value.activeCall.errorCode).toBeNull();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it.each(['reserve', 'authorize'] as const)('shows a %s refusal from the widget dialer and waits for an explicit retry after the line becomes free', async (stage) => {
    mocks.stage = stage;
    const user = await renderPhone();
    await user.click(screen.getByRole('button', { name: i18n.t('telephonyOpen') }));
    const phone = screen.getByRole('dialog', { name: i18n.t('telephonyTitle') });
    fireEvent.change(within(phone).getByRole('textbox'), { target: { value: '+998901234567' } });
    await user.click(within(phone).getByRole('button', { name: i18n.t('call') }));
    expect((await screen.findByRole('alert')).textContent).toBe(i18n.t('onlinePbxLineBusyWithReminder'));
    expect(requestsTo('/lines/reserve')).toHaveLength(1);
    expect(requestsTo('/calls/events')).toHaveLength(0);
    expect(mocks.newCall).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
    if (stage === 'authorize') {
      expect(requestsTo('/lines/release')).toHaveLength(1);
      expect(JSON.parse(requestsTo('/lines/release')[0][1].body)).toEqual({ id: 'manager-lease', beforeInvite: true });
    }
    mocks.stage = 'free';
    vi.useFakeTimers();
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(185_000);
    });
    expect(requestsTo('/lines/reserve')).toHaveLength(1);
    expect(mocks.newCall).not.toHaveBeenCalled();
    vi.useRealTimers();
    await user.click(screen.getByRole('button', { name: i18n.t('telephonyCallAgain') }));
    await waitFor(() => expect(mocks.newCall).toHaveBeenCalledOnce());
    expect(requestsTo('/lines/reserve')).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(requestsTo('/calls/events')).toHaveLength(1);
  });

  it.each([
    ['onlinePbxTooManyCalls', 409], ['onlinePbxUnavailable', 503], ['onlinePbxManagerNotAssigned', 403], ['onlinePbxInvalidCallEvent', 400],
  ] as const)('shows the exact %s refusal through a CRM sheet and its widget without a generic toast', async (key, status) => {
    i18n.setLanguage('ru');
    mocks.admissionFailure = { error: key, status };
    const user = await renderPhone(true);
    await user.click(screen.getByRole('button', { name: 'CRM card call' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledExactlyOnceWith({ title: i18n.t(key), variant: 'destructive' }));
    expect(mocks.value.activeCall.errorCode).toBe(key);
    expect(mocks.newCall).not.toHaveBeenCalled();
    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(requestsTo('/calls/events')).toHaveLength(0);
    expect(screen.getByRole('dialog', { name: 'CRM card' })).toBeTruthy();
  });

  it.each([
    ['onlinePbxTooManyCalls', 409], ['onlinePbxUnavailable', 503],
  ] as const)('keeps %s readable inline for the widget without a duplicate toast or automatic redial', async (key, status) => {
    mocks.admissionFailure = { error: key, status };
    const user = await renderPhone();
    await user.click(screen.getByRole('button', { name: i18n.t('telephonyOpen') }));
    const phone = screen.getByRole('dialog', { name: i18n.t('telephonyTitle') });
    fireEvent.change(within(phone).getByRole('textbox'), { target: { value: '+998901234567' } });
    await user.click(within(phone).getByRole('button', { name: i18n.t('call') }));
    expect((await screen.findByRole('alert')).textContent).toBe(i18n.t(key));
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(mocks.newCall).not.toHaveBeenCalled();
    expect(requestsTo('/calls/events')).toHaveLength(0);
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(requestsTo('/lines/reserve')).toHaveLength(1);
  });

  it('keeps an unrelated server failure generic instead of claiming the reminder is on the line', async () => {
    mocks.stage = 'failed';
    const user = await renderPhone();
    await user.click(screen.getByRole('button', { name: 'CRM card call' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledOnce());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mocks.value.activeCall.errorCode).toBe('CALL_SETUP_FAILED');
    expect(mocks.newCall).not.toHaveBeenCalled();
    expect(requestsTo('/calls/events')).toHaveLength(0);
  });

  it('recognizes the typed refusal without mistaking other statuses or unrecognized server details for it', () => {
    expect(isReminderLineBusyError(Object.assign(new Error('Localized text'), { rawMessage: 'onlinePbxLineBusyWithReminder', status: 409 }))).toBe(true);
    expect(isReminderLineBusyError(new Error('onlinePbxLineBusyWithReminder'))).toBe(true);
    expect(isReminderLineBusyError({ rawMessage: 'onlinePbxLineBusyWithReminder', status: 500 })).toBe(false);
    expect(isReminderLineBusyError({ rawMessage: 'onlinePbxTooManyCalls', status: 409 })).toBe(false);
    expect(isReminderLineBusyError(new Error('Private server details'))).toBe(false);
  });
});
