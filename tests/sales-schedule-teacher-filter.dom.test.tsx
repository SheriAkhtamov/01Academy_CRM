// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SalesScheduleCalendar } from '../client/src/components/ux/SalesScheduleCalendar';
import { i18n } from '../client/src/lib/i18n';

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
    schedule: [{ dayOfWeek: 1, startTime: '18:00', endTime: '19:00' }],
  },
];

const renderSchedule = () => render(
  <QueryClientProvider client={new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })}>
    <SalesScheduleCalendar
      groups={groups}
      lessons={[]}
      courses={[
        { id: 1, name: 'AI Kids' },
        { id: 2, name: 'Vibe Coding' },
      ]}
      schools={[{ id: 1, name: 'Cyberpark' }]}
      leads={[]}
    />
  </QueryClientProvider>,
);

describe('sales schedule teacher filter', () => {
  beforeEach(() => {
    i18n.setLanguage('en');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 5, 15, 9, 0));
  });

  afterEach(() => vi.useRealTimers());

  it('filters calendar events by teacher while leaving group choices intact', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { container } = renderSchedule();

    expect(container.querySelector('[aria-label$=", AI Kids — Morning"]')).toBeTruthy();
    expect(container.querySelector('[aria-label$=", Vibe Coding — Evening"]')).toBeTruthy();
    expect(screen.getByText(/Lessons this week: 2/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Teachers: All teachers' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: /Anna Karimova/ }));
    await user.keyboard('{Escape}');

    expect(container.querySelector('[aria-label$=", AI Kids — Morning"]')).toBeTruthy();
    expect(container.querySelector('[aria-label$=", Vibe Coding — Evening"]')).toBeNull();
    expect(screen.getByText(/Lessons this week: 1/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove teacher filter: Anna Karimova' })).toBeTruthy();
    expect(screen.getByText('Vibe Coding — Evening')).toBeTruthy();
  });

  it('searches the teacher roster and can clear the active teacher chip', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { container } = renderSchedule();

    await user.click(screen.getByRole('button', { name: 'Teachers: All teachers' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Find a teacher' }), {
      target: { value: 'Boris' },
    });

    expect(screen.queryByRole('menuitemcheckbox', { name: /Anna Karimova/ })).toBeNull();
    await user.click(screen.getByRole('menuitemcheckbox', { name: /Boris Saidov/ }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Remove teacher filter: Boris Saidov' }));

    expect(container.querySelector('[aria-label$=", AI Kids — Morning"]')).toBeTruthy();
    expect(container.querySelector('[aria-label$=", Vibe Coding — Evening"]')).toBeTruthy();
  });

  it('collapses long empty hours automatically without density controls', () => {
    renderSchedule();

    expect(screen.getByRole('note', { name: 'No lessons from 11:30 to 17:30' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Compact' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Full day' })).toBeNull();
  });
});
