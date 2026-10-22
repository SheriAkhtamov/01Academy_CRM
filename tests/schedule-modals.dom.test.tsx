// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { enUS } from 'date-fns/locale';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduleEventDialog } from '../client/src/components/ux/calendar/ScheduleEventDialog';
import { ScheduleMonthGrid } from '../client/src/components/ux/calendar/ScheduleMonthGrid';
import { i18n, translations } from '../client/src/lib/i18n';
import type { SalesScheduleEvent } from '../client/src/lib/salesSchedule';

const day = new Date(2026, 9, 22);
const event: SalesScheduleEvent = {
  id: 'lesson-1', source: 'lesson', groupId: 1, groupName: 'Coding group',
  courseName: 'Web development', topic: 'Accessible forms and keyboard controls',
  teacherName: 'Main teacher', schoolName: 'Cyberpark', roomName: 'Room A',
  availableSeats: 3, maxStudents: 12, dayIndex: 0, startMinutes: 600, endMinutes: 660,
  startsAt: new Date('2026-10-22T05:00:00Z'), endsAt: new Date('2026-10-22T06:00:00Z'),
};

beforeEach(() => i18n.setLanguage('en'));
afterEach(async () => {
  cleanup();
  await new Promise(resolve => setTimeout(resolve, 0));
});

describe('schedule modals', () => {
  it('keeps lesson, course and location values separately labeled in the event dialog', () => {
    render(<ScheduleEventDialog event={event} open onOpenChange={vi.fn()} locale={enUS} groupIndexById={new Map([[1, 0]])} />);
    const dialog = screen.getByRole('dialog', { name: event.groupName });
    for (const [label, value] of [
      [translations.course.en, event.courseName],
      [translations.lessonTopic.en, event.topic],
      [translations.school.en, event.schoolName],
      [translations.room.en, event.roomName],
    ]) {
      expect(within(dialog).getByText(label!).closest('div')?.querySelector('dd')?.textContent).toBe(value);
    }
    expect(within(dialog).getByText('10:00–11:00')).toBeTruthy();
    expect(within(dialog).getByText('3/12')).toBeTruthy();
    expect(dialog.querySelector('[data-topographic="header"]')).toBeTruthy();
  });

  it('opens all events for an overflowing day and restores focus when dismissed', async () => {
    const user = userEvent.setup();
    const events = Array.from({ length: 5 }, (_, index) => ({ ...event, id: `lesson-${index}`, groupName: `Group ${index + 1}` }));
    const onSelectEvent = vi.fn();
    render(<ScheduleMonthGrid days={[day]} monthAnchor={day} now={day} locale={enUS} dayNames={['Thu']}
      groupIndexById={new Map([[1, 0]])} eventsByDate={new Map([['2026-10-22', events]])}
      onSelectDay={vi.fn()} onSelectEvent={onSelectEvent} />);
    const more = screen.getByRole('button', { name: translations.moreEventsCount.en.replace('{count}', '2') });
    await user.click(more);
    let dialog = screen.getByRole('dialog', { name: translations.schedule.en });
    expect(within(dialog).getAllByText('Thursday, 22 October')).toHaveLength(1);
    expect(within(dialog).getAllByRole('button', { name: /^10:00–11:00, Group/ })).toHaveLength(5);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(more));
    await user.click(more);
    dialog = screen.getByRole('dialog', { name: translations.schedule.en });
    await user.click(within(dialog).getByRole('button', { name: '10:00–11:00, Group 5' }));
    expect(onSelectEvent).toHaveBeenCalledWith(events[4]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
