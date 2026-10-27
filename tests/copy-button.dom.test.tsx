// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MotionConfig } from 'framer-motion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopyButton } from '../client/src/components/ui/copy-button';

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

const button = () => screen.getByRole('button') as HTMLButtonElement;
const click = async () => { await act(async () => { fireEvent.click(button()); }); };
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

describe('shared copy confirmation', () => {
  it('confirms success for 1.4 seconds and restores the action without submitting its form', async () => {
    const submit = vi.fn();
    const copy = vi.fn().mockResolvedValue(undefined);
    render(<form onSubmit={submit}><CopyButton onCopy={copy} copiedLabel="Copied">Copy report</CopyButton></form>);
    expect(button().type).toBe('button');
    expect(button().getAttribute('data-copy-state')).toBe('idle');
    await click();
    expect(copy).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(button().getAttribute('data-copy-state')).toBe('copied');
    act(() => { vi.advanceTimersByTime(1399); });
    expect(button().getAttribute('data-copy-state')).toBe('copied');
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole('button', { name: 'Copy report' })).toBeTruthy();
    expect(button().getAttribute('data-copy-state')).toBe('idle');
  });

  it('waits for the action and prevents concurrent copying', async () => {
    const action = deferred();
    const copy = vi.fn(() => action.promise);
    render(<CopyButton onCopy={copy} aria-label="Copy number" />);
    fireEvent.click(button());
    fireEvent.click(button());
    expect(copy).toHaveBeenCalledOnce();
    expect(button().disabled).toBe(true);
    expect(button().getAttribute('aria-busy')).toBe('true');
    expect(button().getAttribute('data-copy-state')).toBe('idle');
    await act(async () => { action.resolve(); });
    expect(button().disabled).toBe(false);
    expect(button().getAttribute('data-copy-state')).toBe('copied');
    expect(screen.getByRole('button', { name: 'Copy number' })).toBeTruthy();
  });

  it.each([
    ['rejected', () => Promise.reject(new Error('Clipboard unavailable'))],
    ['failed', () => false],
  ])('does not confirm a %s action and allows a retry', async (_name, fail) => {
    const copy = vi.fn<() => Promise<void> | boolean>().mockImplementationOnce(fail).mockResolvedValueOnce(undefined);
    render(<CopyButton onCopy={copy}>Copy</CopyButton>);
    await click();
    expect(button().getAttribute('data-copy-state')).toBe('idle');
    expect(button().disabled).toBe(false);
    await click();
    expect(copy).toHaveBeenCalledTimes(2);
    expect(button().getAttribute('data-copy-state')).toBe('copied');
  });

  it('extends feedback from the latest successful copy', async () => {
    render(<CopyButton onCopy={() => undefined}>Copy</CopyButton>);
    await click();
    act(() => { vi.advanceTimersByTime(1000); });
    await click();
    act(() => { vi.advanceTimersByTime(400); });
    expect(button().getAttribute('data-copy-state')).toBe('copied');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(button().getAttribute('data-copy-state')).toBe('idle');
  });

  it('ignores a previous value finishing while the new value is being copied', async () => {
    const previous = deferred();
    const current = deferred();
    const view = render(<CopyButton resetKey="old" onCopy={() => previous.promise}>Copy</CopyButton>);
    fireEvent.click(button());
    view.rerender(<CopyButton resetKey="new" onCopy={() => current.promise}>Copy</CopyButton>);
    expect(button().disabled).toBe(false);
    fireEvent.click(button());
    await act(async () => { previous.resolve(); });
    expect(button().getAttribute('data-copy-state')).toBe('idle');
    expect(button().disabled).toBe(true);
    await act(async () => { current.resolve(); });
    expect(button().getAttribute('data-copy-state')).toBe('copied');
    expect(button().disabled).toBe(false);
  });

  it('clears confirmation when the copied value changes and cleans up on unmount', async () => {
    const action = () => undefined;
    const view = render(<CopyButton resetKey="old" onCopy={action}>Copy</CopyButton>);
    await click();
    view.rerender(<CopyButton resetKey="new" onCopy={action}>Copy</CopyButton>);
    expect(button().getAttribute('data-copy-state')).toBe('idle');
    await click();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains the native button styling, ref and disabled state', async () => {
    const ref = { current: null as HTMLButtonElement | null };
    const copy = vi.fn();
    render(<CopyButton unstyled ref={ref} disabled onCopy={copy} className="text-primary" aria-label="Copy number" />);
    expect(ref.current).toBe(button());
    expect(button().className).toBe('text-primary');
    await click();
    expect(copy).not.toHaveBeenCalled();
  });

  it('keeps successful confirmation without spatial movement when reduced motion is enabled', async () => {
    render(<MotionConfig reducedMotion="always"><CopyButton onCopy={() => undefined}>Copy</CopyButton></MotionConfig>);
    await click();
    expect(button().getAttribute('data-copy-state')).toBe('copied');
    expect(Array.from(button().querySelectorAll('svg')).every((icon) => !icon.style.transform)).toBe(true);
  });

  it('copies through keyboard activation', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const copy = vi.fn();
    render(<CopyButton onCopy={copy}>Copy</CopyButton>);
    await user.tab();
    expect(document.activeElement).toBe(button());
    await user.keyboard('{Enter}');
    expect(copy).toHaveBeenCalledOnce();
    expect(button().getAttribute('data-copy-state')).toBe('copied');
  });
});
