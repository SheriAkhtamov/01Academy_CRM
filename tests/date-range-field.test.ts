import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { withRangeBoundary } from '@/components/ux/DateRangeField';
import { academyDateInputValue } from '@/lib/localeFormat';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const dateRangeField = read('../client/src/components/ux/DateRangeField.tsx');
const reportingFilter = read('../client/src/components/ux/ReportingDateRangeFilter.tsx');
const callJournal = read('../client/src/pages/sales/CallJournalPage.tsx');
const audit = read('../client/src/pages/admin/audit.tsx');
const marketing = read('../client/src/pages/marketing-module.tsx');

describe('period boundaries', () => {
  it('lets either end move first and drags the other one along', () => {
    expect(withRangeBoundary({ from: '2026-08-01', to: '2026-08-05' }, 'from', '2026-09-10'))
      .toEqual({ from: '2026-09-10', to: '2026-09-10' });
    expect(withRangeBoundary({ from: '2026-08-01', to: '2026-08-05' }, 'to', '2026-07-01'))
      .toEqual({ from: '2026-07-01', to: '2026-07-01' });
  });

  it('leaves the opposite end alone while the period stays ordered', () => {
    expect(withRangeBoundary({ from: '2026-08-01', to: '2026-08-30' }, 'from', '2026-08-10'))
      .toEqual({ from: '2026-08-10', to: '2026-08-30' });
    expect(withRangeBoundary({ from: '2026-08-01', to: '2026-08-30' }, 'to', '2026-08-20'))
      .toEqual({ from: '2026-08-01', to: '2026-08-20' });
  });

  it('clears one end without disturbing the other', () => {
    expect(withRangeBoundary({ from: '2026-08-01', to: '2026-08-05' }, 'from', ''))
      .toEqual({ from: '', to: '2026-08-05' });
    expect(withRangeBoundary({ from: '', to: '' }, 'to', '2026-08-05'))
      .toEqual({ from: '', to: '2026-08-05' });
  });

  /* `min`/`max` between the two inputs greyed today out of the native calendar
     whenever the opposite end sat in the past: the picker then opened on that
     end's month rather than on today, and the period could only be moved
     forward by editing its ends in one particular order. */
  it('never disables a day in a period picker', () => {
    expect(dateRangeField).not.toMatch(/\bmin=|\bmax=/);
    expect(reportingFilter).not.toContain('max={value.to}');
    expect(reportingFilter).not.toContain('min={value.from}');
    for (const source of [callJournal, audit]) {
      expect(source).not.toContain('max={to || undefined}');
      expect(source).not.toContain('min={from || undefined}');
    }
    expect(marketing).not.toContain('max={expenseForm.periodEnd');
    expect(marketing).not.toContain('min={expenseForm.periodStart');
  });

  it('renders every period through the shared field', () => {
    for (const source of [reportingFilter, callJournal, audit, marketing]) {
      expect(source).toContain('<DateRangeField');
    }
  });
});

describe('academy date input values', () => {
  it('reads a timestamp on the academy calendar, not on UTC', () => {
    // Midnight in Tashkent is 19:00 UTC the day before; slicing the ISO string
    // handed the date field the previous day.
    expect(academyDateInputValue('2026-09-20T00:00:00+05:00')).toBe('2026-09-20');
    // 01:30 in Tashkent, still the 20th in UTC.
    expect(academyDateInputValue('2026-08-20T20:30:00Z')).toBe('2026-08-21');
    expect(academyDateInputValue('2026-09-20')).toBe('2026-09-20');
  });

  it('returns an empty field value for anything unusable', () => {
    expect(academyDateInputValue(null)).toBe('');
    expect(academyDateInputValue(undefined)).toBe('');
    expect(academyDateInputValue('')).toBe('');
    expect(academyDateInputValue('not a date')).toBe('');
  });
});
