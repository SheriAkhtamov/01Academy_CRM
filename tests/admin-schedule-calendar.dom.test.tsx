// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminScheduleCalendar } from '../client/src/components/ux/AdminScheduleCalendar';
import { i18n } from '../client/src/lib/i18n';

const { apiRequestMock } = vi.hoisted(() => ({ apiRequestMock: vi.fn() }));

vi.mock('../client/src/lib/queryClient', () => ({
  apiRequest: apiRequestMock,
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const renderCalendar = () => render(
  <QueryClientProvider client={new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })}>
    <AdminScheduleCalendar schools={[{ id: 1, name: 'Cyberpark', isActive: true }]} />
  </QueryClientProvider>,
);

describe('admin resource schedule calendar', () => {
  beforeEach(() => {
    i18n.setLanguage('en');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 5, 15, 9, 0));
    apiRequestMock.mockResolvedValue({
      date: '2026-06-15',
      rooms: [
        {
          id: 1,
          name: 'Room 101',
          capacity: 12,
          groups: [{
            id: 1,
            name: 'Morning group',
            courseName: 'AI Kids',
            teacherName: 'Anna Karimova',
            durationMinutes: 60,
            schedule: [{ dayOfWeek: 1, startTime: '10:00', endTime: '11:00' }],
          }],
          lessons: [],
          demos: [],
        },
        {
          id: 2,
          name: 'Room 117',
          capacity: 16,
          groups: [{
            id: 2,
            name: 'Evening group',
            courseName: 'Vibe Coding',
            teacherName: 'Boris Saidov',
            durationMinutes: 60,
            schedule: [{ dayOfWeek: 1, startTime: '18:00', endTime: '19:00' }],
          }],
          lessons: [],
          demos: [],
        },
      ],
      onlineDemos: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    apiRequestMock.mockReset();
  });

  it('uses the same automatic gap compression across all resources', async () => {
    renderCalendar();

    expect(await screen.findByText('Morning group')).toBeTruthy();
    expect(screen.getByText('Evening group')).toBeTruthy();
    const collapsedGap = screen.getByRole('note', {
      name: 'No lessons from 11:30 to 17:30',
    });
    expect(collapsedGap.getAttribute('style')).toContain('left: 160px');
    expect(collapsedGap.getAttribute('style')).toContain('width: 128px');
    expect(screen.queryByRole('button', { name: 'Compact' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Full day' })).toBeNull();
  });
});
