import { useCallback, useEffect, useState } from 'react';
import {
  EMPTY_LEAD_FILTERS,
  LEAD_FILTER_LANGUAGES,
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

const readCsvNumbers = (raw: string | null): number[] => {
  if (raw === null) return [];
  const items = raw
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isSafeInteger(item) && item > 0);
  return [...new Set(items)];
};

const readCsvLanguages = (raw: string | null): string[] => {
  if (raw === null) return [];
  const items = raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => (LEAD_FILTER_LANGUAGES as readonly string[]).includes(item));
  return [...new Set(items)];
};

const readTriStateParam = (raw: string | null): LeadFilterState['hasPhone'] => (
  raw === 'yes' || raw === 'no' ? raw : 'any'
);

/**
 * URL params win over stored filters field by field, so a shared link always
 * shows exactly the view it was built for; fields without a param keep the
 * user's persisted choices.
 */
export const applyLeadFilterParams = (
  base: LeadFilterState,
  params: URLSearchParams,
): LeadFilterState => ({
  sourceIds: params.has('sourceIds') ? readCsvNumbers(params.get('sourceIds')) : base.sourceIds,
  languages: params.has('languages') ? readCsvLanguages(params.get('languages')) : base.languages,
  hasPhone: params.has('hasPhone') ? readTriStateParam(params.get('hasPhone')) : base.hasPhone,
  hasMessenger: params.has('hasMessenger') ? readTriStateParam(params.get('hasMessenger')) : base.hasMessenger,
  tagIds: params.has('tagIds') ? readCsvNumbers(params.get('tagIds')) : base.tagIds,
  onlyNew: params.has('onlyNew') ? params.get('onlyNew') === '1' : base.onlyNew,
  demoBooked: params.has('demoBooked') ? readTriStateParam(params.get('demoBooked')) : base.demoBooked,
  hasComment: params.has('hasComment') ? readTriStateParam(params.get('hasComment')) : base.hasComment,
  ageFrom: params.get('ageFrom') ?? base.ageFrom,
  ageTo: params.get('ageTo') ?? base.ageTo,
  amountFrom: params.get('amountFrom') ?? base.amountFrom,
  amountTo: params.get('amountTo') ?? base.amountTo,
  createdFrom: params.get('createdFrom') ?? base.createdFrom,
  createdTo: params.get('createdTo') ?? base.createdTo,
});

const leadFilterUrlParams = (filters: LeadFilterState): Record<string, string | null> => ({
  sourceIds: filters.sourceIds.length > 0 ? filters.sourceIds.join(',') : null,
  languages: filters.languages.length > 0 ? filters.languages.join(',') : null,
  hasPhone: filters.hasPhone !== 'any' ? filters.hasPhone : null,
  hasMessenger: filters.hasMessenger !== 'any' ? filters.hasMessenger : null,
  tagIds: filters.tagIds.length > 0 ? filters.tagIds.join(',') : null,
  onlyNew: filters.onlyNew ? '1' : null,
  demoBooked: filters.demoBooked !== 'any' ? filters.demoBooked : null,
  hasComment: filters.hasComment !== 'any' ? filters.hasComment : null,
  ageFrom: filters.ageFrom || null,
  ageTo: filters.ageTo || null,
  amountFrom: filters.amountFrom || null,
  amountTo: filters.amountTo || null,
  createdFrom: filters.createdFrom || null,
  createdTo: filters.createdTo || null,
});

export interface UseLeadFiltersOptions {
  /** Mirror the active view into the URL so it survives refresh and sharing. */
  urlSync?: boolean;
}

export const useLeadFilters = ({ urlSync = true }: UseLeadFiltersOptions = {}) => {
  const [filters, setFilters] = useState<LeadFilterState>(() => {
    const stored = readStoredFilters();
    if (!urlSync || typeof window === 'undefined') return stored;
    try {
      return applyLeadFilterParams(stored, new URLSearchParams(window.location.search));
    } catch {
      return stored;
    }
  });

  useEffect(() => {
    if (!urlSync) return;
    const currentHref = `${window.location.pathname}${window.location.search}`;
    const params = new URLSearchParams(window.location.search);
    Object.entries(leadFilterUrlParams(filters)).forEach(([key, value]) => {
      if (value === null) params.delete(key);
      else params.set(key, value);
    });
    const query = params.toString();
    const nextHref = `${window.location.pathname}${query ? `?${query}` : ''}`;
    if (nextHref === currentHref) return;
    // Replace, not push: filter tweaks are not history steps.
    window.history.replaceState(window.history.state, '', nextHref);
  }, [filters, urlSync]);

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
