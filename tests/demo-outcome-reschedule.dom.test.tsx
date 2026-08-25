// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoLessonDetailsDialog } from '../client/src/components/ux/DemoLessonDetailsDialog';
import type { DemoLesson } from '../client/src/features/demo-lessons/api';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
(Element.prototype as unknown as Record<string, unknown>).hasPointerCapture = () => false;
(Element.prototype as unknown as Record<string, unknown>).setPointerCapture = () => undefined;
(Element.prototype as unknown as Record<string, unknown>).releasePointerCapture = () => undefined;
(Element.prototype as unknown as Record<string, unknown>).scrollIntoView = () => undefined;

const apiMocks = vi.hoisted(() => ({
  outcome: vi.fn(),
  reschedule: vi.fn(),
}));

vi.mock('../client/src/features/demo-lessons/api', () => ({
  demoLessonQueryKeys: {
    all: ['/api/academy/demo-lessons'],
    availability: ['/api/academy/availability/slots'],
  },
  demoLessonsApi: {
    saveAttendance: vi.fn(),
    cancel: vi.fn(),
    outcome: apiMocks.outcome,
    reschedule: apiMocks.reschedule,
  },
}));

const pastDemo: DemoLesson = {
  id: 17,
  courseId: 1,
  courseName: 'Frontend',
  schoolId: 1,
  schoolName: 'Cyberpark',
  roomId: 2,
  roomName: '204',
  teacherId: 3,
  teacherName: 'Преподаватель',
  scheduledAt: '2025-01-01T05:00:00.000Z',
  durationMinutes: 60,
  format: 'offline',
  status: 'scheduled',
  participants: [
    { id: 11, studentId: 71, leadId: 101, status: 'attended', contactName: 'Родитель', studentName: 'Азиз' },
  ],
  canManage: true,
};

const renderDialog = (demo: DemoLesson = pastDemo) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <DemoLessonDetailsDialog demo={demo} open onOpenChange={vi.fn()} />
  </QueryClientProvider>,
);

describe('demo outcome and rescheduling dialogs', () => {
  beforeEach(() => {
    apiMocks.outcome.mockReset();
    apiMocks.reschedule.mockReset();
    apiMocks.outcome.mockImplementation(async (payloadDemoId: number, payload: { status: string }) => ({
      ...pastDemo,
      id: payloadDemoId,
      status: payload.status,
    }));
    apiMocks.reschedule.mockResolvedValue({
      ...pastDemo,
      scheduledAt: '2030-07-15T05:00:00.000Z',
    });
  });

  it('confirms and saves a conducted outcome', async () => {
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: /Отметить проведённым|Mark as conducted/i }));
    const confirmation = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirmation).getByRole('button', {
      name: /Отметить проведённым|Mark as conducted/i,
    }));

    await waitFor(() => expect(apiMocks.outcome).toHaveBeenCalledWith(17, {
      status: 'completed',
    }));
  });

  it('requires and saves a classified not-conducted reason', async () => {
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: /Не проведено|Not conducted/i }));
    const reasonDialog = await screen.findByRole('dialog', {
      name: /Почему демо не было проведено|Why was the demo not conducted/i,
    });
    fireEvent.click(within(reasonDialog).getByRole('radio', {
      name: /Преподаватель не смог|Teacher was unavailable/i,
    }));
    fireEvent.click(within(reasonDialog).getByRole('button', {
      name: /Не проведено|Not conducted/i,
    }));

    await waitFor(() => expect(apiMocks.outcome).toHaveBeenCalledWith(17, {
      status: 'not_conducted',
      reasonCode: 'teacher_unavailable',
      reasonNote: null,
    }));
  });

  it('sends the new academy-local time and a mandatory rescheduling reason', async () => {
    renderDialog({
      ...pastDemo,
      scheduledAt: '2030-07-14T05:00:00.000Z',
    });

    fireEvent.click(screen.getByRole('button', { name: /Перенести|Reschedule/i }));
    const rescheduleDialog = await screen.findByRole('dialog', {
      name: /Перенести демо-урок|Reschedule demo lesson/i,
    });
    fireEvent.change(within(rescheduleDialog).getByLabelText(/Дата|Date/i), {
      target: { value: '2030-07-15' },
    });
    fireEvent.change(within(rescheduleDialog).getByLabelText(/Время|Time/i), {
      target: { value: '10:30' },
    });
    fireEvent.change(within(rescheduleDialog).getByLabelText(/Причина переноса|Reason for rescheduling/i), {
      target: { value: 'По просьбе родителя' },
    });
    fireEvent.click(within(rescheduleDialog).getByRole('button', {
      name: /Перенести|Reschedule/i,
    }));

    await waitFor(() => expect(apiMocks.reschedule).toHaveBeenCalledWith(17, {
      scheduledAt: '2030-07-15T05:30:00.000Z',
      reason: 'По просьбе родителя',
    }));
  });
});
