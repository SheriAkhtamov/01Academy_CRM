import { useCallback, useEffect, useRef, useState } from 'react';
import type { Group } from './types';

type UpdateParams = (patch: Record<string, string | null>, replace?: boolean) => void;

const sameIds = (left: number[], right: number[]) => (
  left.length === right.length && left.every((id, index) => id === right[index])
);

/**
 * The open group lives in the address, so a phone's Back button closes the
 * drawer instead of leaving the page. Opening pushes one entry; stepping to a
 * neighbour replaces it, so a single Back still gets out. Previous and next
 * follow the table's current sort.
 */
export function useGroupQuickView({ params, groups, updateParams }: {
  params: URLSearchParams;
  groups: Group[];
  updateParams: UpdateParams;
}) {
  const openGroupId = Number(params.get('group')) || null;
  const pushedEntry = useRef(false);
  const [listOrder, setListOrder] = useState<number[]>([]);

  const open = useCallback((group: Group) => {
    if (openGroupId === group.id) return;
    if (!openGroupId) pushedEntry.current = true;
    updateParams({ group: String(group.id) }, Boolean(openGroupId));
  }, [openGroupId, updateParams]);

  const close = useCallback(() => {
    if (pushedEntry.current) {
      pushedEntry.current = false;
      window.history.back();
    } else {
      updateParams({ group: null }, true);
    }
  }, [updateParams]);

  useEffect(() => {
    // Closed by Back or by a link: the next close must not step back again.
    if (!openGroupId) pushedEntry.current = false;
  }, [openGroupId]);

  const openGroup = openGroupId ? groups.find((group) => group.id === openGroupId) ?? null : null;
  useEffect(() => {
    // A link to a group that has since been deleted simply shows the list.
    if (openGroupId && !openGroup) updateParams({ group: null }, true);
  }, [openGroup, openGroupId, updateParams]);

  const handleOrderChange = useCallback((rows: Group[]) => {
    const ids = rows.map((row) => row.id);
    setListOrder((previous) => (sameIds(previous, ids) ? previous : ids));
  }, []);
  const order = listOrder;
  const index = openGroup ? order.indexOf(openGroup.id) : -1;
  const stepTo = (target: number) => updateParams({ group: String(order[target]) }, true);

  return {
    openGroup,
    open,
    close,
    /** For actions that take the open group out of the list it was stepping through. */
    closeIfShowing: (group: Group) => {
      if (openGroupId === group.id) close();
    },
    handleOrderChange,
    position: index >= 0 ? { index: index + 1, total: order.length } : null,
    onPrevious: index > 0 ? () => stepTo(index - 1) : null,
    onNext: index >= 0 && index < order.length - 1 ? () => stepTo(index + 1) : null,
  };
}
