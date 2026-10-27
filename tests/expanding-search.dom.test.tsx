// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MotionConfig } from 'framer-motion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpandingSearch } from '../client/src/components/ui/expanding-search';
import { i18n } from '../client/src/lib/i18n';

beforeEach(() => { i18n.setLanguage('en'); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Search({ initial = '', controlled = false, ...props }: Omit<React.ComponentProps<typeof ExpandingSearch>, 'value' | 'onValueChange'> & { initial?: string; controlled?: boolean }) {
  const [value, setValue] = useState(initial);
  const [expanded, setExpanded] = useState(false);
  return <><ExpandingSearch value={value} onValueChange={setValue} aria-label="Search messages"
    {...(controlled ? { expanded, onExpandedChange: setExpanded } : {})} {...props} /><button type="button">Outside</button></>;
}
const trigger = () => screen.getByRole('button', { name: 'Search messages' });
const field = () => screen.getByRole('searchbox', { name: 'Search messages' }) as HTMLInputElement;

describe('Expanding Search', () => {
  it.each([false, true])('opens from its icon and accepts input immediately (controlled=%s)', async (controlled) => {
    const user = userEvent.setup();
    render(<Search controlled={controlled} />);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('searchbox')).toBeNull();
    await user.click(trigger());
    expect(document.activeElement).toBe(field());
    await user.type(field(), 'invoice');
    expect(field().value).toBe('invoice');
    expect(field().parentElement!.dataset.expanded).toBe('true');
  });

  it('collapses an empty search on blur and preserves a nonempty filter', async () => {
    const user = userEvent.setup();
    render(<Search />);
    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('searchbox')).toBeNull();
    await user.click(trigger());
    await user.type(field(), 'invoice');
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    expect(field().value).toBe('invoice');
  });

  it('clears without closing, then closes an empty search and restores focus to its icon', async () => {
    const user = userEvent.setup();
    render(<Search initial="invoice" />);
    const original = field();
    await user.click(screen.getByRole('button', { name: i18n.t('clearSearch') }));
    expect(field()).toBe(original);
    expect(field().value).toBe('');
    expect(document.activeElement).toBe(field());
    await user.click(screen.getByRole('button', { name: i18n.t('close') }));
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('opens from keyboard, clears and closes with Escape, and skips collapsed input in Tab order', async () => {
    const user = userEvent.setup();
    render(<Search />);
    await user.tab();
    expect(document.activeElement).toBe(trigger());
    await user.keyboard('{Enter}');
    await user.type(field(), 'invoice');
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(trigger());
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Outside' }));
  });

  it('forwards the input ref and expands on a programmatic shortcut focus', () => {
    const ref = { current: null as HTMLInputElement | null };
    render(<ExpandingSearch ref={ref} value="" onValueChange={vi.fn()} aria-label="Search messages" />);
    act(() => ref.current?.focus());
    expect(ref.current).toBe(field());
    expect(document.activeElement).toBe(field());
  });

  it('keeps an always expanded search visible and focused after Escape', async () => {
    const user = userEvent.setup();
    render(<Search alwaysExpanded initial="invoice" />);
    await user.click(field());
    await user.keyboard('{Escape}');
    expect(field().value).toBe('');
    expect(document.activeElement).toBe(field());
    expect(screen.queryByRole('button', { name: 'Search messages' })).toBeNull();
  });

  it('never submits the form from the open, clear or close buttons', async () => {
    const user = userEvent.setup();
    const submit = vi.fn((event) => event.preventDefault());
    render(<form onSubmit={submit}><Search /></form>);
    await user.click(trigger());
    await user.type(field(), 'invoice');
    await user.click(screen.getByRole('button', { name: i18n.t('clearSearch') }));
    await user.click(screen.getByRole('button', { name: i18n.t('close') }));
    expect(submit).not.toHaveBeenCalled();
  });

  it('honours disabled controls and a disabled fieldset', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    const view = render(<ExpandingSearch disabled value="" onValueChange={changed} aria-label="Search messages" />);
    await user.click(trigger());
    expect(screen.queryByRole('searchbox')).toBeNull();
    view.rerender(<fieldset disabled><ExpandingSearch value="" onValueChange={changed} aria-label="Search messages" /></fieldset>);
    fireEvent.click(trigger());
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(changed).not.toHaveBeenCalled();
  });

  it('leaves IME composition and a caller-handled Escape intact', () => {
    render(<Search initial="invoice" onKeyDown={(event) => event.preventDefault()} />);
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(field().value).toBe('invoice');
    cleanup();
    render(<Search initial="invoice" />);
    fireEvent.keyDown(field(), { key: 'Escape', isComposing: true });
    expect(field().value).toBe('invoice');
  });

  it('supports the system preference and the app animation switch', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const view = render(<Search initial="invoice" />);
    expect(field().parentElement!.dataset.searchMotion).toBe('reduced');
    view.rerender(<MotionConfig reducedMotion="always" transition={{ duration: 0 }}><Search initial="invoice" /></MotionConfig>);
    expect(field().parentElement!.dataset.searchMotion).toBe('off');
  });
});
