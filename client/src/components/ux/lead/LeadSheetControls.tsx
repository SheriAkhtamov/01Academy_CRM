import { useMemo } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { translations, type TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useFormField } from '@/components/ui/form';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { LEAD_STATUSES } from '@shared/academy';

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
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            disabled={disabled}
            className={cn(
              'min-w-0 flex-1 truncate rounded-md px-2.5 py-1.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => onChange(option.value)}
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
        'rounded-full border border-border/70 bg-background px-1.5 py-px text-[11px] font-semibold tabular-nums text-muted-foreground',
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
  isLocked,
  pendingStatusCode,
  leadStatusName,
  onSelectStage,
}: {
  statuses: StepperStageSource[];
  currentStatusCode: string;
  isLocked: boolean;
  pendingStatusCode: string | null;
  leadStatusName: (code: string) => string;
  onSelectStage: (code: string) => void;
}) {
  const { t } = useTranslation();

  const stages = useMemo(() => {
    const source: StepperStageSource[] = statuses.length > 0
      ? statuses
      : LEAD_STATUSES.map((status) => ({
          code: status.code,
          name: status.name,
          color: status.color,
          sortOrder: status.sortOrder,
          isActive: true,
          isPipeline: status.activePipeline,
        }));
    return [...source]
      .filter((status) => status.isActive !== false && status.isPipeline !== false)
      .sort((left, right) => Number(left.sortOrder ?? 0) - Number(right.sortOrder ?? 0));
  }, [statuses]);

  if (stages.length === 0) return null;

  const currentIndex = stages.findIndex((stage) => stage.code === currentStatusCode);

  return (
    <div>
      <div
        role="group"
        aria-label={t('pipelineStages')}
        className="flex w-full items-stretch gap-1 overflow-x-auto pb-1"
      >
        {stages.map((stage, index) => {
          const reached = currentIndex >= 0 && index <= currentIndex;
          const isCurrent = index === currentIndex;
          const isStagePending = pendingStatusCode === stage.code;
          const color = HEX_COLOR_PATTERN.test(stage.color ?? '') ? stage.color! : '#64748b';
          const stageName = leadStatusName(stage.code);
          return (
            <button
              key={stage.code}
              type="button"
              title={stageName}
              aria-current={isCurrent ? 'step' : undefined}
              disabled={isLocked || isCurrent || pendingStatusCode !== null}
              className={cn(
                'inline-flex h-8 min-w-16 flex-1 select-none items-center justify-center rounded-md px-2 text-[11px] font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                reached ? 'text-white shadow-2xs' : 'bg-muted text-muted-foreground',
                !reached && !isLocked && pendingStatusCode === null
                  && 'hover:bg-muted/70 hover:text-foreground',
                isLocked && !reached && 'opacity-50',
                isCurrent && 'cursor-default',
              )}
              style={reached
                ? {
                    backgroundColor: color,
                    ...(isCurrent
                      ? { boxShadow: `0 0 0 2px var(--background), 0 0 0 4px ${color}66` }
                      : {}),
                  }
                : undefined}
              onClick={() => onSelectStage(stage.code)}
            >
              {isStagePending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <span className="truncate">{stageName}</span>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {currentIndex >= 0 ? (
          <span>
            {t('stageProgress')
              .replace('{current}', String(currentIndex + 1))
              .replace('{total}', String(stages.length))}
            <span className="font-medium text-foreground/80"> · {leadStatusName(currentStatusCode)}</span>
          </span>
        ) : (
          <Badge variant="secondary">{leadStatusName(currentStatusCode)}</Badge>
        )}
        {currentStatusCode === 'paid' ? (
          <CheckCircle2 className="size-3.5 text-emerald-600" aria-hidden="true" />
        ) : null}
      </div>
    </div>
  );
}
