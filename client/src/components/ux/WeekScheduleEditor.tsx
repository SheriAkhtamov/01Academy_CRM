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

export function WeekScheduleEditor({
  value,
  onChange,
  dayNames,
  schools = [],
  showSchool = false,
  allSchoolsLabel = 'All schools',
  startLabel = 'Start',
  endLabel = 'End',
  disabled = false,
  className,
}: WeekScheduleEditorProps) {
  const updateDay = (dayOfWeek: number, patch: Partial<WeekScheduleItem>) => {
    const existing = value.find((item) => item.dayOfWeek === dayOfWeek);
    const next = existing
      ? value.map((item) => item.dayOfWeek === dayOfWeek ? { ...item, ...patch } : item)
      : [...value, {
          dayOfWeek,
          startTime: DEFAULT_START,
          endTime: DEFAULT_END,
          schoolId: schools[0]?.id ?? null,
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

  return (
    <div className={cn('overflow-hidden rounded-xl border border-border', className)}>
      {dayNames.map((dayName, index) => {
        const dayOfWeek = index + 1;
        const item = value.find((entry) => entry.dayOfWeek === dayOfWeek);
        const enabled = Boolean(item);

        return (
          <div
            key={dayOfWeek}
            className="grid grid-cols-[minmax(8rem,1fr)_7rem_7rem] items-center gap-3 border-b border-border p-3 last:border-b-0 md:grid-cols-[minmax(9rem,1fr)_7.5rem_7.5rem_minmax(10rem,1fr)]"
          >
            <div className="flex items-center gap-2">
              <Checkbox
                id={`schedule-day-${dayOfWeek}`}
                checked={enabled}
                disabled={disabled}
                onCheckedChange={(checked) => toggleDay(dayOfWeek, checked === true)}
              />
              <Label htmlFor={`schedule-day-${dayOfWeek}`} className="text-sm font-medium">
                {dayName}
              </Label>
            </div>
            <Input
              type="time"
              aria-label={`${dayName}: ${startLabel}`}
              value={item?.startTime ?? ''}
              disabled={!enabled || disabled}
              onChange={(event) => updateDay(dayOfWeek, { startTime: event.target.value })}
            />
            <Input
              type="time"
              aria-label={`${dayName}: ${endLabel}`}
              value={item?.endTime ?? ''}
              disabled={!enabled || disabled}
              onChange={(event) => updateDay(dayOfWeek, { endTime: event.target.value })}
            />
            {showSchool ? (
              <Select
                value={item?.schoolId ? String(item.schoolId) : 'all'}
                disabled={!enabled || disabled}
                onValueChange={(nextValue) => updateDay(dayOfWeek, {
                  schoolId: nextValue === 'all' ? null : Number(nextValue),
                })}
              >
                <SelectTrigger className="col-span-3 md:col-span-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">{allSchoolsLabel}</SelectItem>
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
  );
}
