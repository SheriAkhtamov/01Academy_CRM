import { useCallback, useState } from 'react';
import {
  EMPTY_LEAD_FILTERS,
  countActiveLeadFilters,
  parseStoredLeadFilters,
  type LeadFilterState,
} from '@/lib/leadFilters';

const STORAGE_KEY = 'sales.pipeline.leadFilters.v2';
const LEGACY_STORAGE_KEY = 'sales.pipeline.leadFilters';

// Storage is unavailable in private-mode browsers and in tests; a lost filter
// is not worth breaking the pipeline over.
const readStoredFilters = (): LeadFilterState => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return parseStoredLeadFilters(stored);

    // The old tagIds contained per-lead assignment IDs. Preserve unrelated
    // filters during the one-time migration, but discard that invalid scope.
    return {
      ...parseStoredLeadFilters(window.localStorage.getItem(LEGACY_STORAGE_KEY)),
      tagIds: [],
    };
  } catch {
    return EMPTY_LEAD_FILTERS;
  }
};

const writeStoredFilters = (filters: LeadFilterState) => {
  try {
    if (countActiveLeadFilters(filters) === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Filtering still works for this session even when nothing can be stored.
  }
};

export const useLeadFilters = () => {
  const [filters, setFilters] = useState<LeadFilterState>(readStoredFilters);

  const applyFilters = useCallback((next: LeadFilterState) => {
    setFilters(next);
    writeStoredFilters(next);
  }, []);

  return {
    filters,
    applyFilters,
    activeFilterCount: countActiveLeadFilters(filters),
  };
};
