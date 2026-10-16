import { BookOpen, CalendarClock, CheckCircle2, ClipboardCheck, Clock, ListChecks, Radio, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LessonStatusBadge } from '@/components/ux/teacher/TeacherStatusBadge';
import { useTranslation } from '@/hooks/useTranslation';
import { formatAcademyDate } from '@/lib/localeFormat';
import {
  formatLessonEndTime,
  isLessonStarted,
  TEACHER_CARD_PADDING,
  TEACHER_TONE_CLASS,
  TEACHER_TONE_ICON_CLASS,
  type TeacherLesson,
} from '@/lib/teacherModule';
import { cn } from '@/lib/utils';

interface TeacherTodayPanelProps {
  focusLesson: TeacherLesson | null;
  isLessonLive: boolean;
  isFocusLessonToday: boolean;
  todayCount: number;
  todayLessons?: TeacherLesson[];
  pendingLessons: TeacherLesson[];
  onOpenAttendance: (lessonId: string) => void;
  onOpenLessonInSchedule: (lessonId: string) => void;
  onOpenSchedule: () => void;
  onOpenGroup?: (groupId: number) => void;
}

export function TeacherTodayPanel({
  focusLesson,
  isLessonLive,
  todayCount,
  todayLessons = [],
  pendingLessons,
  onOpenAttendance,
  onOpenLessonInSchedule,
  onOpenSchedule,
  onOpenGroup,
}: TeacherTodayPanelProps) {
  const { t, language } = useTranslation();
  const oldestPending = pendingLessons[0] ?? null;
  const focusEndTime = focusLesson
    ? formatLessonEndTime(focusLesson.scheduledAt, focusLesson.durationMinutes, language)
    : null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card
          className={cn(
            'min-w-0 overflow-hidden border lg:col-span-2',
            isLessonLive
              ? 'border-emerald-500/40 bg-gradient-to-br from-emerald-500/[0.07] via-background to-background'
              : 'border-border/70 bg-gradient-to-br from-primary/[0.04] via-background to-background',
          )}
        >
          <CardContent className={cn('flex h-full flex-col justify-between gap-4', TEACHER_CARD_PADDING)}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    'flex size-9 items-center justify-center rounded-xl shadow-xs',
                    isLessonLive ? TEACHER_TONE_ICON_CLASS.success : TEACHER_TONE_ICON_CLASS.accent,
                  )}
                >
                  {isLessonLive ? <Radio className="size-4 animate-pulse" /> : <CalendarClock className="size-4" />}
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {isLessonLive ? t('lessonInProgressTitle') : t('nextLessonTitle')}
                  </p>
                  {focusLesson ? (
                    <p className="text-xs text-muted-foreground">
                      {formatAcademyDate(focusLesson.scheduledAt, language, {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                      })}
                    </p>
                  ) : null}
                </div>
              </div>
              {focusLesson ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {focusLesson.lessonNumber != null ? (
                    <Badge variant="outline" className="font-mono text-xs tabular-nums">
                      #{focusLesson.lessonNumber}
                    </Badge>
                  ) : null}
                  {focusLesson.courseName ? (
                    <Badge variant="secondary" className="max-w-48 truncate text-xs">
                      <BookOpen className="mr-1 size-3 shrink-0" />
                      <span className="truncate">{focusLesson.courseName}</span>
                    </Badge>
                  ) : null}
                  <LessonStatusBadge status={focusLesson.status} />
                </div>
              ) : null}
            </div>

            {focusLesson ? (
              <div className="flex flex-1 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <span className="text-3xl font-bold leading-none tracking-tight tabular-nums text-foreground">
                      {formatAcademyDate(focusLesson.scheduledAt, language, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {focusEndTime ? (
                      <span className="text-base font-medium tabular-nums text-muted-foreground">
                        – {focusEndTime}
                      </span>
                    ) : null}
                    {focusLesson.durationMinutes ? (
                      <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground">
                        <Clock className="mr-1 size-3" />
                        {t('durationMinutesValue', { count: focusLesson.durationMinutes })}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="truncate text-base font-semibold text-foreground">
                    {focusLesson.groupName || t('noGroup')}
                  </p>
                  <p className="line-clamp-1 text-sm text-muted-foreground">{focusLesson.topic}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {onOpenGroup && focusLesson.groupId ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="min-h-10 rounded-lg"
                      onClick={() => onOpenGroup(focusLesson.groupId!)}
                    >
                      <Users className="mr-1.5 size-4" />
                      {t('teacherOpenGroup')}
                    </Button>
                  ) : null}
                  {isLessonLive ? (
                    <Button
                      type="button"
                      className="min-h-10 shrink-0 rounded-lg shadow-xs"
                      onClick={() => onOpenAttendance(String(focusLesson.id))}
                    >
                      <ClipboardCheck className="mr-1.5 size-4" />
                      {t('attendanceChecklist')}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-10 shrink-0 rounded-lg"
                      onClick={() => onOpenLessonInSchedule(String(focusLesson.id))}
                    >
                      <CalendarClock className="mr-1.5 size-4" />
                      {t('openLessonInSchedule')}
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-start justify-center gap-3 py-1">
                <p className="text-sm text-muted-foreground">{t('noUpcomingLessons')}</p>
                <Button type="button" variant="outline" className="min-h-10 rounded-lg" onClick={onOpenSchedule}>
                  <CalendarClock className="mr-1.5 size-4" />
                  {t('openSchedule')}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card
          className={cn(
            'min-w-0 border',
            pendingLessons.length > 0 ? TEACHER_TONE_CLASS.warning : 'border-border/70',
          )}
        >
          <CardContent className={cn('flex h-full flex-col justify-between gap-3', TEACHER_CARD_PADDING)}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    'flex size-9 items-center justify-center rounded-xl',
                    pendingLessons.length > 0 ? TEACHER_TONE_ICON_CLASS.warning : TEACHER_TONE_ICON_CLASS.success,
                  )}
                >
                  {pendingLessons.length > 0 ? (
                    <ListChecks className="size-4" />
                  ) : (
                    <CheckCircle2 className="size-4" />
                  )}
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('attendanceBacklogTitle')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('lessonsTodayCount').replace('{count}', String(todayCount))}
                  </p>
                </div>
              </div>
              <span className="text-3xl font-bold leading-none tabular-nums text-foreground">
                {pendingLessons.length}
              </span>
            </div>

            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {oldestPending
                  ? t('attendanceBacklogOldest').replace(
                      '{date}',
                      formatAcademyDate(oldestPending.scheduledAt, language, {
                        day: 'numeric',
                        month: 'short',
                      }),
                    )
                  : t('attendanceBacklogClear')}
              </p>

              {pendingLessons.length > 1 ? (
                <div className="flex flex-wrap gap-1.5">
                  {pendingLessons.slice(0, 3).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onOpenAttendance(String(item.id))}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/70 bg-background/90 px-2 py-1 text-left text-[11px] font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-background"
                    >
                      <span className="truncate">{item.groupName || item.topic}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {formatAcademyDate(item.scheduledAt, language, {
                          day: '2-digit',
                          month: '2-digit',
                        })}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {oldestPending ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-10 w-full shrink-0 rounded-lg bg-background text-xs font-medium"
                onClick={() => onOpenAttendance(String(oldestPending.id))}
              >
                <ClipboardCheck className="mr-1.5 size-3.5" />
                {t('jumpToNextAttendance')}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {todayLessons.length > 0 ? (
        <Card className="border-border/70">
          <CardContent className="p-3 sm:px-4">
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CalendarClock className="size-4 text-primary" />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('teacherTodayScheduleTitle')}
                </span>
                <Badge variant="secondary" className="h-5 px-1.5 text-[11px] tabular-nums">
                  {todayLessons.length}
                </Badge>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={onOpenSchedule}
              >
                {t('openSchedule')}
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {todayLessons.map((lesson) => {
                const started = isLessonStarted(lesson.scheduledAt);
                const endTime = formatLessonEndTime(lesson.scheduledAt, lesson.durationMinutes, language);
                return (
                  <button
                    key={lesson.id}
                    type="button"
                    onClick={() =>
                      started
                        ? onOpenAttendance(String(lesson.id))
                        : onOpenLessonInSchedule(String(lesson.id))
                    }
                    className={cn(
                      'group flex flex-col justify-between gap-1.5 rounded-xl border p-3 text-left transition-all hover:border-primary/40 hover:shadow-xs',
                      lesson.status === 'conducted'
                        ? 'border-emerald-500/25 bg-emerald-500/[0.04]'
                        : started
                          ? 'border-amber-500/35 bg-amber-500/[0.06]'
                          : 'border-border/70 bg-muted/20 hover:bg-muted/40',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold tabular-nums text-foreground">
                        {formatAcademyDate(lesson.scheduledAt, language, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {endTime ? ` – ${endTime}` : ''}
                      </span>
                      <LessonStatusBadge status={lesson.status} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground group-hover:text-primary">
                        {lesson.groupName || t('noGroup')}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{lesson.topic}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
