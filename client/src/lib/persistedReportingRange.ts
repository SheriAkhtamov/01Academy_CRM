import { isReportingPresetKey, reportingRangeForPreset, type ReportingDateRange } from './reportingDateRange';

/** Relative shortcuts are evaluated when the page opens; custom dates remain fixed. */
export function restoreReportingRange(stored: unknown): ReportingDateRange {
  if (!stored || typeof stored !== 'object') return reportingRangeForPreset('today');
  const candidate = stored as Partial<ReportingDateRange>;
  if (isReportingPresetKey(candidate.preset)) return reportingRangeForPreset(candidate.preset);
  if (candidate.preset === 'custom' && typeof candidate.from === 'string' && typeof candidate.to === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(candidate.from) && /^\d{4}-\d{2}-\d{2}$/.test(candidate.to)
    && candidate.from <= candidate.to) {
    return { from: candidate.from, to: candidate.to, preset: 'custom' };
  }
  return reportingRangeForPreset('today');
}
