// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../client/src/lib/i18n';
import { academyToday } from '../client/src/lib/localeFormat';
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../client/src/lib/queryClient', async () => ({ ...await vi.importActual('../client/src/lib/queryClient'), apiRequest: mocks.api }));
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, fullName: 'Me', onlinePbxExtension: '101', onlinePbxIncomingEnabled: true } }) }));
vi.mock('../client/src/hooks/useOnlinePbxCall', () => ({ useOnlinePbxCall: () => ({ startCall: vi.fn() }) }));
vi.mock('../client/src/components/telephony/CallRecordingPlayer', () => ({ CallRecordingPlayer: () => null }));
import CallJournalPage from '../client/src/pages/sales/CallJournalPage';

const clients: QueryClient[] = [];
const call = (id: number) => ({ id, userId: null, userName: null, extension: null, direction: 'incoming', status: 'missed',
  phone: `+99890000000${id}`, leadId: null, leadName: `Missed ${id}`, contactName: null, managerId: null,
  managerName: null, startedAt: '2026-10-05T08:00:00Z', answeredAt: null, endedAt: null,
  durationSeconds: 20, talkSeconds: 0, hangupCause: null, note: null, hasRecording: false, requiresCallback: true });
beforeEach(() => {
  i18n.setLanguage('ru'); mocks.api.mockReset();
  HTMLElement.prototype.scrollTo = vi.fn(); HTMLElement.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = () => false; Element.prototype.setPointerCapture = () => undefined; Element.prototype.releasePointerCapture = () => undefined;
  mocks.api.mockImplementation(async (_method, path: string) => {
    if (path.endsWith('/operators')) return [{ id: 1, name: 'Me', extension: '101' }, { id: 7, name: 'Anna', extension: '102' }];
    const params = new URL(path, 'http://localhost').searchParams;
    const total = params.get('status') === 'callback' ? 6 : 137;
    return { items: Array.from({ length: total === 6 ? 6 : 1 }, (_, index) => call(index + 1)), total,
      page: Number(params.get('page')), limit: Number(params.get('limit')), summary: { missed: total, answered: 0, talkSeconds: 0 } };
  });
});
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); vi.restoreAllMocks(); });
const mount = (path = '/sales/calls') => {
  const location = memoryLocation({ path });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  render(<Router hook={location.hook} searchHook={location.searchHook}><QueryClientProvider client={client}><CallJournalPage /></QueryClientProvider></Router>);
  return location;
};
const latestRequest = () => {
  const path = mocks.api.mock.calls.filter(([, path]) => path.includes('/journal?')).at(-1)?.[1];
  return new URL(path, 'http://localhost').searchParams;
};
const select = async (label: string, option: string) => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: label }));
  await user.click(screen.getByRole('option', { name: option }));
};
describe('call journal controls and URL state', () => {
  it('defaults to my operator while displaying unassigned missed calls', async () => {
    mount(); await screen.findAllByText('Missed 1');
    expect(latestRequest().get('userId')).toBe('1');
    expect(screen.getByRole('combobox', { name: i18n.t('callJournalEmployee') }).textContent).toContain('Me');
    await select(i18n.t('status'), i18n.t('callJournalRequiresCallback'));
    await screen.findAllByText('Missed 6');
    expect(latestRequest().get('userId')).toBe('1');
    expect(latestRequest().get('status')).toBe('callback');
  });
  it('preserves saved paging and explicit all-employees links', async () => {
    mount('/sales/calls?userId=all&status=missed&page=3&limit=25');
    await screen.findAllByText('Missed 1');
    expect(latestRequest().get('userId')).toBe('all');
    expect(latestRequest().get('page')).toBe('3');
    expect(latestRequest().get('limit')).toBe('25');
  });
  it('combines employee, direction, every status, search and dates while resetting paging', async () => {
    mount('/sales/calls?page=3'); await screen.findAllByText('Missed 1');
    await select(i18n.t('callJournalEmployee'), 'Anna');
    await waitFor(() => expect(latestRequest().get('userId')).toBe('7'));
    expect(latestRequest().get('page')).toBe('1');
    await select(i18n.t('callDirection'), i18n.t('outgoingCall'));
    await waitFor(() => expect(latestRequest().get('direction')).toBe('outgoing'));
    for (const [status, label] of [['dialing', 'telephonyStatusDialing'], ['ringing', 'telephonyStatusRinging'], ['connected', 'telephonyStatusConnected'], ['ended', 'telephonyStatusEnded'], ['missed', 'telephonyStatusMissed'], ['failed', 'telephonyStatusFailed'], ['declined', 'telephonyStatusDeclined']] as const) {
      await select(i18n.t('status'), i18n.t(label));
      await waitFor(() => expect(latestRequest().get('status')).toBe(status));
    }
    fireEvent.change(screen.getByRole('textbox', { name: i18n.t('search') }), { target: { value: '+998 (90) 123' } });
    await waitFor(() => expect(latestRequest().get('q')).toBe('+998 (90) 123'));
    fireEvent.change(screen.getByLabelText(i18n.t('dateFrom')), { target: { value: '2026-10-05' } });
    fireEvent.change(screen.getByLabelText(i18n.t('dateTo')), { target: { value: '2026-10-06' } });
    await waitFor(() => expect(latestRequest().get('to')).toBe('2026-10-06'));
    expect(latestRequest().get('from')).toBe('2026-10-05');
    await userEvent.setup().click(screen.getByRole('button', { name: i18n.t('today') }));
    await waitFor(() => expect(latestRequest().get('from')).toBe(academyToday()));
    expect(latestRequest().get('to')).toBe(academyToday());
    await userEvent.setup().click(screen.getByRole('button', { name: i18n.t('reset') }));
    await waitFor(() => expect(latestRequest().get('q')).toBeNull());
    expect(latestRequest().get('userId')).toBe('1');
    expect(latestRequest().get('status')).toBeNull();
  });
  it('follows later URL navigation and the unassigned operator choice', async () => {
    const location = mount(); await screen.findAllByText('Missed 1');
    await select(i18n.t('callJournalEmployee'), i18n.t('notAssigned'));
    await waitFor(() => expect(latestRequest().get('userId')).toBe('unassigned'));
    act(() => location.navigate('/sales/calls?userId=all&direction=incoming&status=callback'));
    await screen.findAllByText('Missed 6');
    expect(latestRequest().get('userId')).toBe('all');
    expect(screen.getByRole('combobox', { name: i18n.t('callJournalEmployee') }).textContent).toContain(i18n.t('allEmployees'));
  });
});
