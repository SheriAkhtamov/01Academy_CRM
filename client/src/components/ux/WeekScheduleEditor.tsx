import { useState } from 'react';
import { CircleAlert, Clock, CopyCheck, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import ConfirmDialog from '@/components/ConfirmDialog';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export interface WeekScheduleItem {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  schoolId?: number | null;
}

interface WeekScheduleEditorProps {
  value: WeekScheduleItem[];
  onChange: (value: WeekScheduleItem[]) => void;
  dayNames: string[];
  schools?: Array<{ id: number; name: string }>;
  showSchool?: boolean;
  allSchoolsLabel?: string;
  startLabel?: string;
  endLabel?: string;
  defaultDurationMinutes?: number;
  disabled?: boolean;
  className?: string;
}

const DEFAULT_START = '09:00';
const DEFAULT_END = '18:00';
const QUICK_START_TIMES = ['09:00', '10:00', '14:00', '16:00', '18:00', '19:00'] as const;

const PRESETS = [
  { key: 'weekdays', labelKey: 'schedulePresetWeekdays', days: [1, 2, 3, 4, 5] },
  { key: 'oddDays', labelKey: 'schedulePresetOddDays', days: [1, 3, 5] },
  { key: 'evenDays', labelKey: 'schedulePresetEvenDays', days: [2, 4] },
  { key: 'weekend', labelKey: 'schedulePresetWeekend', days: [6, 7] },
] satisfies ReadonlyArray<{ key: string; labelKey: TranslationKey; days: number[] }>;

const toMinutes = (value: string) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

const fromMinutes = (totalMinutes: number) => {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, totalMinutes));
  const hours = String(Math.floor(clamped / 60)).padStart(2, '0');
  const minutes = String(clamped % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
};

const durationLabel = (item: WeekScheduleItem) => {
  const start = toMinutes(item.startTime);
  const end = toMinutes(item.endTime);
  if (start === null || end === null || end <= start) return null;
  const minutes = end - start;
  const hours = Math.floor(minutes / 60);
  return { hours, minutes: minutes % 60, totalMinutes: minutes };
};

export function WeekScheduleEditor({
  value,
  onChange,
  dayNames,
  schools = [],
  showSchool = false,
  allSchoolsLabel,
  startLabel,
  endLabel,
  defaultDurationMinutes,
  disabled = false,
  className,
}: WeekScheduleEditorProps) {
  const { t } = useTranslation();
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const resolvedAllSchoolsLabel = allSchoolsLabel ?? t('allSchools');
  const resolvedStartLabel = startLabel ?? t('start');
  const resolvedEndLabel = endLabel ?? t('end');
  const firstItem = [...value].sort((left, right) => left.dayOfWeek - right.dayOfWeek)[0];

  const resolveDefaultEnd = (startTime: string) => {
    const startMins = toMinutes(startTime);
    if (startMins !== null && defaultDurationMinutes && defaultDurationMinutes >= 15) {
      return fromMinutes(startMins + defaultDurationMinutes);
    }
    return DEFAULT_END;
  };

  const updateDay = (dayOfWeek: number, patch: Partial<WeekScheduleItem>) => {
    const existing = value.find((item) => item.dayOfWeek === dayOfWeek);
    const fallbackStart = firstItem?.startTime ?? DEFAULT_START;
    const next = existing
      ? value.map((item) => item.dayOfWeek === dayOfWeek ? { ...item, ...patch } : item)
      : [...value, {
          dayOfWeek,
          startTime: fallbackStart,
          endTime: firstItem?.endTime ?? resolveDefaultEnd(fallbackStart),
          schoolId: firstItem?.schoolId ?? schools[0]?.id ?? null,
          ...patch,
        }];
    onChange([...next].sort((left, right) => left.dayOfWeek - right.dayOfWeek));
  };

  const toggleDay = (dayOfWeek: number, checked: boolean) => {
    if (!checked) {
      onChange(value.filter((item) => item.dayOfWeek !== dayOfWeek));
      return;
    }
    updateDay(dayOfWeek, {});
  };

  const applyPreset = (days: number[]) => {
    const fallbackStart = firstItem?.startTime ?? DEFAULT_START;
    const template = firstItem ?? {
      startTime: fallbackStart,
      endTime: resolveDefaultEnd(fallbackStart),
      schoolId: schools[0]?.id ?? null,
    };
    onChange(days.map((dayOfWeek) => {
      const existing = value.find((item) => item.dayOfWeek === dayOfWeek);
      return existing ?? {
        dayOfWeek,
        startTime: template.startTime,
        endTime: template.endTime,
        schoolId: template.schoolId ?? null,
      };
    }));
  };

  const applyQuickStartTime = (startTime: string) => {
    const startMins = toMinutes(startTime);
    if (startMins === null || value.length === 0) return;
    onChange(value.map((item) => {
      const currentDuration = durationLabel(item)?.totalMinutes
        ?? (defaultDurationMinutes && defaultDurationMinutes >= 15 ? defaultDurationMinutes : 120);
      return {
        ...item,
        startTime,
        endTime: fromMinutes(startMins + currentDuration),
      };
    }));
  };

  const copyFirstRow = () => {
    if (!firstItem) return;
    onChange(value.map((item) => ({
      ...item,
      startTime: firstItem.startTime,
      endTime: firstItem.endTime,
      schoolId: showSchool ? firstItem.schoolId ?? null : item.schoolId,
    })));
  };

  const isPresetActive = (days: number[]) => (
    value.length === days.length && days.every((day) => value.some((item) => item.dayOfWeek === day))
  );

  const uniformStartTime = value.length > 0 && value.every((item) => item.startTime === value[0]?.startTime)
    ? value[0]?.startTime
    : null;

  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((preset) => {
          const active = isPresetActive(preset.days);
          return (
            <Button
              key={preset.key}
              type="button"
              variant="outline"
              size="sm"
              className={cn(
                'h-7 px-2.5 text-xs transition-colors',
                active && 'border-primary/40 bg-primary/10 font-medium text-primary hover:bg-primary/15',
              )}
              disabled={disabled}
              onClick={() => applyPreset(preset.days)}
            >
              {t(preset.labelKey)}
            </Button>
          );
        })}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          disabled={disabled || value.length < 2}
          onClick={copyFirstRow}
        >
          <CopyCheck className="size-3.5" aria-hidden="true" />
          {t('scheduleCopyFirstRow')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
          disabled={disabled || value.length === 0}
          onClick={() => setResetConfirmOpen(true)}
        >
          <RotateCcw className="size-3" aria-hidden="true" />
          {t('reset')}
        </Button>
      </div>

      {value.length > 0 && !disabled ? (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5">
          <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          {QUICK_START_TIMES.map((slot) => {
            const active = uniformStartTime === slot;
            return (
              <button
                key={slot}
                type="button"
                onClick={() => applyQuickStartTime(slot)}
                className={cn(
                  'rounded-md px-2 py-0.5 text-xs tabular-nums transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground font-medium shadow-2xs'
                    : 'bg-background/80 text-muted-foreground hover:bg-background hover:text-foreground border border-border/60',
                )}
              >
                {slot}
              </button>
            );
          })}
        </div>
      ) : null}

      <ConfirmDialog
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        title={t('scheduleResetTitle')}
        description={`${t('scheduleResetDescription')} ${t('thisActionCannotBeUndone')}`}
        confirmLabel={t('reset')}
        variant="destructive"
        onConfirm={() => {
          setResetConfirmOpen(false);
          onChange([]);
        }}
      />

      <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-2xs">
        {dayNames.map((dayName, index) => {
          const dayOfWeek = index + 1;
          const item = value.find((entry) => entry.dayOfWeek === dayOfWeek);
          const enabled = Boolean(item);
          const duration = item ? durationLabel(item) : null;
          const invalid = enabled && !duration;

          return (
            <div
              key={dayOfWeek}
              className={cn(
                'grid grid-cols-2 items-center gap-2 border-b border-border/70 px-3 py-2 transition-colors last:border-b-0',
                'sm:grid-cols-[minmax(7rem,1fr)_6.5rem_6.5rem]',
                showSchool
                  ? 'md:grid-cols-[minmax(8rem,1fr)_7rem_7rem_5rem_minmax(9rem,1fr)]'
                  : 'md:grid-cols-[minmax(8rem,1fr)_7rem_7rem_5rem]',
                enabled
                  ? 'border-l-2 border-l-primary bg-primary/[0.03] dark:bg-primary/[0.07]'
                  : 'bg-muted/20 hover:bg-muted/35',
                invalid && 'border-l-2 border-l-destructive bg-destructive/5',
              )}
            >
              <div className="col-span-2 flex items-center gap-2.5 sm:col-span-1">
                <Checkbox
                  id={`schedule-day-${dayOfWeek}`}
                  checked={enabled}
                  disabled={disabled}
                  onCheckedChange={(checked) => toggleDay(dayOfWeek, checked === true)}
                />
                <Label
                  htmlFor={`schedule-day-${dayOfWeek}`}
                  className={cn(
                    'cursor-pointer select-none text-sm transition-colors',
                    enabled ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground',
                  )}
                >
                  {dayName}
                </Label>
              </div>
              <Input
                type="time"
                className={cn('h-8.5 text-xs tabular-nums sm:text-sm', !enabled && 'opacity-50')}
                aria-label={`${dayName}: ${resolvedStartLabel}`}
                aria-invalid={invalid}
                value={item?.startTime ?? ''}
                disabled={!enabled || disabled}
                onChange={(event) => updateDay(dayOfWeek, { startTime: event.target.value })}
              />
              <Input
                type="time"
                className={cn('h-8.5 text-xs tabular-nums sm:text-sm', !enabled && 'opacity-50')}
                aria-label={`${dayName}: ${resolvedEndLabel}`}
                aria-invalid={invalid}
                value={item?.endTime ?? ''}
                disabled={!enabled || disabled}
                onChange={(event) => updateDay(dayOfWeek, { endTime: event.target.value })}
              />
              <span
                className={cn(
                  'col-span-2 flex items-center justify-end gap-1 text-xs tabular-nums sm:col-span-3 md:col-span-1 md:justify-start',
                  invalid ? 'font-medium text-destructive' : 'text-muted-foreground',
                )}
              >
                {invalid ? (
                  <>
                    <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
                    {t('scheduleEndBeforeStart')}
                  </>
                ) : duration ? (
                  <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                    {`${duration.hours}${t('teachingHoursUnit')} ${duration.minutes > 0 ? `${duration.minutes}${t('minuteShort')}` : ''}`.trim()}
                  </span>
                ) : null}
              </span>
              {showSchool ? (
                <Select
                  value={item?.schoolId ? String(item.schoolId) : 'all'}
                  disabled={!enabled || disabled}
                  onValueChange={(nextValue) => updateDay(dayOfWeek, {
                    schoolId: nextValue === 'all' ? null : Number(nextValue),
                  })}
                >
                  <SelectTrigger aria-label={`${t('school')}: ${dayNames[dayOfWeek - 1] ?? dayOfWeek}`} className="col-span-2 h-8.5 sm:col-span-3 md:col-span-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">{resolvedAllSchoolsLabel}</SelectItem>
                      {schools.map((school) => (
                        <SelectItem key={school.id} value={String(school.id)}>
                          {school.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
