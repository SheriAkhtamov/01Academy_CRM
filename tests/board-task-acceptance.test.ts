import { expect, it } from 'vitest';
import { isBoardTaskAwaitingAcceptance } from '../shared/board-permissions';

const delegated = { creatorId: 7, assigneeId: 8, status: 'done' };

it('marks completed delegated work only for its creator', () => {
  expect(isBoardTaskAwaitingAcceptance({ id: 7 }, delegated)).toBe(true);
  expect(isBoardTaskAwaitingAcceptance({ id: 8 }, delegated)).toBe(false);
  expect(isBoardTaskAwaitingAcceptance({ id: 1 }, delegated)).toBe(false);
  expect(isBoardTaskAwaitingAcceptance(null, delegated)).toBe(false);
});

it.each(['todo', 'in_progress', 'accepted'])('clears the completion indicator for status %s', (status) => {
  expect(isBoardTaskAwaitingAcceptance({ id: 7 }, { ...delegated, status })).toBe(false);
});

it('does not mark self-assigned work or tasks without an assignee', () => {
  expect(isBoardTaskAwaitingAcceptance({ id: 7 }, { ...delegated, assigneeId: 7 })).toBe(false);
  expect(isBoardTaskAwaitingAcceptance({ id: 7 }, { ...delegated, assigneeId: null })).toBe(false);
});

it('recognizes the embedded owners in board summaries', () => {
  expect(isBoardTaskAwaitingAcceptance({ id: 7 }, { creator: { id: 7 }, assignee: { id: 8 }, status: 'done' })).toBe(true);
});
