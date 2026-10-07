// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoLessonDetailsDialog } from '../client/src/components/ux/DemoLessonDetailsDialog';
import type { DemoLesson } from '../client/src/features/demo-lessons/api';
import { i18n, translations } from '../client/src/lib/i18n';

const mocks = vi.hoisted(() => ({ toast: vi.fn(), apiRequest: vi.fn() }));
vi.mock('../client/src/hooks/use-toast', () => ({ toast: mocks.toast }));
vi.mock('../client/src/lib/queryClient', () => ({ apiRequest: mocks.apiRequest }));

const demo: DemoLesson = {
  id: 17, courseId: 1, schoolId: 2, teacherId: 4, courseName: 'Frontend',
  scheduledAt: '2026-10-07T05:00:00Z', durationMinutes: 60, format: 'online',
  status: 'scheduled', canManage: true,
  participants: [{
    id: 11, studentId: 71, leadId: 101, status: 'attended',
    contactName: 'Контакт ученика', leadName: 'Имя лида', studentName: 'Азиз',
    leadPhone: '+998901234567',
  }],
};

let client: QueryClient;
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  i18n.setLanguage('ru');
  mocks.toast.mockReset();
  mocks.apiRequest.mockReset();
  writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), {
    clipboard: { writeText },
  }));
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
});

function mount(value = demo, context: 'sales' | 'teacher' = 'sales') {
  render(<QueryClientProvider client={client}>
    <DemoLessonDetailsDialog demo={value} open onOpenChange={vi.fn()} context={context} />
  </QueryClientProvider>);
}

const copyButton = () => screen.getByRole('button', { name: translations.copyDemoReport.ru });

describe('copying a demo report', () => {
  it('copies every participant with lead name, student name, lead phone and distinct attendance marks after completion', async () => {
    mount({ ...demo, status: 'completed', participants: [
      ...demo.participants,
      { id: 12, studentId: 72, status: 'no_show', contactName: 'Родитель', studentName: 'Самира', leadPhone: '+998909876543', noShowReasonCode: 'forgot' },
      { id: 13, studentId: 73, status: 'invited', studentName: 'Саид', leadPhone: 'instagram:123' },
    ] });
    fireEvent.click(copyButton());

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      '1. Имя лида: Имя лида\nИмя студента: Азиз\nТелефон лида: +998901234567\nПосещение демо: Был на демо\n\n'
      + '2. Имя лида: Родитель\nИмя студента: Самира\nТелефон лида: +998909876543\nПосещение демо: Не пришёл\n\n'
      + '3. Имя лида: Не указано\nИмя студента: Саид\nТелефон лида: Не указано\nПосещение демо: Не отмечено',
    ));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ title: translations.demoReportCopied.ru }));
    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });

  it('copies the current attendance selection without saving it', async () => {
    mount({ ...demo, participants: [{ ...demo.participants[0], status: 'invited' }] });
    const selector = screen.getByRole('combobox');
    selector.focus();
    fireEvent.keyDown(selector, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: translations.demoParticipantAttended.ru }));
    fireEvent.click(copyButton());

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Посещение демо: Был на демо')));
    expect(mocks.apiRequest).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: translations.saveAttendance.ru }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('reports clipboard failure and allows another attempt', async () => {
    writeText.mockRejectedValueOnce(new Error('Permission denied'));
    mount();
    fireEvent.click(copyButton());
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ title: translations.copyFailed.ru, variant: 'destructive' }));
    expect((copyButton() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(copyButton());
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ title: translations.demoReportCopied.ru }));
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it('disables copying an empty list and keeps the action out of teacher dialogs', () => {
    mount({ ...demo, participants: [] });
    expect((copyButton() as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    mount(demo, 'teacher');
    expect(screen.queryByRole('button', { name: translations.copyDemoReport.ru })).toBeNull();
  });
});
