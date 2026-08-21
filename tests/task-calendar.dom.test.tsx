// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskCalendar, dueAtForDay } from '../client/src/components/ux/board/TaskCalendar';
import { i18n } from '../client/src/lib/i18n';
import type { TaskSummary } from '../client/src/lib/boardTypes';

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

const person = { id: 7, fullName: 'Anna Karimova', position: 'Manager', module: 'sales' as const };

const task = (overrides: Partial<TaskSummary> & Pick<TaskSummary, 'id'>): TaskSummary => ({
  boardId: 1,
  title: `Task ${overrides.id}`,
  description: null,
  status: 'todo',
  priority: 'normal',
  position: 0,
  leadId: null,
  lead: null,
  dueAt: null,
  acceptedAt: null,
  createdAt: '2026-06-01T05:00:00.000Z',
  updatedAt: '2026-06-01T05:00:00.000Z',
  creator: person,
  assignee: person,
  commentCount: 0,
  attachmentCount: 0,
  checklistTotal: 0,
  checklistDone: 0,
  ...overrides,
});

// 16 June 2026, 11:00 in Tashkent.
const NOW = Date.UTC(2026, 5, 16, 6, 0);

const tasks: TaskSummary[] = [
  task({ id: 1, title: 'Call the lead back', dueAt: '2026-06-18T13:00:00.000Z' }),
  task({ id: 2, title: 'Send the contract', status: 'in_progress', dueAt: '2026-06-10T13:00:00.000Z' }),
  task({ id: 3, title: 'Close the month', status: 'done', dueAt: '2026-06-20T05:00:00.000Z' }),
  task({ id: 4, title: 'Rewrite the onboarding script', dueAt: null }),
];

describe('task calendar', () => {
  beforeEach(() => {
    window.localStorage.clear();
    i18n.setLanguage('en');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => vi.useRealTimers());

  const renderCalendar = () => {
    const onTaskClick = vi.fn();
    const onReschedule = vi.fn().mockResolvedValue(true);
    render(<TaskCalendar tasks={tasks} onTaskClick={onTaskClick} onReschedule={onReschedule} />);
    return { onTaskClick, onReschedule };
  };

  it('places a task on the day its deadline falls on, in academy time', () => {
    renderCalendar();

    // 13:00 UTC is 18:00 in Tashkent on the 18th, so the task belongs to the
    // 18th rather than being pushed a day either way.
    const june18 = screen.getByRole('group', { name: 'Thursday, June 18' });
    expect(june18.querySelector('[data-testid="task-calendar-task-1"]')).toBeTruthy();
  });

  it('keeps a task with no deadline off the grid and inside its own panel', () => {
    renderCalendar();

    const panel = screen.getByRole('complementary', { name: 'Tasks without a due date' });
    expect(panel.querySelector('[data-testid="task-calendar-task-4"]')).toBeTruthy();
    expect(screen.getByTestId('task-calendar-task-4').closest('[role="group"]')).toBeNull();
  });

  it('opens the task that was clicked', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onTaskClick } = renderCalendar();

    await user.click(screen.getByTestId('task-calendar-task-1'));

    expect(onTaskClick).toHaveBeenCalledWith(1);
  });

  it('separates overdue work from what is still planned and what is finished', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCalendar();

    expect(screen.getByTestId('task-calendar-filter-overdue').textContent).toContain('1');
    expect(screen.getByTestId('task-calendar-filter-planned').textContent).toContain('1');
    expect(screen.getByTestId('task-calendar-filter-finished').textContent).toContain('1');

    await user.click(screen.getByTestId('task-calendar-filter-overdue'));

    expect(screen.queryByTestId('task-calendar-task-2')).toBeNull();
    expect(screen.getByTestId('task-calendar-task-1')).toBeTruthy();
  });

  it('paints tasks with theme tokens so they survive dark mode', () => {
    renderCalendar();

    const overdue = screen.getByTestId('task-calendar-task-2');
    expect(overdue.getAttribute('style')).toContain('var(--calendar-rose-background)');
    expect(overdue.className).not.toContain('bg-red-50');
  });

  it('moves between months and comes back to today', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCalendar();

    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.queryByTestId('task-calendar-task-1')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByTestId('task-calendar-task-1')).toBeTruthy();
  });

  it('asks before a drag strips a deadline, since nothing here can undo it', () => {
    renderCalendar();
    // The confirmation is what the drop handler opens; it must not be standing
    // open on its own.
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('carries the tasks over into the week and agenda views', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCalendar();

    // 16 June is a Monday, so its week holds the 18th but not the 10th or 20th.
    await user.click(screen.getByRole('button', { name: 'Week' }));
    expect(screen.getByTestId('task-calendar-task-1')).toBeTruthy();
    expect(screen.queryByTestId('task-calendar-task-2')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByTestId('task-calendar-task-1')).toBeTruthy();
    // The week of the 15th holds the 18th and the 20th; the agenda skips the
    // five empty days rather than printing seven headings.
    expect(screen.getAllByRole('group', { name: /June/ }).map((day) => day.getAttribute('aria-label')))
      .toEqual(['Thursday, June 18', 'Saturday, June 20']);
  });

  it('names a day for a screen reader without filing it as a landmark', () => {
    renderCalendar();
    // A month is 42 cells. Landmarks are a navigation index, not a grid.
    expect(screen.queryAllByRole('region')).toHaveLength(0);
    expect(screen.getAllByRole('group', { name: /June/ }).length).toBeGreaterThan(27);
  });

  it('keeps the whole title reachable from a cell too narrow to show it', () => {
    renderCalendar();
    expect(screen.getByTestId('task-calendar-task-1').getAttribute('title'))
      .toBe('Call the lead back');
  });

  it('says when a task is due, not only that it is late', () => {
    renderCalendar();
    const label = screen.getByTestId('task-calendar-task-2').getAttribute('aria-label');
    expect(label).toContain('Overdue tasks');
    expect(label).toContain('Jun 10');
  });
});

describe('deadline placement', () => {
  it('keeps the time of day a deadline already had', () => {
    // 04:00 UTC is 09:00 in Tashkent: a morning task stays a morning task.
    expect(dueAtForDay('2026-06-25', '2026-06-18T04:00:00.000Z'))
      .toBe(new Date('2026-06-25T09:00:00+05:00').toISOString());
  });

  it('gives a task scheduled for the first time the end of that working day', () => {
    expect(dueAtForDay('2026-06-25', null))
      .toBe(new Date('2026-06-25T18:00:00+05:00').toISOString());
  });
});
