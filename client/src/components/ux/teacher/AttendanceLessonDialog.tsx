import { DateTimeInput } from '@/components/ui/date-time-input';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Loader2,
  MessageSquare,
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
import { LessonStaffSection } from '@/features/lesson-staff/LessonStaffSection';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/ux/EmptyState';
import { CompactModalSection } from '@/components/ux/CompactModalSection';
import { LessonStatusBadge } from '@/components/ux/teacher/TeacherStatusBadge';
import { useTranslation } from '@/hooks/useTranslation';
import { formatAcademyDate } from '@/lib/localeFormat';
import {
  TEACHER_TONE_CLASS,
  attendancePercentTone,
  getInitials,
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
  noteDirty: boolean;
  hasDivergingNotes: boolean;
  onNoteChange: (value: string) => void;
  onToggleStudent: (studentId: number, status: AttendanceStatus) => void;
  onSave: () => void;
  canSave: boolean;
  isSaving: boolean;
  isRosterPending: boolean;
  isRosterError: boolean;
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
  canReschedule: boolean;
  isRescheduling: boolean;
  onConfirmReschedule: () => void;
  rescheduleConfirmOpen: boolean;
  onRescheduleConfirmOpenChange: (open: boolean) => void;
  onStaffPendingChange?: (pending: boolean) => void;
}

/**
 * A checklist a teacher works through standing at a whiteboard, usually on a
 * phone. Three things drive the layout: the modal is a flex column so the save
 * button can never be pushed off-screen by a long topic; attendance controls
 * stay easy to tap, and the roster answers arrow keys plus P/A so a
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
    noteDirty,
    hasDivergingNotes,
    onNoteChange,
    onToggleStudent,
    onSave,
    canSave,
    isSaving,
    isRosterPending,
    isRosterError,
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
    canReschedule,
    isRescheduling,
    onConfirmReschedule,
    rescheduleConfirmOpen,
    onRescheduleConfirmOpenChange,
    onStaffPendingChange,
  } = props;

  const { t, language } = useTranslation();
  const rowRefs = useRef<Array<HTMLLIElement | null>>([]);
  const [activeRowIndex, setActiveRowIndex] = useState(0);
  const [noteOverwriteConfirmOpen, setNoteOverwriteConfirmOpen] = useState(false);

  const firstUnmarkedIndex = students.findIndex((student) => draft[student.id] === undefined);

  useEffect(() => {
    rowRefs.current.length = students.length;
    setActiveRowIndex(0);
  }, [students.length]);

  useEffect(() => {
    setNoteOverwriteConfirmOpen(false);
  }, [open, lesson?.id]);

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

  const unmarkedCount = students.filter(student => !draft[student.id]).length;
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
        <DialogContent className="compact-modal flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-1.5rem)] max-w-3xl flex-col overflow-hidden p-0 sm:w-[calc(100vw-3rem)]">
          <DialogHeader className="compact-modal-header">
            <div className="flex items-start gap-2.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
                <ClipboardCheck className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={cn('block max-w-full truncate rounded-lg border', TEACHER_TONE_CLASS.accent)}
                  >
                    {lesson?.groupName || t('noGroup')}
                  </Badge>
                  {lesson ? <LessonStatusBadge status={lesson.status} /> : null}
                </div>
                <DialogTitle className="text-base font-semibold leading-6">
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
                  ) : null}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="compact-modal-body flex-1 space-y-3 overflow-y-auto">
            {lesson ? <LessonStaffSection key={lesson.id} lessonId={lesson.id}
              editable={['scheduled', 'conducted'].includes(lesson.status)} disabled={mutationPending}
              onPendingChange={onStaffPendingChange} /> : null}
            {isRosterPending ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full rounded-lg" />
                <Skeleton className="h-14 w-full rounded-lg" />
                <Skeleton className="h-14 w-full rounded-lg" />
                <Skeleton className="h-14 w-full rounded-lg" />
              </div>
            ) : null}

            {isRosterError ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-card p-3">
                <p role="alert" className="text-sm font-medium text-destructive">{t('attendanceRosterLoadFailed')}</p>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 rounded-md text-xs"
                  disabled={mutationPending}
                  onClick={onRetryRoster}
                >
                  {t('retry')}
                </Button>
              </div>
            ) : null}

            {!isRosterPending && !isRosterError && students.length > 0 ? (
              <>
                <CompactModalSection title={t('attendanceChecklist')} icon={ClipboardCheck} tone="teal" count={students.length} collapsible={false}>
                  <ul
                    className="space-y-1.5"
                    aria-label={t('groupStudentsCount').replace('{count}', String(students.length))}
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
                            'flex flex-col gap-2 rounded-lg border px-3 py-2 transition-colors sm:flex-row sm:items-center sm:justify-between',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            status === 'present' && 'border-emerald-500/40 bg-emerald-500/[0.06]',
                            status === 'absent' && 'border-rose-500/40 bg-rose-500/[0.06]',
                            !status && 'border-border-strong bg-background',
                          )}
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className={cn(
                              'flex size-8 shrink-0 items-center justify-center rounded-md border text-xs font-semibold',
                              status === 'present' && TEACHER_TONE_CLASS.success,
                              status === 'absent' && TEACHER_TONE_CLASS.danger,
                              !status && TEACHER_TONE_CLASS.accent,
                            )}>
                              {getInitials(name)}
                            </span>
                            <div className="min-w-0 space-y-0.5">
                              <p className="break-words text-sm font-semibold leading-tight text-foreground">
                                {name}
                              </p>
                              <span className={cn(
                                'inline-flex items-center rounded border px-1 py-0.5 text-[10px] font-medium tabular-nums',
                                TEACHER_TONE_CLASS[attendancePercentTone(percent)],
                              )}>
                                {t('attendanceRateShort').replace('{percent}', String(percent))}
                              </span>
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              disabled={mutationPending}
                              tabIndex={-1}
                              onClick={() => onToggleStudent(student.id, 'present')}
                              aria-pressed={status === 'present'}
                              className={cn(
                                'min-h-11 flex-1 rounded-md px-3 text-xs font-semibold sm:h-9 sm:min-h-9 sm:flex-none',
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
                                'min-h-11 flex-1 rounded-md px-3 text-xs font-semibold sm:h-9 sm:min-h-9 sm:flex-none',
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
                </CompactModalSection>

                <CompactModalSection title={t('lessonNoteLabel')} icon={MessageSquare} tone="violet" summary={note} disabled={mutationPending}>
                  <Label htmlFor="attendance-note" className="sr-only">{t('lessonNoteLabel')}</Label>
                  <Textarea
                    id="attendance-note"
                    value={note}
                    disabled={mutationPending}
                    onChange={(event) => onNoteChange(event.target.value)}
                    rows={2}
                    className="min-h-20 text-sm"
                  />
                </CompactModalSection>
              </>
            ) : null}

            {!isRosterPending && !isRosterError && students.length === 0 && lesson ? (
              <div className="rounded-lg border border-border-strong bg-card p-3">
                <EmptyState
                  icon={Users}
                  className="py-4"
                  title={t('noStudents')}
                />
              </div>
            ) : null}

            {!isRosterPending && !isRosterError && lesson && lesson.canManageLesson !== false
              && (lesson.status === 'scheduled' || lesson.status === 'conducted') ? (
              <CompactModalSection
                title={t('lessonRescheduling')}
                icon={Calendar}
                tone="amber"
                open={rescheduleOpen}
                onOpenChange={onRescheduleOpenChange}
                disabled={mutationPending}
                contentClassName="space-y-3"
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="reschedule-at" className="font-medium">{t('newLessonDate')}</Label>
                    <DateTimeInput
                      id="reschedule-at"
                      value={rescheduleAt}
                      disabled={mutationPending}
                      onValueChange={onRescheduleAtChange}
                      className="text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="reschedule-reason" className="font-medium">{t('rescheduleReason')}</Label>
                    <Input
                      id="reschedule-reason"
                      value={rescheduleReason}
                      maxLength={500}
                      disabled={mutationPending}
                      onChange={(event) => onRescheduleReasonChange(event.target.value)}
                      className="text-sm"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 rounded-md text-xs font-medium"
                    onClick={() => onRescheduleConfirmOpenChange(true)}
                    disabled={!canReschedule || mutationPending}
                  >
                    <Calendar className="mr-1.5 size-3.5" />
                    {isRescheduling ? t('saving') : t('rescheduleLesson')}
                  </Button>
                </div>
              </CompactModalSection>
            ) : null}
          </div>

          {!isRosterPending && !isRosterError && students.length > 0 ? (
            <div className="compact-modal-footer space-y-2">
              {blocking ? (
                <div
                  className="flex items-center gap-2 text-xs"
                  aria-live="polite"
                >
                  <span className="min-w-0 flex-1">{blocking.message}</span>
                  {blocking.canJump ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0 rounded-md bg-background text-xs"
                      onClick={() => focusRow(firstUnmarkedIndex)}
                    >
                      {t('goToUnmarkedStudent')}
                    </Button>
                  ) : null}
                </div>
              ) : null}

              <Button
                className="min-h-9 w-full rounded-md py-2 text-sm font-semibold"
                onClick={() => {
                  if (hasDivergingNotes && noteDirty) setNoteOverwriteConfirmOpen(true);
                  else onSave();
                }}
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

      <AlertDialog open={open && noteOverwriteConfirmOpen} onOpenChange={setNoteOverwriteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('lessonNoteOverwriteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('lessonNoteOverwriteConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={mutationPending || !canSave}
              onClick={() => {
                if (!mutationPending && canSave) onSave();
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
          {lesson?.status === 'conducted' ? (
            <p className="text-sm text-destructive">
              {t('rescheduleConductedWarning')}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRescheduling}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                onConfirmReschedule();
              }}
              disabled={isRescheduling}
            >
              {isRescheduling ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
              {isRescheduling ? t('saving') : t('rescheduleLesson')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
