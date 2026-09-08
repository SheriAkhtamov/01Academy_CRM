import { useMemo } from 'react';
import { useStickyState } from '@/hooks/useStickyState';
import { reportingToday, type ReportingDateRange } from '@/lib/reportingDateRange';
import { resolveSalesReportingRange } from '@/lib/salesReportingRange';

export function useSalesReportingRange(): [ReportingDateRange, (range: ReportingDateRange) => void] {
  const [legacyMonth] = useStickyState<unknown>('sales-overview-month', null);
  const [stored, setRange] = useStickyState<unknown>('sales-overview-period', null);
  const today = reportingToday();
  const range = useMemo(() => resolveSalesReportingRange(stored, legacyMonth, today), [stored, legacyMonth, today]);
  return [range, setRange];
}
