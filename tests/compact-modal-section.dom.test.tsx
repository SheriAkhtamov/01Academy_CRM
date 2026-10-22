// @vitest-environment jsdom
import { createRef } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { CompactModalSection } from '../client/src/components/ux/CompactModalSection';

afterEach(cleanup);

it('keeps an edited field mounted across mouse and keyboard disclosure', async () => {
  const user = userEvent.setup();
  render(<CompactModalSection title="Details" summary="Saved contact">
    <label htmlFor="section-name">Name</label>
    <input id="section-name" defaultValue="Initial" />
  </CompactModalSection>);
  const toggle = screen.getByRole('button', { name: 'Details' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull();
  await user.hover(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  toggle.focus();
  await user.keyboard('{Enter}');
  const field = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
  await user.clear(field);
  await user.type(field, 'Unsaved draft');
  await user.click(toggle);
  expect(field.isConnected).toBe(true);
  expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull();
  await user.keyboard(' ');
  expect(screen.getByRole('textbox', { name: 'Name' })).toBe(field);
  expect(field.value).toBe('Unsaved draft');
});

it('keeps navigation enabled while disabling the section controls', async () => {
  const user = userEvent.setup();
  render(<CompactModalSection title="Details" disabled>
    <input aria-label="Name" />
    <button type="button">Save</button>
  </CompactModalSection>);
  const toggle = screen.getByRole('button', { name: 'Details' });
  expect(toggle.matches(':disabled')).toBe(false);
  await user.click(toggle);
  expect(screen.getByRole('textbox', { name: 'Name' }).matches(':disabled')).toBe(true);
  expect(screen.getByRole('button', { name: 'Save' }).matches(':disabled')).toBe(true);
});

it('supports controlled error reveal and a focusable section ref', async () => {
  const user = userEvent.setup();
  const change = vi.fn();
  const ref = createRef<HTMLElement>();
  const content = (open: boolean) => <CompactModalSection ref={ref} title="Details" open={open} onOpenChange={change}>
    <input aria-label="Name" aria-invalid />
  </CompactModalSection>;
  const view = render(content(false));
  await user.click(screen.getByRole('button', { name: 'Details' }));
  expect(change).toHaveBeenCalledWith(true);
  expect(screen.queryByRole('textbox')).toBeNull();
  view.rerender(content(true));
  ref.current?.focus();
  expect(document.activeElement).toBe(ref.current);
  const field = screen.getByRole('textbox', { name: 'Name' });
  field.focus();
  expect(document.activeElement).toBe(field);
});

it('keeps header actions independent and supports a static section', async () => {
  const user = userEvent.setup();
  const action = vi.fn();
  const view = render(<CompactModalSection title="Details" actions={<button type="button" onClick={action}>Add</button>}>
    <input aria-label="Name" />
  </CompactModalSection>);
  await user.click(screen.getByRole('button', { name: 'Add' }));
  expect(action).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Details' }).getAttribute('aria-expanded')).toBe('false');
  view.rerender(<CompactModalSection title="Details" collapsible={false} open={false}>
    <input aria-label="Name" />
  </CompactModalSection>);
  expect(screen.queryByRole('button', { name: 'Details' })).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy();
});
