// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MotionConfig } from 'framer-motion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Checkbox, NativeCheckbox, NativeChoiceInput } from '../client/src/components/ui/checkbox';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Checkbox Draw', () => {
  it('keeps one decorative path mounted while a label, Space and fast clicks change the value', async () => {
    const changed = vi.fn();
    const ref = { current: null as HTMLButtonElement | null };
    function Choice() {
      const [checked, setChecked] = useState(false);
      return <><Checkbox ref={ref} id="choice" checked={checked} onCheckedChange={(next) => { changed(next); setChecked(next === true); }} />
        <label htmlFor="choice">Ship on Friday</label></>;
    }
    const user = userEvent.setup();
    render(<Choice />);
    const checkbox = screen.getByRole('checkbox', { name: 'Ship on Friday' });
    const path = checkbox.querySelector('.checkbox-tick');
    expect(ref.current).toBe(checkbox);
    expect(checkbox.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(checkbox.querySelector('svg')?.getAttribute('focusable')).toBe('false');
    await user.click(screen.getByText('Ship on Friday'));
    expect(checkbox.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(checkbox);
    await user.keyboard(' ');
    expect(checkbox.getAttribute('aria-checked')).toBe('false');
    await user.dblClick(checkbox);
    expect(changed.mock.calls.map(([value]) => value)).toEqual([true, false, true, false]);
    expect(checkbox.querySelector('.checkbox-tick')).toBe(path);
  });

  it('represents mixed selection separately and proceeds from mixed to checked to unchecked', async () => {
    function MixedChoice() {
      const [checked, setChecked] = useState<boolean | 'indeterminate'>('indeterminate');
      return <Checkbox aria-label="All rows" checked={checked} onCheckedChange={setChecked} />;
    }
    const user = userEvent.setup();
    render(<MixedChoice />);
    const checkbox = screen.getByRole('checkbox', { name: 'All rows' });
    expect(checkbox.getAttribute('aria-checked')).toBe('mixed');
    expect(checkbox.getAttribute('data-state')).toBe('indeterminate');
    expect(checkbox.querySelector('.checkbox-mixed')?.getAttribute('d')).toBe('M5 12h14');
    await user.click(checkbox);
    expect(checkbox.getAttribute('aria-checked')).toBe('true');
    await user.keyboard(' ');
    expect(checkbox.getAttribute('aria-checked')).toBe('false');
  });

  it('keeps existing selection and its path stable through unrelated renders', () => {
    const changed = vi.fn();
    const view = render(<Checkbox aria-label="Selected" checked onCheckedChange={changed} />);
    const checkbox = screen.getByRole('checkbox', { name: 'Selected' });
    const path = checkbox.querySelector('.checkbox-tick');
    view.rerender(<Checkbox aria-label="Selected" checked onCheckedChange={changed} className="border-primary" />);
    expect(screen.getByRole('checkbox')).toBe(checkbox);
    expect(checkbox.querySelector('.checkbox-tick')).toBe(path);
    expect(checkbox.getAttribute('aria-checked')).toBe('true');
    expect(changed).not.toHaveBeenCalled();
  });

  it('does not change disabled controls or controls inside disabled fieldsets', async () => {
    const changed = vi.fn();
    const user = userEvent.setup();
    render(<><Checkbox disabled aria-label="Protected" onCheckedChange={changed} />
      <fieldset disabled><Checkbox aria-label="Blocked" onCheckedChange={changed} /><NativeCheckbox aria-label="Native blocked" onChange={changed} /></fieldset></>);
    for (const checkbox of screen.getAllByRole('checkbox')) await user.click(checkbox);
    expect(changed).not.toHaveBeenCalled();
  });

  it('preserves Radix form values and reset behavior', async () => {
    const user = userEvent.setup();
    render(<form aria-label="Choices"><Checkbox aria-label="Approved" name="approved" value="yes" defaultChecked /></form>);
    const form = screen.getByRole('form', { name: 'Choices' }) as HTMLFormElement;
    const checkbox = screen.getByRole('checkbox', { name: 'Approved' });
    expect(new FormData(form).get('approved')).toBe('yes');
    await user.click(checkbox);
    expect(new FormData(form).has('approved')).toBe(false);
    fireEvent.reset(form);
    expect(checkbox.getAttribute('aria-checked')).toBe('true');
    expect(new FormData(form).get('approved')).toBe('yes');
  });
});

describe('native Checkbox Draw', () => {
  it('keeps real native change events, the ref and label activation without duplicate events', async () => {
    const changed = vi.fn();
    const ref = { current: null as HTMLInputElement | null };
    const user = userEvent.setup();
    render(<label><NativeCheckbox ref={ref} onChange={(event) => changed(event.target, event.target.checked)} />Required</label>);
    const checkbox = screen.getByRole('checkbox', { name: 'Required' }) as HTMLInputElement;
    expect(ref.current).toBe(checkbox);
    expect(checkbox.tagName).toBe('INPUT');
    await user.click(screen.getByText('Required'));
    expect(checkbox.checked).toBe(true);
    expect(changed).toHaveBeenCalledExactlyOnceWith(checkbox, true);
    await user.keyboard(' ');
    expect(checkbox.checked).toBe(false);
    expect(changed.mock.calls).toEqual([[checkbox, true], [checkbox, false]]);
  });

  it('preserves native validation, form serialization and reset', async () => {
    const user = userEvent.setup();
    render(<form aria-label="Native form"><NativeCheckbox aria-label="Consent" name="consent" value="given" required /></form>);
    const form = screen.getByRole('form', { name: 'Native form' }) as HTMLFormElement;
    const checkbox = screen.getByRole('checkbox', { name: 'Consent' }) as HTMLInputElement;
    expect(form.checkValidity()).toBe(false);
    expect(new FormData(form).has('consent')).toBe(false);
    await user.click(checkbox);
    expect(form.checkValidity()).toBe(true);
    expect(new FormData(form).getAll('consent')).toEqual(['given']);
    form.reset();
    expect(checkbox.checked).toBe(false);
    expect(new FormData(form).has('consent')).toBe(false);
  });

  it('keeps a controlled native input in sync without replacing it', async () => {
    function NativeChoice() {
      const [checked, setChecked] = useState(false);
      return <NativeCheckbox aria-label="Choice" checked={checked} onChange={(event) => setChecked(event.target.checked)} />;
    }
    const user = userEvent.setup();
    render(<NativeChoice />);
    const checkbox = screen.getByRole('checkbox', { name: 'Choice' }) as HTMLInputElement;
    const mark = checkbox.nextElementSibling;
    await user.click(checkbox);
    expect(checkbox.checked).toBe(true);
    await user.dblClick(checkbox);
    expect(checkbox.checked).toBe(true);
    expect(screen.getByRole('checkbox')).toBe(checkbox);
    expect(checkbox.nextElementSibling).toBe(mark);
  });

  it('retains a native intermediate state and clears it with a real click', async () => {
    const user = userEvent.setup();
    render(<NativeCheckbox aria-label="All" />);
    const checkbox = screen.getByRole('checkbox', { name: 'All' }) as HTMLInputElement;
    checkbox.indeterminate = true;
    expect(checkbox.matches(':indeterminate')).toBe(true);
    await user.click(checkbox);
    expect(checkbox.indeterminate).toBe(false);
    expect(checkbox.checked).toBe(true);
  });

  it('uses the animated marker only for multiple-choice quiz options', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    const view = render(<NativeChoiceInput type="checkbox" aria-label="Option" onChange={changed} />);
    const checkbox = screen.getByRole('checkbox', { name: 'Option' }) as HTMLInputElement;
    await user.click(checkbox);
    expect(checkbox.checked).toBe(true);
    expect(checkbox.nextElementSibling?.querySelector('.checkbox-tick')).toBeTruthy();
    view.rerender(<NativeChoiceInput type="radio" aria-label="Option" onChange={changed} />);
    const radio = screen.getByRole('radio', { name: 'Option' }) as HTMLInputElement;
    await user.click(radio);
    expect(radio.checked).toBe(true);
    expect(view.container.querySelector('.checkbox-mark')).toBeNull();
    expect(changed).toHaveBeenCalledTimes(2);
  });
});

it.each([
  { reducedMotion: 'always' as const },
  { transition: { duration: 0 } },
])('keeps selection usable with motion disabled: %j', async (config) => {
  const user = userEvent.setup();
  render(<MotionConfig {...config}><Checkbox aria-label="Shared" /><NativeCheckbox aria-label="Native" /></MotionConfig>);
  for (const checkbox of screen.getAllByRole('checkbox')) {
    expect(checkbox.closest('[data-checkbox-motion]')?.getAttribute('data-checkbox-motion')).toBe('off');
    await user.click(checkbox);
    expect(checkbox instanceof HTMLInputElement ? checkbox.checked : checkbox.getAttribute('aria-checked') === 'true').toBe(true);
  }
});
