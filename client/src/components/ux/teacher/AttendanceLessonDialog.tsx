import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock3,
  Users,
  XCircle,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/ux/EmptyState';
import { LessonStatusBadge } from '@/components/ux/teacher/TeacherStatusBadge';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useTranslation } from '@/hooks/useTranslation';
import { formatAcademyDate } from '@/lib/localeFormat';
import {
  TEACHER_CARD_PADDING,
  TEACHER_TONE_CLASS,
  attendancePercentTone,
  getInitials,
  teacherPercent,
  type TeacherAttendanceDraft,
  type TeacherLesson,
  type TeacherStudent,
} from '@/lib/teacherModule';
import { cn } from '@/lib/utils';

export type AttendanceStatus = 'present' | 'absent';

export interface AttendanceLessonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lesson?: TeacherLesson;
  students: TeacherStudent[];
  draft: TeacherAttendanceDraft;
  note: string;
  hasDivergingNotes: boolean;
  onNoteChange: (value: string) => void;
  onToggleStudent: (studentId: number, status: AttendanceStatus) => void;
  onSetAll: (status: AttendanceStatus) => void;
  onSave: () => void;
  canSave: boolean;
  isSaving: boolean;
  isRosterPending: boolean;
  isRosterError: boolean;
  rosterErrorMessage: string;
  onRetryRoster: () => void;
  mutationPending: boolean;
  lessonHasStarted: boolean;
  hasPreviousIncompleteLesson: boolean;
  rescheduleOpen: boolean;
  onRescheduleOpenChange: (open: boolean) => void;
  rescheduleAt: string;
  onRescheduleAtChange: (value: string) => void;
  rescheduleReason: string;
  onRescheduleReasonChange: (value: string) => void;
  rescheduleAtDate: Date | null;
  rescheduleMin: string;
  canReschedule: boolean;
  isRescheduling: boolean;
  onConfirmReschedule: () => void;
  rescheduleConfirmOpen: boolean;
  onRescheduleConfirmOpenChange: (open: boolean) => void;
  bulkConfirmStatus: AttendanceStatus | null;
  onBulkConfirmChange: (status: AttendanceStatus | null) => void;
  onRequestSetAll: (status: AttendanceStatus) => void;
}

/**
 * A checklist a teacher works through standing at a whiteboard, usually on a
 * phone. Three things drive the layout: the modal is a flex column so the save
 * button can never be pushed off-screen by a long topic or a warning banner;
 * every control clears 44px; and the roster answers arrow keys plus P/A so a
 * group of fifteen can be marked without touching the screen at all.
 */
export function AttendanceLessonDialog(props: AttendanceLessonDialogProps) {
  const {
    open,
    onOpenChange,
    lesson,
    students,
    draft,
    note,
    hasDivergingNotes,
    onNoteChange,
    onToggleStudent,
    onSave,
    canSave,
    isSaving,
    isRosterPending,
    isRosterError,
    rosterErrorMessage,
    onRetryRoster,
    mutationPending,
    lessonHasStarted,
    hasPreviousIncompleteLesson,
    rescheduleOpen,
    onRescheduleOpenChange,
    rescheduleAt,
    onRescheduleAtChange,
    rescheduleReason,
    onRescheduleReasonChange,
    rescheduleAtDate,
    rescheduleMin,
    canReschedule,
    isRescheduling,
    onConfirmReschedule,
    rescheduleConfirmOpen,
    onRescheduleConfirmOpenChange,
    bulkConfirmStatus,
    onBulkConfirmChange,
    onRequestSetAll,
    onSetAll,
  } = props;

  const { t, language } = useTranslation();
  const rescheduleBodyId = useId();
  const keyboardHintId = useId();
  const rowRefs = useRef<Array<HTMLLIElement | null>>([]);
  const [activeRowIndex, setActiveRowIndex] = useState(0);
  // The hint costs a line of a phone modal and describes keys that device does
  // not have.
  const hasKeyboardPointer = useMediaQuery('(pointer: fine)');

  const summary = useMemo(() => {
    let marked = 0;
    let present = 0;
    let absent = 0;
    for (const student of students) {
      const status = draft[student.id];
      if (!status) continue;
      marked += 1;
      if (status === 'present') present += 1;
      else absent += 1;
    }
    return { total: students.length, marked, present, absent };
  }, [draft, students]);

  const firstUnmarkedIndex = students.findIndex((student) => draft[student.id] === undefined);

  useEffect(() => {
    rowRefs.current.length = students.length;
    setActiveRowIndex(0);
  }, [students.length]);

  /* Roving tabindex. Fifteen students used to mean 15 rows plus 30 buttons —
     45 stops between the modal header and the Save button. Exactly one row is
     tabbable at a time and the buttons inside are taken out of the tab order;
     arrows move within the list, P/A act on the focused row. */
  const activeIndex = Math.min(activeRowIndex, Math.max(students.length - 1, 0));

  const focusRow = useCallback((index: number) => {
    const clamped = Math.min(Math.max(index, 0), Math.max(students.length - 1, 0));
    setActiveRowIndex(clamped);
    rowRefs.current[clamped]?.focus();
  }, [students.length]);

  const handleRosterFocus = useCallback((event: React.FocusEvent<HTMLUListElement>) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-row-index]');
    const index = Number(row?.dataset.rowIndex ?? '-1');
    if (Number.isInteger(index) && index >= 0) setActiveRowIndex(index);
  }, []);

  const handleRosterKeyDown = useCallback((event: React.KeyboardEvent<HTMLUListElement>) => {
    /* Every browser and OS shortcut is a modifier combination, and this list
       swallowed two of the most common ones: Cmd+A silently marked a student
       absent instead of selecting text, Cmd+P marked them present instead of
       printing. A single-key mode must never claim a chord. */
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const target = event.target as HTMLElement;
    // Typing a comment inside the row must stay typing.
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;

    const row = target.closest<HTMLElement>('[data-row-index]');
    const index = Number(row?.dataset.rowIndex ?? '-1');
    if (!Number.isInteger(index) || index < 0) return;

    if (event.code === 'ArrowDown') {
      event.preventDefault();
      focusRow(index + 1);
      return;
    }
    if (event.code === 'ArrowUp') {
      event.preventDefault();
      focusRow(index - 1);
      return;
    }
    if (event.code === 'Home') {
      event.preventDefault();
      focusRow(0);
      return;
    }
    if (event.code === 'End') {
      event.preventDefault();
      focusRow(students.length - 1);
      return;
    }
    // `code` rather than `key` so the shortcut survives a Cyrillic layout.
    if (event.code === 'KeyP' || event.code === 'KeyA') {
      event.preventDefault();
      const student = students[index];
      if (!student || mutationPending) return;
      onToggleStudent(student.id, event.code === 'KeyP' ? 'present' : 'absent');
      focusRow(index + 1);
    }
  }, [focusRow, mutationPending, onToggleStudent, students]);

  const unmarkedCount = Math.max(summary.total - summary.marked, 0);
  const blocking = (() => {
    if (!lesson) return null;
    if (lesson.status === 'scheduled' && !lessonHasStarted) {
      return { message: t('attendanceAvailableAfterLessonStart'), canJump: false };
    }
    if (hasPreviousIncompleteLesson) {
      return { message: t('previousLessonMustBeCompleted'), canJump: false };
    }
    if (firstUnmarkedIndex >= 0) {
      return {
        message: t('attendanceUnmarkedRemaining').replace('{count}', String(unmarkedCount)),
        canJump: true,
      };
    }
    return null;
  })();

  const lessonTitle = lesson?.topic || t('attendanceChecklist');

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-1.5rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:w-[calc(100vw-3rem)]">
          <DialogHeader className="shrink-0 space-y-2 border-b border-border/60 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent py-4 pl-4 pr-12 text-left sm:pl-6 sm:pr-14">
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
                <ClipboardCheck className="size-6" />
              </span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={cn('block max-w-full truncate rounded-lg border', TEACHER_TONE_CLASS.accent)}
                  >
                    {lesson?.groupName || t('noGroup')}
                  </Badge>
                  {lesson ? <LessonStatusBadge status={lesson.status} /> : null}
                </div>
                <DialogTitle className="text-lg font-bold tracking-tight sm:text-xl">
                  {lessonTitle}
                </DialogTitle>
                <DialogDescription className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  {lesson ? (
                    <>
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <Calendar className="size-3.5 text-primary" />
                        {formatAcademyDate(lesson.scheduledAt, language, {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })}
                      </span>
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <Clock3 className="size-3.5 text-primary" />
                        {formatAcademyDate(lesson.scheduledAt, language, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span className="inline-flex items-center gap-1.5 font-medium tabular-nums">
                        {t('durationMinutesValue').replace('{count}', String(lesson.durationMinutes))}
                      </span>
                      {lesson.courseName ? (
                        <span className="inline-flex items-center gap-1.5 font-medium">
                          <BookOpen className="size-3.5 text-primary" />
                          {lesson.courseName}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    t('attendanceCalendarHint')
                  )}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
            {isRosterPending ? (
              <div className="space-y-3">
                <Skeleton className="h-20 w-full rounded-xl" />
                <Skeleton className="h-16 w-full rounded-xl" />
                <Skeleton className="h-16 w-full rounded-xl" />
                <Skeleton className="h-16 w-full rounded-xl" />
              </div>
            ) : null}

            {isRosterError ? (
              <div className={cn('rounded-xl border border-destructive/30 bg-destructive/5 text-center', TEACHER_CARD_PADDING)}>
                <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                  <AlertTriangle className="size-6" />
                </span>
                <p className="text-base font-semibold text-destructive">{t('attendanceRosterLoadFailed')}</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{rosterErrorMessage}</p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4 min-h-11 rounded-lg px-5"
                  disabled={mutationPending}
                  onClick={onRetryRoster}
                >
                  {t('retry')}
                </Button>
              </div>
            ) : null}

            {!isRosterPending && !isRosterError && students.length > 0 ? (
              <>
                <div className={cn('space-y-3 rounded-xl border border-border/60 bg-muted/20', TEACHER_CARD_PADDING)}>
                  <div
                    className="flex flex-wrap items-center gap-2 text-xs font-medium"
                    aria-live="polite"
                  >
                    <Badge variant="outline" className="rounded-lg border-border/60 bg-background px-3 py-1 font-semibold tabular-nums">
                      {t('attendanceMarkedOf')
                        .replace('{marked}', String(summary.marked))
                        .replace('{total}', String(summary.total))}
                    </Badge>
                    <Badge variant="outline" className={cn('rounded-lg border px-3 py-1 font-semibold tabular-nums', TEACHER_TONE_CLASS.success)}>
                      {t('attendancePresentCount').replace('{count}', String(summary.present))}
                    </Badge>
                    <Badge variant="outline" className={cn('rounded-lg border px-3 py-1 font-semibold tabular-nums', TEACHER_TONE_CLASS.danger)}>
                      {t('attendanceAbsentCount').replace('{count}', String(summary.absent))}
                    </Badge>
                  </div>

                  <Progress
                    value={teacherPercent(summary.marked, summary.total)}
                    className="h-2"
                    aria-label={t('attendanceMarkedOf')
                      .replace('{marked}', String(summary.marked))
                      .replace('{total}', String(summary.total))}
                  />

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Button
                      type="button"
                      variant="outline"
                      className={cn('min-h-11 rounded-lg text-xs font-medium', TEACHER_TONE_CLASS.success)}
                      disabled={mutationPending}
                      onClick={() => onRequestSetAll('present')}
                    >
                      <CheckCircle2 className="mr-1.5 size-4" />
                      {t('allPresent')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className={cn('min-h-11 rounded-lg text-xs font-medium', TEACHER_TONE_CLASS.danger)}
                      disabled={mutationPending}
                      onClick={() => onRequestSetAll('absent')}
                    >
                      <XCircle className="mr-1.5 size-4" />
                      {t('allAbsent')}
                    </Button>
                  </div>

                  {hasKeyboardPointer ? (
                    <p id={keyboardHintId} className="text-xs text-muted-foreground">
                      {t('attendanceKeyboardHint')}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2.5">
                  <h3 className="px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    {t('groupStudentsCount').replace('{count}', String(students.length))}
                  </h3>

                  <ul
                    className="space-y-2.5"
                    aria-label={t('groupStudentsCount').replace('{count}', String(students.length))}
                    aria-describedby={hasKeyboardPointer ? keyboardHintId : undefined}
                    onKeyDown={handleRosterKeyDown}
                    onFocus={handleRosterFocus}
                  >
                    {students.map((student, index) => {
                      const status = draft[student.id];
                      const percent = student.attendancePercent || 0;
                      const name = student.studentName || student.contactName;
                      const statusLabel = status === 'present'
                        ? t('present')
                        : status === 'absent'
                          ? t('absent')
                          : t('attendanceNotMarked');

                      return (
                        <li
                          key={student.id}
                          data-row-index={index}
                          data-testid={`attendance-student-row-${student.id}`}
                          role="group"
                          tabIndex={index === activeIndex ? 0 : -1}
                          aria-label={`${name}. ${statusLabel}`}
                          ref={(element) => { rowRefs.current[index] = element; }}
                          className={cn(
                            'flex flex-col gap-3 rounded-xl border p-4 transition-colors sm:flex-row sm:items-center sm:justify-between',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            status === 'present' && 'border-emerald-500/40 bg-emerald-500/[0.06]',
                            status === 'absent' && 'border-rose-500/40 bg-rose-500/[0.06]',
                            !status && 'border-border/60 bg-card',
                          )}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <span className={cn(
                              'flex size-10 shrink-0 items-center justify-center rounded-xl border text-xs font-bold',
                              status === 'present' && TEACHER_TONE_CLASS.success,
                              status === 'absent' && TEACHER_TONE_CLASS.danger,
                              !status && TEACHER_TONE_CLASS.accent,
                            )}>
                              {getInitials(name)}
                            </span>
                            <div className="min-w-0 space-y-1">
                              <p className="break-words text-sm font-semibold leading-tight text-foreground">
                                {name}
                              </p>
                              <span className={cn(
                                'inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium tabular-nums',
                                TEACHER_TONE_CLASS[attendancePercentTone(percent)],
                              )}>
                                {t('attendanceRateShort').replace('{percent}', String(percent))}
                              </span>
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                            <Button
                              type="button"
                              variant="outline"
                              disabled={mutationPending}
                              tabIndex={-1}
                              onClick={() => onToggleStudent(student.id, 'present')}
                              aria-pressed={status === 'present'}
                              className={cn(
                                'min-h-11 flex-1 rounded-lg text-xs font-semibold sm:flex-none',
                                status === 'present'
                                  ? 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-600/90 hover:text-white'
                                  : 'border-border/80 text-muted-foreground',
                              )}
                            >
                              <CheckCircle2 className="mr-1.5 size-4" />
                              {t('present')}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              disabled={mutationPending}
                              tabIndex={-1}
                              onClick={() => onToggleStudent(student.id, 'absent')}
                              aria-pressed={status === 'absent'}
                              className={cn(
                                'min-h-11 flex-1 rounded-lg text-xs font-semibold sm:flex-none',
                                status === 'absent'
                                  ? 'border-rose-600 bg-rose-600 text-white hover:bg-rose-600/90 hover:text-white'
                                  : 'border-border/80 text-muted-foreground',
                              )}
                            >
                              <XCircle className="mr-1.5 size-4" />
                              {t('absent')}
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="attendance-note" className="text-xs font-semibold text-muted-foreground">
                    {t('lessonNoteLabel')}
                  </Label>
                  <Textarea
                    id="attendance-note"
                    value={note}
                    disabled={mutationPending}
                    onChange={(event) => onNoteChange(event.target.value)}
                    placeholder={t('attendanceNotePlaceholder')}
                    rows={2}
                    className="rounded-xl text-sm"
                  />
                  <p className="text-xs text-muted-foreground">{t('lessonNoteScopeHint')}</p>
                  {/* The API writes one note onto every attendance row, so
                      individual notes that already differ are about to be
                      flattened. Say so before it happens. */}
                  {hasDivergingNotes ? (
                    <p className={cn('flex items-start gap-2 rounded-lg border p-2 text-xs', TEACHER_TONE_CLASS.warning)}>
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      <span>{t('lessonNoteOverwriteWarning')}</span>
                    </p>
                  ) : null}
                </div>
              </>
            ) : null}

            {!isRosterPending && !isRosterError && students.length === 0 && lesson ? (
              <div className={cn('rounded-xl border border-dashed border-border/80 bg-muted/10', TEACHER_CARD_PADDING)}>
                <EmptyState
                  icon={Users}
                  className="py-4"
                  title={t('noStudents')}
                  description={t('noStudentsInGroup')}
                />
              </div>
            ) : null}

            {!isRosterPending && !isRosterError && lesson
              && (lesson.status === 'scheduled' || lesson.status === 'conducted') ? (
              <div className={cn('space-y-3 rounded-xl border', TEACHER_CARD_PADDING, TEACHER_TONE_CLASS.warning)}>
                <button
                  type="button"
                  aria-expanded={rescheduleOpen}
                  aria-controls={rescheduleBodyId}
                  onClick={() => onRescheduleOpenChange(!rescheduleOpen)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex items-center gap-2">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-amber-500/15">
                      <Calendar className="size-4" />
                    </span>
                    <span>
                      <span className="block text-xs font-bold text-foreground">{t('rescheduleLesson')}</span>
                      <span className="block text-xs text-muted-foreground">{t('rescheduleLessonHint')}</span>
                    </span>
                  </span>
                  <ChevronDown className={cn('size-4 shrink-0 transition-transform', rescheduleOpen && 'rotate-180')} />
                </button>

                {rescheduleOpen ? (
                  <div id={rescheduleBodyId} className="space-y-3 border-t border-amber-500/20 pt-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="reschedule-at" className="text-xs font-medium text-muted-foreground">
                          {t('newLessonDate')}
                        </Label>
                        <Input
                          id="reschedule-at"
                          type="datetime-local"
                          min={rescheduleMin}
                          value={rescheduleAt}
                          disabled={mutationPending}
                          onChange={(event) => onRescheduleAtChange(event.target.value)}
                          className="h-11 rounded-lg text-sm"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="reschedule-reason" className="text-xs font-medium text-muted-foreground">
                          {t('rescheduleReason')}
                        </Label>
                        <Input
                          id="reschedule-reason"
                          value={rescheduleReason}
                          maxLength={500}
                          disabled={mutationPending}
                          onChange={(event) => onRescheduleReasonChange(event.target.value)}
                          placeholder={t('rescheduleReasonPlaceholder')}
                          className="h-11 rounded-lg text-sm"
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{t('rescheduleChainWarning')}</p>
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11 rounded-lg text-xs font-medium"
                        onClick={() => onRescheduleConfirmOpenChange(true)}
                        disabled={!canReschedule || mutationPending}
                      >
                        <Calendar className="mr-1.5 size-4" />
                        {isRescheduling ? t('saving') : t('rescheduleLesson')}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {!isRosterPending && !isRosterError && students.length > 0 ? (
            <div className="shrink-0 space-y-3 border-t border-border/60 bg-background/95 p-4 backdrop-blur-md sm:p-6">
              {blocking ? (
                <div
                  className={cn('flex items-center gap-2 rounded-xl border p-3 text-xs', TEACHER_TONE_CLASS.warning)}
                  aria-live="polite"
                >
                  <AlertTriangle className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1">{blocking.message}</span>
                  {blocking.canJump ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11 shrink-0 rounded-lg bg-background text-xs"
                      onClick={() => focusRow(firstUnmarkedIndex)}
                    >
                      {t('goToUnmarkedStudent')}
                    </Button>
                  ) : null}
                </div>
              ) : null}

              <Button
                className="h-12 w-full rounded-xl bg-gradient-to-r from-[var(--brand-gradient-from)] to-[var(--brand-gradient-to)] text-sm font-bold shadow-md shadow-primary/25 transition-all hover:brightness-110 active:scale-[0.99]"
                onClick={onSave}
                disabled={mutationPending || !canSave}
              >
                {isSaving
                  ? t('saving')
                  : lesson?.status === 'conducted'
                    ? t('updateAttendance')
                    : t('finishLessonAndSaveAttendance')}
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={bulkConfirmStatus !== null} onOpenChange={(next) => { if (!next) onBulkConfirmChange(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-amber-500" />
              {t('bulkAttendanceConfirmTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('bulkAttendanceConfirmDesc')
                .replace('{marked}', String(summary.marked))
                .replace('{total}', String(summary.total))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => onBulkConfirmChange(null)}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (bulkConfirmStatus) onSetAll(bulkConfirmStatus);
                onBulkConfirmChange(null);
              }}
            >
              {t('confirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={rescheduleConfirmOpen} onOpenChange={onRescheduleConfirmOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-amber-500" />
              {t('rescheduleConfirmTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('rescheduleConfirmDesc')
                .replace('{from}', lesson
                  ? formatAcademyDate(lesson.scheduledAt, language, {
                    day: 'numeric',
                    month: 'long',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                  : '')
                .replace('{to}', rescheduleAtDate
                  ? formatAcademyDate(rescheduleAtDate, language, {
                    day: 'numeric',
                    month: 'long',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                  : '')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className={cn('rounded-xl border p-3 text-xs', TEACHER_TONE_CLASS.warning)}>
            {t('rescheduleChainWarning')}
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmReschedule}>
              {t('rescheduleLesson')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
