// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../client/src/lib/i18n';
import { academyToday } from '../client/src/lib/localeFormat';
import type { ReminderCallHistoryFields } from '../client/src/features/telephony/call-history';
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
const onlinePbxCall = vi.hoisted(() => ({ startCall: vi.fn(), isPending: false,
  isLineBusyWithReminder: false, callButtonLabel: '' }));
vi.mock('../client/src/lib/queryClient', async () => ({ ...await vi.importActual('../client/src/lib/queryClient'), apiRequest: mocks.api }));
vi.mock('../client/src/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, fullName: 'Me', onlinePbxExtension: '101', onlinePbxIncomingEnabled: true } }) }));
vi.mock('../client/src/hooks/useOnlinePbxCall', () => ({ useOnlinePbxCall: () => onlinePbxCall }));
import CallJournalPage from '../client/src/pages/sales/CallJournalPage';

const clients: QueryClient[] = [];
const call = (id: number) => ({ id, userId: null, userName: null, extension: null, direction: 'incoming', status: 'missed',
  phone: `+99890000000${id}`, leadId: null, leadName: `Missed ${id}`, contactName: null, managerId: null,
  managerName: null, startedAt: '2026-10-05T08:00:00Z', answeredAt: null, endedAt: null,
  durationSeconds: 20, talkSeconds: 0, hangupCause: null, note: null, hasRecording: false, requiresCallback: true });
beforeEach(() => {
  i18n.setLanguage('ru'); mocks.api.mockReset();
  onlinePbxCall.startCall.mockClear(); onlinePbxCall.isPending = false;
  onlinePbxCall.isLineBusyWithReminder = false; onlinePbxCall.callButtonLabel = i18n.t('telephonyLineBusyWithReminder');
  HTMLElement.prototype.scrollTo = vi.fn(); HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
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
  const content = () => <Router hook={location.hook} searchHook={location.searchHook}><QueryClientProvider client={client}><CallJournalPage /></QueryClientProvider></Router>;
  const view = render(content());
  return { ...location, refresh: () => view.rerender(content()) };
};
const latestRequest = () => {
  const path = mocks.api.mock.calls.filter(([, path]) => path.includes('/journal?')).at(-1)?.[1];
  return new URL(path, 'http://localhost').searchParams;
};
const reminderId = '11111111-1111-4111-8111-111111111111';
type JournalFixture = Omit<ReturnType<typeof call>, 'id' | 'userId' | 'userName' | 'extension' | 'note'> & ReminderCallHistoryFields & {
  id: number | string; userId: number | null; userName: string | null; extension: string | null; note: string | null;
};
const reminderCall = (): JournalFixture => ({ ...call(9), id: reminderId, source: 'voice_reminder', voiceReminderCallId: reminderId,
  direction: 'outgoing', status: 'ended', talkSeconds: 23, hasRecording: true, requiresCallback: false,
  leadName: 'Reminder journal contact', reminderOutcome: 'delivered_no_response', reminderResponse: 'no',
  userId: 999, userName: 'Borrowed-line employee', extension: '9999', note: 'Injected bot note' });
const setJournalItems = (items: JournalFixture[]) => {
  mocks.api.mockImplementation(async (_method, path: string) => {
    if (path.endsWith('/operators')) return [{ id: 1, name: 'Me', extension: '101' }];
    if (path.endsWith('/recording')) return { url: `${path}/media` };
    return { items, total: items.length, page: 1, limit: 50, summary: {
      missed: items.filter(item => item.requiresCallback).length,
      answered: items.filter(item => item.talkSeconds > 0).length,
      talkSeconds: items.reduce((sum, item) => sum + item.talkSeconds, 0),
    } };
  });
};
const select = async (label: string, option: string) => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: label }));
  await user.click(screen.getByRole('option', { name: option }));
};
describe('call journal controls and URL state', () => {
  it.each(['ru', 'en'] as const)('shows mixed reminder calls on desktop and mobile in %s with their own result, recording and callback', async language => {
    i18n.setLanguage(language);
    const human = { ...call(1), userId: 7, userName: 'Actual employee', note: 'Manager note', requiresCallback: false };
    setJournalItems([reminderCall(), human]);
    mount('/sales/calls?userId=all');
    const names = await screen.findAllByText('Reminder journal contact');
    expect(names).toHaveLength(2);
    const botRows = names.map(name => name.closest('tr') ?? name.closest('article')) as HTMLElement[];
    for (const row of botRows) {
      expect(within(row).getByText(i18n.t('telephonySourceVoiceReminder'))).toBeTruthy();
      expect(within(row).getByText(i18n.t('telephonyReminderResponseNo'))).toBeTruthy();
      expect(within(row).queryByText(i18n.t('voiceRemindersDeliveredNoResponse'))).toBeNull();
      expect(within(row).queryByText(i18n.t('newMissedCall'))).toBeNull();
      expect(within(row).getByText('00:23')).toBeTruthy();
    }
    expect(screen.queryByText('Borrowed-line employee')).toBeNull();
    expect(screen.queryByText('Injected bot note')).toBeNull();
    expect(screen.queryByText(/9999/)).toBeNull();
    expect(screen.getAllByText('Actual employee')).toHaveLength(2);
    expect(screen.getAllByText('Manager note')).toHaveLength(2);
    const user = userEvent.setup();
    await user.click(within(botRows[0]).getByRole('button', { name: i18n.t('telephonyPlayRecording') }));
    await waitFor(() => expect(botRows[0].querySelector('audio')?.getAttribute('src'))
      .toBe(`/api/telephony/reminder-calls/${reminderId}/recording/media`));
    expect(mocks.api).toHaveBeenCalledWith('GET', `/api/telephony/reminder-calls/${reminderId}/recording`);
    expect(mocks.api.mock.calls.some(([, path]) => String(path).includes(`/api/telephony/calls/${reminderId}`))).toBe(false);
    await user.click(within(botRows[0]).getByRole('button', { name: i18n.t('telephonyCallBack') }));
    expect(onlinePbxCall.startCall).toHaveBeenCalledExactlyOnceWith(reminderCall().phone);
  });

  it('preserves line-priority blocking for reminder callbacks on both journal layouts', async () => {
    onlinePbxCall.isLineBusyWithReminder = true;
    setJournalItems([reminderCall()]);
    const view = mount();
    await screen.findAllByText('Reminder journal contact');
    const blocked = screen.getAllByRole('button', { name: onlinePbxCall.callButtonLabel });
    expect(blocked).toHaveLength(2);
    for (const button of blocked) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      await userEvent.setup().click(button);
    }
    expect(onlinePbxCall.startCall).not.toHaveBeenCalled();
    onlinePbxCall.isLineBusyWithReminder = false;
    view.refresh();
    await userEvent.setup().click(screen.getAllByRole('button', { name: i18n.t('telephonyCallBack') })[1]);
    expect(onlinePbxCall.startCall).toHaveBeenCalledExactlyOnceWith(reminderCall().phone);
  });

  it('shows delivery without a reply truthfully and does not offer nonexistent or wrongly referenced recordings', async () => {
    setJournalItems([{ ...reminderCall(), reminderResponse: null, hasRecording: false, voiceReminderCallId: '' }]);
    mount();
    expect(await screen.findAllByText(i18n.t('voiceRemindersDeliveredNoResponse'))).toHaveLength(2);
    expect(screen.queryByText(i18n.t('telephonyReminderResponseYes'))).toBeNull();
    expect(screen.queryByText(i18n.t('telephonyReminderResponseNo'))).toBeNull();
    expect(screen.queryByRole('button', { name: i18n.t('telephonyPlayRecording') })).toBeNull();
  });

  it('updates both desktop and mobile callback buttons while the reminder owns the line', async () => {
    onlinePbxCall.isLineBusyWithReminder = true;
    const view = mount(); await screen.findAllByText('Missed 1');
    const blocked = screen.getAllByRole('button', { name: onlinePbxCall.callButtonLabel });
    expect(blocked).toHaveLength(2);
    for (const button of blocked) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      await userEvent.setup().click(button);
    }
    expect(onlinePbxCall.startCall).not.toHaveBeenCalled();
    onlinePbxCall.isLineBusyWithReminder = false;
    view.refresh();
    const ready = screen.getAllByRole('button', { name: i18n.t('telephonyCallBack') });
    expect(ready.every(button => !(button as HTMLButtonElement).disabled)).toBe(true);
    await userEvent.setup().click(ready[1]);
    expect(onlinePbxCall.startCall).toHaveBeenCalledExactlyOnceWith(call(1).phone);
  });
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
