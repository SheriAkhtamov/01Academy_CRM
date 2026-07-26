import { CalendarRange, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import {
  reportingRangeForPreset,
  type ReportingDatePreset,
  type ReportingDateRange,
} from '@/lib/reportingDateRange';
import { cn } from '@/lib/utils';

const presetTranslationKeys = {
  last7: 'reportingLast7Days',
  last30: 'reportingLast30Days',
  thisMonth: 'reportingThisMonth',
  previousMonth: 'reportingPreviousMonth',
} as const satisfies Record<Exclude<ReportingDatePreset, 'custom'>, TranslationKey>;

const quickPresets = ['last7', 'last30', 'thisMonth', 'previousMonth'] as const;

export function ReportingDateRangeFilter({
  value,
  onChange,
  isFetching = false,
  className,
}: {
  value: ReportingDateRange;
  onChange: (value: ReportingDateRange) => void;
  isFetching?: boolean;
  className?: string;
}) {
  const { t, language } = useTranslation();
  const locale = language === 'ru' ? 'ru-RU' : 'en-US';
  const formatDate = (dateOnly: string) => new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${dateOnly}T00:00:00Z`));
  const formattedRange = `${formatDate(value.from)} — ${formatDate(value.to)}`;

  const setPreset = (preset: Exclude<ReportingDatePreset, 'custom'>) => {
    onChange(reportingRangeForPreset(preset));
  };

  const setBoundary = (boundary: 'from' | 'to', nextValue: string) => {
    if (!nextValue) return;
    const next = { ...value, [boundary]: nextValue, preset: 'custom' as const };
    if (next.from > next.to) {
      if (boundary === 'from') next.to = nextValue;
      else next.from = nextValue;
    }
    onChange(next);
  };

  return (
    <Card className={cn('border-border/60 bg-card shadow-sm', className)}>
      <CardContent className="flex flex-col gap-2.5 p-3 xl:flex-row xl:items-center">
        <div className="flex min-w-0 items-center gap-2.5 xl:mr-auto">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <CalendarRange className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold">{t('reportingPeriod')}</p>
            <p className="truncate text-xs leading-4 text-muted-foreground" title={formattedRange} aria-live="polite">
              {formattedRange}
            </p>
          </div>
          {isFetching ? (
            <span className="ml-auto shrink-0 xl:ml-0" role="status">
              <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">{t('loading')}</span>
            </span>
          ) : null}
        </div>

        <div className="hidden rounded-lg bg-muted p-1 xl:flex" role="group" aria-label={t('reportingQuickPeriods')}>
          {quickPresets.map((preset) => (
            <Button
              key={preset}
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                'h-11 px-3 text-xs font-medium',
                value.preset === preset && 'bg-background text-foreground shadow-sm hover:bg-background',
              )}
              aria-pressed={value.preset === preset}
              onClick={() => setPreset(preset)}
            >
              {t(presetTranslationKeys[preset])}
            </Button>
          ))}
        </div>

        <Select
          value={value.preset}
          onValueChange={(preset) => {
            if (preset !== 'custom') setPreset(preset as Exclude<ReportingDatePreset, 'custom'>);
          }}
        >
          <SelectTrigger className="h-11 xl:hidden" aria-label={t('reportingQuickPeriods')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {quickPresets.map((preset) => (
              <SelectItem key={preset} value={preset}>{t(presetTranslationKeys[preset])}</SelectItem>
            ))}
            {value.preset === 'custom' ? <SelectItem value="custom">{t('reportingCustomPeriod')}</SelectItem> : null}
          </SelectContent>
        </Select>

        <div className="grid grid-cols-2 gap-2">
          <label className="relative">
            <span className="absolute left-3 top-1 text-xs font-medium text-muted-foreground">
              {t('dateFrom')}
            </span>
            <Input
              type="date"
              value={value.from}
              max={value.to}
              onChange={(event) => setBoundary('from', event.target.value)}
              className="h-12 min-w-0 pt-5 sm:w-[148px]"
            />
          </label>
          <label className="relative">
            <span className="absolute left-3 top-1 text-xs font-medium text-muted-foreground">
              {t('dateTo')}
            </span>
            <Input
              type="date"
              value={value.to}
              min={value.from}
              onChange={(event) => setBoundary('to', event.target.value)}
              className="h-12 min-w-0 pt-5 sm:w-[148px]"
            />
          </label>
        </div>
      </CardContent>
    </Card>
  );
}
