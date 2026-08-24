import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { enUS, ru } from 'date-fns/locale';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, CalendarClock, MapPin, Pencil, UserRoundCheck, UsersRound } from 'lucide-react';
import {
  DEMO_NO_SHOW_REASON_CODES,
  type DemoNoShowReasonCode,
} from '@shared/contracts/demo-lessons';
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
  type DemoLesson,
} from '@/features/demo-lessons/api';
import { invalidateSalesLeadData } from '@/features/sales/queries';
import { submitOnEnter } from '@/lib/submitOnEnter';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';

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
}: DemoLessonDetailsDialogProps) {
  const { t, language } = useTranslation();
  const locale = language === 'ru' ? ru : enUS;
  const queryClient = useQueryClient();
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
  const [attendance, setAttendance] = useState<Record<number, AttendanceStatus>>({});
  const [noShowReasons, setNoShowReasons] = useState<Record<number, NoShowReasonDraft>>({});
  const [dirtyLeadIds, setDirtyLeadIds] = useState<Set<number>>(new Set());
  const [reasonLeadId, setReasonLeadId] = useState<number | null>(null);
  const [reasonCode, setReasonCode] = useState<DemoNoShowReasonCode | ''>('');
  const [reasonNote, setReasonNote] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  useEffect(() => {
    if (!demo || !open) return;
    setAttendance(Object.fromEntries(demo.participants.map((participant) => [
      participant.leadId,
      participant.status === 'attended' || participant.status === 'no_show'
        ? participant.status
        : '',
    ])));
    setNoShowReasons(Object.fromEntries(demo.participants.flatMap((participant) => (
      participant.noShowReasonCode
        ? [[participant.leadId, {
          code: participant.noShowReasonCode,
          note: participant.noShowReasonNote ?? '',
        }]]
        : []
    ))));
    setDirtyLeadIds(new Set());
    setReasonLeadId(null);
    setReasonCode('');
    setReasonNote('');
    setCancelReason('');
    setCancelOpen(false);
  }, [demo, open]);

  const invalidate = async (updated: DemoLesson) => {
    await Promise.all([
      invalidateSalesLeadData(queryClient),
      queryClient.invalidateQueries({ queryKey: demoLessonQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: demoLessonQueryKeys.availability }),
    ]);
    onChanged?.(updated);
  };

  const saveAttendance = useMutation({
    mutationFn: () => demoLessonsApi.saveAttendance(Number(demo?.id), {
      participants: Array.from(dirtyLeadIds).flatMap((leadId) => {
        const status = attendance[leadId];
        if (!status) return [];
        const reason = noShowReasons[leadId];
        return [{
          leadId,
          status,
          result: null,
          noShowReasonCode: status === 'no_show' ? reason?.code ?? null : null,
          noShowReasonNote: status === 'no_show' ? reason?.note.trim() || null : null,
        }];
      }),
    }),
    onSuccess: async (updated) => {
      await invalidate(updated);
      toast({ title: t('demoAttendanceSaved') });
      onOpenChange(false);
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
  });

  const reasonParticipant = useMemo(
    () => demo?.participants.find((participant) => participant.leadId === reasonLeadId) ?? null,
    [demo, reasonLeadId],
  );

  const availableReasonCodes = useMemo(() => DEMO_NO_SHOW_REASON_CODES.filter((code) => {
    if (demo?.format === 'online') return code !== 'could_not_reach_location';
    return code !== 'technical_issue';
  }), [demo?.format]);

  const markDirty = (leadId: number) => {
    setDirtyLeadIds((current) => new Set(current).add(leadId));
  };

  const openNoShowReason = (leadId: number) => {
    const current = noShowReasons[leadId];
    setReasonLeadId(leadId);
    setReasonCode(current?.code ?? '');
    setReasonNote(current?.note ?? '');
  };

  const closeNoShowReason = () => {
    setReasonLeadId(null);
    setReasonCode('');
    setReasonNote('');
  };

  const confirmNoShowReason = () => {
    if (!reasonLeadId || !reasonCode) return;
    const note = reasonNote.trim();
    if (reasonCode === 'other' && !note) return;
    setAttendance((current) => ({ ...current, [reasonLeadId]: 'no_show' }));
    setNoShowReasons((current) => ({
      ...current,
      [reasonLeadId]: { code: reasonCode, note },
    }));
    markDirty(reasonLeadId);
    closeNoShowReason();
  };

  const changeAttendance = (leadId: number, status: 'attended' | 'no_show') => {
    if (status === 'no_show') {
      openNoShowReason(leadId);
      return;
    }
    setAttendance((current) => ({ ...current, [leadId]: 'attended' }));
    setNoShowReasons((current) => {
      const next = { ...current };
      delete next[leadId];
      return next;
    });
    markDirty(leadId);
  };

  if (!demo) return null;
  const scheduledAt = new Date(demo.scheduledAt);
  const canEditAttendance = demo.canManage !== false && demo.status !== 'cancelled';
  const canCancel = demo.canManage !== false && demo.status === 'scheduled';

  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => {
        if (!saveAttendance.isPending
          && !cancelDemo.isPending
          && reasonLeadId === null
          && !cancelOpen) {
          onOpenChange(nextOpen);
        }
      }}>
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('demoLesson')}</DialogTitle>
            <DialogDescription>{demo.courseName ?? t('noCourse')}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2">
            <div className="flex items-start gap-3">
              <CalendarClock className="mt-0.5 size-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">{format(scheduledAt, 'd MMMM yyyy, HH:mm', { locale })}</p>
                <p className="text-xs text-muted-foreground">{demo.durationMinutes} {t('minuteShort')}</p>
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
              <UserRoundCheck className="mt-0.5 size-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">{demo.teacherName}</p>
                <p className="text-xs text-muted-foreground">{t('teacher')}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <UsersRound className="mt-0.5 size-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">{demo.participants.length}</p>
                <p className="text-xs text-muted-foreground">{t('demoParticipants')}</p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t('demoAttendance')}</h3>
              <Badge variant={demo.status === 'cancelled' ? 'destructive' : 'secondary'}>
                {demo.status === 'scheduled'
                  ? t('demoStatusScheduled')
                  : demo.status === 'completed'
                    ? t('demoStatusCompleted')
                    : t('demoStatusCancelled')}
              </Badge>
            </div>
            <div className="space-y-2">
              {demo.participants.map((participant) => {
                // The server blanks both names on a lead this user may not open,
                // so a nameless participant must stay unclickable.
                const primaryName = participant.studentName || participant.contactName;
                const secondaryName = participant.studentName && participant.contactName
                  ? participant.contactName
                  : null;

                return (
                  <div key={participant.id} className="grid items-center gap-3 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
                    {onOpenLead && primaryName ? (
                      <button
                        type="button"
                        onClick={() => onOpenLead(participant.leadId)}
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
                      <Label className="sr-only" htmlFor={`demo-attendance-${participant.leadId}`}>
                        {t('demoAttendance')}
                      </Label>
                      <Select
                        value={attendance[participant.leadId] || ''}
                        onValueChange={(value) => changeAttendance(
                          participant.leadId,
                          value as 'attended' | 'no_show',
                        )}
                        disabled={!canEditAttendance}
                      >
                        <SelectTrigger id={`demo-attendance-${participant.leadId}`}>
                          <SelectValue placeholder={t('selectAttendanceResult')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="attended">{t('demoParticipantAttended')}</SelectItem>
                          <SelectItem value="no_show">{t('demoParticipantNoShow')}</SelectItem>
                        </SelectContent>
                      </Select>
                      {attendance[participant.leadId] === 'no_show' ? (
                        <div className="flex items-start justify-between gap-2 px-1 text-xs text-muted-foreground">
                          <span className="min-w-0 truncate">
                            {noShowReasons[participant.leadId]
                              ? noShowReasonLabels[noShowReasons[participant.leadId].code]
                              : t('demoNoShowReasonMissing')}
                          </span>
                          {canEditAttendance ? (
                            <button
                              type="button"
                              className="inline-flex shrink-0 items-center gap-1 rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={() => openNoShowReason(participant.leadId)}
                              aria-label={t('editDemoNoShowReason')}
                            >
                              <Pencil aria-hidden="true" className="size-3" />
                              {t('edit')}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {demo.notes ? (
            <div className="rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">{demo.notes}</div>
          ) : null}

          <DialogFooter className="sm:justify-between">
            <div>
              {canCancel ? (
                <Button type="button" variant="destructive" onClick={() => setCancelOpen(true)}>
                  {t('cancelDemoLesson')}
                </Button>
              ) : null}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('close')}
              </Button>
              {canEditAttendance ? (
                <Button
                  type="button"
                  disabled={dirtyLeadIds.size === 0 || saveAttendance.isPending}
                  onClick={() => saveAttendance.mutate()}
                >
                  {saveAttendance.isPending ? t('saving') : t('saveAttendance')}
                </Button>
              ) : null}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reasonLeadId !== null} onOpenChange={(nextOpen) => {
        if (!nextOpen) closeNoShowReason();
      }}>
        <DialogContent className="max-w-lg">
          <form onSubmit={(event) => {
            event.preventDefault();
            confirmNoShowReason();
          }} className="space-y-5">
            <DialogHeader>
              <DialogTitle>{t('demoNoShowReasonTitle')}</DialogTitle>
              <DialogDescription>{t('demoNoShowReasonDescription')}</DialogDescription>
            </DialogHeader>

            <div className="rounded-lg bg-muted/60 px-3 py-2 text-sm font-medium">
              {reasonParticipant?.studentName
                || reasonParticipant?.contactName
                || t('restrictedLead')}
            </div>

            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">{t('demoNoShowReason')}</legend>
              {availableReasonCodes.map((code) => (
                <label
                  key={code}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors',
                    reasonCode === code
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border hover:bg-muted/60',
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

            <div className="space-y-2">
              <Label htmlFor="demo-no-show-reason-note">
                {reasonCode === 'other'
                  ? t('demoNoShowReasonCommentRequired')
                  : t('demoNoShowReasonComment')}
              </Label>
              <Textarea
                id="demo-no-show-reason-note"
                value={reasonNote}
                onChange={(event) => setReasonNote(event.target.value)}
                placeholder={t('demoNoShowReasonCommentPlaceholder')}
                maxLength={500}
                rows={3}
              />
            </div>

            <DialogFooter>
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

      <AlertDialog open={cancelOpen} onOpenChange={(nextOpen) => {
        if (!cancelDemo.isPending) setCancelOpen(nextOpen);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('cancelDemoLessonTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('cancelDemoLessonDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="demo-cancel-reason">{t('cancellationReason')}</Label>
            <Input
              id="demo-cancel-reason"
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              onKeyDown={submitOnEnter(() => cancelDemo.mutate(), {
                disabled: !cancelReason.trim() || cancelDemo.isPending,
              })}
              placeholder={t('cancellationReasonPlaceholder')}
              maxLength={500}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelDemo.isPending}>{t('back')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!cancelReason.trim() || cancelDemo.isPending}
              onClick={() => cancelDemo.mutate()}
            >
              {cancelDemo.isPending ? t('saving') : t('cancelDemoLesson')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
