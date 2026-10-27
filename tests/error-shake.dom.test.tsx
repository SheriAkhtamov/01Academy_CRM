// @vitest-environment jsdom
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorShakeProvider } from '../client/src/components/ux/ErrorShakeProvider';
import { Input } from '../client/src/components/ui/input';
import { Textarea } from '../client/src/components/ui/textarea';
import { QuantityStepper } from '../client/src/components/ui/quantity-stepper';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../client/src/components/ui/form';
import { PortalSelect } from '../client/src/features/portal-app/controls';
import { requestErrorShake } from '../client/src/lib/errorShake';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
});
afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.motion;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function frame(ms = 20) {
  await act(async () => {
    await Promise.resolve();
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}
const shaking = () => document.querySelectorAll('[data-error-shake]');

describe('Error Shake validation feedback', () => {
  it('responds to native invalid events without cancelling validation or changing the control', async () => {
    const invalid = vi.fn();
    render(<ErrorShakeProvider><Input aria-label="Email" type="email" defaultValue="bad@" onInvalid={invalid} /></ErrorShakeProvider>);
    const input = screen.getByRole('textbox', { name: 'Email' }) as HTMLInputElement;
    expect(input.checkValidity()).toBe(false);
    await frame();
    expect(input.hasAttribute('data-error-shake')).toBe(true);
    expect(invalid).toHaveBeenCalledOnce();
    expect(invalid.mock.calls[0][0].defaultPrevented).toBe(false);
    expect(input.value).toBe('bad@');
    await frame(550);
    expect(input.hasAttribute('data-error-shake')).toBe(false);
  });

  it('highlights only the first visible editable error and replays a repeated failed submit', async () => {
    const submit = vi.fn((event) => event.preventDefault());
    render(<ErrorShakeProvider><form aria-label="Contact" noValidate onSubmit={submit}>
      <Input aria-label="Hidden" aria-invalid hidden />
      <fieldset disabled><Input aria-label="Disabled" aria-invalid /></fieldset>
      <Input aria-label="Read only" aria-invalid readOnly />
      <Input aria-label="Name" aria-invalid defaultValue="Keep draft" aria-describedby="contact-error" />
      <Textarea aria-label="Comment" aria-invalid />
      <p id="contact-error">Check this value</p>
    </form></ErrorShakeProvider>);
    const form = screen.getByRole('form', { name: 'Contact' });
    const input = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    input.focus();
    input.setSelectionRange(2, 5);
    fireEvent.submit(form);
    await frame();
    expect(shaking()).toHaveLength(1);
    expect(input.hasAttribute('data-error-shake')).toBe(true);
    const first = input.dataset.errorShake;
    fireEvent.submit(form);
    await frame();
    expect(input.dataset.errorShake).not.toBe(first);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('Keep draft');
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 5]);
    expect(input.getAttribute('aria-describedby')).toBe('contact-error');
    expect(screen.getByText('Check this value')).toBeTruthy();
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('handles an asynchronously revealed field and stops another shake in the same form', async () => {
    const view = render(<ErrorShakeProvider><form noValidate onSubmit={(event) => event.preventDefault()}>
      <div hidden><Input aria-label="Revealed" aria-invalid /></div>
      <Textarea aria-label="Comment" aria-invalid />
    </form></ErrorShakeProvider>);
    const comment = screen.getByRole('textbox', { name: 'Comment' });
    fireEvent.submit(comment.closest('form')!);
    await frame();
    expect(comment.hasAttribute('data-error-shake')).toBe(true);
    view.rerender(<ErrorShakeProvider><form noValidate onSubmit={(event) => event.preventDefault()}>
      <div><Input aria-label="Revealed" aria-invalid /></div>
      <Textarea aria-label="Comment" aria-invalid />
    </form></ErrorShakeProvider>);
    await frame();
    expect(shaking()).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: 'Revealed' }).hasAttribute('data-error-shake')).toBe(true);
    expect(comment.hasAttribute('data-error-shake')).toBe(false);
  });

  it('waits until blur for a new error produced by typing and stops once corrected', async () => {
    function LiveField() {
      const [value, setValue] = useState('');
      return <Input aria-label="Name" value={value} aria-invalid={value.length > 0 && value.length < 3}
        onChange={(event) => setValue(event.target.value)} />;
    }
    render(<ErrorShakeProvider><LiveField /></ErrorShakeProvider>);
    const input = screen.getByRole('textbox', { name: 'Name' });
    fireEvent.input(input, { target: { value: 'A' } });
    await frame();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(shaking()).toHaveLength(0);
    fireEvent.blur(input);
    await frame();
    expect(input.hasAttribute('data-error-shake')).toBe(true);
    fireEvent.input(input, { target: { value: 'Alice' } });
    await frame();
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(shaking()).toHaveLength(0);
  });

  it('does not shake a stale error that validation clears before the feedback frame', async () => {
    function Validated() {
      const [error, setError] = useState(true);
      return <form aria-label="Valid" noValidate onSubmit={(event) => { event.preventDefault(); setError(false); }}>
        <Input aria-label="Name" aria-invalid={error} defaultValue="Valid name" />
      </form>;
    }
    render(<ErrorShakeProvider><Validated /></ErrorShakeProvider>);
    fireEvent.submit(screen.getByRole('form', { name: 'Valid' }));
    await frame();
    expect(shaking()).toHaveLength(0);
  });

  it('supports portalled forms and custom validation without adding wrappers or moving focus', async () => {
    render(<ErrorShakeProvider>{createPortal(<div role="dialog" aria-label="Details">
      <Input aria-label="Custom" defaultValue="Draft" />
    </div>, document.body)}</ErrorShakeProvider>);
    const input = screen.getByRole('textbox', { name: 'Custom' });
    input.focus();
    requestErrorShake(input);
    await frame();
    expect(input.hasAttribute('data-error-shake')).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(input.parentElement?.getAttribute('role')).toBe('dialog');
  });

  it('animates the visible select trigger when its native validation proxy fails', async () => {
    const view = render(<ErrorShakeProvider><form><PortalSelect id="choice" aria-label="Choice" name="choice" required
      value="" onValueChange={vi.fn()} options={[{ value: '', label: 'Choose' }, { value: 'one', label: 'One' }]} /></form></ErrorShakeProvider>);
    const proxy = view.container.querySelector('select[name="choice"]') as HTMLSelectElement;
    expect(proxy.checkValidity()).toBe(false);
    await frame();
    const trigger = screen.getByRole('combobox', { name: 'Choice' });
    expect(trigger.hasAttribute('data-error-shake')).toBe(true);
    expect(proxy.hasAttribute('data-error-shake')).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('retains the stepper DOM and value while indicating a quantity error', async () => {
    render(<ErrorShakeProvider><form aria-label="Quantity" noValidate onSubmit={(event) => event.preventDefault()}>
      <QuantityStepper aria-label="Count" defaultValue={3} aria-invalid min={1} />
    </form></ErrorShakeProvider>);
    const input = screen.getByRole('spinbutton', { name: 'Count' }) as HTMLInputElement;
    fireEvent.submit(screen.getByRole('form', { name: 'Quantity' }));
    await frame();
    expect(input.closest('[data-error-shake-control]')?.hasAttribute('data-error-shake')).toBe(true);
    expect(input.hasAttribute('data-error-shake')).toBe(false);
    expect(screen.getByRole('spinbutton')).toBe(input);
    expect(input.value).toBe('3');
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('stops pending feedback on unmount and ignores detached controls', async () => {
    const view = render(<ErrorShakeProvider><Input aria-label="Name" /></ErrorShakeProvider>);
    const input = screen.getByRole('textbox', { name: 'Name' });
    requestErrorShake(input);
    await frame();
    expect(input.hasAttribute('data-error-shake')).toBe(true);
    view.unmount();
    expect(input.hasAttribute('data-error-shake')).toBe(false);
    requestErrorShake(input);
    await frame(600);
    expect(input.hasAttribute('data-error-shake')).toBe(false);
  });

  it.each(['reduced', 'instant', 'master', 'hidden'] as const)('preserves the error without motion when %s', async (mode) => {
    if (mode === 'master') document.documentElement.dataset.motion = 'off';
    if (mode === 'hidden') vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    render(<MotionConfig reducedMotion={mode === 'reduced' ? 'always' : 'never'} transition={mode === 'instant' ? { duration: 0 } : undefined}>
      <ErrorShakeProvider><Input aria-label="Name" aria-invalid aria-describedby="error" /><p id="error">Check this value</p></ErrorShakeProvider>
    </MotionConfig>);
    const input = screen.getByRole('textbox', { name: 'Name' });
    requestErrorShake(input);
    await frame();
    expect(shaking()).toHaveLength(0);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('error');
    expect(screen.getByText('Check this value')).toBeTruthy();
  });

  it('responds to actual RHF validation, repeats failures and leaves successful submits alone', async () => {
    const save = vi.fn();
    function Editor() {
      const form = useForm({ defaultValues: { name: '' } });
      return <Form {...form}><form aria-label="Editor" noValidate onSubmit={form.handleSubmit(save)}>
        <FormField control={form.control} name="name" rules={{ required: 'Name required' }} render={({ field }) =>
          <FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>} />
      </form></Form>;
    }
    render(<ErrorShakeProvider><Editor /></ErrorShakeProvider>);
    const form = screen.getByRole('form', { name: 'Editor' });
    await act(async () => { fireEvent.submit(form); });
    await frame();
    const input = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    expect(input.hasAttribute('data-error-shake')).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(screen.getByText('Name required')).toBeTruthy();
    const first = input.dataset.errorShake;
    await act(async () => { fireEvent.submit(form); });
    await frame();
    expect(input.dataset.errorShake).not.toBe(first);
    fireEvent.input(input, { target: { value: 'Alice' } });
    await frame();
    await act(async () => { fireEvent.submit(form); });
    await frame();
    expect(shaking()).toHaveLength(0);
    expect(save).toHaveBeenCalledOnce();
    expect(input.value).toBe('Alice');
  });
});
