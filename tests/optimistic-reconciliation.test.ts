import { describe, expect, it } from 'vitest';
import {
  finishOptimisticChange,
  incomingValueChangedSinceStart,
  reconcileOptimisticItems,
  type OptimisticChange,
} from '@/lib/optimisticReconciliation';

interface Item {
  id: number;
  status: string;
  title: string;
}

const reconcile = (
  incoming: Item[],
  pending: ReadonlyMap<number, OptimisticChange<string>>,
) => reconcileOptimisticItems(
  incoming,
  pending,
  (item) => item.id,
  (item) => item.status,
  (item, status) => ({ ...item, status }),
);

describe('optimistic collection reconciliation', () => {
  it('overlays only explicitly pending values and keeps fresh server fields', () => {
    const pending = new Map<number, OptimisticChange<string>>([
      [1, { token: 1, value: 'doing', baselineValue: 'todo' }],
      [99, { token: 2, value: 'done', baselineValue: 'todo' }],
    ]);
    const incoming = [
      { id: 1, status: 'todo', title: 'Fresh server title' },
      { id: 2, status: 'done', title: 'Second' },
    ];

    expect(reconcile(incoming, pending)).toEqual([
      { id: 1, status: 'doing', title: 'Fresh server title' },
      { id: 2, status: 'done', title: 'Second' },
    ]);
  });

  it('lets an external server status win after the pending change settles', () => {
    const pending = new Map<number, OptimisticChange<string>>([
      [1, { token: 7, value: 'doing', baselineValue: 'todo' }],
    ]);

    expect(reconcile([{ id: 1, status: 'review', title: 'Task' }], pending)[0].status).toBe('doing');
    expect(finishOptimisticChange(pending, 1, 7)).toBeDefined();
    expect(reconcile([{ id: 1, status: 'review', title: 'Task' }], pending)[0].status).toBe('review');
  });

  it('does not let an older request settle a newer optimistic move', () => {
    const pending = new Map<number, OptimisticChange<string>>([
      [1, { token: 2, value: 'done', baselineValue: 'todo' }],
    ]);

    expect(finishOptimisticChange(pending, 1, 1)).toBeUndefined();
    expect(pending.get(1)?.value).toBe('done');
  });

  it('detects an authoritative update or deletion that arrived during a request', () => {
    const change: OptimisticChange<string> = {
      token: 1,
      value: 'doing',
      baselineValue: 'todo',
    };

    expect(incomingValueChangedSinceStart(
      { id: 1, status: 'todo', title: 'Task' },
      change,
      (item) => item.status,
    )).toBe(false);
    expect(incomingValueChangedSinceStart(
      { id: 1, status: 'review', title: 'Task' },
      change,
      (item) => item.status,
    )).toBe(true);
    expect(incomingValueChangedSinceStart(undefined, change, (item: Item) => item.status)).toBe(true);
  });
});
