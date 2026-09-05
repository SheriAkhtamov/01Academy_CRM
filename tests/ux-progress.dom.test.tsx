// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { Progress } from '../client/src/components/ui/progress';
afterEach(cleanup);
it('exposes the same value as the visual progress', () => {
  const view = render(<Progress value={60} max={200} aria-label="Attendance" />);
  const bar = screen.getByRole('progressbar', { name: 'Attendance' });
  expect(bar.getAttribute('aria-valuenow')).toBe('60');
  expect(bar.getAttribute('aria-valuemax')).toBe('200');
  view.rerender(<Progress value={120} aria-label="Attendance" />);
  expect(bar.getAttribute('aria-valuenow')).toBe('100');
  view.rerender(<Progress aria-label="Attendance" />);
  expect(bar.hasAttribute('aria-valuenow')).toBe(false);
});
