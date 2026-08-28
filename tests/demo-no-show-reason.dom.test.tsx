// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  saveAttendance: vi.fn(),
}));

vi.mock('../client/src/features/demo-lessons/api', () => ({
  demoLessonQueryKeys: {
    all: ['/api/academy/demo-lessons'],
    availability: ['/api/academy/availability/slots'],
    resourceAvailability: ['/api/academy/demo-lessons/resource-availability'],
    teacherOptions: ['/api/academy/demo-lessons', 'teacher-options'],
  },
  demoLessonsApi: {
    saveAttendance: apiMocks.saveAttendance,
    cancel: vi.fn(),
    outcome: vi.fn(),
    reschedule: vi.fn(),
    teacherOptions: vi.fn(),
    changeTeacher: vi.fn(),
  },
}));

const demo: DemoLesson = {
  id: 5,
  courseId: 1,
  courseName: 'Frontend',
  schoolId: 1,
  schoolName: 'Cyberpark',
  roomId: 2,
  roomName: '204',
  teacherId: 3,
  teacherName: 'Преподаватель',
  scheduledAt: '2026-09-01T10:00:00.000Z',
  durationMinutes: 60,
  format: 'offline',
  status: 'scheduled',
  participants: [
    { id: 11, studentId: 71, leadId: 101, status: 'confirmed', contactName: 'Родитель Азиза', studentName: 'Азиз' },
  ],
  canManage: true,
};

const renderDialog = (value: DemoLesson = demo) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <DemoLessonDetailsDialog demo={value} open onOpenChange={vi.fn()} />
  </QueryClientProvider>,
);

const chooseNoShow = async () => {
  const combobox = screen.getByRole('combobox');
  combobox.focus();
  fireEvent.keyDown(combobox, { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: /Не пришёл|Did not attend/i }));
  await screen.findByRole('dialog', { name: /Причина отсутствия|Reason for absence/i });
};

describe('demo no-show reason dialog', () => {
  beforeEach(() => {
    apiMocks.saveAttendance.mockReset();
    apiMocks.saveAttendance.mockResolvedValue({ ...demo, status: 'completed' });
  });

  it('does not apply a no-show when the reason dialog is cancelled', async () => {
    renderDialog();
    await chooseNoShow();

    fireEvent.click(screen.getByRole('button', { name: /Назад|Go back/i }));

    await waitFor(() => expect(screen.queryByRole('dialog', {
      name: /Причина отсутствия|Reason for absence/i,
    })).toBeNull());
    expect(screen.getByRole('combobox').textContent).toMatch(/Выберите результат|Select result/i);
    expect((screen.getByRole('button', {
      name: /Сохранить посещение|Save demo attendance/i,
    }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves the selected structured reason only after the main confirmation', async () => {
    renderDialog();
    await chooseNoShow();

    fireEvent.click(screen.getByRole('radio', { name: /Забыл о занятии|Forgot about the lesson/i }));
    fireEvent.change(screen.getByLabelText(/Комментарий \(необязательно\)|Comment \(optional\)/i), {
      target: { value: 'Перезвонили родителю' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Подтвердить|Confirm/i }));

    expect(apiMocks.saveAttendance).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Сохранить посещение|Save demo attendance/i }));

    await waitFor(() => expect(apiMocks.saveAttendance).toHaveBeenCalledWith(5, {
      participants: [{
        participantId: 11,
        status: 'no_show',
        result: null,
        noShowReasonCode: 'forgot',
        noShowReasonNote: 'Перезвонили родителю',
      }],
    }));
  });

  it('keeps owned participants editable when a future demo also contains another manager\'s student', async () => {
    renderDialog({
      ...demo,
      scheduledAt: '2030-09-01T10:00:00.000Z',
      canManage: false,
      participants: [
        { ...demo.participants[0], canManage: true },
        {
          id: 12,
          studentId: 72,
          leadId: 102,
          status: 'confirmed',
          contactName: null,
          studentName: null,
          canManage: false,
        },
      ],
    });

    const attendanceSelectors = screen.getAllByRole('combobox') as HTMLButtonElement[];
    expect(attendanceSelectors[0].disabled).toBe(false);
    expect(attendanceSelectors[1].disabled).toBe(true);

    attendanceSelectors[0].focus();
    fireEvent.keyDown(attendanceSelectors[0], { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: /Был на демо|Attended/i }));
    fireEvent.click(screen.getByRole('button', {
      name: /Сохранить посещение|Save demo attendance/i,
    }));

    await waitFor(() => expect(apiMocks.saveAttendance).toHaveBeenCalledWith(5, {
      participants: [{
        participantId: 11,
        status: 'attended',
        result: null,
        noShowReasonCode: null,
        noShowReasonNote: null,
      }],
    }));
  });
});
