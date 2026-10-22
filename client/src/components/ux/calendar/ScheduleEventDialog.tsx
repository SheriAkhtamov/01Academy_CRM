import { EmployeeIdentity } from '@/components/ux/EmployeeIdentity';
import { CompactModalSection } from '@/components/ux/CompactModalSection';
import type { Locale } from 'date-fns';
import {
  BookOpen,
  CalendarDays,
  Clock3,
  MapPin,
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
      label: t('time'),
      value: `${formatCalendarMinutes(event.startMinutes)}–${formatCalendarMinutes(event.endMinutes)}`,
    },
    ...(event.courseName ? [{
      key: 'course',
      icon: BookOpen,
      label: t('course'),
      value: event.courseName,
    }] : []),
    ...(event.topic ? [{
      key: 'topic',
      icon: BookOpen,
      label: t('lessonTopic'),
      value: event.topic,
    }] : []),
    {
      key: 'teacher',
      icon: UserRoundCheck,
      label: t('teacher'),
      value: <EmployeeIdentity userId={event.teacherUserId} name={event.teacherName || t('notAssigned')} wrapName />,
    },
    ...(event.schoolName ? [{ key: 'school', icon: MapPin, label: t('school'), value: event.schoolName }] : []),
    ...(event.roomName ? [{ key: 'room', icon: MapPin, label: t('room'), value: event.roomName }] : []),
    ...(event.availableSeats !== null && event.availableSeats !== undefined
      ? [{
          key: 'seats',
          icon: UserRoundCheck,
          label: t('seatsAvailable'),
          value: `${event.availableSeats}/${event.maxStudents ?? 12}`,
        }]
      : []),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="compact-modal flex max-w-md flex-col overflow-hidden p-0">
        <div className="h-1 w-full shrink-0" style={{ backgroundColor: tone.solid }} aria-hidden="true" />
        <DialogHeader className="compact-modal-header">
          <DialogTitle className="text-base leading-6">{event.groupName}</DialogTitle>
          <DialogDescription className="flex items-center gap-1.5 text-xs capitalize">
            <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
            {academyDateTimeFormat(language, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }).format(event.startsAt)}
          </DialogDescription>
        </DialogHeader>

        <div className="compact-modal-body overflow-y-auto">
          <CompactModalSection title={t('lessonColumn')} icon={CalendarDays} tone="sky" collapsible={false}>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              {rows.map((row) => (
                <div key={row.key} className="min-w-0 space-y-1">
                  <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <row.icon className="size-3.5 shrink-0" aria-hidden="true" />
                    {row.label}
                  </dt>
                  <dd className="break-words text-sm font-medium text-foreground">{row.value}</dd>
                </div>
              ))}
            </dl>
          </CompactModalSection>
        </div>
      </DialogContent>
    </Dialog>
  );
}
