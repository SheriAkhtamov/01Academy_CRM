export interface OptimisticChange<Value> {
  token: number;
  value: Value;
  baselineValue: Value;
}

export function reconcileOptimisticItems<Item, Key, Value>(
  incoming: Item[],
  pending: ReadonlyMap<Key, OptimisticChange<Value>>,
  getKey: (item: Item) => Key,
  getValue: (item: Item) => Value,
  withValue: (item: Item, value: Value) => Item,
): Item[] {
  if (pending.size === 0) return incoming;

  let changed = false;
  const reconciled = incoming.map((item) => {
    const optimistic = pending.get(getKey(item));
    if (!optimistic || Object.is(getValue(item), optimistic.value)) return item;

    changed = true;
    return withValue(item, optimistic.value);
  });

  return changed ? reconciled : incoming;
}

export function finishOptimisticChange<Key, Value>(
  pending: Map<Key, OptimisticChange<Value>>,
  key: Key,
  token: number,
): OptimisticChange<Value> | undefined {
  const change = pending.get(key);
  if (!change || change.token !== token) return undefined;

  pending.delete(key);
  return change;
}

export function incomingValueChangedSinceStart<Item, Value>(
  incoming: Item | undefined,
  change: OptimisticChange<Value>,
  getValue: (item: Item) => Value,
): boolean {
  return incoming === undefined || !Object.is(getValue(incoming), change.baselineValue);
}
