// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MotionConfig } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuantityStepper } from '../client/src/components/ui/quantity-stepper';
import { i18n } from '../client/src/lib/i18n';

beforeEach(() => i18n.setLanguage('en'));
afterEach(cleanup);

function Counter({ initial = '2', ...props }: Omit<React.ComponentProps<typeof QuantityStepper>, 'value' | 'onChange'> & { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <><label htmlFor="quantity">Duration</label><QuantityStepper id="quantity" value={value} onChange={(event) => setValue(event.target.value)} {...props} /></>;
}
const mount = (element: React.ReactNode) => render(<MotionConfig reducedMotion="always" transition={{ duration: 0 }}>{element}</MotionConfig>);
const field = () => screen.getByRole('spinbutton') as HTMLInputElement;
const increase = () => screen.getByRole('button', { name: 'Increase: Duration' }) as HTMLButtonElement;
const decrease = () => screen.getByRole('button', { name: 'Decrease: Duration' }) as HTMLButtonElement;

describe('Quantity Stepper', () => {
  it('increments and decrements a controlled value without dropping rapid clicks', () => {
    mount(<Counter />);
    for (let count = 0; count < 5; count += 1) fireEvent.click(increase());
    expect(field().value).toBe('7');
    fireEvent.click(decrease());
    expect(field().value).toBe('6');
    expect(increase().getAttribute('aria-controls')).toBe(field().id);
  });

  it('honours the native step lattice and disables actions at the bounds', () => {
    mount(<Counter initial="15" min={15} max={45} step={15} />);
    expect(decrease().disabled).toBe(true);
    fireEvent.click(increase());
    expect(field().value).toBe('30');
    fireEvent.click(increase());
    expect(field().value).toBe('45');
    expect(increase().disabled).toBe(true);
    fireEvent.click(increase());
    expect(field().value).toBe('45');
    fireEvent.click(decrease());
    expect(field().value).toBe('30');
  });

  it('aligns an off-step value and preserves decimal precision', () => {
    const view = mount(<Counter initial="16" min={15} step={15} />);
    fireEvent.click(increase());
    expect(field().value).toBe('30');
    view.unmount();
    mount(<Counter initial="0.2" min={0} max={1} step="0.1" />);
    fireEvent.click(increase());
    expect(field().value).toBe('0.3');
    fireEvent.click(decrease());
    expect(field().value).toBe('0.2');
  });

  it('preserves clearing, typing, native validation, focus, blur and the input ref', async () => {
    const user = userEvent.setup();
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    const ref = { current: null as HTMLInputElement | null };
    mount(<><label htmlFor="quantity">Duration</label><QuantityStepper id="quantity" ref={ref} defaultValue="30" min={15} max={120} step={15} required onFocus={onFocus} onBlur={onBlur} /></>);
    expect(ref.current).toBe(field());
    await user.clear(field());
    expect(field().value).toBe('');
    expect(field().validity.valueMissing).toBe(true);
    await user.type(field(), '35');
    expect(field().validity.stepMismatch).toBe(true);
    await user.clear(field());
    await user.type(field(), '45');
    expect(field().checkValidity()).toBe(true);
    await user.tab();
    expect(onFocus).toHaveBeenCalledOnce();
    expect(onBlur).toHaveBeenCalledOnce();
    fireEvent.click(increase());
    expect(field().value).toBe('60');
  });

  it('starts an empty field on its minimum and submits its value through FormData', () => {
    mount(<form><label htmlFor="quantity">Duration</label><QuantityStepper name="duration" id="quantity" min={15} step={15} /></form>);
    fireEvent.click(increase());
    expect(field().value).toBe('15');
    expect(new FormData(field().form!).get('duration')).toBe('15');
  });

  it('restores the displayed and submitted default value on a native form reset', async () => {
    mount(<form><label htmlFor="quantity">Duration</label><QuantityStepper name="duration" id="quantity" defaultValue="30" min={15} step={15} /></form>);
    fireEvent.click(increase());
    expect(field().value).toBe('45');
    await act(async () => { field().form!.reset(); });
    expect(field().value).toBe('30');
    expect(field().parentElement!.querySelector('[aria-hidden="true"]')?.textContent).toBe('30');
  });

  it.each(['disabled', 'readOnly'] as const)('blocks both buttons for a %s field', (mode) => {
    const onChange = vi.fn();
    mount(<QuantityStepper aria-label="Duration" value={3} onChange={onChange} {...{ [mode]: true }} />);
    expect(increase().disabled).toBe(true);
    expect(decrease().disabled).toBe(true);
    fireEvent.click(increase());
    expect(onChange).not.toHaveBeenCalled();
    expect(field().value).toBe('3');
  });

  it('honours a disabled ancestor fieldset', () => {
    mount(<fieldset disabled><Counter /></fieldset>);
    expect(increase().matches(':disabled')).toBe(true);
    fireEvent.click(increase());
    expect(field().value).toBe('2');
  });

  it('retains keyboard activation and never submits the parent form from its step buttons', async () => {
    const user = userEvent.setup();
    const submit = vi.fn((event) => event.preventDefault());
    mount(<form onSubmit={submit}><Counter /></form>);
    increase().focus();
    await user.keyboard('{Enter}');
    expect(field().value).toBe('3');
    await user.keyboard(' ');
    expect(field().value).toBe('4');
    expect(submit).not.toHaveBeenCalled();
  });

  it('updates react-hook-form numeric fields and preserves validation and submit', async () => {
    const save = vi.fn();
    function Form() {
      const form = useForm({ defaultValues: { duration: 30 } });
      return <form onSubmit={form.handleSubmit(save)}>
        <label htmlFor="quantity">Duration</label>
        <QuantityStepper id="quantity" min={15} step={15} {...form.register('duration', { valueAsNumber: true })} />
        <button type="submit">Save</button>
      </form>;
    }
    mount(<Form />);
    fireEvent.click(increase());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    expect(save).toHaveBeenCalledWith({ duration: 45 }, expect.anything());
  });

  it('reflects external value changes while keeping the field mounted', () => {
    const view = mount(<QuantityStepper value={30} readOnly aria-label="Duration" />);
    const original = field();
    view.rerender(<MotionConfig reducedMotion="always" transition={{ duration: 0 }}><QuantityStepper value={90} readOnly aria-label="Duration" /></MotionConfig>);
    expect(field()).toBe(original);
    expect(field().value).toBe('90');
    expect(screen.getAllByRole('spinbutton')).toHaveLength(1);
  });

  it('localizes button names and shows the value without movement under reduced motion', () => {
    i18n.setLanguage('ru');
    mount(<Counter />);
    fireEvent.click(screen.getByRole('button', { name: 'Увеличить: Duration' }));
    expect(field().value).toBe('3');
    const display = field().parentElement!.querySelector('[aria-hidden="true"] span') as HTMLElement;
    expect(display.textContent).toBe('3');
    expect(['', 'none']).toContain(display.style.transform);
  });
});
