// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MotionConfig } from 'framer-motion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrbitSpinner } from '../client/src/components/ui/orbit-spinner';
import { LoadingRegion } from '../client/src/components/ui/loading-region';
import { Button } from '../client/src/components/ui/button';
import { Skeleton } from '../client/src/components/ui/skeleton';
import { CopyButton } from '../client/src/components/ui/copy-button';
import { i18n } from '../client/src/lib/i18n';

beforeEach(() => i18n.setLanguage('en'));
afterEach(cleanup);
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => { resolve = finish; });
  return { promise, resolve };
};

describe('Orbit Spinner', () => {
  it('keeps inline indicators decorative and forwards size, color and the SVG ref', () => {
    const ref = { current: null as SVGSVGElement | null };
    const view = render(<OrbitSpinner ref={ref} className="size-8 text-primary" data-icon="inline-start" />);
    expect(ref.current).toBe(view.container.querySelector('svg'));
    expect(ref.current?.classList.contains('size-8')).toBe(true);
    expect(ref.current?.classList.contains('text-primary')).toBe(true);
    expect(ref.current?.getAttribute('data-icon')).toBe('inline-start');
    expect(ref.current?.getAttribute('aria-hidden')).toBe('true');
    expect(ref.current?.getAttribute('focusable')).toBe('false');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('announces an explicitly labelled standalone loader', () => {
    render(<OrbitSpinner aria-label="Loading preview" />);
    expect(screen.getByRole('status', { name: 'Loading preview' })).toBeTruthy();
  });

  it('respects explicit dimensions without applying the default CSS size', () => {
    const view = render(<OrbitSpinner size={32} width={40} />);
    const spinner = view.container.querySelector('svg');
    expect(spinner?.getAttribute('width')).toBe('40');
    expect(spinner?.getAttribute('height')).toBe('32');
    expect(spinner?.classList.contains('size-4')).toBe(false);
  });

  it('keeps a meaningful status visible when motion is disabled', () => {
    render(<MotionConfig reducedMotion="always" transition={{ duration: 0 }}><OrbitSpinner aria-label="Loading preview" /></MotionConfig>);
    const spinner = screen.getByRole('status', { name: 'Loading preview' });
    expect(spinner.getAttribute('aria-hidden')).toBeNull();
    expect(spinner.querySelector('g')?.style.animation).toBe('none');
  });
});

describe('shared loading controls', () => {
  it('keeps the button label, prevents repeated submits, and clears feedback on completion', async () => {
    const task = deferred();
    const save = vi.fn(() => task.promise);
    function Save() {
      const [loading, setLoading] = useState(false);
      return <Button loading={loading} onClick={async () => {
        setLoading(true);
        try { await save(); } finally { setLoading(false); }
      }}>Save</Button>;
    }
    render(<Save />);
    const button = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    fireEvent.click(button);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelectorAll('.orbit-spinner')).toHaveLength(1);
    fireEvent.click(button);
    expect(save).toHaveBeenCalledOnce();
    await act(async () => task.resolve());
    expect(button.disabled).toBe(false);
    expect(button.querySelector('.orbit-spinner')).toBeNull();
    expect(button.textContent).toBe('Save');
  });

  it('does not show loading for a merely disabled action', () => {
    render(<Button disabled>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.querySelector('.orbit-spinner')).toBeNull();
    expect(button.getAttribute('aria-busy')).toBeNull();
  });

  it('preserves asChild links and their handlers', async () => {
    const clicked = vi.fn((event) => event.preventDefault());
    const user = userEvent.setup();
    render(<Button asChild><a href="/tasks" onClick={clicked}>Tasks</a></Button>);
    await user.click(screen.getByRole('link', { name: 'Tasks' }));
    expect(clicked).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows exactly one indicator for nested loading sections while retaining skeleton geometry', () => {
    const view = render(<LoadingRegion className="grid gap-3"><Skeleton className="h-24" data-testid="first" />
      <LoadingRegion role="status" className="space-y-2"><Skeleton className="h-12" /><Skeleton className="h-12" /></LoadingRegion>
    </LoadingRegion>);
    expect(view.container.querySelectorAll('.orbit-spinner')).toHaveLength(1);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status', { name: i18n.t('loading') }).getAttribute('aria-busy')).toBe('true');
    expect(screen.getByTestId('first').classList.contains('h-24')).toBe(true);
  });

  it('removes loading feedback without remounting the existing form or losing its draft', async () => {
    const user = userEvent.setup();
    const child = <input aria-label="Draft" defaultValue="Unfinished" />;
    const view = render(<LoadingRegion loading>{child}</LoadingRegion>);
    const input = screen.getByRole('textbox', { name: 'Draft' }) as HTMLInputElement;
    await user.type(input, ' task');
    view.rerender(<LoadingRegion loading={false}>{child}</LoadingRegion>);
    expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(input);
    expect(input.value).toBe('Unfinished task');
    expect(view.container.querySelector('.orbit-spinner')).toBeNull();
  });

  it('shows a spinner during clipboard work and then restores the copy confirmation', async () => {
    const task = deferred();
    render(<MotionConfig reducedMotion="always" transition={{ duration: 0 }}><CopyButton onCopy={() => task.promise}>Copy</CopyButton></MotionConfig>);
    const button = screen.getByRole('button', { name: 'Copy' });
    fireEvent.click(button);
    expect(button.querySelectorAll('.orbit-spinner')).toHaveLength(1);
    expect(button.getAttribute('data-copy-state')).toBe('idle');
    await act(async () => task.resolve());
    expect(button.querySelector('.orbit-spinner')).toBeNull();
    expect(button.getAttribute('data-copy-state')).toBe('copied');
  });
});
