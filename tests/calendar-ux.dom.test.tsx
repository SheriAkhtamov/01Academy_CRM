// @vitest-environment jsdom
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SalesScheduleCalendar } from '../client/src/components/ux/SalesScheduleCalendar';
import { AdminScheduleCalendar } from '../client/src/components/ux/AdminScheduleCalendar';
import { AttendanceCalendar } from '../client/src/components/ux/AttendanceCalendar';
import {
  WeekScheduleEditor,
  type WeekScheduleItem,
} from '../client/src/components/ux/WeekScheduleEditor';
import { i18n } from '../client/src/lib/i18n';

const { apiRequestMock } = vi.hoisted(() => ({ apiRequestMock: vi.fn() }));

vi.mock('../client/src/lib/queryClient', () => ({ apiRequest: apiRequestMock }));
vi.mock('../client/src/features/demo-lessons/api', () => ({
  demoLessonQueryKeys: { all: ['/api/academy/demo-lessons'] },
  demoLessonsApi: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../client/src/components/ux/DemoLessonDialog', () => ({
  DemoLessonDialog: () => null,
}));
vi.mock('../client/src/components/ux/DemoLessonDetailsDialog', () => ({
  DemoLessonDetailsDialog: () => null,
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
});

const groups = [
  {
    id: 1,
    name: 'AI Kids — Morning',
    schoolId: 1,
    schoolName: 'Cyberpark',
    courseId: 1,
    courseName: 'AI Kids',
    teacherId: 10,
    teacherName: 'Anna Karimova',
    status: 'in_progress',
    schedule: [{ dayOfWeek: 1, startTime: '10:00', endTime: '11:00' }],
  },
  {
    id: 2,
    name: 'Vibe Coding — Evening',
    schoolId: 1,
    schoolName: 'Cyberpark',
    courseId: 2,
    courseName: 'Vibe Coding',
    teacherId: 11,
    teacherName: 'Boris Saidov',
    status: 'in_progress',
    schedule: [{ dayOfWeek: 4, startTime: '18:00', endTime: '19:00' }],
  },
];

const renderSalesSchedule = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <SalesScheduleCalendar
      groups={groups}
      lessons={[]}
      courses={[{ id: 1, name: 'AI Kids' }, { id: 2, name: 'Vibe Coding' }]}
      schools={[{ id: 1, name: 'Cyberpark' }]}
      leads={[]}
    />
  </QueryClientProvider>,
);

describe('sales schedule calendar views', () => {
  beforeEach(() => {
    window.localStorage.clear();
    i18n.setLanguage('en');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Monday of the week holding both scheduled groups.
    vi.setSystemTime(new Date(2026, 5, 15, 9, 0));
  });

  afterEach(() => vi.useRealTimers());

  it('opens on the week grid and labels the visible range', () => {
    renderSalesSchedule();

    expect(screen.getByRole('button', { name: 'Week' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('15 Jun — 21 Jun 2026')).toBeTruthy();
  });

  it('narrows to a single day and back, keeping only that day’s lessons', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { container } = renderSalesSchedule();

    await user.click(screen.getByRole('button', { name: 'Day' }));

    expect(container.querySelector('[aria-label$=", AI Kids — Morning"]')).toBeTruthy();
    expect(container.querySelector('[aria-label$=", Vibe Coding — Evening"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Next day' }));
    expect(screen.getByText('Tuesday, 16 June 2026')).toBeTruthy();
    expect(container.querySelector('[aria-label$=", AI Kids — Morning"]')).toBeNull();
  });

  it('lists the week chronologically in the agenda view', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { container } = renderSalesSchedule();

    await user.click(screen.getByRole('button', { name: 'List' }));

    const rows = container.querySelectorAll('li button[aria-label]');
    expect([...rows].map((row) => row.getAttribute('aria-label'))).toEqual([
      '10:00–11:00, AI Kids — Morning',
      '18:00–19:00, Vibe Coding — Evening',
    ]);
  });

  it('remembers the chosen view for the next visit', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const first = renderSalesSchedule();
    await user.click(screen.getByRole('button', { name: 'Month' }));
    first.unmount();

    renderSalesSchedule();
    expect(screen.getByRole('button', { name: 'Month' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('June 2026')).toBeTruthy();
  });

  it('collapses the filter panel and counts what is hidden', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSalesSchedule();

    await user.click(screen.getByRole('checkbox', { name: /AI Kids — Morning/ }));
    const filtersToggle = screen.getByRole('button', { name: /Schedule filters/ });
    expect(within(filtersToggle).getByText('1')).toBeTruthy();

    await user.click(filtersToggle);
    expect(screen.queryByRole('textbox', { name: 'Find a group' })).toBeNull();
  });
});

describe('admin resource calendar navigation', () => {
  beforeEach(() => {
    i18n.setLanguage('en');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 5, 15, 9, 0));
    apiRequestMock.mockResolvedValue({ date: '2026-06-15', rooms: [], onlineDemos: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    apiRequestMock.mockReset();
  });

  const renderResourceCalendar = () => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AdminScheduleCalendar schools={[{ id: 1, name: 'Cyberpark', isActive: true }]} />
    </QueryClientProvider>,
  );

  it('steps between days without opening the date picker', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderResourceCalendar();

    expect(await screen.findByText('Monday, 15 June 2026')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Today' }).hasAttribute('disabled')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Next day' }));
    expect(screen.getByText('Tuesday, 16 June 2026')).toBeTruthy();
    expect(apiRequestMock).toHaveBeenCalledWith(
      'GET',
      expect.stringContaining('date=2026-06-16'),
    );

    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByText('Monday, 15 June 2026')).toBeTruthy();
  });
});

describe('attendance calendar', () => {
  const lessons = [
    {
      id: 41,
      groupName: 'AI Kids',
      topic: 'Neural networks',
      scheduledAt: new Date(Date.UTC(2026, 5, 15, 5, 0)).toISOString(),
      status: 'scheduled',
    },
    {
      id: 42,
      groupName: 'AI Kids',
      topic: 'Prompt design',
      scheduledAt: new Date(Date.UTC(2026, 5, 18, 5, 0)).toISOString(),
      status: 'conducted',
    },
  ];

  beforeEach(() => {
    window.localStorage.clear();
    i18n.setLanguage('en');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 16, 6, 0)));
  });

  afterEach(() => vi.useRealTimers());

  const renderAttendance = (onSelect = vi.fn()) => {
    render(
      <AttendanceCalendar
        lessons={lessons}
        selectedLessonId=""
        now={Date.UTC(2026, 5, 16, 6, 0)}
        onSelectLesson={onSelect}
      />,
    );
    return onSelect;
  };

  it('hides a status when its chip is switched off', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAttendance();

    expect(screen.getByTestId('attendance-calendar-lesson-41')).toBeTruthy();
    expect(screen.getByTestId('attendance-calendar-lesson-42')).toBeTruthy();

    await user.click(screen.getByTestId('attendance-filter-pending'));

    expect(screen.queryByTestId('attendance-calendar-lesson-41')).toBeNull();
    expect(screen.getByTestId('attendance-calendar-lesson-42')).toBeTruthy();
  });

  it('jumps straight to the oldest lesson still waiting for attendance', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onSelect = renderAttendance();

    await user.click(screen.getByRole('button', { name: 'Next to mark' }));

    expect(onSelect).toHaveBeenCalledWith('41');
  });

  it('paints lesson cards with theme tokens rather than fixed light colours', () => {
    renderAttendance();

    const card = screen.getByTestId('attendance-calendar-lesson-42');
    expect(card.getAttribute('style')).toContain('var(--calendar-emerald-background)');
    expect(card.className).not.toContain('bg-emerald-50');
  });
});

describe('week schedule editor', () => {
  beforeEach(() => i18n.setLanguage('en'));

  function EditorHarness({ initial = [] as WeekScheduleItem[] }) {
    const [value, setValue] = useState<WeekScheduleItem[]>(initial);
    return (
      <WeekScheduleEditor
        value={value}
        onChange={setValue}
        dayNames={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']}
      />
    );
  }

  it('fills the working week from a preset', async () => {
    const user = userEvent.setup();
    render(<EditorHarness />);

    await user.click(screen.getByRole('button', { name: 'Mon–Fri' }));

    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) {
      expect(screen.getByLabelText(`${day}: Start`).getAttribute('value')).toBe('09:00');
    }
    expect(screen.getByLabelText('Sat: Start').hasAttribute('disabled')).toBe(true);
  });

  it('flags a row whose end is not after its start', async () => {
    const user = userEvent.setup();
    render(<EditorHarness initial={[{ dayOfWeek: 1, startTime: '10:00', endTime: '09:00' }]} />);

    expect(screen.getByText('End is not after start')).toBeTruthy();

    await user.clear(screen.getByLabelText('Mon: End'));
    await user.type(screen.getByLabelText('Mon: End'), '11:30');

    expect(screen.queryByText('End is not after start')).toBeNull();
    expect(screen.getByText('1h 30min')).toBeTruthy();
  });

  it('copies the first row time across every selected day', async () => {
    const user = userEvent.setup();
    render(<EditorHarness initial={[
      { dayOfWeek: 1, startTime: '10:00', endTime: '12:00' },
      { dayOfWeek: 3, startTime: '15:00', endTime: '16:00' },
    ]} />);

    await user.click(screen.getByRole('button', { name: 'Same time everywhere' }));

    expect(screen.getByLabelText('Wed: Start').getAttribute('value')).toBe('10:00');
    expect(screen.getByLabelText('Wed: End').getAttribute('value')).toBe('12:00');
  });
});
