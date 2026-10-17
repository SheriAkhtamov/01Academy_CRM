// @vitest-environment jsdom
import { useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoLessonDetailsDialog } from '../client/src/components/ux/DemoLessonDetailsDialog';
import { SalesScheduleCalendar } from '../client/src/components/ux/SalesScheduleCalendar';
import type { DemoLesson } from '../client/src/features/demo-lessons/api';
import { i18n, translations } from '../client/src/lib/i18n';

const mocks = vi.hoisted(() => ({ list: vi.fn(), saveAttendance: vi.fn(), cancel: vi.fn(), outcome: vi.fn() }));
vi.mock('../client/src/features/demo-lessons/api', () => ({
  demoLessonQueryKeys: {
    all: ['/api/academy/demo-lessons'], availability: ['demo-availability'], resourceAvailability: ['demo-resources'],
    teacherOptions: ['demo-teachers'], teacher: ['teacher-demos'],
  },
  demoLessonsApi: { ...mocks, reschedule: vi.fn(), teacherOptions: vi.fn(), changeTeacher: vi.fn(), removeParticipant: vi.fn() },
  teacherDemoLessonsApi: { saveAttendance: mocks.saveAttendance, outcome: mocks.outcome },
}));
vi.mock('../client/src/components/ux/DemoLessonDialog', () => ({ DemoLessonDialog: () => null }));

const demo: DemoLesson = {
  id: 5, courseId: 1, courseName: 'Frontend', schoolId: 1, schoolName: 'Cyberpark', roomId: 2, roomName: '204',
  teacherId: 3, teacherName: 'Teacher', scheduledAt: '2026-09-01T10:00:00.000Z', durationMinutes: 60,
  format: 'offline', status: 'scheduled', canManage: true,
  participants: [{ id: 11, studentId: 71, leadId: 101, status: 'confirmed', contactName: 'Parent', studentName: 'Learner',
    reminderResponse: null, reminderRespondedAt: null }],
};

const clients: QueryClient[] = [];
const show = (value = demo) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const onOpenChange = vi.fn();
  const tree = (current: DemoLesson) => <QueryClientProvider client={client}>
    <DemoLessonDetailsDialog demo={current} open onOpenChange={onOpenChange} />
  </QueryClientProvider>;
  const view = render(tree(value));
  return { onOpenChange, update: (current: DemoLesson) => view.rerender(tree(current)) };
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  i18n.setLanguage('en');
  mocks.list.mockResolvedValue([]);
  mocks.saveAttendance.mockResolvedValue(demo);
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  for (const method of ['setPointerCapture', 'releasePointerCapture', 'scrollIntoView']) {
    (Element.prototype as unknown as Record<string, unknown>)[method] = () => undefined;
  }
  (Element.prototype as unknown as Record<string, unknown>).hasPointerCapture = () => false;
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.useRealTimers(); });

const showCachedParent = (load: () => Promise<DemoLesson[]>, context: 'sales' | 'teacher' = 'sales') => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60_000, refetchOnWindowFocus: false } } });
  clients.push(client);
  const queryKey = ['/api/academy/demo-lessons', '2026-09-01', '2026-09-07'];
  client.setQueryData(queryKey, [demo]);
  function Host() {
    const [open, setOpen] = useState(true);
    const query = useQuery({ queryKey, queryFn: load });
    return <>
      <button onClick={() => setOpen(false)}>Close panel</button>
      <button onClick={() => setOpen(true)}>Open panel</button>
      <DemoLessonDetailsDialog demo={query.data?.find(item => item.id === demo.id) ?? null}
        open={open} onOpenChange={setOpen} context={context} />
    </>;
  }
  return render(<QueryClientProvider client={client}><Host /></QueryClientProvider>);
};

describe('demo reminder answers beside actual attendance', () => {
  it.each([
    ['en', 'yes', 'Auto-informer: Will attend'], ['en', 'no', 'Auto-informer: Will not attend'],
    ['ru', 'yes', 'Автоинформатор: Придёт'], ['ru', 'no', 'Автоинформатор: Не придёт'],
  ] as const)('shows the %s %s source beside the selector without changing attendance', (language, response, label) => {
    i18n.setLanguage(language);
    const value = { ...demo, participants: [{ ...demo.participants[0], reminderResponse: response, reminderRespondedAt: '2026-08-31T10:00:00Z' }] };
    const { onOpenChange } = show(value);
    const badge = screen.getByText(label);
    const selector = within(badge.parentElement!).getByRole('combobox');
    expect(selector.textContent).toBe(translations.selectAttendanceResult[language]);
    expect(badge.parentElement!.querySelector('button[aria-label*="Open lead"]')).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(mocks.saveAttendance).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.outcome).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('does not infer a negative answer when no response exists', () => {
    show();
    expect(screen.queryByText(/Auto-informer:/)).toBeNull();
    expect(screen.getByRole('combobox').textContent).toBe(translations.selectAttendanceResult.en);
  });

  it('preserves an unsaved attended mark when only the reminder response refreshes', async () => {
    const view = show();
    const selector = screen.getByRole('combobox');
    selector.focus();
    fireEvent.keyDown(selector, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: translations.demoParticipantAttended.en }));
    const updated = { ...demo, participants: [{ ...demo.participants[0], reminderResponse: 'no' as const, reminderRespondedAt: '2026-08-31T10:00:00Z' }] };
    view.update(updated);
    expect(screen.getByText('Auto-informer: Will not attend')).toBeTruthy();
    expect(screen.getByRole('combobox').textContent).toBe(translations.demoParticipantAttended.en);
    const save = screen.getByRole('button', { name: translations.saveAttendance.en }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(mocks.saveAttendance).toHaveBeenCalledWith(5, {
      participants: [{ participantId: 11, status: 'attended', result: null, noShowReasonCode: null, noShowReasonNote: null }],
    }));
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.outcome).not.toHaveBeenCalled();
  });

  it('refreshes a cached parent while open and shows a new answer without discarding attendance or polling after close', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const updated = { ...demo, participants: [{ ...demo.participants[0], reminderResponse: 'yes' as const, reminderRespondedAt: '2026-08-31T10:00:00Z' }] };
    const load = vi.fn().mockResolvedValueOnce([demo]).mockResolvedValue([updated]);
    showCachedParent(load);
    await act(async () => { await Promise.resolve(); });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Auto-informer: Will attend')).toBeNull();
    const selector = screen.getByRole('combobox');
    selector.focus();
    fireEvent.keyDown(selector, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: translations.demoParticipantAttended.en }));
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(await screen.findByText('Auto-informer: Will attend')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('combobox').textContent).toBe(translations.demoParticipantAttended.en);
    expect((screen.getByRole('button', { name: translations.saveAttendance.en }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByText('Close panel'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(load).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByText('Open panel'));
    await act(async () => { await Promise.resolve(); });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
  });

  it('does not duplicate an in-flight refresh and cleans up its timer on unmount', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let resolve!: (value: DemoLesson[]) => void;
    const load = vi.fn(() => new Promise<DemoLesson[]>(done => { resolve = done; }));
    const view = showCachedParent(load);
    await act(async () => { await Promise.resolve(); });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(load).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => {
      resolve([demo]);
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not refresh sales data in the teacher attendance context', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const load = vi.fn().mockResolvedValue([demo]);
    showCachedParent(load, 'teacher');
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(load).not.toHaveBeenCalled();
  });

  it.each(['en', 'ru'] as const)('shows only the explicit delivered-without-response marker beside attendance in %s', language => {
    i18n.setLanguage(language);
    show({ ...demo, participants: [{ ...demo.participants[0], reminderDeliveryStatus: 'delivered_no_response', reminderDeliveredAt: '2026-08-31T11:00:00Z' }] });
    const badge = screen.getByText(language === 'ru' ? 'Напоминание доставлено, ответ не получен' : 'Reminder delivered, no response received');
    expect(within(badge.parentElement!).getByRole('combobox').textContent).toBe(translations.selectAttendanceResult[language]);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryByText(/Auto-informer:|Автоинформатор:/)).toBeNull();
    expect(mocks.saveAttendance).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.outcome).not.toHaveBeenCalled();
  });

  it.each(['yes', 'no'] as const)('keeps a recorded %s answer ahead of delivered-without-response without changing physical attendance', response => {
    show({ ...demo, participants: [{ ...demo.participants[0], reminderResponse: response, reminderRespondedAt: '2026-08-31T11:00:00Z',
      reminderDeliveryStatus: 'delivered_no_response', reminderDeliveredAt: '2026-08-31T10:00:00Z' }] });
    expect(screen.getByText(response === 'yes' ? 'Auto-informer: Will attend' : 'Auto-informer: Will not attend')).toBeTruthy();
    expect(screen.queryByText('Reminder delivered, no response received')).toBeNull();
    expect(screen.getByRole('combobox').textContent).toBe(translations.selectAttendanceResult.en);
    expect(mocks.saveAttendance).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it('refreshes terminal delivery from the real parent cache without discarding dirty attendance and ignores delivery timestamp-only updates', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const delivered: DemoLesson = { ...demo, participants: [{ ...demo.participants[0],
      reminderDeliveryStatus: 'delivered_no_response', reminderDeliveredAt: '2026-08-31T11:00:00Z' }] };
    const later: DemoLesson = { ...delivered, participants: [{ ...delivered.participants[0], reminderDeliveredAt: '2026-08-31T11:05:00Z' }] };
    const load = vi.fn().mockResolvedValueOnce([demo]).mockResolvedValueOnce([delivered]).mockResolvedValue([later]);
    showCachedParent(load);
    await act(async () => { await Promise.resolve(); });
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    expect(screen.queryByText('Reminder delivered, no response received')).toBeNull();
    const selector = screen.getByRole('combobox');
    selector.focus();
    fireEvent.keyDown(selector, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: translations.demoParticipantAttended.en }));
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(await screen.findByText('Reminder delivered, no response received')).toBeTruthy();
    expect(screen.getByRole('combobox').textContent).toBe(translations.demoParticipantAttended.en);
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(load).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('combobox').textContent).toBe(translations.demoParticipantAttended.en);
    fireEvent.click(screen.getByRole('button', { name: translations.saveAttendance.en }));
    await waitFor(() => expect(mocks.saveAttendance).toHaveBeenCalledWith(5, {
      participants: [{ participantId: 11, status: 'attended', result: null, noShowReasonCode: null, noShowReasonNote: null }],
    }));
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.outcome).not.toHaveBeenCalled();
  });

  it('shows a refreshed bot delivery report in the actual sales calendar participant row without inventing an answer or losing attendance', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-08-31T04:00:00.000Z'));
    i18n.setLanguage('ru');
    const initial: DemoLesson = {
      ...demo,
      courseName: 'AI Kids',
      participants: [{ ...demo.participants[0], studentName: 'Алия', contactName: 'Индира' }],
    };
    const delivered: DemoLesson = {
      ...initial,
      participants: [{ ...initial.participants[0],
        reminderDeliveryStatus: 'delivered_no_response', reminderDeliveredAt: '2026-08-31T10:00:00Z' }],
    };
    mocks.list.mockResolvedValueOnce([initial]).mockResolvedValueOnce([initial]).mockResolvedValue([delivered]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60_000 } } });
    clients.push(client);
    render(<QueryClientProvider client={client}>
      <SalesScheduleCalendar groups={[]} lessons={[]} courses={[{ id: 1, name: 'AI Kids' }]}
        schools={[{ id: 1, name: 'Cyberpark' }]} leads={[]} onOpenLead={vi.fn()} />
    </QueryClientProvider>);

    const calendarEvent = await screen.findByRole('button', { name: /15:00–16:00, .*AI Kids/ });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    fireEvent.click(calendarEvent);
    const dialog = screen.getByRole('dialog');
    await act(async () => { await Promise.resolve(); });
    expect(within(dialog).getByText('Алия')).toBeTruthy();
    expect(within(dialog).getByText('Индира')).toBeTruthy();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    expect(within(dialog).queryByText(translations.voiceRemindersDeliveredNoResponse.ru)).toBeNull();
    const selector = within(dialog).getByRole('combobox');
    selector.focus();
    fireEvent.keyDown(selector, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: translations.demoParticipantAttended.ru }));

    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    const badge = await screen.findByText(translations.voiceRemindersDeliveredNoResponse.ru);
    expect(within(badge.parentElement!).getByRole('combobox').textContent).toBe(translations.demoParticipantAttended.ru);
    expect(within(dialog).queryByText(translations.voiceRemindersResponseYes.ru)).toBeNull();
    expect(within(dialog).queryByText(translations.voiceRemindersResponseNo.ru)).toBeNull();
    expect((within(dialog).getByRole('button', { name: translations.saveAttendance.ru }) as HTMLButtonElement).disabled).toBe(false);
    expect(mocks.saveAttendance).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.outcome).not.toHaveBeenCalled();
  });

});
