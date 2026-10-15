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
vi.mock('@/features/telephony/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../client/src/features/telephony/api')>();
  return { ...actual, telephonyApi: { ...actual.telephonyApi,
    reserveLine: mocks.reserveLine, authorizeLine: mocks.authorizeLine, releaseLine: mocks.releaseLine, renewLine: mocks.renewLine,
  } };
});
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
  mocks.api.mockImplementation(async (_method: string, url: string, data?: { clientCallId?: string; status?: string; endedAt?: string | null; answeredAt?: string | null }) => {
    if (url === '/api/telephony/credentials') return {
      extension: '100', username: 'test', password: 'synthetic', sipDomain: 'example.test', websocketUrl: 'wss://example.test',
    };
    if (url === '/api/telephony/calls/events') return { id: 1, clientCallId: data?.clientCallId, status: data?.status, endedAt: data?.endedAt, answeredAt: data?.answeredAt };
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

const reports = () => mocks.api.mock.calls.filter(([, url]) => url === '/api/telephony/calls/events').map(([, , data]) => data);
const savedReports = () => JSON.parse(window.localStorage.getItem('01academy.telephony.call-reports.v1:7') ?? '[]');
const incoming = (id: string) => ({ ...dialog(id), direction: { name: 'inbound' }, state: { name: 'ringing' } });
const allowIncoming = () => {
  const api = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation((method, url, data) => url === '/api/telephony/incoming/access'
    ? Promise.resolve({ allowed: true, delayMs: 0 }) : api(method, url, data));
};

describe('durable manager call recovery', () => {
  it.each([
    ['onlinePbxTooManyCalls', 409], ['onlinePbxUnavailable', 503], ['onlinePbxManagerNotAssigned', 403], ['onlinePbxInvalidCallEvent', 400],
  ] as const)('preserves an owned %s admission failure without an INVITE or journal', async (key, status) => {
    const media = microphone();
    mocks.microphone.mockResolvedValueOnce(media.stream);
    mocks.reserveLine.mockRejectedValueOnce(Object.assign(new Error('Localized response'), { rawMessage: key, status }));
    await renderPhone();
    let refusal: any;
    await act(async () => { refusal = await mocks.value.startCall('+998901234567').catch((error: unknown) => error); });
    expect(mocks.value.activeCall.errorCode).toBe(key);
    expect(refusal).toMatchObject({ rawMessage: key, status, clientCallId: mocks.value.activeCall.clientCallId });
    expect(mocks.newCall).not.toHaveBeenCalled();
    expect(reports()).toEqual([]);
    expect(media.stop).toHaveBeenCalledOnce();
    expect(savedReports()).toEqual([]);
  });

  it('ignores a foreign synchronous SDK state while creating its own exact UUID dialog', async () => {
    const foreign = dialog('foreign-call');
    mocks.newCall.mockImplementation((options) => {
      mocks.onDialogState!(foreign);
      return { ...dialog(options.callID), state: { name: 'requesting' } };
    });
    await renderPhone();
    await act(async () => mocks.value.startCall('+998901234567'));
    expect(mocks.value.activeCall.clientCallId).toBe(mocks.reserveLine.mock.calls[0][0]);
    expect(reports()).toEqual([expect.objectContaining({ clientCallId: mocks.reserveLine.mock.calls[0][0], status: 'dialing' })]);
    expect(foreign.hangup).not.toHaveBeenCalled();
  });

  it('recovers a persisted exact UUID when its first post-reload SDK state is an online terminal event', async () => {
    const view = await renderPhone();
    await act(async () => mocks.value.startCall('+998901234567'));
    const original = mocks.newCall.mock.results[0].value;
    view.unmount();
    mocks.onDialogState = null;
    await renderPhone();
    expect(mocks.value.activeCall).toBeNull();
    const foreign = { ...dialog('foreign-call'), state: { name: 'hangup' } };
    await act(async () => mocks.onDialogState!(foreign));
    expect(mocks.value.activeCall).toBeNull();
    const ended = { ...dialog(original.callID), state: { name: 'hangup' } };
    await act(async () => mocks.onDialogState!(ended));
    expect(mocks.value.activeCall.clientCallId).toBe(original.callID);
    expect(mocks.value.activeCall.status).toBe('failed');
    expect(reports().at(-1)).toMatchObject({ clientCallId: original.callID, status: 'failed', endedAt: expect.any(String) });
    expect(mocks.releaseLine).toHaveBeenCalledExactlyOnceWith('first-lease');
    expect(savedReports()).toEqual([]);
  });

  it('does not interpret purge or its subsequent online destroy as provider termination', async () => {
    await renderPhone();
    await act(async () => mocks.value.startCall('+998901234567'));
    const session = mocks.newCall.mock.results[0].value;
    await act(async () => mocks.onDialogState!(session));
    session.state.name = 'purge';
    await act(async () => mocks.onDialogState!(session));
    await act(async () => mocks.callbacks.onWSLogin({}, true));
    session.state.name = 'destroy';
    await act(async () => mocks.onDialogState!(session));
    expect(mocks.value.activeCall.status).toBe('connected');
    expect(reports().every((report) => report.endedAt === null)).toBe(true);
    expect(mocks.releaseLine).not.toHaveBeenCalled();
    expect(savedReports()[0].call.clientCallId).toBe(session.callID);
  });

  it('times out a lost report ACK, retries the latest terminal state and ignores the original late ACK', async () => {
    const intervals = vi.spyOn(window, 'setInterval');
    const lost = deferred<any>();
    const api = mocks.api.getMockImplementation()!;
    let eventCount = 0;
    mocks.api.mockImplementation((method, url, data) => url === '/api/telephony/calls/events' && ++eventCount === 1
      ? lost.promise : api(method, url, data));
    await renderPhone();
    vi.useFakeTimers();
    await act(async () => mocks.value.startCall('+998901234567'));
    const old = mocks.newCall.mock.results[0].value;
    old.state.name = 'hangup';
    await act(async () => mocks.onDialogState!(old));
    expect(reports()).toHaveLength(1);
    expect(mocks.releaseLine).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(15_001));
    const retry = intervals.mock.calls.find(([, milliseconds]) => milliseconds === 5_000)![0] as () => void;
    await act(async () => retry());
    expect(reports().map((report) => report.status)).toEqual(['dialing', 'failed']);
    expect(mocks.releaseLine).toHaveBeenCalledExactlyOnceWith('first-lease');
    expect(savedReports()).toEqual([]);
    mocks.reserveLine.mockResolvedValueOnce({ id: 'successor-lease' });
    await act(async () => mocks.value.startCall('+998901234568'));
    const successor = mocks.newCall.mock.results[1].value;
    await act(async () => mocks.onDialogState!(successor));
    await act(async () => lost.resolve({ id: 44, clientCallId: old.callID, status: 'ended', endedAt: new Date().toISOString() }));
    expect(mocks.value.activeCall.clientCallId).toBe(successor.callID);
    expect(mocks.value.activeCall.status).toBe('connected');
    expect(successor.hangup).not.toHaveBeenCalled();
    expect(savedReports()).toEqual([expect.objectContaining({ call: expect.objectContaining({ clientCallId: successor.callID }) })]);
  });

  it('times out a lost release ACK and retries only that owned lease without redialing', async () => {
    const intervals = vi.spyOn(window, 'setInterval');
    const lost = deferred<{ released: boolean }>();
    mocks.releaseLine.mockReturnValueOnce(lost.promise);
    await renderPhone();
    vi.useFakeTimers();
    await act(async () => mocks.value.startCall('+998901234567'));
    const session = mocks.newCall.mock.results[0].value;
    session.state.name = 'hangup';
    await act(async () => mocks.onDialogState!(session));
    const eventCount = reports().length;
    await act(async () => vi.advanceTimersByTimeAsync(15_001));
    const retry = intervals.mock.calls.find(([, milliseconds]) => milliseconds === 5_000)![0] as () => void;
    await act(async () => retry());
    expect(mocks.releaseLine.mock.calls).toEqual([['first-lease'], ['first-lease']]);
    expect(reports()).toHaveLength(eventCount);
    expect(mocks.newCall).toHaveBeenCalledOnce();
    expect(JSON.parse(window.localStorage.getItem('01academy.telephony.lease-releases.v1:7') ?? '[]')).toEqual([]);
    await act(async () => lost.resolve({ released: true }));
    expect(mocks.releaseLine).toHaveBeenCalledTimes(2);
  });

  it.each([
    { status: 'connected', endedAt: null }, { status: 'ended', endedAt: 'invalid-date' }, { status: 'ended', endedAt: null },
  ])('bounds retries when a terminal report receives an unacceptable $status/$endedAt ACK', async (ack) => {
    const intervals = vi.spyOn(window, 'setInterval');
    const api = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation((method, url, data) => url === '/api/telephony/calls/events' && data.endedAt
      ? Promise.resolve({ id: 1, clientCallId: data.clientCallId, ...ack }) : api(method, url, data));
    await renderPhone();
    vi.useFakeTimers();
    await act(async () => mocks.value.startCall('+998901234567'));
    const session = mocks.newCall.mock.results[0].value;
    session.state.name = 'hangup';
    await act(async () => mocks.onDialogState!(session));
    expect(reports()).toHaveLength(2);
    expect(savedReports()[0]).toMatchObject({ pending: true, call: { status: 'failed' } });
    expect(mocks.releaseLine).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    const retry = intervals.mock.calls.find(([, milliseconds]) => milliseconds === 5_000)![0] as () => void;
    await act(async () => retry());
    expect(reports()).toHaveLength(3);
    expect(mocks.releaseLine).not.toHaveBeenCalled();
  });

  it('adopts an exact server terminal ACK after a heartbeat and permits a fresh manual call', async () => {
    const media = microphone();
    mocks.microphone.mockResolvedValueOnce(media.stream);
    const api = mocks.api.getMockImplementation()!;
    let endedAt: string | null = null;
    mocks.api.mockImplementation((method, url, data) => url === '/api/telephony/calls/events' && endedAt
      ? Promise.resolve({ id: 1, clientCallId: data.clientCallId, status: 'ended', endedAt }) : api(method, url, data));
    await renderPhone();
    await act(async () => mocks.value.startCall('+998901234567'));
    const session = mocks.newCall.mock.results[0].value;
    await act(async () => mocks.onDialogState!(session));
    endedAt = new Date().toISOString();
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(mocks.value.activeCall.status).toBe('ended');
    expect(mocks.value.activeCall.endedAt).toBe(endedAt);
    expect(media.stop).toHaveBeenCalledOnce();
    expect(session.hangup).toHaveBeenCalledExactlyOnceWith({ cause: 'NORMAL_CLEARING' });
    expect(mocks.releaseLine).toHaveBeenCalledExactlyOnceWith('first-lease');
    expect(savedReports()).toEqual([]);
    endedAt = null;
    await act(async () => mocks.value.startCall('+998901234568'));
    expect(mocks.newCall).toHaveBeenCalledTimes(2);
    expect(mocks.value.activeCall.clientCallId).not.toBe(session.callID);
  });

  it('preserves newer pending terminal details until their own ACK after an older terminal receipt', async () => {
    const initial = deferred<any>();
    const terminal = deferred<any>();
    const api = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation((method, url, data) => {
      if (url !== '/api/telephony/calls/events') return api(method, url, data);
      return reports().length === 1 ? initial.promise : terminal.promise;
    });
    await renderPhone();
    await act(async () => mocks.value.startCall('+998901234567'));
    const session = mocks.newCall.mock.results[0].value;
    await act(async () => mocks.onDialogState!(session));
    session.state.name = 'hangup';
    await act(async () => mocks.onDialogState!(session));
    const localTerminal = { ...savedReports()[0].call };
    await act(async () => initial.resolve({ id: 1, clientCallId: session.callID, status: 'failed', endedAt: localTerminal.endedAt }));
    expect(reports().at(-1)).toMatchObject({ status: localTerminal.status, answeredAt: localTerminal.answeredAt, endedAt: localTerminal.endedAt });
    expect(savedReports()[0].pending).toBe(true);
    expect(mocks.releaseLine).not.toHaveBeenCalled();
    await act(async () => terminal.resolve({ id: 1, clientCallId: session.callID, status: localTerminal.status, endedAt: localTerminal.endedAt }));
    expect(savedReports()).toEqual([]);
    expect(mocks.releaseLine).toHaveBeenCalledExactlyOnceWith('first-lease');
  });

  it('does not adopt an old actor terminal ACK into a new user call or stop its media', async () => {
    const oldAck = deferred<any>();
    const newMedia = microphone();
    mocks.microphone.mockResolvedValueOnce(microphone().stream).mockResolvedValueOnce(newMedia.stream);
    const api = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation((method, url, data) => url === '/api/telephony/calls/events' && mocks.user.id === 7
      ? oldAck.promise : api(method, url, data));
    const view = await renderPhone();
    await act(async () => mocks.value.startCall('+998901234567'));
    const oldId = mocks.value.activeCall.clientCallId;
    const previousCallbacks = mocks.onDialogState;
    mocks.user = { ...mocks.user, id: 8 };
    await act(async () => view.refresh());
    await waitFor(() => expect(mocks.onDialogState).not.toBe(previousCallbacks));
    await act(async () => mocks.value.startCall('+998901234568'));
    const successor = mocks.newCall.mock.results[1].value;
    await act(async () => mocks.onDialogState!(successor));
    await act(async () => oldAck.resolve({ id: 7, clientCallId: oldId, status: 'ended', endedAt: new Date().toISOString() }));
    expect(mocks.value.activeCall.status).toBe('connected');
    expect(mocks.value.activeCall.clientCallId).toBe(successor.callID);
    expect(newMedia.stop).not.toHaveBeenCalled();
    expect(mocks.releaseLine).not.toHaveBeenCalled();
  });

  it('does not answer or overwrite a successor while the old incoming microphone permission is pending', async () => {
    allowIncoming();
    const permission = deferred<MediaStream>();
    const oldMedia = microphone();
    const nextPermission = deferred<MediaStream>();
    mocks.microphone.mockReturnValueOnce(permission.promise).mockReturnValueOnce(nextPermission.promise);
    await renderPhone();
    const old = incoming('incoming-old');
    await act(async () => mocks.onDialogState!(old));
    let answering!: Promise<void>;
    await act(async () => { answering = mocks.value.answerCall(); await mocks.value.answerCall(); });
    expect(mocks.microphone).toHaveBeenCalledOnce();
    old.state.name = 'hangup';
    await act(async () => mocks.onDialogState!(old));
    let starting!: Promise<void>;
    await act(async () => { starting = mocks.value.startCall('+998901234568'); });
    expect(mocks.value.pendingPhone).toBe('+998901234568');
    await act(async () => { permission.resolve(oldMedia.stream); await answering; });
    expect(old.answer).not.toHaveBeenCalled();
    expect(oldMedia.stop).toHaveBeenCalledOnce();
    expect(mocks.value.pendingPhone).toBe('+998901234568');
    expect(mocks.value.isPending).toBe(true);
    await act(async () => { nextPermission.resolve(microphone().stream); await starting; });
    expect(mocks.newCall).toHaveBeenCalledOnce();
  });

  it('stops late incoming microphone media after logout without answering or changing the new actor state', async () => {
    allowIncoming();
    const permission = deferred<MediaStream>();
    const oldMedia = microphone();
    mocks.microphone.mockReturnValueOnce(permission.promise);
    const view = await renderPhone();
    const old = incoming('incoming-old');
    await act(async () => mocks.onDialogState!(old));
    let answering!: Promise<void>;
    await act(async () => { answering = mocks.value.answerCall(); });
    mocks.authenticated = false;
    await act(async () => view.refresh());
    await act(async () => { permission.resolve(oldMedia.stream); await answering; });
    expect(oldMedia.stop).toHaveBeenCalledOnce();
    expect(old.answer).not.toHaveBeenCalled();
    expect(mocks.value.activeCall).toBeNull();
    expect(mocks.value.pendingPhone).toBeNull();
  });

  it.each(['reserve', 'authorize'] as const)('bounds a hung %s admission and releases a late owned lease without dispatching or touching a successor', async (stage) => {
    const pending = deferred<any>();
    const media = microphone();
    const successorMedia = microphone();
    mocks.microphone.mockResolvedValueOnce(media.stream).mockResolvedValueOnce(successorMedia.stream);
    if (stage === 'reserve') mocks.reserveLine.mockReturnValueOnce(pending.promise);
    else mocks.authorizeLine.mockReturnValueOnce(pending.promise);
    await renderPhone();
    vi.useFakeTimers();
    let starting!: Promise<any>;
    await act(async () => { starting = mocks.value.startCall('+998901234567').catch((error: unknown) => error); });
    await act(async () => vi.advanceTimersByTimeAsync(15_001));
    expect(await starting).toMatchObject({ rawMessage: 'onlinePbxUnavailable', clientCallId: mocks.value.activeCall.clientCallId });
    expect(mocks.value.activeCall.errorCode).toBe('onlinePbxUnavailable');
    expect(mocks.value.isPending).toBe(false);
    expect(media.stop).toHaveBeenCalledOnce();
    expect(mocks.newCall).not.toHaveBeenCalled();
    expect(reports()).toEqual([]);
    mocks.reserveLine.mockResolvedValueOnce({ id: 'successor-lease' });
    await act(async () => mocks.value.startCall('+998901234568'));
    const successor = mocks.newCall.mock.results[0].value;
    await act(async () => mocks.onDialogState!(successor));
    await act(async () => pending.resolve(stage === 'reserve' ? { id: 'expired-lease' } : { authorized: true }));
    expect(mocks.newCall).toHaveBeenCalledOnce();
    expect(successorMedia.stop).not.toHaveBeenCalled();
    expect(mocks.value.activeCall.clientCallId).toBe(successor.callID);
    expect(mocks.value.activeCall.status).toBe('connected');
    expect(mocks.releaseLine).toHaveBeenCalledExactlyOnceWith(stage === 'reserve' ? 'expired-lease' : 'first-lease', true);
  });

  it.each([-500, -1001])('accepts exact server end precision only within one second (%sms)', async (offset) => {
    const media = microphone();
    mocks.microphone.mockResolvedValueOnce(media.stream);
    const api = mocks.api.getMockImplementation()!;
    let endedAt: string | null = null;
    mocks.api.mockImplementation((method, url, data) => url === '/api/telephony/calls/events' && endedAt
      ? Promise.resolve({ id: 1, clientCallId: data.clientCallId, status: 'ended', endedAt }) : api(method, url, data));
    await renderPhone();
    await act(async () => mocks.value.startCall('+998901234567'));
    const session = mocks.newCall.mock.results[0].value;
    await act(async () => mocks.onDialogState!(session));
    endedAt = new Date(Date.parse(mocks.value.activeCall.startedAt) + offset).toISOString();
    await act(async () => window.dispatchEvent(new Event('online')));
    if (offset >= -1000) {
      expect(mocks.value.activeCall.status).toBe('ended');
      expect(mocks.value.activeCall.endedAt).toBe(endedAt);
      expect(mocks.releaseLine).toHaveBeenCalledExactlyOnceWith('first-lease');
      expect(media.stop).toHaveBeenCalledOnce();
    } else {
      expect(mocks.value.activeCall.status).toBe('connected');
      expect(mocks.releaseLine).not.toHaveBeenCalled();
      expect(media.stop).not.toHaveBeenCalled();
      expect(savedReports()[0].pending).toBe(true);
    }
  });

  it('uses authoritative server chronology when the browser start clock is ahead', async () => {
    const api = mocks.api.getMockImplementation()!;
    let proof: any = null;
    mocks.api.mockImplementation((method, url, data) => url === '/api/telephony/calls/events' && proof
      ? Promise.resolve({ id: 1, clientCallId: data.clientCallId, ...proof }) : api(method, url, data));
    await renderPhone();
    await act(async () => mocks.value.startCall('+998901234567'));
    proof = { status: 'ended', startedAt: new Date(Date.now() - 120_000).toISOString(), endedAt: new Date(Date.now() - 30_000).toISOString() };
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(mocks.value.activeCall.status).toBe('ended');
    expect(mocks.value.activeCall.endedAt).toBe(proof.endedAt);
    expect(mocks.releaseLine).toHaveBeenCalledExactlyOnceWith('first-lease');
  });

  it('keeps an incoming call terminal after server proof despite a late active SDK echo', async () => {
    allowIncoming();
    const api = mocks.api.getMockImplementation()!;
    let endedAt: string | null = null;
    mocks.api.mockImplementation((method, url, data) => url === '/api/telephony/calls/events' && endedAt
      ? Promise.resolve({ id: 1, clientCallId: data.clientCallId, status: 'ended', endedAt }) : api(method, url, data));
    await renderPhone();
    const session = incoming('incoming-proof');
    await act(async () => mocks.onDialogState!(session));
    session.state.name = 'active';
    await act(async () => mocks.onDialogState!(session));
    endedAt = new Date().toISOString();
    session.hangup.mockImplementation(() => {
      session.state.name = 'hangup';
      mocks.onDialogState!(session);
      session.state.name = 'destroy';
      mocks.onDialogState!(session);
    });
    const beforeProof = reports().length;
    await act(async () => window.dispatchEvent(new Event('online')));
    const reportCount = reports().length;
    expect(reportCount).toBe(beforeProof + 1);
    expect(session.hangup).toHaveBeenCalledExactlyOnceWith({ cause: 'NORMAL_CLEARING' });
    expect(mocks.value.activeCall.status).toBe('ended');
    session.state.name = 'active';
    await act(async () => mocks.onDialogState!(session));
    expect(mocks.value.activeCall.status).toBe('ended');
    expect(reports()).toHaveLength(reportCount);
  });

  it('does not answer a purged incoming dialog when its old microphone permission resolves after reconnect', async () => {
    allowIncoming();
    const permission = deferred<MediaStream>();
    const media = microphone();
    mocks.microphone.mockReturnValueOnce(permission.promise);
    await renderPhone();
    const session = incoming('incoming-purged');
    await act(async () => mocks.onDialogState!(session));
    let answering!: Promise<void>;
    await act(async () => { answering = mocks.value.answerCall(); });
    session.state.name = 'purge';
    await act(async () => mocks.onDialogState!(session));
    await act(async () => mocks.callbacks.onWSLogin({}, true));
    await act(async () => { permission.resolve(media.stream); await answering; });
    expect(session.answer).not.toHaveBeenCalled();
    expect(media.stop).toHaveBeenCalledOnce();
    expect(reports().every((report) => report.endedAt === null)).toBe(true);
  });

});
