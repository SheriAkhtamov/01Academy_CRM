// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoLessonDetailsDialog } from '../client/src/components/ux/DemoLessonDetailsDialog';
import { DemoParticipantCardDialog } from '../client/src/features/demo-lessons/ui/DemoParticipantCardDialog';
import type { DemoLesson } from '../client/src/features/demo-lessons/api';
import { i18n } from '../client/src/lib/i18n';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../client/src/lib/queryClient', () => ({ apiRequest: mocks.request }));

const card = {
  demoLessonId: 23, participantId: 78,
  lead: { id: 42, contactName: 'Другой родитель', phone: '+998901234567', managerName: 'Другой менеджер', statusName: 'Демо запланировано', sourceName: 'Сайт', courseName: 'AI Kids', goal: null, urgency: null, comment: null },
  student: { id: 156, studentName: 'Другой ученик', studentAge: 12, contactName: 'Другой родитель', phone: null, managerName: 'Другой менеджер', courseName: 'AI Kids', schoolName: 'Cyberpark', groupName: null },
};
const demo: DemoLesson = {
  id: 23, courseId: 1, schoolId: 1, teacherId: 1, courseName: 'AI Kids', scheduledAt: '2030-01-02T05:00:00Z', durationMinutes: 60, format: 'offline', status: 'scheduled',
  participants: [{ id: 78, studentId: 156, leadId: 42, studentName: 'Другой ученик', contactName: 'Другой родитель', status: 'invited', managerId: 18, canManage: false }],
};
let client: QueryClient;

beforeEach(() => {
  i18n.setLanguage('ru');
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mocks.request.mockResolvedValue(card);
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
});
afterEach(() => { cleanup(); client.clear(); });

describe('demo participant card', () => {
  it('opens another manager participant above the demo with scoped data and no pipeline cache', async () => {
    const onOpenLead = vi.fn();
    const onOpenChange = vi.fn();
    render(<QueryClientProvider client={client}><DemoLessonDetailsDialog demo={demo} open participantView="demo" onOpenLead={onOpenLead} onOpenChange={onOpenChange} /></QueryClientProvider>);
    // The button names what it opens: the participant card, not the lead.
    fireEvent.click(screen.getByRole('button', { name: 'Участник демо-урока: Другой ученик' }));
    const dialog = await screen.findByRole('dialog', { name: 'Участник демо-урока' });
    await waitFor(() => expect(within(dialog).getByText('+998901234567')).toBeTruthy());
    expect(within(dialog).getAllByText('Другой менеджер')).toHaveLength(2);
    expect(mocks.request).toHaveBeenCalledWith('GET', '/api/academy/demo-lessons/23/participants/78/card');
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(onOpenLead).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(client.getQueryCache().getAll().some((query) => query.queryKey.includes('/api/academy/leads'))).toBe(false);
    expect(within(dialog).queryByRole('textbox')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Сохранить' })).toBeNull();
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Закрыть' })[0]);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Участник демо-урока' })).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Демо-урок' })).toBeTruthy();
  });

  it('does not reuse the previous participant data while another card is loading or denied', async () => {
    const view = (participantId: number) => <QueryClientProvider client={client}><DemoParticipantCardDialog demoId={23} participantId={participantId} open onOpenChange={vi.fn()} /></QueryClientProvider>;
    const rendered = render(view(78));
    await screen.findByText('+998901234567');
    let rejectNext: (error: Error) => void = () => {};
    mocks.request.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectNext = reject; }));
    rendered.rerender(view(79));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('GET', '/api/academy/demo-lessons/23/participants/79/card'));
    expect(screen.queryByText('+998901234567')).toBeNull();
    await act(async () => rejectNext(new Error('403: accessDenied')));
    await screen.findByText('Не удалось загрузить данные');
    expect(screen.queryByText('Другой ученик')).toBeNull();
  });
});
