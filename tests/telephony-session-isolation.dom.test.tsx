// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ onDialogState: null as any, value: null as any, api: vi.fn(), newCall: vi.fn(), user: { id: 7, fullName: 'Test User', onlinePbxExtension: '100', onlinePbxIncomingEnabled: true } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user, isAuthenticated: true }) }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: mocks.api }));
vi.mock('@/lib/incomingCallRingtone', () => ({ shouldPlayIncomingRingtone: () => false, IncomingCallRingtone: class { start() {return Promise.resolve();} stop() {} destroy() {} unlock() {return Promise.resolve(true);} } }));
vi.mock('@xswitch/rtc', () => ({ Verto: class { constructor(_options: any, callbacks: any) { mocks.onDialogState = callbacks.onDialogState; } newCall() { return mocks.newCall(); } socketReady() {return true;} closeSocket() {} } }));
import { TelephonyProvider, useTelephony } from '../client/src/contexts/TelephonyContext';
function Probe() { mocks.value = useTelephony(); return null; }
const dialog = (callID: string) => ({ callID, direction: { name: 'inbound' }, state: { name: 'ringing' }, params: { caller_id_number: '+998901234567' }, answer: vi.fn(), hangup: vi.fn(), setMute: vi.fn().mockReturnValue(true), getMute: vi.fn(), toggleHold: vi.fn(), dtmf: vi.fn(), transfer: vi.fn() });
beforeEach(() => { vi.clearAllMocks(); mocks.onDialogState = null; mocks.value = null; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('preserves every current call control while rejecting and ignoring a second incoming dialog', async () => {
  mocks.api.mockImplementation(async (_method: string, url: string) => {
    if (url === '/api/telephony/credentials') return { extension: '100', username: 'test', password: 'fake', sipDomain: 'example.test', websocketUrl: 'wss://example.test' };
    if (url === '/api/telephony/incoming/access') return { allowed: true, delayMs: 0 };
    if (url.startsWith('/api/telephony/contacts/lookup')) return { contact: null };
    if (url === '/api/telephony/calls/events') return { id: 1 };
    return {};
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><TelephonyProvider><Probe /></TelephonyProvider></QueryClientProvider>);
  await waitFor(() => expect(mocks.onDialogState).toBeTruthy());
  const first = dialog('first-call');
  await act(async () => mocks.onDialogState(first));
  await waitFor(() => expect(mocks.value.activeCall?.clientCallId).toBe('first-call'));
  first.state.name = 'active';
  await act(async () => mocks.onDialogState(first));
  expect(mocks.value.activeCall.status).toBe('connected');
  await act(async () => mocks.value.toggleMute());
  expect(first.setMute).toHaveBeenCalledTimes(1);
  const second = dialog('second-call');
  await act(async () => mocks.onDialogState(second));
  expect(second.hangup).toHaveBeenCalledWith({ cause: 'USER_BUSY' });
  second.state.name = 'active';
  await act(async () => mocks.onDialogState(second));
  expect(mocks.value.activeCall.clientCallId).toBe('first-call');
  expect(mocks.value.activeCall.status).toBe('connected');
  second.state.name = 'held';
  await act(async () => mocks.onDialogState(second));
  expect(mocks.value.activeCall.held).toBe(false);
  second.state.name = 'hangup';
  await act(async () => mocks.onDialogState(second));
  await act(async () => {
    mocks.value.toggleMute();
    await mocks.value.toggleHold();
    await mocks.value.sendDtmf('1');
    await mocks.value.transferCall('101');
    await mocks.value.hangupCall();
  });
  expect(mocks.value.activeCall.clientCallId).toBe('first-call');
  expect(mocks.value.activeCall.status).toBe('connected');
  expect(first.setMute).toHaveBeenCalledTimes(2);
  expect(first.toggleHold).toHaveBeenCalledExactlyOnceWith({});
  expect(first.transfer).toHaveBeenCalledExactlyOnceWith('101', {});
  expect(first.hangup).toHaveBeenCalledExactlyOnceWith({ cause: 'NORMAL_CLEARING' });
  expect(first.dtmf).toHaveBeenCalledExactlyOnceWith('1');
  expect(second.setMute).not.toHaveBeenCalled();
  expect(second.dtmf).not.toHaveBeenCalled();
  first.state.name = 'hangup';
  await act(async () => mocks.onDialogState(first));
  expect(mocks.value.activeCall.status).toBe('ended');
  client.clear();
});


it('retains the dialog that wins incoming eligibility while another pending dialog is rejected', async () => {
  const pending: Array<(access: { allowed: boolean; delayMs: number }) => void> = [];
  mocks.api.mockImplementation(async (_method: string, url: string) => {
    if (url === '/api/telephony/credentials') return { extension: '100', username: 'test', password: 'fake', sipDomain: 'example.test', websocketUrl: 'wss://example.test' };
    if (url === '/api/telephony/incoming/access') return new Promise((resolve) => pending.push(resolve));
    if (url === '/api/telephony/calls/events') return { id: 1 };
    return {};
  });
  const client = new QueryClient();
  render(<QueryClientProvider client={client}><TelephonyProvider><Probe /></TelephonyProvider></QueryClientProvider>);
  await waitFor(() => expect(mocks.onDialogState).toBeTruthy());
  const first = dialog('pending-first');
  const second = dialog('pending-second');
  await act(async () => { mocks.onDialogState(first); mocks.onDialogState(second); });
  expect(pending).toHaveLength(2);
  await act(async () => pending[1]({ allowed: true, delayMs: 0 }));
  await waitFor(() => expect(mocks.value.activeCall?.clientCallId).toBe('pending-second'));
  await act(async () => pending[0]({ allowed: true, delayMs: 0 }));
  expect(first.hangup).toHaveBeenCalledWith({ cause: 'USER_BUSY' });
  first.state.name = 'hangup';
  second.state.name = 'active';
  await act(async () => { mocks.onDialogState(first); mocks.onDialogState(second); });
  await act(async () => { mocks.value.toggleMute(); await mocks.value.sendDtmf('2'); });
  expect(second.setMute).toHaveBeenCalledExactlyOnceWith('toggle');
  expect(second.dtmf).toHaveBeenCalledExactlyOnceWith('2');
  expect(first.setMute).not.toHaveBeenCalled();
  client.clear();
});

it('preserves synchronous outgoing SDK state notifications while creating its dialog', async () => {
  mocks.api.mockImplementation(async (_method: string, url: string) => {
    if (url === '/api/telephony/credentials') return { extension: '100', username: 'test', password: 'fake', sipDomain: 'example.test', websocketUrl: 'wss://example.test' };
    if (url === '/api/telephony/calls/events') return { id: 1 };
    return {};
  });
  const outgoing = { ...dialog('outgoing-sync'), direction: { name: 'outbound' }, state: { name: 'active' } };
  mocks.newCall.mockImplementation(() => { mocks.onDialogState(outgoing); return outgoing; });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }),
  } });
  const client = new QueryClient();
  render(<QueryClientProvider client={client}><TelephonyProvider><Probe /></TelephonyProvider></QueryClientProvider>);
  await waitFor(() => expect(mocks.onDialogState).toBeTruthy());
  await act(async () => mocks.value.startCall('+998901234567'));
  expect(mocks.value.activeCall.clientCallId).toBe('outgoing-sync');
  expect(mocks.value.activeCall.status).toBe('connected');
  await act(async () => mocks.value.toggleMute());
  expect(outgoing.setMute).toHaveBeenCalledExactlyOnceWith('toggle');
  client.clear();
});
