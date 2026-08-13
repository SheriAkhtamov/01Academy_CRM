import { CircleAlert, CopyCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  disabled?: boolean;
  className?: string;
}

const DEFAULT_START = '09:00';
const DEFAULT_END = '18:00';

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

const durationLabel = (item: WeekScheduleItem) => {
  const start = toMinutes(item.startTime);
  const end = toMinutes(item.endTime);
  if (start === null || end === null || end <= start) return null;
  const minutes = end - start;
  const hours = Math.floor(minutes / 60);
  return { hours, minutes: minutes % 60 };
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
  disabled = false,
  className,
}: WeekScheduleEditorProps) {
  const { t } = useTranslation();
  const resolvedAllSchoolsLabel = allSchoolsLabel ?? t('allSchools');
  const resolvedStartLabel = startLabel ?? t('start');
  const resolvedEndLabel = endLabel ?? t('end');
  const firstItem = [...value].sort((left, right) => left.dayOfWeek - right.dayOfWeek)[0];

  const updateDay = (dayOfWeek: number, patch: Partial<WeekScheduleItem>) => {
    const existing = value.find((item) => item.dayOfWeek === dayOfWeek);
    const next = existing
      ? value.map((item) => item.dayOfWeek === dayOfWeek ? { ...item, ...patch } : item)
      : [...value, {
          dayOfWeek,
          startTime: firstItem?.startTime ?? DEFAULT_START,
          endTime: firstItem?.endTime ?? DEFAULT_END,
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
    const template = firstItem ?? {
      startTime: DEFAULT_START,
      endTime: DEFAULT_END,
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

  const copyFirstRow = () => {
    if (!firstItem) return;
    onChange(value.map((item) => ({
      ...item,
      startTime: firstItem.startTime,
      endTime: firstItem.endTime,
      schoolId: showSchool ? firstItem.schoolId ?? null : item.schoolId,
    })));
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((preset) => (
          <Button
            key={preset.key}
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={disabled}
            onClick={() => applyPreset(preset.days)}
          >
            {t(preset.labelKey)}
          </Button>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          disabled={disabled || value.length < 2}
          onClick={copyFirstRow}
        >
          <CopyCheck />
          {t('scheduleCopyFirstRow')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-7 px-2 text-xs"
          disabled={disabled || value.length === 0}
          onClick={() => onChange([])}
        >
          {t('reset')}
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
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
                'grid grid-cols-[minmax(7rem,1fr)_6.5rem_6.5rem] items-center gap-2 border-b border-border px-3 py-2 last:border-b-0',
                'md:grid-cols-[minmax(8rem,1fr)_7rem_7rem_5rem_minmax(9rem,1fr)]',
                enabled ? 'bg-card' : 'bg-muted/25',
                invalid && 'bg-destructive/5',
              )}
            >
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`schedule-day-${dayOfWeek}`}
                  checked={enabled}
                  disabled={disabled}
                  onCheckedChange={(checked) => toggleDay(dayOfWeek, checked === true)}
                />
                <Label
                  htmlFor={`schedule-day-${dayOfWeek}`}
                  className={cn(
                    'cursor-pointer text-sm font-medium',
                    !enabled && 'text-muted-foreground',
                  )}
                >
                  {dayName}
                </Label>
              </div>
              <Input
                type="time"
                className="h-9"
                aria-label={`${dayName}: ${resolvedStartLabel}`}
                aria-invalid={invalid}
                value={item?.startTime ?? ''}
                disabled={!enabled || disabled}
                onChange={(event) => updateDay(dayOfWeek, { startTime: event.target.value })}
              />
              <Input
                type="time"
                className="h-9"
                aria-label={`${dayName}: ${resolvedEndLabel}`}
                aria-invalid={invalid}
                value={item?.endTime ?? ''}
                disabled={!enabled || disabled}
                onChange={(event) => updateDay(dayOfWeek, { endTime: event.target.value })}
              />
              <span
                className={cn(
                  'col-span-3 flex items-center gap-1 text-xs tabular-nums md:col-span-1',
                  invalid ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {invalid ? (
                  <>
                    <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
                    {t('scheduleEndBeforeStart')}
                  </>
                ) : duration ? (
                  `${duration.hours}${t('teachingHoursUnit')} ${duration.minutes > 0 ? `${duration.minutes}${t('minuteShort')}` : ''}`.trim()
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
                  <SelectTrigger className="col-span-3 h-9 md:col-span-1">
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
