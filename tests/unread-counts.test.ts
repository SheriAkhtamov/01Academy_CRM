import { describe, expect, it } from 'vitest';
import { formatUnreadCount } from '../client/src/components/ux/UnreadCountBadge';
import { totalUnreadMessages } from '../client/src/features/messages/api';

describe('unread counters', () => {
  it('adds unread messages across conversations and ignores invalid values', () => {
    expect(totalUnreadMessages([
      { id: 1, fullName: 'A', unreadCount: 2 },
      { id: 2, fullName: 'B', unreadCount: 4 },
      { id: 3, fullName: 'C', unreadCount: -3 },
      { id: 4, fullName: 'D' },
    ])).toBe(6);
  });

  it('keeps badge labels compact for large counts', () => {
    expect(formatUnreadCount(0)).toBe('0');
    expect(formatUnreadCount(8)).toBe('8');
    expect(formatUnreadCount(100)).toBe('99+');
    expect(formatUnreadCount(Number.NaN)).toBe('0');
  });
});
