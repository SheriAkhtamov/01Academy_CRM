import { describe, expect, it } from 'vitest';
import {
  TASK_OWNER_ALL,
  countTasksByOwner,
  filterTasksByOwner,
  isTaskOwnedBy,
} from '@/lib/boardTypes';

const person = (id: number) => ({
  id,
  fullName: `User ${id}`,
  position: null,
  module: 'sales' as const,
});

const task = (assigneeId: number | null, creatorId: number | null) => ({
  assignee: assigneeId === null ? null : person(assigneeId),
  creator: creatorId === null ? null : person(creatorId),
});

describe('task board owner filter', () => {
  it('counts a task for the person who owns it and the person who wrote it', () => {
    const counts = countTasksByOwner([task(1, 2), task(1, 1), task(null, 3)]);

    expect(counts.get(1)).toBe(2);
    expect(counts.get(2)).toBe(1);
    expect(counts.get(3)).toBe(1);
  });

  it('counts a task once for someone who both wrote and owns it', () => {
    expect(countTasksByOwner([task(4, 4)]).get(4)).toBe(1);
  });

  it('keeps delegated work in the picture instead of matching the assignee alone', () => {
    const delegated = task(2, 1);

    expect(isTaskOwnedBy(delegated, 1)).toBe(true);
    expect(isTaskOwnedBy(delegated, 2)).toBe(true);
    expect(isTaskOwnedBy(delegated, 3)).toBe(false);
  });

  it('narrows the board to one employee and widens it back to everyone', () => {
    const tasks = [task(1, 1), task(2, 1), task(3, 3)];

    expect(filterTasksByOwner(tasks, 2)).toEqual([tasks[1]]);
    expect(filterTasksByOwner(tasks, 1)).toEqual([tasks[0], tasks[1]]);
    expect(filterTasksByOwner(tasks, TASK_OWNER_ALL)).toBe(tasks);
  });

  it('shows an empty board for an employee with nothing on it', () => {
    expect(filterTasksByOwner([task(1, 1)], 9)).toEqual([]);
  });

  it('ignores tasks with no assignee and no creator', () => {
    expect(isTaskOwnedBy(task(null, null), 1)).toBe(false);
    expect(countTasksByOwner([task(null, null)]).size).toBe(0);
  });
});
