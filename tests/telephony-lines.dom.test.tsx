// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  onDialogState: null as ((dialog: any) => void) | null,
  callbacks: null as any,
  value: null as any,
  api: vi.fn(), reserveLine: vi.fn(), releaseLine: vi.fn(), renewLine: vi.fn(),
  microphone: vi.fn(), newCall: vi.fn(),
  socketReady: true,
  authenticated: true,
  user: { id: 7, fullName: 'Test User', onlinePbxExtension: '100', onlinePbxIncomingEnabled: true },
  errors: [] as Array<(error?: unknown) => void>,
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user, isAuthenticated: mocks.authenticated }) }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: mocks.api }));
vi.mock('@/features/telephony/api', () => ({ telephonyApi: {
  reserveLine: mocks.reserveLine, releaseLine: mocks.releaseLine, renewLine: mocks.renewLine,
} }));
vi.mock('@/lib/incomingCallRingtone', () => ({
  shouldPlayIncomingRingtone: () => false,
  IncomingCallRingtone: class { start() { return Promise.resolve(); } stop() {} destroy() {} unlock() { return Promise.resolve(true); } },
}));
vi.mock('@xswitch/rtc', () => ({
  Verto: class {
    constructor(_options: unknown, callbacks: any) {
      mocks.callbacks = callbacks;
      mocks.onDialogState = callbacks.onDialogState;
    }
    socketReady() { return mocks.socketReady; }
    closeSocket() {}
    newCall(options: any, _callbacks: unknown, _success: unknown, onError: (error?: unknown) => void) {
      mocks.errors.push(onError);
      return mocks.newCall(options);
    }
  },
}));

import { TelephonyProvider, useTelephony } from '../client/src/contexts/TelephonyContext';

const deferred = <Value,>() => {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};
const microphone = () => {
  const stop = vi.fn();
  return { stop, stream: { getTracks: () => [{ stop }] } as unknown as MediaStream };
};
const dialog = (callID: string) => ({
  callID, direction: { name: 'outbound' }, state: { name: 'active' },
  answer: vi.fn(), hangup: vi.fn(), setMute: vi.fn().mockReturnValue(true), getMute: vi.fn(),
  toggleHold: vi.fn(), dtmf: vi.fn(), transfer: vi.fn(),
});
function Probe() { mocks.value = useTelephony(); return null; }

async function renderPhone() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><TelephonyProvider><Probe /></TelephonyProvider></QueryClientProvider>;
  const view = render(tree());
  await waitFor(() => expect(mocks.onDialogState).toBeTruthy());
  return { ...view, refresh: () => view.rerender(tree()), client };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.onDialogState = null;
  mocks.value = null;
  mocks.errors = [];
  mocks.socketReady = true;
  mocks.authenticated = true;
  mocks.user = { id: 7, fullName: 'Test User', onlinePbxExtension: '100', onlinePbxIncomingEnabled: true };
  mocks.api.mockImplementation(async (_method: string, url: string) => {
    if (url === '/api/telephony/credentials') return {
      extension: '100', username: 'test', password: 'synthetic', sipDomain: 'example.test', websocketUrl: 'wss://example.test',
    };
    if (url === '/api/telephony/calls/events') return { id: 1 };
    if (url.startsWith('/api/telephony/contacts/lookup')) return { contact: null };
    return {};
  });
  mocks.reserveLine.mockResolvedValue({ id: 'first-lease' });
  mocks.releaseLine.mockResolvedValue({ ok: true });
  mocks.renewLine.mockResolvedValue({ alive: true });
  mocks.microphone.mockResolvedValue(microphone().stream);
  mocks.newCall.mockImplementation((options: { callID: string }) => dialog(options.callID));
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: mocks.microphone } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('manager outgoing channel ownership', () => {
  it('serializes two starts before microphone permission and preserves the first call controls', async () => {
    const permission = deferred<MediaStream>();
    mocks.microphone.mockReturnValue(permission.promise);
    await renderPhone();
    let first!: Promise<unknown>;
    await act(async () => { first = mocks.value.startCall('+998901234567').catch((error: Error) => error); });
    await waitFor(() => expect(mocks.microphone).toHaveBeenCalledTimes(1));
    let second!: unknown;
    await act(async () => { second = await mocks.value.startCall('+998901234568').catch((error: Error) => error); });
    expect(second).toMatchObject({ message: 'onlinePbxCallAlreadyActive' });
    expect(mocks.value.pendingPhone).toBe('+998901234567');
    expect(mocks.reserveLine).not.toHaveBeenCalled();
    await act(async () => { permission.resolve(microphone().stream); await first; });
    expect(mocks.reserveLine).toHaveBeenCalledTimes(1);
    expect(mocks.newCall).toHaveBeenCalledTimes(1);
    const session = mocks.newCall.mock.results[0].value;
    await act(async () => mocks.onDialogState!(session));
    await act(async () => { mocks.value.toggleMute(); await mocks.value.sendDtmf('2'); });
    expect(session.setMute).toHaveBeenCalledExactlyOnceWith('toggle');
    expect(session.dtmf).toHaveBeenCalledExactlyOnceWith('2');
    expect(mocks.releaseLine).not.toHaveBeenCalled();
  });

  it('waits for a channel reservation before inviting and refuses busy preflight', async () => {
    const reservation = deferred<{ id: string }>();
    mocks.reserveLine.mockReturnValue(reservation.promise);
    await renderPhone();
    let starting!: Promise<unknown>;
    await act(async () => { starting = mocks.value.startCall('+998901234567').catch((error: Error) => error); });
    await waitFor(() => expect(mocks.reserveLine).toHaveBeenCalledTimes(1));
    expect(mocks.newCall).not.toHaveBeenCalled();
    await act(async () => {
      reservation.reject(Object.assign(new Error('onlinePbxTooManyCalls'), { status: 409 }));
      await starting;
    });
    expect(mocks.newCall).not.toHaveBeenCalled();
    expect(mocks.releaseLine).not.toHaveBeenCalled();
    expect(mocks.api.mock.calls.filter(([, url]) => url === '/api/telephony/calls/events')).toHaveLength(0);
    expect(mocks.value.pendingPhone).toBeNull();
    mocks.reserveLine.mockResolvedValueOnce({ id: 'retry-lease' });
    await act(async () => mocks.value.startCall('+998901234567'));
    expect(mocks.newCall).toHaveBeenCalledTimes(1);
    expect(mocks.api.mock.calls.filter(([, url]) => url === '/api/telephony/calls/events')).toHaveLength(1);
    expect(mocks.reserveLine.mock.invocationCallOrder.at(-1)!).toBeLessThan(mocks.newCall.mock.invocationCallOrder[0]);
  });

  it('releases a late abandoned reservation without clearing a successor call lease or controls', async () => {
    const abandoned = deferred<{ id: string }>();
    mocks.reserveLine.mockReturnValueOnce(abandoned.promise).mockResolvedValueOnce({ id: 'successor-lease' });
    await renderPhone();
    let first!: Promise<unknown>;
    await act(async () => { first = mocks.value.startCall('+998901234567').catch((error: Error) => error); });
    await waitFor(() => expect(mocks.reserveLine).toHaveBeenCalledTimes(1));
    await act(async () => mocks.value.hangupCall());
    await act(async () => mocks.value.startCall('+998901234568'));
    const successor = mocks.newCall.mock.results[0].value;
    await act(async () => mocks.onDialogState!(successor));
    await act(async () => { abandoned.resolve({ id: 'abandoned-lease' }); await first; });
    expect(mocks.releaseLine).toHaveBeenCalledExactlyOnceWith('abandoned-lease');
    expect(mocks.value.activeCall.clientCallId).toBe(successor.callID);
    expect(mocks.value.activeCall.status).toBe('connected');
    await act(async () => mocks.value.toggleMute());
    expect(successor.setMute).toHaveBeenCalledExactlyOnceWith('toggle');
    await act(async () => mocks.value.hangupCall());
    expect(mocks.releaseLine.mock.calls.map(([id]) => id)).toEqual(['abandoned-lease', 'successor-lease']);
  });

  it('releases only its own lease and ignores stale errors from an earlier completed call', async () => {
    mocks.reserveLine.mockResolvedValueOnce({ id: 'first-lease' }).mockResolvedValueOnce({ id: 'second-lease' });
    await renderPhone();
    await act(async () => mocks.value.startCall('+998901234567'));
    const first = mocks.newCall.mock.results[0].value;
    first.state.name = 'hangup';
    await act(async () => mocks.onDialogState!(first));
    await act(async () => mocks.value.startCall('+998901234568'));
    const second = mocks.newCall.mock.results[1].value;
    await act(async () => mocks.onDialogState!(second));
    await act(async () => { mocks.errors[0](new Error('stale setup error')); mocks.onDialogState!(first); });
    expect(mocks.releaseLine).toHaveBeenCalledExactlyOnceWith('first-lease');
    expect(mocks.value.activeCall.clientCallId).toBe(second.callID);
    await act(async () => mocks.value.toggleMute());
    expect(second.setMute).toHaveBeenCalledOnce();
  });

  it('stops a microphone granted after logout and does not reserve or invite', async () => {
    const permission = deferred<MediaStream>();
    const media = microphone();
    mocks.microphone.mockReturnValue(permission.promise);
    const view = await renderPhone();
    let starting!: Promise<unknown>;
    await act(async () => { starting = mocks.value.startCall('+998901234567').catch((error: Error) => error); });
    await waitFor(() => expect(mocks.microphone).toHaveBeenCalledOnce());
    mocks.authenticated = false;
    await act(async () => view.refresh());
    await act(async () => { permission.resolve(media.stream); await starting; });
    expect(media.stop).toHaveBeenCalledOnce();
    expect(mocks.reserveLine).not.toHaveBeenCalled();
    expect(mocks.newCall).not.toHaveBeenCalled();
    expect(mocks.value.activeCall).toBeNull();
  });

  it('does not let late microphone permission clear or stop a successor preflight', async () => {
    const abandonedPermission = deferred<MediaStream>();
    const successorReservation = deferred<{ id: string }>();
    const abandonedMedia = microphone();
    const successorMedia = microphone();
    mocks.microphone.mockReturnValueOnce(abandonedPermission.promise).mockResolvedValueOnce(successorMedia.stream);
    mocks.reserveLine.mockReturnValueOnce(successorReservation.promise);
    await renderPhone();
    let first!: Promise<unknown>;
    await act(async () => { first = mocks.value.startCall('+998901234567').catch((error: Error) => error); });
    await waitFor(() => expect(mocks.microphone).toHaveBeenCalledOnce());
    await act(async () => mocks.value.hangupCall());
    let second!: Promise<unknown>;
    await act(async () => { second = mocks.value.startCall('+998901234568'); });
    await waitFor(() => expect(mocks.reserveLine).toHaveBeenCalledOnce());
    await act(async () => { abandonedPermission.resolve(abandonedMedia.stream); await first; });
    expect(abandonedMedia.stop).toHaveBeenCalledOnce();
    expect(successorMedia.stop).not.toHaveBeenCalled();
    expect(mocks.value.pendingPhone).toBe('+998901234568');
    expect(mocks.value.activeCall.phone).toBe('+998901234568');
    await act(async () => { successorReservation.resolve({ id: 'successor-lease' }); await second; });
    expect(mocks.newCall).toHaveBeenCalledOnce();
    expect(mocks.releaseLine).not.toHaveBeenCalled();
  });

  it('clears the previous user preflight and preserves the new user call when the old reservation arrives', async () => {
    const reservation = deferred<{ id: string }>();
    mocks.reserveLine.mockReturnValueOnce(reservation.promise).mockResolvedValueOnce({ id: 'new-user-lease' });
    const view = await renderPhone();
    let first!: Promise<unknown>;
    await act(async () => { first = mocks.value.startCall('+998901234567').catch((error: Error) => error); });
    await waitFor(() => expect(mocks.reserveLine).toHaveBeenCalledOnce());
    const previousCallbacks = mocks.onDialogState;
    mocks.user = { ...mocks.user, id: 8 };
    await act(async () => view.refresh());
    await waitFor(() => expect(mocks.onDialogState).not.toBe(previousCallbacks));
    expect(mocks.value.activeCall).toBeNull();
    await act(async () => mocks.value.startCall('+998901234568'));
    const current = mocks.newCall.mock.results[0].value;
    await act(async () => mocks.onDialogState!(current));
    await act(async () => { reservation.resolve({ id: 'old-user-lease' }); await first; });
    expect(mocks.releaseLine).toHaveBeenCalledExactlyOnceWith('old-user-lease');
    expect(mocks.value.activeCall.clientCallId).toBe(current.callID);
    expect(mocks.value.activeCall.status).toBe('connected');
  });

  it('releases a reservation returned after unmount without inviting', async () => {
    const reservation = deferred<{ id: string }>();
    mocks.reserveLine.mockReturnValue(reservation.promise);
    const view = await renderPhone();
    let starting!: Promise<unknown>;
    await act(async () => { starting = mocks.value.startCall('+998901234567').catch((error: Error) => error); });
    await waitFor(() => expect(mocks.reserveLine).toHaveBeenCalledOnce());
    view.unmount();
    await act(async () => { reservation.resolve({ id: 'late-lease' }); await starting; });
    expect(mocks.releaseLine).toHaveBeenCalledExactlyOnceWith('late-lease');
    expect(mocks.newCall).not.toHaveBeenCalled();
  });

  it('releases the acquired lease if the provider goes offline during reservation', async () => {
    const reservation = deferred<{ id: string }>();
    mocks.reserveLine.mockReturnValue(reservation.promise);
    await renderPhone();
    let starting!: Promise<unknown>;
    await act(async () => { starting = mocks.value.startCall('+998901234567').catch((error: Error) => error); });
    await waitFor(() => expect(mocks.reserveLine).toHaveBeenCalledOnce());
    mocks.socketReady = false;
    await act(async () => { reservation.resolve({ id: 'offline-lease' }); await starting; });
    expect(mocks.releaseLine).toHaveBeenCalledExactlyOnceWith('offline-lease');
    expect(mocks.newCall).not.toHaveBeenCalled();
    expect(mocks.value.activeCall).toBeNull();
  });

  it('preserves normal calling with a null lease when reminders are disabled', async () => {
    mocks.reserveLine.mockResolvedValue({ id: null });
    const view = await renderPhone();
    await act(async () => mocks.value.startCall('+998901234567'));
    expect(mocks.newCall).toHaveBeenCalledOnce();
    await act(async () => mocks.value.hangupCall());
    view.unmount();
    expect(mocks.releaseLine).not.toHaveBeenCalled();
  });

  it('releases an active owned lease once on unmount', async () => {
    const view = await renderPhone();
    await act(async () => mocks.value.startCall('+998901234567'));
    view.unmount();
    expect(mocks.releaseLine).toHaveBeenCalledExactlyOnceWith('first-lease');
  });

  it('preserves the manager conversation and controls when renewal reports an expired lease', async () => {
    const intervals = vi.spyOn(window, 'setInterval');
    mocks.renewLine.mockResolvedValue({ alive: false });
    await renderPhone();
    await act(async () => mocks.value.startCall('+998901234567'));
    const session = mocks.newCall.mock.results[0].value;
    await act(async () => mocks.onDialogState!(session));
    const renewTick = intervals.mock.calls.find(([, milliseconds]) => milliseconds === 30_000)?.[0];
    expect(typeof renewTick).toBe('function');
    await act(async () => { (renewTick as () => void)(); });
    expect(mocks.renewLine).toHaveBeenCalledExactlyOnceWith('first-lease');
    expect(session.hangup).not.toHaveBeenCalled();
    expect(mocks.releaseLine).not.toHaveBeenCalled();
    expect(mocks.value.activeCall.clientCallId).toBe(session.callID);
    expect(mocks.value.activeCall.status).toBe('connected');
    await act(async () => { mocks.value.toggleMute(); await mocks.value.sendDtmf('3'); });
    expect(session.setMute).toHaveBeenCalledExactlyOnceWith('toggle');
    expect(session.dtmf).toHaveBeenCalledExactlyOnceWith('3');
    await act(async () => mocks.value.hangupCall());
    expect(session.hangup).toHaveBeenCalledExactlyOnceWith({ cause: 'NORMAL_CLEARING' });
    expect(mocks.releaseLine).toHaveBeenCalledExactlyOnceWith('first-lease');
  });
});
