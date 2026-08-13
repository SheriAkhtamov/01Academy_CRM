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
 *
 * Sizing is deliberately asymmetric. Below `md` every control grows to 44px,
 * because this row is the primary navigation of four calendars and people pan
 * weeks with a thumb — a 32px arrow wedged between "Today" and the card edge is
 * a miss every other tap. From `md` up nothing changes at all, so no existing
 * desktop layout in any module shifts by a pixel.
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
          className="size-8 rounded-md max-md:size-11"
          aria-label={previousLabel}
          onClick={onPrevious}
        >
          <ChevronLeft />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 rounded-md px-2.5 text-xs font-semibold max-md:h-11 max-md:px-4"
          disabled={atToday}
          onClick={onToday}
        >
          {t('today')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 rounded-md max-md:size-11"
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
                'h-8 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-card/70 max-md:h-11 max-md:px-3.5',
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
