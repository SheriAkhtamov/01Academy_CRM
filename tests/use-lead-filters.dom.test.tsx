// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useLeadFilters } from '../client/src/features/sales/useLeadFilters';
import { EMPTY_LEAD_FILTERS } from '../client/src/lib/leadFilters';

const STORAGE_KEY = 'sales.pipeline.leadFilters.v2';
const LEGACY_STORAGE_KEY = 'sales.pipeline.leadFilters';

describe('persisted pipeline filters', () => {
  beforeEach(() => window.localStorage.clear());

  it('preserves legacy conditions but drops assignment-scoped tag IDs', () => {
    window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({
      ...EMPTY_LEAD_FILTERS,
      sourceIds: [2],
      tagIds: [777],
      onlyNew: true,
    }));

    const { result } = renderHook(() => useLeadFilters());

    expect(result.current.filters.sourceIds).toEqual([2]);
    expect(result.current.filters.onlyNew).toBe(true);
    expect(result.current.filters.tagIds).toEqual([]);
  });

  it('stores catalog tag IDs in the new storage scope', () => {
    const { result } = renderHook(() => useLeadFilters());

    act(() => result.current.applyFilters({
      ...EMPTY_LEAD_FILTERS,
      tagIds: [9],
    }));

    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}').tagIds).toEqual([9]);
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });
});
