// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TypingIndicator } from '../client/src/components/ui/typing-indicator';
import { i18n } from '../client/src/lib/i18n';

beforeEach(() => i18n.setLanguage('en'));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Typing Indicator', () => {
  it('announces one localized status while keeping animated dots decorative', () => {
    i18n.setLanguage('ru');
    render(<TypingIndicator />);
    const status = screen.getByRole('status', { name: 'Собеседник печатает' });
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.getAttribute('aria-atomic')).toBe('true');
    expect(status.textContent).toBe('Собеседник печатает');
    expect(status.querySelectorAll('.typing-indicator-dot[aria-hidden="true"]')).toHaveLength(3);
  });

  it('removes an inactive status and keeps the existing message draft when it toggles', () => {
    const view = render(<div><input aria-label="Message" defaultValue="Draft" /><TypingIndicator active={false} /></div>);
    const input = screen.getByRole('textbox', { name: 'Message' }) as HTMLInputElement;
    input.value = 'Unsent message';
    expect(screen.queryByRole('status')).toBeNull();
    view.rerender(<div><input aria-label="Message" defaultValue="Draft" /><TypingIndicator /></div>);
    expect(screen.getByRole('status', { name: 'Someone is typing' })).toBeTruthy();
    expect(screen.getByRole('textbox')).toBe(input);
    expect(input.value).toBe('Unsent message');
    view.rerender(<div><input aria-label="Message" defaultValue="Draft" /><TypingIndicator active={false} /></div>);
    expect(screen.queryByRole('status')).toBeNull();
    expect(input.value).toBe('Unsent message');
  });

  it.each([
    { reducedMotion: 'always' as const },
    { transition: { duration: 0 } },
  ])('keeps the status visible when motion is disabled: %j', (config) => {
    render(<MotionConfig {...config}><TypingIndicator aria-label="Alice is typing" /></MotionConfig>);
    const status = screen.getByRole('status', { name: 'Alice is typing' });
    expect(status.getAttribute('data-typing-motion')).toBe('off');
    expect(status.textContent).toBe('Alice is typing');
  });

  it('pauses outside the viewport or in a hidden document and disconnects when inactive', () => {
    let notify!: IntersectionObserverCallback;
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { notify = callback; }
      observe = observe;
      disconnect = disconnect;
    });
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const view = render(<TypingIndicator />);
    const status = screen.getByRole('status');
    expect(observe).toHaveBeenCalledWith(status);
    const intersection = (isIntersecting: boolean) => act(() => notify([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver));
    intersection(false);
    expect(status.getAttribute('data-typing-paused')).toBe('true');
    intersection(true);
    expect(status.getAttribute('data-typing-paused')).toBe('false');
    hidden.mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(status.getAttribute('data-typing-paused')).toBe('true');
    hidden.mockReturnValue(false);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(status.getAttribute('data-typing-paused')).toBe('false');
    view.rerender(<TypingIndicator active={false} />);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
