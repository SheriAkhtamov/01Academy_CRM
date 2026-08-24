import type { Locale } from 'date-fns';
import {
  BookOpen,
  CalendarDays,
  Clock3,
  MapPin,
  Repeat2,
  UserRoundCheck,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  calendarToneAt,
  DEMO_TONE,
  formatCalendarMinutes,
} from '@/components/ux/calendar/calendarTones';
import { useTranslation } from '@/hooks/useTranslation';
import { academyDateTimeFormat } from '@/lib/localeFormat';
import type { SalesScheduleEvent } from '@/lib/salesSchedule';

interface ScheduleEventDialogProps {
  event: SalesScheduleEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: Locale;
  groupIndexById: Map<number, number>;
}

export function ScheduleEventDialog({
  event,
  open,
  onOpenChange,
  groupIndexById,
}: ScheduleEventDialogProps) {
  const { t, language } = useTranslation();
  if (!event) return null;

  const tone = event.source === 'demo'
    ? DEMO_TONE
    : calendarToneAt(groupIndexById.get(event.groupId) ?? 0);
  const rows = [
    {
      key: 'time',
      icon: Clock3,
      value: `${formatCalendarMinutes(event.startMinutes)}–${formatCalendarMinutes(event.endMinutes)}`,
    },
    {
      key: 'course',
      icon: BookOpen,
      value: event.topic || event.courseName || t('lessonColumn'),
    },
    {
      key: 'teacher',
      icon: UserRoundCheck,
      value: event.teacherName || t('teacherWillBeAssigned'),
    },
    ...(event.schoolName ? [{ key: 'school', icon: MapPin, value: event.schoolName }] : []),
    ...(event.roomName ? [{ key: 'room', icon: MapPin, value: event.roomName }] : []),
    ...(event.availableSeats !== null && event.availableSeats !== undefined
      ? [{
          key: 'seats',
          icon: UserRoundCheck,
          value: `${event.availableSeats}/${event.maxStudents ?? 12} ${t('seatsAvailable')}`,
        }]
      : []),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
        <div className="h-1.5 w-full" style={{ backgroundColor: tone.solid }} aria-hidden="true" />
        <DialogHeader className="px-6 pb-3 pt-5">
          <DialogTitle className="text-lg">{event.groupName}</DialogTitle>
          <DialogDescription className="flex items-center gap-1.5 capitalize">
            <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
            {academyDateTimeFormat(language, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }).format(event.startsAt)}
          </DialogDescription>
        </DialogHeader>

        <dl className="flex flex-col gap-2.5 px-6 pb-5">
          {rows.map((row) => (
            <div key={row.key} className="flex items-center gap-2.5 text-sm">
              <row.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <dd className="min-w-0 truncate text-foreground">{row.value}</dd>
            </div>
          ))}

          {event.source === 'recurring' ? (
            <p className="mt-1 flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              <Repeat2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {t('recurringLessonHint')}
            </p>
          ) : null}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
