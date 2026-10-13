// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  onDialogState: null as ((dialog: any) => void) | null,
  callbacks: null as any,
  value: null as any,
  api: vi.fn(), reserveLine: vi.fn(), authorizeLine: vi.fn(), releaseLine: vi.fn(), renewLine: vi.fn(),
  microphone: vi.fn(), newCall: vi.fn(),
  socketReady: true,
  authenticated: true,
  user: { id: 7, fullName: 'Test User', onlinePbxExtension: '100', onlinePbxIncomingEnabled: true },
  errors: [] as Array<(error?: unknown) => void>,
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user, isAuthenticated: mocks.authenticated }) }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: mocks.api }));
vi.mock('@/features/telephony/api', () => ({ telephonyApi: {
  reserveLine: mocks.reserveLine, authorizeLine: mocks.authorizeLine, releaseLine: mocks.releaseLine, renewLine: mocks.renewLine,
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
  window.localStorage.clear();
  mocks.onDialogState = null;
  mocks.value = null;
  mocks.errors = [];
  mocks.socketReady = true;
  mocks.authenticated = true;
  mocks.user = { id: 7, fullName: 'Test User', onlinePbxExtension: '100', onlinePbxIncomingEnabled: true };
  mocks.api.mockImplementation(async (_method: string, url: string, data?: { clientCallId?: string }) => {
    if (url === '/api/telephony/credentials') return {
      extension: '100', username: 'test', password: 'synthetic', sipDomain: 'example.test', websocketUrl: 'wss://example.test',
    };
    if (url === '/api/telephony/calls/events') return { id: 1, clientCallId: data?.clientCallId };
    if (url.startsWith('/api/telephony/contacts/lookup')) return { contact: null };
    return {};
  });
  mocks.reserveLine.mockResolvedValue({ id: 'first-lease' });
  mocks.authorizeLine.mockResolvedValue({ authorized: true });
  mocks.releaseLine.mockResolvedValue({ released: true });
  mocks.renewLine.mockResolvedValue({ alive: true });
  mocks.microphone.mockResolvedValue(microphone().stream);
  mocks.newCall.mockImplementation((options: { callID: string }) => dialog(options.callID));
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: mocks.microphone } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('manager outgoing channel ownership', () => {
  it('authorizes the reserved UUID before inviting with that same provider call ID', async () => {
    const authorization = deferred<{ authorized: boolean }>();
    mocks.authorizeLine.mockReturnValueOnce(authorization.promise);
    await renderPhone();
    let starting!: Promise<void>;
    await act(async () => { starting = mocks.value.startCall('+998901234567'); });
    await waitFor(() => expect(mocks.authorizeLine).toHaveBeenCalledExactlyOnceWith('first-lease'));
    expect(mocks.newCall).not.toHaveBeenCalled();
    await act(async () => { authorization.resolve({ authorized: true }); await starting; });
    const reservedCallId = mocks.reserveLine.mock.calls[0][0];
    expect(reservedCallId).toMatch(/^[a-f0-9-]{36}$/);
    expect(mocks.newCall.mock.calls[0][0].callID).toBe(reservedCallId);
    expect(mocks.api.mock.calls.find(([, url]) => url === '/api/telephony/calls/events')?.[2].clientCallId).toBe(reservedCallId);
    expect(mocks.reserveLine.mock.invocationCallOrder[0]).toBeLessThan(mocks.authorizeLine.mock.invocationCallOrder[0]);
    expect(mocks.authorizeLine.mock.invocationCallOrder[0]).toBeLessThan(mocks.newCall.mock.invocationCallOrder[0]);
  });

  it('does not invite or create a KPI event when authorization rejects an expired reservation', async () => {
    mocks.authorizeLine.mockRejectedValueOnce(Object.assign(new Error('onlinePbxTooManyCalls'), { status: 409 }));
    await renderPhone();
    await act(async () => { await mocks.value.startCall('+998901234567').catch(() => undefined); });
    expect(mocks.newCall).not.toHaveBeenCalled();
    expect(mocks.releaseLine).toHaveBeenCalledExactlyOnceWith('first-lease', true);
    expect(mocks.api.mock.calls.some(([, url]) => url === '/api/telephony/calls/events')).toBe(false);
  });

  it('releases a cancelled preflight while authorization is in flight and ignores its late acknowledgement', async () => {
    const authorization = deferred<{ authorized: boolean }>();
    mocks.authorizeLine.mockReturnValueOnce(authorization.promise);
    await renderPhone();
    let starting!: Promise<unknown>;
    await act(async () => { starting = mocks.value.startCall('+998901234567').catch((error: Error) => error); });
    await waitFor(() => expect(mocks.authorizeLine).toHaveBeenCalledOnce());
    await act(async () => mocks.value.hangupCall());
    expect(mocks.releaseLine).toHaveBeenCalledExactlyOnceWith('first-lease', true);
    await act(async () => { authorization.resolve({ authorized: true }); await starting; });
    expect(mocks.newCall).not.toHaveBeenCalled();
    expect(mocks.releaseLine).toHaveBeenCalledOnce();
  });

  it('durably retries owned release when the authorization reply and release acknowledgement are lost', async () => {
    mocks.authorizeLine.mockRejectedValueOnce(new Error('Connection lost after authorization'));
    mocks.releaseLine.mockRejectedValueOnce(new Error('Backend unavailable'));
    await renderPhone();
    await act(async () => { await mocks.value.startCall('+998901234567').catch(() => undefined); });
    expect(mocks.newCall).not.toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem('01academy.telephony.lease-releases.v1:7') ?? '[]'))
      .toEqual([{ actorId: 7, id: 'first-lease', beforeInvite: true }]);
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(mocks.releaseLine.mock.calls).toEqual([['first-lease', true], ['first-lease', true]]);
    expect(JSON.parse(window.localStorage.getItem('01academy.telephony.lease-releases.v1:7') ?? '[]')).toEqual([]);
    expect(mocks.api.mock.calls.some(([, url]) => url === '/api/telephony/calls/events')).toBe(false);
  });

  it('restores a pre-invite release after remount under its original user', async () => {
    mocks.authorizeLine.mockRejectedValueOnce(new Error('Authorization reply lost'));
    mocks.releaseLine.mockRejectedValueOnce(new Error('Release reply lost'));
    const first = await renderPhone();
    await act(async () => { await mocks.value.startCall('+998901234567').catch(() => undefined); });
    first.unmount();
    expect(mocks.releaseLine).toHaveBeenCalledExactlyOnceWith('first-lease', true);
    mocks.onDialogState = null;
    await renderPhone();
    await waitFor(() => expect(mocks.releaseLine.mock.calls).toEqual([['first-lease', true], ['first-lease', true]]));
    expect(JSON.parse(window.localStorage.getItem('01academy.telephony.lease-releases.v1:7') ?? '[]')).toEqual([]);
    expect(mocks.newCall).not.toHaveBeenCalled();
  });

  it('retains an ambiguous SDK invocation and recovers it only through its exact UUID', async () => {
    mocks.newCall.mockImplementationOnce(() => { throw new Error('SDK failed after possible invite'); });
    const first = await renderPhone();
    await act(async () => { await mocks.value.startCall('+998901234567').catch(() => undefined); });
    const callId = mocks.reserveLine.mock.calls[0][0];
    expect(mocks.newCall).toHaveBeenCalledOnce();
    expect(mocks.releaseLine).not.toHaveBeenCalled();
    expect(mocks.api.mock.calls.some(([, url]) => url === '/api/telephony/calls/events')).toBe(false);
    expect(JSON.parse(window.localStorage.getItem('01academy.telephony.call-reports.v1:7') ?? '[]'))
      .toEqual([expect.objectContaining({ confirmed: false, pending: false, leaseId: 'first-lease' })]);
    first.unmount();
    mocks.onDialogState = null;
    await renderPhone();
    const recovered = dialog(callId);
    await act(async () => mocks.onDialogState!(recovered));
    expect(mocks.value.activeCall.status).toBe('connected');
    expect(mocks.releaseLine).not.toHaveBeenCalled();
    recovered.state.name = 'hangup';
    await act(async () => mocks.onDialogState!(recovered));
    expect(mocks.releaseLine).toHaveBeenCalledExactlyOnceWith('first-lease');
  });

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
    expect(mocks.authorizeLine).toHaveBeenCalledExactlyOnceWith('first-lease');
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
    expect(mocks.authorizeLine).toHaveBeenCalledExactlyOnceWith('retry-lease');
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
    expect(mocks.releaseLine).toHaveBeenCalledExactlyOnceWith('abandoned-lease', true);
    expect(mocks.value.activeCall.clientCallId).toBe(successor.callID);
    expect(mocks.value.activeCall.status).toBe('connected');
    await act(async () => mocks.value.toggleMute());
    expect(successor.setMute).toHaveBeenCalledExactlyOnceWith('toggle');
    await act(async () => mocks.value.hangupCall());
    successor.state.name = 'hangup';
    await act(async () => mocks.onDialogState!(successor));
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
    expect(mocks.releaseLine).not.toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem('01academy.telephony.lease-releases.v1:7') ?? '[]'))
      .toEqual([{ actorId: 7, id: 'old-user-lease', beforeInvite: true }]);
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
    expect(mocks.releaseLine).toHaveBeenCalledExactlyOnceWith('late-lease', true);
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
    expect(mocks.releaseLine).toHaveBeenCalledExactlyOnceWith('offline-lease', true);
    expect(mocks.newCall).not.toHaveBeenCalled();
    expect(mocks.value.activeCall).toBeNull();
  });

  it('preserves normal calling with a null lease when reminders are disabled', async () => {
    mocks.reserveLine.mockResolvedValue({ id: null });
    const view = await renderPhone();
    await act(async () => mocks.value.startCall('+998901234567'));
    expect(mocks.newCall).toHaveBeenCalledOnce();
    expect(mocks.authorizeLine).not.toHaveBeenCalled();
    await act(async () => mocks.value.hangupCall());
    view.unmount();
    expect(mocks.releaseLine).not.toHaveBeenCalled();
  });

  it('retains an issued active intent on unmount until provider end or terminal acknowledgement', async () => {
    const view = await renderPhone();
    await act(async () => mocks.value.startCall('+998901234567'));
    view.unmount();
    expect(mocks.releaseLine).not.toHaveBeenCalled();
    const saved = JSON.parse(window.localStorage.getItem('01academy.telephony.call-reports.v1:7') ?? '[]');
    expect(saved).toEqual([expect.objectContaining({ leaseId: 'first-lease', pending: false })]);
  });

  it('preserves the manager conversation and controls when renewal reports an expired lease', async () => {
    const intervals = vi.spyOn(window, 'setInterval');
    mocks.renewLine.mockResolvedValue({ alive: false });
    await renderPhone();
    await act(async () => mocks.value.startCall('+998901234567'));
    const session = mocks.newCall.mock.results[0].value;
    await act(async () => mocks.onDialogState!(session));
    const renewTicks = intervals.mock.calls.filter(([, milliseconds]) => milliseconds === 30_000).map(([tick]) => tick);
    expect(renewTicks).toHaveLength(2);
    await act(async () => { renewTicks.forEach((tick) => (tick as () => void)()); });
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
    session.state.name = 'hangup';
    await act(async () => mocks.onDialogState!(session));
    expect(mocks.releaseLine).toHaveBeenCalledExactlyOnceWith('first-lease');
  });

  it('serializes start and terminal reports and keeps the issued lease until the terminal report is acknowledged', async () => {
    const initial = deferred<{ id: number; clientCallId: string }>();
    const reports: Array<{ clientCallId: string; status: string }> = [];
    const api = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation((method, url, data) => {
      if (url !== '/api/telephony/calls/events') return api(method, url, data);
      reports.push(data);
      return reports.length === 1 ? initial.promise : Promise.resolve({ id: 2, clientCallId: data.clientCallId });
    });
    await renderPhone();
    await act(async () => mocks.value.startCall('+998901234567'));
    const session = mocks.newCall.mock.results[0].value;
    await act(async () => mocks.onDialogState!(session));
    session.state.name = 'hangup';
    await act(async () => mocks.onDialogState!(session));
    expect(reports.map((report) => report.status)).toEqual(['dialing']);
    expect(mocks.releaseLine).not.toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem('01academy.telephony.call-reports.v1:7') ?? '[]'))
      .toEqual([expect.objectContaining({ leaseId: 'first-lease', pending: true, call: expect.objectContaining({ status: 'ended' }) })]);
    await act(async () => initial.resolve({ id: 1, clientCallId: session.callID }));
    expect(reports.map((report) => report.status)).toEqual(['dialing', 'ended']);
    expect(mocks.value.activeCall.status).toBe('ended');
    expect(mocks.releaseLine).toHaveBeenCalledExactlyOnceWith('first-lease');
  });

  it('replays a live call after backend recovery without stopping media or releasing its intent', async () => {
    const intervals = vi.spyOn(window, 'setInterval');
    let offline = true;
    const api = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation((method, url, data) => {
      if (url === '/api/telephony/calls/events' && offline) return Promise.reject(new Error('Backend restarting'));
      return api(method, url, data);
    });
    await renderPhone();
    await act(async () => mocks.value.startCall('+998901234567'));
    const session = mocks.newCall.mock.results[0].value;
    await act(async () => mocks.onDialogState!(session));
    expect(mocks.value.activeCall.status).toBe('connected');
    expect(mocks.releaseLine).not.toHaveBeenCalled();
    offline = false;
    const retry = intervals.mock.calls.find(([, milliseconds]) => milliseconds === 5_000)?.[0] as () => void;
    await act(async () => retry());
    expect(mocks.value.activeCall.status).toBe('connected');
    expect(mocks.value.activeCall.storedCallId).toBe(1);
    expect(session.hangup).not.toHaveBeenCalled();
    expect(mocks.releaseLine).not.toHaveBeenCalled();
    await act(async () => mocks.value.toggleMute());
    expect(session.setMute).toHaveBeenCalledExactlyOnceWith('toggle');
    const reports = mocks.api.mock.calls.filter(([, url]) => url === '/api/telephony/calls/events').map(([, , data]) => data);
    expect(reports[reports.length - 1].status).toBe('connected');
  });

  it('restores an unacknowledged terminal report after remount and releases only after replay succeeds', async () => {
    let offline = true;
    const api = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation((method, url, data) => {
      if (url === '/api/telephony/calls/events' && offline) return Promise.reject(new Error('Backend offline'));
      return api(method, url, data);
    });
    const first = await renderPhone();
    await act(async () => mocks.value.startCall('+998901234567'));
    const session = mocks.newCall.mock.results[0].value;
    await act(async () => mocks.onDialogState!(session));
    session.state.name = 'hangup';
    await act(async () => mocks.onDialogState!(session));
    first.unmount();
    expect(mocks.releaseLine).not.toHaveBeenCalled();
    offline = false;
    mocks.onDialogState = null;
    await renderPhone();
    await waitFor(() => expect(mocks.releaseLine).toHaveBeenCalledExactlyOnceWith('first-lease'));
    expect(JSON.parse(window.localStorage.getItem('01academy.telephony.call-reports.v1:7') ?? '[]')).toEqual([]);
    expect(mocks.value.activeCall).toBeNull();
  });

  it('retries a terminal release that was not acknowledged without resending the completed call', async () => {
    mocks.releaseLine.mockResolvedValueOnce({ released: false });
    await renderPhone();
    await act(async () => mocks.value.startCall('+998901234567'));
    const session = mocks.newCall.mock.results[0].value;
    session.state.name = 'hangup';
    await act(async () => mocks.onDialogState!(session));
    const reports = mocks.api.mock.calls.filter(([, url]) => url === '/api/telephony/calls/events').length;
    expect(JSON.parse(window.localStorage.getItem('01academy.telephony.lease-releases.v1:7') ?? '[]'))
      .toEqual([{ actorId: 7, id: 'first-lease', beforeInvite: false }]);
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(mocks.releaseLine.mock.calls).toEqual([['first-lease'], ['first-lease']]);
    expect(mocks.api.mock.calls.filter(([, url]) => url === '/api/telephony/calls/events')).toHaveLength(reports);
    expect(JSON.parse(window.localStorage.getItem('01academy.telephony.lease-releases.v1:7') ?? '[]')).toEqual([]);
  });

  it('restores a known live call only when the SDK recovers the exact provider UUID', async () => {
    const first = await renderPhone();
    await act(async () => mocks.value.startCall('+998901234567'));
    const original = mocks.newCall.mock.results[0].value;
    await act(async () => mocks.onDialogState!(original));
    first.unmount();
    mocks.onDialogState = null;
    await renderPhone();
    expect(mocks.value.activeCall).toBeNull();
    const unrelated = dialog('unrelated-uuid');
    await act(async () => mocks.onDialogState!(unrelated));
    expect(mocks.value.activeCall).toBeNull();
    const recovered = dialog(original.callID);
    recovered.direction.name = 'inbound';
    recovered.state.name = 'recovering';
    await act(async () => mocks.onDialogState!(recovered));
    expect(mocks.value.activeCall.clientCallId).toBe(original.callID);
    expect(mocks.value.activeCall.direction).toBe('outgoing');
    recovered.state.name = 'active';
    await act(async () => mocks.onDialogState!(recovered));
    await act(async () => mocks.value.sendDtmf('4'));
    expect(recovered.dtmf).toHaveBeenCalledExactlyOnceWith('4');
    expect(mocks.releaseLine).not.toHaveBeenCalled();
  });

  it('retains a conversation on provider disconnect and purge and republishes it on login', async () => {
    await renderPhone();
    await act(async () => mocks.value.startCall('+998901234567'));
    const session = mocks.newCall.mock.results[0].value;
    await act(async () => mocks.onDialogState!(session));
    mocks.socketReady = false;
    await act(async () => mocks.callbacks.onWSClose());
    session.state.name = 'purge';
    await act(async () => mocks.onDialogState!(session));
    session.state.name = 'destroy';
    await act(async () => mocks.onDialogState!(session));
    expect(mocks.value.activeCall.status).toBe('connected');
    expect(mocks.releaseLine).not.toHaveBeenCalled();
    mocks.socketReady = true;
    await act(async () => mocks.callbacks.onWSLogin({}, true));
    const reports = mocks.api.mock.calls.filter(([, url]) => url === '/api/telephony/calls/events').map(([, , data]) => data);
    expect(reports.every((report) => ['dialing', 'connected'].includes(report.status))).toBe(true);
    expect(mocks.value.connectionState).toBe('ready');
  });

  it('retains a live intent when local hangup is requested or emitted while signalling is offline', async () => {
    await renderPhone();
    await act(async () => mocks.value.startCall('+998901234567'));
    const session = mocks.newCall.mock.results[0].value;
    await act(async () => mocks.onDialogState!(session));
    mocks.socketReady = false;
    await act(async () => mocks.value.hangupCall());
    expect(session.hangup).not.toHaveBeenCalled();
    session.cause = 'NORMAL_CLEARING';
    session.state.name = 'hangup';
    await act(async () => mocks.onDialogState!(session));
    session.state.name = 'destroy';
    await act(async () => mocks.onDialogState!(session));
    expect(mocks.value.activeCall.status).toBe('connected');
    expect(mocks.releaseLine).not.toHaveBeenCalled();
    const reports = mocks.api.mock.calls.filter(([, url]) => url === '/api/telephony/calls/events').map(([, , data]) => data);
    expect(reports.every((report) => ['dialing', 'connected'].includes(report.status))).toBe(true);
  });

  it('does not convert an offline unanswered timer into a terminal proof or release', async () => {
    const timeouts = vi.spyOn(window, 'setTimeout');
    await renderPhone();
    await act(async () => mocks.value.startCall('+998901234567'));
    const session = mocks.newCall.mock.results[0].value;
    const deadline = timeouts.mock.calls.find(([, milliseconds]) => milliseconds === 45_000)?.[0] as () => void;
    expect(deadline).toBeTypeOf('function');
    mocks.socketReady = false;
    await act(async () => deadline());
    expect(session.hangup).not.toHaveBeenCalled();
    expect(mocks.value.activeCall.status).toBe('dialing');
    expect(mocks.value.connectionState).toBe('offline');
    expect(mocks.releaseLine).not.toHaveBeenCalled();
    const reports = mocks.api.mock.calls.filter(([, url]) => url === '/api/telephony/calls/events').map(([, , data]) => data);
    expect(reports.every((report) => report.status === 'dialing')).toBe(true);
  });

  it('does not replay a previous user terminal snapshot under a new user session', async () => {
    const api = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation((method, url, data) => {
      if (url === '/api/telephony/calls/events') return Promise.reject(new Error('Backend offline'));
      return api(method, url, data);
    });
    const view = await renderPhone();
    await act(async () => mocks.value.startCall('+998901234567'));
    const session = mocks.newCall.mock.results[0].value;
    session.state.name = 'hangup';
    await act(async () => mocks.onDialogState!(session));
    const previousReports = mocks.api.mock.calls.filter(([, url]) => url === '/api/telephony/calls/events').length;
    mocks.user = { ...mocks.user, id: 8 };
    await act(async () => view.refresh());
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(mocks.api.mock.calls.filter(([, url]) => url === '/api/telephony/calls/events')).toHaveLength(previousReports);
    expect(mocks.releaseLine).not.toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem('01academy.telephony.call-reports.v1:7') ?? '[]')[0].pending).toBe(true);
  });

  it('does not apply a late previous user HTTP receipt to the new user call', async () => {
    const intervals = vi.spyOn(window, 'setInterval');
    const previous = deferred<{ id: number; clientCallId: string }>();
    const api = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation((method, url, data) => {
      if (url === '/api/telephony/calls/events') {
        return mocks.user.id === 7 ? previous.promise : Promise.resolve({ id: 99, clientCallId: data.clientCallId });
      }
      return api(method, url, data);
    });
    const view = await renderPhone();
    await act(async () => mocks.value.startCall('+998901234567'));
    const originalId = mocks.reserveLine.mock.calls[0][0];
    mocks.user = { ...mocks.user, id: 8 };
    await act(async () => view.refresh());
    await waitFor(() => expect(mocks.value.connectionState).toBe('connecting'));
    const renew = intervals.mock.calls.filter(([, milliseconds]) => milliseconds === 30_000)[1][0] as () => void;
    await act(async () => renew());
    expect(mocks.renewLine).not.toHaveBeenCalled();
    await act(async () => mocks.value.startCall('+998901234568'));
    const current = mocks.newCall.mock.results[1].value;
    await act(async () => mocks.onDialogState!(current));
    await act(async () => previous.resolve({ id: 77, clientCallId: originalId }));
    expect(mocks.value.activeCall.clientCallId).toBe(current.callID);
    expect(mocks.value.activeCall.storedCallId).toBe(99);
    expect(mocks.value.activeCall.status).toBe('connected');
    await act(async () => mocks.value.sendDtmf('5'));
    expect(current.dtmf).toHaveBeenCalledExactlyOnceWith('5');
    expect(mocks.releaseLine).not.toHaveBeenCalled();
  });

  it('records incoming dialog arrival before an eligibility and presentation delay', async () => {
    const eligibility = deferred<{ allowed: boolean; delayMs: number }>();
    const api = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation((method, url, data) => url === '/api/telephony/incoming/access'
      ? eligibility.promise : api(method, url, data));
    await renderPhone();
    vi.useFakeTimers();
    const arrival = new Date('2026-10-13T12:00:00.000Z');
    vi.setSystemTime(arrival);
    const incoming = dialog('delayed-incoming');
    incoming.direction.name = 'inbound';
    incoming.state.name = 'ringing';
    await act(async () => mocks.onDialogState!(incoming));
    vi.setSystemTime(new Date(arrival.getTime() + 2_000));
    await act(async () => eligibility.resolve({ allowed: true, delayMs: 10_000 }));
    expect(mocks.value.activeCall).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(mocks.value.activeCall.startedAt).toBe(arrival.toISOString());
    const report = mocks.api.mock.calls.find(([, url]) => url === '/api/telephony/calls/events')?.[2];
    expect(report.startedAt).toBe(arrival.toISOString());
    expect(report.status).toBe('ringing');
  });
});
