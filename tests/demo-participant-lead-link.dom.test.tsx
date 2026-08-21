// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
    { id: 11, leadId: 101, status: 'confirmed', contactName: 'Родитель Азиза', studentName: 'Азиз' },
    { id: 12, leadId: 102, status: 'invited', contactName: 'Дилноза' },
    // A lead this manager may not open: the server blanks both names.
    { id: 13, leadId: 103, status: 'invited', contactName: null, studentName: null },
  ],
  canManage: true,
};

const renderDialog = (props: Partial<Parameters<typeof DemoLessonDetailsDialog>[0]> = {}) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <DemoLessonDetailsDialog demo={demo} open onOpenChange={vi.fn()} {...props} />
  </QueryClientProvider>,
);

const leadButtons = () => screen.getAllByRole('button')
  .filter((button) => /Открыть лида|Open lead/.test(button.getAttribute('aria-label') ?? ''));

describe('demo participants open their lead card', () => {
  it('gives every reachable participant a button that opens their lead', () => {
    const onOpenLead = vi.fn();
    const onOpenChange = vi.fn();
    renderDialog({ onOpenLead, onOpenChange });

    const buttons = leadButtons();
    expect(buttons).toHaveLength(2);
    expect(buttons[0].getAttribute('aria-label')).toContain('Азиз');
    expect(buttons[1].getAttribute('aria-label')).toContain('Дилноза');

    fireEvent.click(buttons[0]);
    expect(onOpenLead).toHaveBeenCalledWith(101);

    // The lead card opens on top: the demo stays open so attendance marks survive.
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('leaves a restricted participant unclickable', () => {
    renderDialog({ onOpenLead: vi.fn() });

    const restricted = screen.getByText('Лид с ограниченным доступом');
    expect(restricted.closest('button')).toBeNull();
  });

  it('renders participants as plain text when the host cannot show a lead', () => {
    renderDialog();

    expect(leadButtons()).toHaveLength(0);
    expect(screen.getByText('Азиз')).toBeTruthy();
    expect(screen.getByText('Дилноза')).toBeTruthy();
  });
});
