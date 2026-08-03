// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UnreadCountBadge } from '../client/src/components/ux/UnreadCountBadge';

describe('unread count badge', () => {
  it('renders nothing at zero when it is not announcing', () => {
    const { container } = render(
      <UnreadCountBadge count={0} label="0 unread" />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('keeps the live region mounted at zero so a later count is announced', () => {
    const { rerender } = render(
      <UnreadCountBadge count={0} label="0 unread messages" announce />,
    );

    // The region has to exist before the count arrives: screen readers ignore a
    // live region that is inserted together with its content.
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');
    expect(screen.queryByText('0')).toBeNull();

    rerender(<UnreadCountBadge count={3} label="3 unread messages" announce />);

    expect(screen.getByRole('status')).toBe(region);
    expect(region.textContent).toBe('3 unread messages');
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('caps the visible bubble but keeps the exact count for assistive tech', () => {
    render(<UnreadCountBadge count={140} label="140 unread notifications" announce />);

    expect(screen.getByText('99+')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('140 unread notifications');
  });

  it('ignores negative and non-finite counts', () => {
    const { container, rerender } = render(
      <UnreadCountBadge count={-4} label="none" />,
    );
    expect(container.innerHTML).toBe('');

    rerender(<UnreadCountBadge count={Number.NaN} label="none" />);
    expect(container.innerHTML).toBe('');
  });
});
