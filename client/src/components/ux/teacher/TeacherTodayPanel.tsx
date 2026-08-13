import { CalendarClock, ClipboardCheck, ListChecks, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LessonStatusBadge } from '@/components/ux/teacher/TeacherStatusBadge';
import { useTranslation } from '@/hooks/useTranslation';
import { formatAcademyDate } from '@/lib/localeFormat';
import {
  TEACHER_CARD_PADDING,
  TEACHER_TONE_CLASS,
  TEACHER_TONE_ICON_CLASS,
  type TeacherLesson,
} from '@/lib/teacherModule';
import { cn } from '@/lib/utils';

interface TeacherTodayPanelProps {
  focusLesson: TeacherLesson | null;
  isLessonLive: boolean;
  todayCount: number;
  pendingLessons: TeacherLesson[];
  onOpenAttendance: (lessonId: string) => void;
  onOpenLessonInSchedule: (lessonId: string) => void;
  onOpenSchedule: () => void;
}

/**
 * The overview opened on a wall of period analytics and answered none of the
 * questions a teacher actually has at 9am. This strip goes first and answers
 * all three: what is next, how much is left today, and what still has no
 * attendance recorded — each with a single click to act on it.
 *
 * The primary button is chosen from the lesson's own state rather than being
 * fixed. Offering "attendance checklist" for a lesson two hours away opened a
 * modal whose save button is disabled by definition — the exact dead click the
 * panel exists to remove.
 */
export function TeacherTodayPanel({
  focusLesson,
  isLessonLive,
  todayCount,
  pendingLessons,
  onOpenAttendance,
  onOpenLessonInSchedule,
  onOpenSchedule,
}: TeacherTodayPanelProps) {
  const { t, language } = useTranslation();
  const oldestPending = pendingLessons[0] ?? null;

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <Card className="min-w-0 border-border/70 lg:col-span-2">
        <CardContent className={cn('flex h-full flex-col gap-3', TEACHER_CARD_PADDING)}>
          <div className="flex items-center gap-2">
            <span className={cn(
              'flex size-8 items-center justify-center rounded-lg',
              isLessonLive ? TEACHER_TONE_ICON_CLASS.success : TEACHER_TONE_ICON_CLASS.accent,
            )}>
              {isLessonLive ? <Radio className="size-4" /> : <CalendarClock className="size-4" />}
            </span>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {isLessonLive ? t('lessonInProgressTitle') : t('nextLessonTitle')}
            </p>
          </div>

          {focusLesson ? (
            <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-3xl font-bold leading-none tabular-nums text-foreground">
                    {formatAcademyDate(focusLesson.scheduledAt, language, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {formatAcademyDate(focusLesson.scheduledAt, language, {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'long',
                    })}
                  </span>
                  <LessonStatusBadge status={focusLesson.status} />
                </div>
                <p className="truncate text-sm font-semibold text-foreground">
                  {focusLesson.groupName || t('noGroup')}
                </p>
                <p className="truncate text-sm text-muted-foreground">{focusLesson.topic}</p>
                {/* Says why the checklist is not on offer, at the point where
                    the user would otherwise go looking for it. */}
                {isLessonLive ? null : (
                  <p className="text-xs text-muted-foreground">
                    {t('attendanceAvailableAfterLessonStart')}
                  </p>
                )}
              </div>
              {isLessonLive ? (
                <Button
                  type="button"
                  className="min-h-11 shrink-0 rounded-lg"
                  onClick={() => onOpenAttendance(String(focusLesson.id))}
                >
                  <ClipboardCheck className="mr-1.5 size-4" />
                  {t('attendanceChecklist')}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 shrink-0 rounded-lg"
                  onClick={() => onOpenLessonInSchedule(String(focusLesson.id))}
                >
                  <CalendarClock className="mr-1.5 size-4" />
                  {t('openLessonInSchedule')}
                </Button>
              )}
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-start justify-center gap-3">
              <p className="text-sm text-muted-foreground">{t('noUpcomingLessons')}</p>
              <Button type="button" variant="outline" className="min-h-11 rounded-lg" onClick={onOpenSchedule}>
                {t('openSchedule')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className={cn('min-w-0 border', pendingLessons.length > 0 ? TEACHER_TONE_CLASS.warning : 'border-border/70')}>
        <CardContent className={cn('flex h-full flex-col gap-3', TEACHER_CARD_PADDING)}>
          <div className="flex items-center gap-2">
            <span className={cn(
              'flex size-8 items-center justify-center rounded-lg',
              pendingLessons.length > 0 ? TEACHER_TONE_ICON_CLASS.warning : TEACHER_TONE_ICON_CLASS.neutral,
            )}>
              <ListChecks className="size-4" />
            </span>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('attendanceBacklogTitle')}
            </p>
          </div>

          <div className="flex flex-1 items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-3xl font-bold leading-none tabular-nums text-foreground">
                {pendingLessons.length}
              </p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t('lessonsTodayCount').replace('{count}', String(todayCount))}
              </p>
            </div>
            {oldestPending ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-11 shrink-0 rounded-lg bg-background text-xs"
                onClick={() => onOpenAttendance(String(oldestPending.id))}
              >
                {t('jumpToNextAttendance')}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
