import { useMemo } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { translations, type TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useFormField } from '@/components/ui/form';

export function LocalizedFormMessage() {
  const { t } = useTranslation();
  const { error, formMessageId } = useFormField();
  if (!error?.message) return null;
  const message = String(error.message);
  const key = Object.prototype.hasOwnProperty.call(translations, message)
    ? message as TranslationKey
    : 'invalidData';
  return (
    <p id={formMessageId} className="text-sm font-medium text-destructive">
      {t(key)}
    </p>
  );
}

export function SegmentedControl({
  options,
  value,
  onChange,
  ariaLabel,
  disabled,
  className,
}: {
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('flex w-full gap-0.5 rounded-lg border border-border bg-muted/60 p-0.5', className)}
    >
      {options.map((option, index) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            tabIndex={isActive || (!options.some((item) => item.value === value) && index === 0) ? 0 : -1}
            disabled={disabled}
            className={cn(
              'min-w-0 flex-1 truncate rounded-md px-2.5 py-1.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
                : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
              if (!direction && event.key !== 'Home' && event.key !== 'End') return;
              event.preventDefault();
              const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
                : (index + direction + options.length) % options.length;
              onChange(options[nextIndex].value);
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex]?.focus();
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabCount({ value, tone }: { value: number; tone?: 'warning' }) {
  if (value <= 0) return null;
  return (
    <span
      className={cn(
        'inline-flex min-w-5 items-center justify-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold leading-4 tabular-nums text-muted-foreground',
        tone === 'warning'
          && 'border-amber-300/70 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
      )}
    >
      {value}
    </span>
  );
}

export interface StepperStageSource {
  code: string;
  name: string;
  color?: string;
  sortOrder?: number;
  isActive?: boolean;
  isPipeline?: boolean;
}

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function LeadStageStepper({
  statuses,
  currentStatusCode,
  leadStatusName,
}: {
  statuses: StepperStageSource[];
  currentStatusCode: string;
  leadStatusName: (code: string) => string;
}) {
  const { t } = useTranslation();

  const stages = useMemo(() => {
    return [...statuses]
      .filter((status) => status.isActive !== false && status.isPipeline !== false)
      .sort((left, right) => Number(left.sortOrder ?? 0) - Number(right.sortOrder ?? 0));
  }, [statuses]);

  if (stages.length === 0) return null;

  const currentIndex = stages.findIndex((stage) => stage.code === currentStatusCode);
  const currentStage = currentIndex >= 0 ? stages[currentIndex] : null;
  const currentColor = HEX_COLOR_PATTERN.test(currentStage?.color ?? '')
    ? currentStage!.color!
    : '#64748b';

  return (
    <div className="flex min-w-0 flex-col-reverse gap-2">
      <div
        role="group"
        aria-label={t('pipelineStages')}
        className="flex w-full items-center gap-1"
      >
        {stages.map((stage, index) => {
          const isCurrent = index === currentIndex;
          const color = HEX_COLOR_PATTERN.test(stage.color ?? '') ? stage.color! : '#64748b';
          const stageName = leadStatusName(stage.code);
          return (
            <div
              key={stage.code}
              aria-current={isCurrent ? 'step' : undefined}
              className={cn(
                'h-1 min-w-0 flex-1 rounded-full',
                !isCurrent && 'bg-border/60',
              )}
              style={isCurrent ? { backgroundColor: color } : undefined}
            >
              <span className="sr-only">{stageName}</span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {currentIndex >= 0 ? (
          <>
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: currentColor }}
              />
              <span className="break-words font-medium text-foreground">
                {leadStatusName(currentStatusCode)}
              </span>
            </span>
            <span className="shrink-0 text-[11px] tabular-nums">
              {t('stageProgress')
                .replace('{current}', String(currentIndex + 1))
                .replace('{total}', String(stages.length))}
            </span>
          </>
        ) : (
          <Badge variant="secondary">{leadStatusName(currentStatusCode)}</Badge>
        )}
      </div>
    </div>
  );
}
