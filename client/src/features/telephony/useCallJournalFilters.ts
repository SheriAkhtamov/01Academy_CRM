import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { callJournalFieldsSchema, callJournalSearchParams, readCallJournalFilters, type CallJournalFilters } from '@shared/contracts/call-journal';

export function useCallJournalFilters(defaultEmployeeId = 'all') {
  const [, setRoute] = useLocation();
  const routeSearch = useSearch();
  const filters = useMemo(() => readCallJournalFilters(new URLSearchParams(routeSearch), defaultEmployeeId), [routeSearch, defaultEmployeeId]);
  const [search, setSearchDraft] = useState(filters.q);
  useEffect(() => { setSearchDraft(filters.q); }, [filters.q]);
  const deferredSearch = useDeferredValue(filters.q);
  const updateFilters = useCallback((changes: Partial<CallJournalFilters>) => {
    const next = { ...filters, page: 1, ...changes };
    const params = callJournalSearchParams(next);
    const query = params.toString();
    setRoute(query ? `/sales/calls?${query}` : '/sales/calls', { replace: true });
  }, [filters, setRoute]);
  const queryString = useMemo(() => {
    const params = callJournalSearchParams({ ...filters, q: deferredSearch });
    params.set('page', String(filters.page));
    params.set('limit', String(filters.limit));
    return params.toString();
  }, [filters, deferredSearch]);
  return {
    filters, queryString, search, deferredSearch, updateFilters,
    setSearch: (value: string) => { setSearchDraft(value); updateFilters({ q: value.trim() }); },
    resetFilters: () => { setSearchDraft(''); updateFilters({ ...callJournalFieldsSchema.parse({}), userId: defaultEmployeeId }); },
  };
}
