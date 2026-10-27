import { TimePicker } from '@/components/ui/time-picker';
import { useUnsavedChangesGuard, UnsavedChangesDialog } from '@/components/ux/UnsavedChangesGuard';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  CalendarClock,
  ClipboardList,
  History,
  MessageSquare,
  MapPin,
  Pencil,
  UsersRound,
  X,
} from 'lucide-react';
import {
  DEMO_NOT_CONDUCTED_REASON_CODES,
  DEMO_NO_SHOW_REASON_CODES,
  type DemoLessonOutcome,
  type DemoNotConductedReasonCode,
  type DemoNoShowReasonCode,
} from '@shared/contracts/demo-lessons';
import { DemoReminderStatus } from '@/features/demo-lessons/ui/DemoReminderStatus';
import { EmployeeIdentity } from '@/components/ux/EmployeeIdentity';
import { CompactModalSection } from '@/components/ux/CompactModalSection';
import {
  AlertDialogBody,
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
import { CopyButton } from '@/components/ui/copy-button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  demoLessonQueryKeys,
  demoLessonsApi,
  teacherDemoLessonsApi,
  type DemoLesson,
  type DemoLessonParticipant,
} from '@/features/demo-lessons/api';
import { invalidateSalesLeadData } from '@/features/sales/queries';
import {
  academyDateInputValue,
  academyInstant,
  academyTimeOfDay,
  academyToday,
  formatAcademyDate,
} from '@/lib/localeFormat';
import { submitOnEnter } from '@/lib/submitOnEnter';
import { primaryVisibleLeadPhone } from '@/lib/leadContact';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import type { TranslationKey } from '@/lib/i18n';
import { OrbitSpinner } from '@/components/ui/orbit-spinner';

interface DemoLessonDetailsDialogProps {
  demo: DemoLesson | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: (demo: DemoLesson) => void;
  /**
   * Opens a participant's lead card on top of this dialog. Left out where the
   * host has nowhere to show a lead, which turns participants back into plain text.
   */
  onOpenLead?: (leadId: number) => void;
  context?: 'sales' | 'teacher';
}

type AttendanceStatus = 'attended' | 'no_show' | '';

interface NoShowReasonDraft {
  code: DemoNoShowReasonCode;
  note: string;
}

export function DemoLessonDetailsDialog({
  demo,
  open,
  onOpenChange,
  onChanged,
  onOpenLead,
  context = 'sales',
}: DemoLessonDetailsDialogProps) {
  const { t, language } = useTranslation();
  const queryClient = useQueryClient();
  const attendanceApi = context === 'teacher' ? teacherDemoLessonsApi : demoLessonsApi;
  const noShowReasonLabels: Record<DemoNoShowReasonCode, string> = {
    no_contact: t('demoNoShowReasonNoContact'),
    forgot: t('demoNoShowReasonForgot'),
    reschedule_requested: t('demoNoShowReasonRescheduleRequested'),
    illness_or_emergency: t('demoNoShowReasonIllnessOrEmergency'),
    could_not_reach_location: t('demoNoShowReasonCouldNotReachLocation'),
    technical_issue: t('demoNoShowReasonTechnicalIssue'),
    not_interested: t('demoNoShowReasonNotInterested'),
    other: t('demoNoShowReasonOther'),
  };
  const notConductedReasonLabels: Record<DemoNotConductedReasonCode, string> = {
    teacher_unavailable: t('demoNotConductedReasonTeacherUnavailable'),
    participants_absent: t('demoNotConductedReasonParticipantsAbsent'),
    client_requested_change: t('demoNotConductedReasonClientRequestedChange'),
    room_unavailable: t('demoNotConductedReasonRoomUnavailable'),
    technical_issue: t('demoNoShowReasonTechnicalIssue'),
    organizational_issue: t('demoNotConductedReasonOrganizationalIssue'),
    emergency: t('demoNotConductedReasonEmergency'),
    other: t('archiveReasonOther'),
  };
  const [attendance, setAttendance] = useState<Record<number, AttendanceStatus>>({});
  const [noShowReasons, setNoShowReasons] = useState<Record<number, NoShowReasonDraft>>({});
  const [dirtyParticipantIds, setDirtyParticipantIds] = useState<Set<number>>(new Set());
  const unsavedGuard = useUnsavedChangesGuard({ open, isDirty: dirtyParticipantIds.size > 0, onOpenChange });
  const [reasonParticipantId, setReasonParticipantId] = useState<number | null>(null);
  const [reasonCode, setReasonCode] = useState<DemoNoShowReasonCode | ''>('');
  const [reasonNote, setReasonNote] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const cancelSubmitting = useRef(false);
  const [conductedConfirmOpen, setConductedConfirmOpen] = useState(false);
  const [notConductedOpen, setNotConductedOpen] = useState(false);
  const [notConductedReasonCode, setNotConductedReasonCode] = useState<DemoNotConductedReasonCode | ''>('');
  const [notConductedReasonNote, setNotConductedReasonNote] = useState('');
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [changeTeacherOpen, setChangeTeacherOpen] = useState(false);
  const [teacherDraftId, setTeacherDraftId] = useState('');
  const [participantToRemove, setParticipantToRemove] = useState<DemoLessonParticipant | null>(null);
  const draftIdentity = demo ? JSON.stringify({
    ...demo, participants: demo.participants.map(({
      reminderResponse: _reminderResponse, reminderRespondedAt: _reminderRespondedAt,
      reminderDeliveryStatus: _reminderDeliveryStatus, reminderDeliveredAt: _reminderDeliveredAt,
      reminderProgressStatus: _reminderProgressStatus, reminderRuns: _reminderRuns, ...participant
    }) => participant)
  }) : null;
  const draftIdentityRef = useRef<string | null>(null);

  const teacherOptions = useQuery({
    queryKey: [...demoLessonQueryKeys.teacherOptions, demo?.id ?? 0],
    queryFn: () => demoLessonsApi.teacherOptions(Number(demo?.id)),
    enabled: Boolean(
      open
      && changeTeacherOpen
      && demo
      && demo.status === 'scheduled'
      && demo.canManage !== false,
    ),
    retry: false,
  });

  useEffect(() => {
    if (!open || context !== 'sales' || !demo?.id) return;
    let active = true;
    const refresh = () => {
      if (!active) return;
      void queryClient.refetchQueries({ queryKey: demoLessonQueryKeys.all, type: 'active' }, { cancelRefetch: false });
    };
    void Promise.resolve().then(refresh);
    const timer = window.setInterval(refresh, 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [context, demo?.id, open, queryClient]);

  useEffect(() => {
    if (!demo || !open) { draftIdentityRef.current = null; return; }
    if (draftIdentityRef.current === draftIdentity) return;
    draftIdentityRef.current = draftIdentity;
    setAttendance(Object.fromEntries(demo.participants.map((participant) => [
      participant.id,
      participant.status === 'attended' || participant.status === 'no_show'
        ? participant.status
        : '',
    ])));
    setNoShowReasons(Object.fromEntries(demo.participants.flatMap((participant) => (
      participant.noShowReasonCode
        ? [[participant.id, {
          code: participant.noShowReasonCode,
          note: participant.noShowReasonNote ?? '',
        }]]
        : []
    ))));
    setDirtyParticipantIds(new Set());
    setReasonParticipantId(null);
    setReasonCode('');
    setReasonNote('');
    setCancelReason('');
    setCancelOpen(false);
    setConductedConfirmOpen(false);
    setNotConductedOpen(false);
    setNotConductedReasonCode('');
    setNotConductedReasonNote('');
    setRescheduleOpen(false);
    setRescheduleDate(academyDateInputValue(demo.scheduledAt));
    setRescheduleTime(academyTimeOfDay(demo.scheduledAt));
    setRescheduleReason('');
    setChangeTeacherOpen(false);
    setTeacherDraftId(String(demo.teacherId));
    setParticipantToRemove(null);
  }, [demo, draftIdentity, open]);

  const invalidate = async (updated: DemoLesson) => {
    await Promise.all([
      invalidateSalesLeadData(queryClient),
      queryClient.invalidateQueries({ queryKey: demoLessonQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: demoLessonQueryKeys.availability }),
      queryClient.invalidateQueries({ queryKey: demoLessonQueryKeys.resourceAvailability }),
      queryClient.invalidateQueries({ queryKey: demoLessonQueryKeys.teacherOptions }),
      queryClient.invalidateQueries({ queryKey: demoLessonQueryKeys.teacher }),
    ]);
    onChanged?.(updated);
  };

  const saveAttendance = useMutation({
    mutationFn: () => attendanceApi.saveAttendance(Number(demo?.id), {
      participants: Array.from(dirtyParticipantIds).flatMap((participantId) => {
        const status = attendance[participantId];
        if (!status) return [];
        const reason = noShowReasons[participantId];
        return [{
          participantId,
          status,
          result: null,
          noShowReasonCode: status === 'no_show' ? reason?.code ?? null : null,
          noShowReasonNote: status === 'no_show' ? reason?.note.trim() || null : null,
        }];
      }),
    }),
    onSuccess: async (updated) => {
      setDirtyParticipantIds(new Set());
      await invalidate(updated);
      toast({ title: t('demoAttendanceSaved') });
    },
    onError: (error: Error) => toast({
      title: t('demoAttendanceSaveFailed'),
      description: error.message === 'demoNoShowReasonRequired'
        ? t('demoNoShowReasonRequired')
        : error.message === 'demoNoShowOtherNoteRequired'
          ? t('demoNoShowOtherNoteRequired')
          : error.message === 'demoNoShowReasonOnlyForAbsence'
            ? t('demoNoShowReasonOnlyForAbsence')
            : error.message,
      variant: 'destructive',
    }),
  });

  const cancelDemo = useMutation({
    mutationFn: () => demoLessonsApi.cancel(Number(demo?.id), cancelReason.trim()),
    onSuccess: async (updated) => {
      await invalidate(updated);
      toast({ title: t('demoLessonCancelled') });
      setCancelOpen(false);
      onOpenChange(false);
    },
    onError: (error: Error) => toast({
      title: t('demoLessonCancelFailed'),
      description: error.message,
      variant: 'destructive',
    }),
    onSettled: () => { cancelSubmitting.current = false; },
  });

  const confirmCancellation = () => {
    if (!open || !demo || !cancelReason.trim() || cancelDemo.isPending || cancelSubmitting.current) return;
    cancelSubmitting.current = true;
    cancelDemo.mutate();
  };

  const finalizeDemo = useMutation({
    mutationFn: (payload: DemoLessonOutcome) => attendanceApi.outcome(Number(demo?.id), payload),
    onSuccess: async (updated) => {
      await invalidate(updated);
      toast({
        title: updated.status === 'completed'
          ? t('demoMarkedConducted')
          : t('demoMarkedNotConducted'),
      });
      setConductedConfirmOpen(false);
      setNotConductedOpen(false);
      onOpenChange(false);
    },
    onError: (error: Error) => toast({
      title: t('demoOutcomeSaveFailed'),
      description: error.message,
      variant: 'destructive',
    }),
  });

  const rescheduleDemo = useMutation({
    mutationFn: () => demoLessonsApi.reschedule(Number(demo?.id), {
      scheduledAt: academyInstant(rescheduleDate, rescheduleTime).toISOString(),
      reason: rescheduleReason.trim(),
    }),
    onSuccess: async (updated) => {
      await invalidate(updated);
      toast({ title: t('demoLessonRescheduled') });
      setRescheduleOpen(false);
      onOpenChange(false);
    },
    onError: (error: Error) => toast({
      title: t('demoLessonRescheduleFailed'),
      description: error.message,
      variant: 'destructive',
    }),
  });

  const changeDemoTeacher = useMutation({
    mutationFn: () => demoLessonsApi.changeTeacher(Number(demo?.id), {
      teacherId: Number(teacherDraftId),
    }),
    onSuccess: async (updated) => {
      await invalidate(updated);
      setChangeTeacherOpen(false);
      toast({ title: t('demoTeacherChanged') });
    },
    onError: async (error: Error & { status?: number }) => {
      if (error.status === 409) {
        await queryClient.invalidateQueries({ queryKey: demoLessonQueryKeys.teacherOptions });
      }
      toast({
        title: t('demoTeacherChangeFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const removeParticipant = useMutation({
    mutationFn: (participantId: number) => demoLessonsApi.removeParticipant(
      Number(demo?.id),
      participantId,
    ),
    onSuccess: async (updated) => {
      await invalidate(updated);
      setParticipantToRemove(null);
      toast({ title: t('demoParticipantRemoved') });
    },
    onError: (error: Error) => toast({
      title: t('demoParticipantRemoveFailed'),
      description: error.message,
      variant: 'destructive',
    }),
  });

  const reasonParticipant = useMemo(
    () => demo?.participants.find((participant) => participant.id === reasonParticipantId) ?? null,
    [demo, reasonParticipantId],
  );

  const availableReasonCodes = useMemo(() => DEMO_NO_SHOW_REASON_CODES.filter((code) => {
    if (demo?.format === 'online') return code !== 'could_not_reach_location';
    return code !== 'technical_issue';
  }), [demo?.format]);

  const markDirty = (participantId: number) => {
    setDirtyParticipantIds((current) => new Set(current).add(participantId));
  };

  const openNoShowReason = (participantId: number) => {
    const current = noShowReasons[participantId];
    setReasonParticipantId(participantId);
    setReasonCode(current?.code ?? '');
    setReasonNote(current?.note ?? '');
  };

  const closeNoShowReason = () => {
    setReasonParticipantId(null);
    setReasonCode('');
    setReasonNote('');
  };

  const confirmNoShowReason = () => {
    if (!reasonParticipantId || !reasonCode) return;
    const note = reasonNote.trim();
    if (reasonCode === 'other' && !note) return;
    setAttendance((current) => ({ ...current, [reasonParticipantId]: 'no_show' }));
    setNoShowReasons((current) => ({
      ...current,
      [reasonParticipantId]: { code: reasonCode, note },
    }));
    markDirty(reasonParticipantId);
    closeNoShowReason();
  };

  const changeAttendance = (participantId: number, status: 'attended' | 'no_show') => {
    if (status === 'no_show') {
      openNoShowReason(participantId);
      return;
    }
    setAttendance((current) => ({ ...current, [participantId]: 'attended' }));
    setNoShowReasons((current) => {
      const next = { ...current };
      delete next[participantId];
      return next;
    });
    markDirty(participantId);
  };

  const isMutating = saveAttendance.isPending || cancelDemo.isPending
    || finalizeDemo.isPending || rescheduleDemo.isPending
    || changeDemoTeacher.isPending || removeParticipant.isPending;

  if (!demo) return null;
  const scheduledAt = new Date(demo.scheduledAt);
  const canEditAttendance = demo.status !== 'cancelled'
    && demo.status !== 'not_conducted';
  const canManageScheduledDemo = (context === 'teacher' || demo.canManage !== false)
    && demo.status === 'scheduled';
  const attendanceComplete = demo.participants.every((participant) => (
    attendance[participant.id] === 'attended'
    || attendance[participant.id] === 'no_show'
  ));
  const canMarkConducted = canManageScheduledDemo
    && attendanceComplete
    && dirtyParticipantIds.size === 0;
  const rescheduledAt = rescheduleDate && rescheduleTime
    ? academyInstant(rescheduleDate, rescheduleTime)
    : null;
  const rescheduleIsValid = Boolean(
    rescheduledAt
    && !Number.isNaN(rescheduledAt.getTime())
    && rescheduledAt.getTime() > Date.now()
    && rescheduleReason.trim(),
  );
  const notConductedReasonValid = Boolean(
    notConductedReasonCode
    && (notConductedReasonCode !== 'other' || notConductedReasonNote.trim()),
  );
  const selectedTeacherOption = teacherOptions.data?.find(
    (teacher) => String(teacher.id) === teacherDraftId,
  );
  const teacherSelectionValid = Boolean(
    selectedTeacherOption?.available
    && Number(teacherDraftId) !== Number(demo.teacherId),
  );
  const unavailableTeacherLabel = (reason: string | null) => (
    reason === 'inactive' ? t('demoResourceInactive') : t('demoResourceBusyShort')
  );

  const copyDemoReport = async () => {
    const reportValue = (value?: string | null) => (
      value?.replace(/\s+/g, ' ').trim() || t('demoReportNotSpecified')
    );
    const report = demo.participants.map((participant, index) => {
      const status = attendance[participant.id] || participant.status;
      const attendanceLabel = status === 'attended'
        ? t('demoParticipantAttended')
        : status === 'no_show'
          ? t('demoParticipantNoShow')
          : status === 'cancelled'
            ? t('demoReportAttendanceCancelled')
            : t('studentAttendanceUnmarked');
      return [
        `${index + 1}. ${t('demoReportLeadName')}: ${reportValue(participant.leadName || participant.contactName)}`,
        `${t('demoReportStudentName')}: ${reportValue(participant.studentName)}`,
        `${t('demoReportLeadPhone')}: ${reportValue(primaryVisibleLeadPhone({ phone: participant.leadPhone }))}`,
        `${t('demoAttendance')}: ${attendanceLabel}`,
      ].join('\n');
    }).join('\n\n');

    try {
      await navigator.clipboard.writeText(report);
      toast({ title: t('demoReportCopied') });
    } catch {
      toast({ title: t('copyFailed'), variant: 'destructive' });
      return false;
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => {
        if (!saveAttendance.isPending
          && !cancelDemo.isPending
          && !finalizeDemo.isPending
          && !rescheduleDemo.isPending
          && !changeDemoTeacher.isPending
          && !removeParticipant.isPending
          && reasonParticipantId === null
          && participantToRemove === null
          && !cancelOpen
          && !conductedConfirmOpen
          && !notConductedOpen
          && !rescheduleOpen
          && !changeTeacherOpen) {
          unsavedGuard.handleOpenChange(nextOpen);
        }
      }}>
        <DialogContent className="compact-modal grid max-h-[calc(100dvh-2rem)] max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-0">
          <DialogHeader className="compact-modal-header">
            <DialogTitle>{t('demoLesson')}</DialogTitle>
            <DialogDescription>{demo.courseName ?? t('noCourse')}</DialogDescription>
          </DialogHeader>

          <div className="compact-modal-body space-y-3 overflow-y-auto overscroll-contain">
            <CompactModalSection title={t('schedule')} icon={CalendarClock} tone="violet" collapsible={false}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="flex items-start gap-3">
                  <CalendarClock className="mt-0.5 size-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{formatAcademyDate(scheduledAt, language, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                    <p className="text-xs text-muted-foreground">{demo.durationMinutes} {t('minuteShort')} · {t('academyTimeZoneLabel')}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <MapPin className="mt-0.5 size-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{demo.format === 'online' ? t('online') : demo.schoolName}</p>
                    <p className="text-xs text-muted-foreground">{demo.format === 'online' ? t('demoOnlineLocation') : demo.roomName}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div>
                    <EmployeeIdentity userId={demo.teacherUserId} name={demo.teacherName} className="text-sm font-medium" avatarClassName="size-8" />
                    <p className="text-xs text-muted-foreground">{t('teacher')}</p>
                  </div>
                </div>
              </div>

            </CompactModalSection>

            <CompactModalSection
              title={t('demoAttendance')}
              icon={UsersRound}
              tone="teal"
              count={demo.participants.length}
              summary={t('demoAttendanceProgress')
                .replace('{marked}', String(demo.participants.filter((participant) => attendance[participant.id] === 'attended' || attendance[participant.id] === 'no_show').length))
                .replace('{total}', String(demo.participants.length))}
              defaultOpen
              disabled={isMutating}
              actions={(
                <Badge variant={demo.status === 'cancelled' || demo.status === 'not_conducted'
                  ? 'destructive'
                  : 'secondary'}>
                  {demo.status === 'scheduled'
                    ? t('demoStatusScheduled')
                    : demo.status === 'completed'
                      ? t('demoStatusCompleted')
                      : demo.status === 'not_conducted'
                        ? t('demoStatusNotConducted')
                        : t('demoStatusCancelled')}
                </Badge>
              )}
            >
              <div className="space-y-1.5">
                {demo.participants.map((participant) => {
                  // The server blanks both names on a lead this user may not open,
                  // so a nameless participant must stay unclickable.
                  const primaryName = participant.studentName || participant.contactName;
                  const secondaryName = participant.studentName && participant.contactName
                    ? participant.contactName
                    : null;
                  const canEditParticipantAttendance = canEditAttendance
                    && participant.canManage !== false;
                  return (
                    <div key={participant.id} className="relative grid grid-cols-1 items-center gap-2 rounded-md border border-border-strong bg-background p-2.5 pr-11 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:pr-2.5">
                      {onOpenLead && participant.leadId && primaryName ? (
                        <button
                          type="button"
                          onClick={() => onOpenLead(Number(participant.leadId))}
                          aria-label={`${t('openLead')}: ${primaryName}`}
                          className="group -m-1 flex min-w-0 items-center gap-2 rounded-md p-1 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium underline-offset-4 group-hover:underline">
                              {primaryName}
                            </span>
                            {secondaryName ? (
                              <span className="block truncate text-xs text-muted-foreground">{secondaryName}</span>
                            ) : null}
                          </span>
                          <ArrowUpRight
                            aria-hidden="true"
                            className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                          />
                        </button>
                      ) : (
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {primaryName || t('restrictedLead')}
                          </p>
                          {secondaryName ? (
                            <p className="truncate text-xs text-muted-foreground">{secondaryName}</p>
                          ) : null}
                        </div>
                      )}
                      <div className="space-y-1.5">
                        <Label className="sr-only" htmlFor={`demo-attendance-${participant.id}`}>
                          {t('demoAttendance')}
                        </Label>
                        <Select
                          value={attendance[participant.id] || ''}
                          onValueChange={(value) => changeAttendance(
                            participant.id,
                            value as 'attended' | 'no_show',
                          )}
                          disabled={!canEditParticipantAttendance}
                        >
                          <SelectTrigger id={`demo-attendance-${participant.id}`}>
                            <SelectValue placeholder={t('selectAttendanceResult')} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="attended">{t('demoParticipantAttended')}</SelectItem>
                            <SelectItem value="no_show">{t('demoParticipantNoShow')}</SelectItem>
                          </SelectContent>
                        </Select>
                        <DemoReminderStatus participant={participant} parentOpen={open} />
                        {attendance[participant.id] === 'no_show' ? (
                          <div className="flex items-start justify-between gap-2 px-1 text-xs text-muted-foreground">
                            <span className="min-w-0 truncate">
                              {noShowReasons[participant.id]
                                ? noShowReasonLabels[noShowReasons[participant.id].code]
                                : t('demoNoShowReasonMissing')}
                            </span>
                            {canEditParticipantAttendance ? (
                              <button
                                type="button"
                                className="inline-flex shrink-0 items-center gap-1 rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                onClick={() => openNoShowReason(participant.id)}
                                aria-label={t('editDemoNoShowReason')}
                              >
                                <Pencil aria-hidden="true" className="size-3" />
                                {t('edit')}
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      {context === 'sales' && demo.status === 'scheduled'
                        && participant.canManage !== false
                        && ['invited', 'confirmed'].includes(participant.status) ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-2 top-2 size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:static"
                          disabled={dirtyParticipantIds.size > 0 || removeParticipant.isPending}
                          onClick={() => setParticipantToRemove(participant)}
                          aria-label={t('removeDemoParticipantAria').replace(
                            '{name}',
                            primaryName || t('restrictedLead'),
                          )}
                        >
                          <X aria-hidden="true" className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </CompactModalSection>

            {demo.notes ? (
              <CompactModalSection title={t('comment')} summary={demo.notes} icon={MessageSquare} tone="amber">
                <p className="whitespace-pre-wrap break-words text-sm">{demo.notes}</p>
              </CompactModalSection>
            ) : null}

            {demo.status === 'not_conducted' && demo.notConductedReasonCode ? (
              <CompactModalSection title={t('demoNotConductedReason')} icon={ClipboardList} tone="amber" collapsible={false}>
                <p className="break-words text-sm">
                  {notConductedReasonLabels[demo.notConductedReasonCode]}
                  {demo.notConductedReasonNote ? ` — ${demo.notConductedReasonNote}` : ''}
                </p>
              </CompactModalSection>
            ) : null}

            {demo.lastRescheduledFrom && demo.lastRescheduleReason ? (
              <CompactModalSection title={t('demoLastReschedule')} summary={demo.lastRescheduleReason} icon={History} tone="violet">
                <p className="break-words text-sm">
                  {formatAcademyDate(demo.lastRescheduledFrom, language, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  {' · '}
                  {demo.lastRescheduleReason}
                </p>
              </CompactModalSection>
            ) : null}

            {canManageScheduledDemo || context === 'sales' ? (
              <CompactModalSection title={t('demoLessonActions')} icon={ClipboardList} tone="sky" collapsible={false} disabled={isMutating}>
                <div className="flex flex-wrap gap-2 [&_button]:h-auto [&_button]:min-h-8 [&_button]:px-2.5 [&_button]:py-1.5 [&_button]:text-xs">
                  {context === 'sales' ? (
                    <CopyButton
                      type="button"
                      variant="outline"
                      className="max-w-full whitespace-normal"
                      disabled={demo.participants.length === 0}
                      onCopy={copyDemoReport}
                      resetKey={`${demo.id}:${open}`}
                      copiedLabel={t('lmsStaffCopied')}
                    >
                      {t('copyDemoReport')}
                    </CopyButton>
                  ) : null}
                  {canManageScheduledDemo ? (
                    <>
                      {context === 'sales' ? (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              setTeacherDraftId(String(demo.teacherId));
                              setChangeTeacherOpen(true);
                            }}
                          >
                            {t('changeDemoTeacher')}
                          </Button>
                          <Button type="button" variant="outline" onClick={() => setRescheduleOpen(true)}>
                            {t('rescheduleDemoLesson')}
                          </Button>
                        </>
                      ) : null}
                      <Button
                        type="button"
                        disabled={!canMarkConducted || finalizeDemo.isPending}
                        onClick={() => setConductedConfirmOpen(true)}
                      >
                        {t('markDemoConducted')}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={finalizeDemo.isPending}
                        onClick={() => setNotConductedOpen(true)}
                      >
                        {t('markDemoNotConducted')}
                      </Button>
                      {context === 'sales' ? (
                        <Button type="button" variant="destructive" onClick={() => setCancelOpen(true)}>
                          {t('cancelDemoLesson')}
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                </div>
                {canManageScheduledDemo && !canMarkConducted ? (
                  <p role="status" className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">
                    {!attendanceComplete ? t('demoAttendanceIncomplete') : t('unsavedAttendanceTitle')}
                  </p>
                ) : null}
              </CompactModalSection>
            ) : null}
          </div>

          <DialogFooter className="compact-modal-footer">
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" disabled={isMutating} onClick={() => unsavedGuard.handleOpenChange(false)}>
                {t('close')}
              </Button>
              {canEditAttendance && demo.participants.some((participant) => (
                participant.canManage !== false
              )) ? (
                <Button loading={isMutating}
                  type="button"
                  disabled={dirtyParticipantIds.size === 0 || isMutating}
                  onClick={() => saveAttendance.mutate()}
                >
                  {saveAttendance.isPending ? t('saving') : t('saveAttendance')}
                </Button>
              ) : null}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reasonParticipantId !== null} onOpenChange={(nextOpen) => {
        if (!nextOpen) closeNoShowReason();
      }}>
        <DialogContent aria-describedby={undefined} className="compact-modal grid max-h-[calc(100dvh-2rem)] max-w-lg grid-rows-[minmax(0,1fr)] overflow-hidden p-0">
          <form onSubmit={(event) => {
            event.preventDefault();
            confirmNoShowReason();
          }} className="flex min-h-0 flex-1 flex-col">
            <DialogHeader className="compact-modal-header">
              <DialogTitle>{t('demoNoShowReasonTitle')}</DialogTitle>
            </DialogHeader>

            <div className="compact-modal-body min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain">
              <CompactModalSection
                title={t('demoNoShowReason')}
                summary={reasonParticipant?.studentName || reasonParticipant?.contactName || t('restrictedLead')}
                icon={ClipboardList}
                tone="amber"
                collapsible={false}
                contentClassName="space-y-3"
              >
                <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <legend className="sr-only">{t('demoNoShowReason')}</legend>
                  {availableReasonCodes.map((code) => (
                    <label
                      key={code}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-md border bg-background px-2.5 py-2 text-sm leading-5 transition-colors',
                        reasonCode === code
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border-strong hover:bg-amber-500/5',
                      )}
                    >
                      <input
                        type="radio"
                        name="demo-no-show-reason"
                        value={code}
                        checked={reasonCode === code}
                        onChange={() => setReasonCode(code)}
                        className="size-4 accent-primary"
                      />
                      <span>{noShowReasonLabels[code]}</span>
                    </label>
                  ))}
                </fieldset>

                <div className="space-y-1.5">
                  <Label htmlFor="demo-no-show-reason-note">
                    {reasonCode === 'other'
                      ? t('demoNoShowReasonCommentRequired')
                      : t('demoNoShowReasonComment')}
                  </Label>
                  <Textarea
                    id="demo-no-show-reason-note"
                    value={reasonNote}
                    onChange={(event) => setReasonNote(event.target.value)}
                    maxLength={500}
                    rows={2}
                  />
                </div>
              </CompactModalSection>
            </div>

            <DialogFooter className="compact-modal-footer">
              <Button type="button" variant="outline" onClick={closeNoShowReason}>
                {t('back')}
              </Button>
              <Button
                type="submit"
                disabled={!reasonCode || (reasonCode === 'other' && !reasonNote.trim())}
              >
                {t('confirmAction')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={conductedConfirmOpen} onOpenChange={(nextOpen) => {
        if (!finalizeDemo.isPending) setConductedConfirmOpen(nextOpen);
      }} pending={finalizeDemo.isPending}>
        <AlertDialogContent className="compact-modal gap-0 overflow-hidden p-0">
          <AlertDialogHeader className="compact-modal-header" data-topographic="header">
            <AlertDialogTitle>{t('markDemoConductedTitle')}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogBody>
            <AlertDialogDescription>{t('markDemoConductedDescription')}</AlertDialogDescription>
          </AlertDialogBody>
          <AlertDialogFooter className="compact-modal-footer">
            <AlertDialogCancel disabled={finalizeDemo.isPending}>{t('back')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={!canMarkConducted || finalizeDemo.isPending}
              onClick={(event) => { event.preventDefault(); finalizeDemo.mutate({ status: 'completed' }); }}
            >{(finalizeDemo.isPending) && <OrbitSpinner className="mr-1.5 size-4" />}
              {finalizeDemo.isPending ? t('saving') : t('markDemoConducted')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={participantToRemove !== null} onOpenChange={(nextOpen) => {
        if (!nextOpen && !removeParticipant.isPending) setParticipantToRemove(null);
      }} pending={removeParticipant.isPending}>
        <AlertDialogContent className="compact-modal gap-0 overflow-hidden p-0">
          <AlertDialogHeader className="compact-modal-header" data-topographic="header">
            <AlertDialogTitle>{t('removeDemoParticipantTitle')}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogBody>
            <AlertDialogDescription>
              {t('removeDemoParticipantDescription').replace(
                '{name}',
                participantToRemove?.studentName
                || participantToRemove?.contactName
                || t('restrictedLead'),
              )}
            </AlertDialogDescription>
          </AlertDialogBody>
          <AlertDialogFooter className="compact-modal-footer">
            <AlertDialogCancel disabled={removeParticipant.isPending}>{t('back')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!participantToRemove || removeParticipant.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (participantToRemove) removeParticipant.mutate(participantToRemove.id);
              }}
            >{(removeParticipant.isPending) && <OrbitSpinner className="mr-1.5 size-4" />}
              {removeParticipant.isPending ? t('deleting') : t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={notConductedOpen} onOpenChange={(nextOpen) => {
        if (!finalizeDemo.isPending) setNotConductedOpen(nextOpen);
      }}>
        <DialogContent aria-describedby={undefined} className="compact-modal grid max-h-[calc(100dvh-2rem)] max-w-lg grid-rows-[minmax(0,1fr)] overflow-hidden p-0">
          <form onSubmit={(event) => {
            event.preventDefault();
            if (!notConductedReasonCode || !notConductedReasonValid) return;
            finalizeDemo.mutate({
              status: 'not_conducted',
              reasonCode: notConductedReasonCode,
              reasonNote: notConductedReasonNote.trim() || null,
            });
          }} className="flex min-h-0 flex-1 flex-col">
            <DialogHeader className="compact-modal-header">
              <DialogTitle>{t('markDemoNotConductedTitle')}</DialogTitle>
            </DialogHeader>

            <div className="compact-modal-body min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain">
              <CompactModalSection title={t('demoNotConductedReason')} icon={ClipboardList} tone="amber" collapsible={false} disabled={finalizeDemo.isPending} contentClassName="space-y-3">
                <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <legend className="sr-only">{t('demoNotConductedReason')}</legend>
                  {DEMO_NOT_CONDUCTED_REASON_CODES
                    .filter((code) => demo.format !== 'online' || code !== 'room_unavailable')
                    .map((code) => (
                      <label
                        key={code}
                        className={cn(
                          'flex cursor-pointer items-center gap-2 rounded-md border bg-background px-2.5 py-2 text-sm leading-5 transition-colors',
                          notConductedReasonCode === code
                            ? 'border-primary bg-primary/10 text-foreground'
                            : 'border-border-strong hover:bg-amber-500/5',
                        )}
                      >
                        <input
                          type="radio"
                          name="demo-not-conducted-reason"
                          value={code}
                          checked={notConductedReasonCode === code}
                          onChange={() => setNotConductedReasonCode(code)}
                          className="size-4 accent-primary"
                        />
                        <span>{notConductedReasonLabels[code]}</span>
                      </label>
                    ))}
                </fieldset>

                <div className="space-y-1.5">
                  <Label htmlFor="demo-not-conducted-note">
                    {notConductedReasonCode === 'other'
                      ? t('demoNoShowReasonCommentRequired')
                      : t('demoNoShowReasonComment')}
                  </Label>
                  <Textarea
                    id="demo-not-conducted-note"
                    value={notConductedReasonNote}
                    onChange={(event) => setNotConductedReasonNote(event.target.value)}
                    maxLength={500}
                    rows={2}
                  />
                </div>
              </CompactModalSection>
            </div>

            <DialogFooter className="compact-modal-footer">
              <Button type="button" variant="outline" disabled={finalizeDemo.isPending} onClick={() => setNotConductedOpen(false)}>
                {t('back')}
              </Button>
              <Button loading={finalizeDemo.isPending} type="submit" disabled={!notConductedReasonValid || finalizeDemo.isPending}>
                {finalizeDemo.isPending ? t('saving') : t('markDemoNotConducted')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={changeTeacherOpen} onOpenChange={(nextOpen) => {
        if (!changeDemoTeacher.isPending) setChangeTeacherOpen(nextOpen);
      }}>
        <DialogContent aria-describedby={undefined} className="compact-modal grid max-h-[calc(100dvh-2rem)] max-w-lg grid-rows-[minmax(0,1fr)] overflow-hidden p-0">
          <form onSubmit={(event) => {
            event.preventDefault();
            if (teacherSelectionValid) changeDemoTeacher.mutate();
          }} className="flex min-h-0 flex-col">
            <DialogHeader className="compact-modal-header">
              <DialogTitle>{t('changeDemoTeacher')}</DialogTitle>
            </DialogHeader>

            <div className="compact-modal-body space-y-3 overflow-y-auto overscroll-contain">
              <CompactModalSection title={t('schedule')} icon={CalendarClock} tone="violet" collapsible={false}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0">
                      <EmployeeIdentity userId={demo.teacherUserId} name={demo.teacherName} className="text-sm font-medium" avatarClassName="size-8" />
                      <p className="text-xs text-muted-foreground">{t('teacher')}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CalendarClock className="mt-0.5 size-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">
                        {formatAcademyDate(scheduledAt, language, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {demo.durationMinutes} {t('minuteShort')} · {t('academyTimeZoneLabel')}
                      </p>
                    </div>
                  </div>
                </div>

              </CompactModalSection>
              <CompactModalSection title={t('teacher')} icon={UsersRound} tone="teal" collapsible={false} disabled={changeDemoTeacher.isPending} contentClassName="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="demo-change-teacher">{t('teacher')}</Label>
                  <Select
                    value={teacherDraftId}
                    onValueChange={setTeacherDraftId}
                    disabled={!teacherOptions.data || teacherOptions.isFetching}
                  >
                    <SelectTrigger id="demo-change-teacher">
                      <SelectValue placeholder={t('selectTeacher')} />
                    </SelectTrigger>
                    <SelectContent>
                      {teacherOptions.data?.map((teacher) => (
                        <SelectItem
                          key={teacher.id}
                          value={String(teacher.id)}
                          textValue={teacher.fullName}
                          disabled={!teacher.available}
                        >
                          <EmployeeIdentity userId={teacher.userId} name={teacher.fullName} />
                          {teacher.available
                            ? ''
                            : ` · ${unavailableTeacherLabel(teacher.reason)}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div aria-live="polite">
                  {teacherOptions.isFetching ? (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <OrbitSpinner className="size-4" />
                      {t('checkingAvailability')}
                    </p>
                  ) : teacherOptions.isError ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p role="alert" className="text-sm text-destructive">{t('failedToLoadData')}</p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => teacherOptions.refetch()}
                      >
                        {t('retry')}
                      </Button>
                    </div>
                  ) : selectedTeacherOption && !selectedTeacherOption.available ? (
                    <p role="alert" className="text-sm text-destructive">
                      {selectedTeacherOption.reason === 'inactive'
                        ? t('teacherNotActive')
                        : t('demoTeacherBusy')}
                    </p>
                  ) : null}
                </div>

              </CompactModalSection>
            </div>

            <DialogFooter className="compact-modal-footer">
              <Button
                type="button"
                variant="outline"
                disabled={changeDemoTeacher.isPending}
                onClick={() => setChangeTeacherOpen(false)}
              >
                {t('back')}
              </Button>
              <Button loading={teacherOptions.isFetching || changeDemoTeacher.isPending}
                type="submit"
                disabled={
                  !teacherSelectionValid
                  || teacherOptions.isFetching
                  || changeDemoTeacher.isPending
                }
              >
                {changeDemoTeacher.isPending ? t('saving') : t('saveDemoTeacher')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={rescheduleOpen} onOpenChange={(nextOpen) => {
        if (!rescheduleDemo.isPending) setRescheduleOpen(nextOpen);
      }}>
        <DialogContent aria-describedby={undefined} className="compact-modal grid max-h-[calc(100dvh-2rem)] max-w-lg grid-rows-[minmax(0,1fr)] overflow-hidden p-0">
          <form onSubmit={(event) => {
            event.preventDefault();
            if (rescheduleIsValid) rescheduleDemo.mutate();
          }} className="flex min-h-0 flex-col">
            <DialogHeader className="compact-modal-header">
              <DialogTitle>{t('rescheduleDemoLessonTitle')}</DialogTitle>
            </DialogHeader>

            <div className="compact-modal-body space-y-3 overflow-y-auto overscroll-contain">
              <CompactModalSection title={t('schedule')} icon={CalendarClock} tone="violet" collapsible={false} disabled={rescheduleDemo.isPending}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="demo-reschedule-date">{t('dateColumn')}</Label>
                    <Input
                      id="demo-reschedule-date"
                      type="date"
                      min={academyToday()}
                      value={rescheduleDate}
                      onChange={(event) => setRescheduleDate(event.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="demo-reschedule-time">{t('time')}</Label>
                    <TimePicker
                      id="demo-reschedule-time"
                      value={rescheduleTime}
                      onValueChange={(value) => setRescheduleTime(value)}
                      required
                    />
                  </div>
                </div>

              </CompactModalSection>
              <CompactModalSection title={t('demoRescheduleReason')} icon={MessageSquare} tone="amber" collapsible={false} disabled={rescheduleDemo.isPending}>
                <Label className="sr-only" htmlFor="demo-reschedule-reason">{t('demoRescheduleReason')}</Label>
                <Textarea
                  id="demo-reschedule-reason"
                  value={rescheduleReason}
                  onChange={(event) => setRescheduleReason(event.target.value)}
                  maxLength={500}
                  rows={3}
                  required
                />
              </CompactModalSection>
            </div>

            <DialogFooter className="compact-modal-footer">
              <Button type="button" variant="outline" disabled={rescheduleDemo.isPending} onClick={() => setRescheduleOpen(false)}>
                {t('back')}
              </Button>
              <Button loading={rescheduleDemo.isPending} type="submit" disabled={!rescheduleIsValid || rescheduleDemo.isPending}>
                {rescheduleDemo.isPending ? t('saving') : t('rescheduleDemoLesson')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={cancelOpen} onOpenChange={(nextOpen) => {
        if (!cancelDemo.isPending) setCancelOpen(nextOpen);
      }} pending={cancelDemo.isPending}>
        <AlertDialogContent className="compact-modal gap-0 overflow-hidden p-0">
          <AlertDialogHeader className="compact-modal-header" data-topographic="header">
            <AlertDialogTitle>{t('cancelDemoLessonTitle')}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogBody>
            <AlertDialogDescription>{t('cancelDemoLessonDescription')}</AlertDialogDescription>
            <>
              <Label htmlFor="demo-cancel-reason">{t('cancellationReason')}</Label>
              <Input
                id="demo-cancel-reason"
                disabled={cancelDemo.isPending}
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                onKeyDown={submitOnEnter(confirmCancellation, {
                  disabled: !cancelReason.trim() || cancelDemo.isPending,
                })}
                maxLength={500}
              />
            </>
          </AlertDialogBody>
          <AlertDialogFooter className="compact-modal-footer">
            <AlertDialogCancel disabled={cancelDemo.isPending}>{t('back')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!cancelReason.trim() || cancelDemo.isPending}
              onClick={(event) => { event.preventDefault(); confirmCancellation(); }}
            >{(cancelDemo.isPending) && <OrbitSpinner className="mr-1.5 size-4" />}
              {cancelDemo.isPending ? t('saving') : t('cancelDemoLesson')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <UnsavedChangesDialog open={unsavedGuard.confirmationOpen} onOpenChange={unsavedGuard.setConfirmationOpen} onDiscard={unsavedGuard.discardChanges} />
    </>
  );
}
