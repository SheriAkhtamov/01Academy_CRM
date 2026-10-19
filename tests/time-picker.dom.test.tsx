// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimePicker, type TimePickerProps } from '../client/src/components/ui/time-picker';
import { DateTimeInput } from '../client/src/components/ui/date-time-input';
import { i18n } from '../client/src/lib/i18n';

beforeEach(() => i18n.setLanguage('en'));
afterEach(cleanup);

function Clock({ initial = '18:30', ...props }: Partial<TimePickerProps> & { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <><label htmlFor="clock">Meeting time</label><TimePicker id="clock" value={value} onValueChange={setValue} {...props} /></>;
}
function DateAndTime({ initial = '2026-10-21T18:30', required = false }: { initial?: string; required?: boolean }) {
  const [value, setValue] = useState(initial);
  return <form aria-label="Deadline"><label htmlFor="due">Due date</label><DateTimeInput id="due" name="dueAt" value={value} required={required} onValueChange={setValue} /><output data-testid="value">{value}</output></form>;
}
const wheel = (name: string) => within(screen.getByRole('listbox', { name }));
const pick = (name: string, option: string) => fireEvent.click(wheel(name).getByRole('option', { name: option }));

describe('shared clock picker', () => {
  it('opens scrollable hours and minutes without a calendar, and applies only after confirmation', async () => {
    const user = userEvent.setup();
    render(<Clock />);
    const field = screen.getByRole('textbox', { name: 'Meeting time' }) as HTMLInputElement;
    await user.click(field);
    const dialog = screen.getByRole('dialog', { name: 'Time' });
    expect(dialog.querySelector('input[type="date"], input[type="datetime-local"]')).toBeNull();
    expect(wheel('Hours').getAllByRole('option')).toHaveLength(24);
    expect(wheel('Minutes').getAllByRole('option')).toHaveLength(60);
    expect(wheel('Hours').getByRole('option', { selected: true }).textContent).toBe('18');
    pick('Hours', '15'); pick('Minutes', '05');
    expect(field.value).toBe('18:30');
    await user.click(within(dialog).getByRole('button', { name: 'Select time' }));
    expect(field.value).toBe('15:05');
    expect(document.activeElement).toBe(field);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('settles scrolling on the selected minute, then cancels without changing the field', async () => {
    render(<Clock />);
    fireEvent.click(screen.getByLabelText('Meeting time'));
    const column = screen.getByRole('listbox', { name: 'Minutes' });
    fireEvent.scroll(column, { target: { scrollTop: 7 * 44 } });
    await waitFor(() => expect(wheel('Minutes').getByRole('option', { selected: true }).textContent).toBe('07'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect((screen.getByLabelText('Meeting time') as HTMLInputElement).value).toBe('18:30');
  });

  it('supports keyboard selection and keeps the form from submitting on Enter', async () => {
    const submit = vi.fn(event => event.preventDefault());
    render(<form onSubmit={submit}><Clock /></form>);
    const field = screen.getByLabelText('Meeting time');
    fireEvent.keyDown(field, { key: 'Enter' });
    const hours = wheel('Hours').getByRole('option', { selected: true });
    fireEvent.keyDown(hours, { key: 'ArrowDown' });
    expect(wheel('Hours').getByRole('option', { selected: true }).textContent).toBe('19');
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect((field as HTMLInputElement).value).toBe('18:30');
  });

  it('uses the visible time when confirming immediately after a scroll', () => {
    render(<Clock />);
    fireEvent.click(screen.getByLabelText('Meeting time'));
    fireEvent.scroll(screen.getByRole('listbox', { name: 'Minutes' }), { target: { scrollTop: 42 * 44 } });
    fireEvent.click(screen.getByRole('button', { name: 'Select time' }));
    expect((screen.getByLabelText('Meeting time') as HTMLInputElement).value).toBe('18:42');
  });

  it('honors minute steps and bounds when the hour changes', () => {
    render(<Clock initial="10:45" min="10:30" max="11:15" step={900} />);
    fireEvent.click(screen.getByLabelText('Meeting time'));
    expect(wheel('Hours').getAllByRole('option').map(option => option.textContent)).toEqual(['10', '11']);
    expect(wheel('Minutes').getAllByRole('option').map(option => option.textContent)).toEqual(['30', '45']);
    pick('Hours', '11');
    expect(wheel('Minutes').getAllByRole('option').map(option => option.textContent)).toEqual(['00', '15']);
    fireEvent.click(screen.getByRole('button', { name: 'Select time' }));
    expect((screen.getByLabelText('Meeting time') as HTMLInputElement).value).toBe('11:15');
  });

  it('preserves required validation, names and disabled fields', () => {
    const { rerender } = render(<form aria-label="Clock form"><Clock initial="" name="meeting" required /></form>);
    const field = screen.getByLabelText('Meeting time') as HTMLInputElement;
    expect(field.checkValidity()).toBe(false);
    fireEvent.change(field, { target: { value: '25:00' } });
    expect(field.checkValidity()).toBe(false);
    fireEvent.change(field, { target: { value: '09:25' } });
    expect(field.checkValidity()).toBe(true);
    expect(new FormData(screen.getByRole('form') as HTMLFormElement).get('meeting')).toBe('09:25');
    rerender(<fieldset disabled><Clock /></fieldset>);
    fireEvent.click(screen.getByLabelText('Meeting time'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('supports permitted time ranges that cross midnight', () => {
    render(<Clock initial="23:00" min="22:00" max="02:00" />);
    fireEvent.click(screen.getByLabelText('Meeting time'));
    expect(wheel('Hours').getAllByRole('option').map(option => option.textContent)).toEqual(['00', '01', '02', '22', '23']);
    pick('Hours', '01'); pick('Minutes', '10');
    fireEvent.click(screen.getByRole('button', { name: 'Select time' }));
    expect((screen.getByLabelText('Meeting time') as HTMLInputElement).value).toBe('01:10');
  });
});

describe('separate date and clock controls', () => {
  it('preserves the day when changing time and preserves the time when changing the day', () => {
    render(<DateAndTime />);
    const date = screen.getByLabelText('Due date') as HTMLInputElement;
    expect(date.type).toBe('date');
    fireEvent.click(screen.getByRole('textbox', { name: 'Time' }));
    pick('Hours', '16'); pick('Minutes', '40');
    fireEvent.click(screen.getByRole('button', { name: 'Select time' }));
    expect(date.value).toBe('2026-10-21');
    expect(screen.getByTestId('value').textContent).toBe('2026-10-21T16:40');
    fireEvent.change(date, { target: { value: '2026-11-07' } });
    expect((screen.getByRole('textbox', { name: 'Time' }) as HTMLInputElement).value).toBe('16:40');
    expect(new FormData(screen.getByRole('form') as HTMLFormElement).get('dueAt')).toBe('2026-11-07T16:40');
    fireEvent.change(date, { target: { value: '' } });
    expect(screen.getByTestId('value').textContent).toBe('');
    expect((screen.getByRole('textbox', { name: 'Time' }) as HTMLInputElement).value).toBe('');
  });

  it('refreshes both controls after external quick-date changes and enforces date-specific bounds', () => {
    const { rerender } = render(<DateTimeInput id="bounded" aria-label="Date" value="2026-10-21T10:30" min="2026-10-21T10:30" max="2026-10-22T12:00" onValueChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('textbox', { name: 'Time' }));
    expect(wheel('Hours').queryByRole('option', { name: '09' })).toBeNull();
    expect(wheel('Minutes').queryByRole('option', { name: '29' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    rerender(<DateTimeInput id="bounded" aria-label="Date" value="2026-10-22T11:00" min="2026-10-21T10:30" max="2026-10-22T12:00" onValueChange={vi.fn()} />);
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe('2026-10-22');
    fireEvent.click(screen.getByRole('textbox', { name: 'Time' }));
    expect(wheel('Hours').getAllByRole('option').at(-1)?.textContent).toBe('12');
    pick('Hours', '12');
    expect(wheel('Minutes').getAllByRole('option').map(option => option.textContent)).toEqual(['00']);
  });
});
