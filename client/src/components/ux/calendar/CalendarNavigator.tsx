import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import type { CalendarViewMode } from '@/lib/calendarPreferences';
import type { TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface CalendarNavigatorProps {
  label: string;
  hint?: ReactNode;
  previousLabel: string;
  nextLabel: string;
  atToday: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  views?: readonly CalendarViewMode[];
  view?: CalendarViewMode;
  onViewChange?: (view: CalendarViewMode) => void;
  actions?: ReactNode;
  className?: string;
}

const VIEW_LABEL_KEYS = {
  day: 'calendarViewDay',
  week: 'calendarViewWeek',
  month: 'calendarViewMonth',
  agenda: 'calendarViewAgenda',
} satisfies Record<CalendarViewMode, TranslationKey>;

/**
 * Every calendar used to invent its own navigation: one had a bare date input,
 * another had arrows only, a third had no way back to today. A single control
 * means the muscle memory carries between the sales, academy and teacher
 * screens — including the arrow / T keyboard shortcuts they all register.
 */
export function CalendarNavigator({
  label,
  hint,
  previousLabel,
  nextLabel,
  atToday,
  onPrevious,
  onNext,
  onToday,
  views,
  view,
  onViewChange,
  actions,
  className,
}: CalendarNavigatorProps) {
  const { t } = useTranslation();

  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2', className)}>
      <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5 shadow-2xs">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 rounded-md"
          aria-label={previousLabel}
          onClick={onPrevious}
        >
          <ChevronLeft />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 rounded-md px-2.5 text-xs font-semibold"
          disabled={atToday}
          onClick={onToday}
        >
          {t('today')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 rounded-md"
          aria-label={nextLabel}
          onClick={onNext}
        >
          <ChevronRight />
        </Button>
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold capitalize text-foreground">{label}</p>
        {hint ? (
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </div>

      {views && view && onViewChange ? (
        <div
          role="group"
          aria-label={t('calendarViewMode')}
          className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5"
        >
          {views.map((item) => (
            <Button
              key={item}
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={item === view}
              className={cn(
                'h-8 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-card/70',
                item === view && 'bg-card text-foreground shadow-2xs hover:bg-card',
              )}
              onClick={() => onViewChange(item)}
            >
              {t(VIEW_LABEL_KEYS[item])}
            </Button>
          ))}
        </div>
      ) : null}

      {actions}
    </div>
  );
}
