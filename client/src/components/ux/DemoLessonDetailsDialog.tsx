import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { enUS, ru } from 'date-fns/locale';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, CalendarClock, MapPin, UserRoundCheck, UsersRound } from 'lucide-react';
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
  const [attendance, setAttendance] = useState<Record<number, 'attended' | 'no_show' | ''>>({});
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
      participants: Object.entries(attendance).flatMap(([leadId, status]) => (
        status ? [{ leadId: Number(leadId), status, result: null }] : []
      )),
    }),
    onSuccess: async (updated) => {
      await invalidate(updated);
      toast({ title: t('demoAttendanceSaved') });
      onOpenChange(false);
    },
    onError: (error: Error) => toast({
      title: t('demoAttendanceSaveFailed'),
      description: error.message,
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

  const attendanceEntries = useMemo(
    () => Object.values(attendance).filter(Boolean).length,
    [attendance],
  );

  if (!demo) return null;
  const scheduledAt = new Date(demo.scheduledAt);
  const canEditAttendance = demo.canManage !== false && demo.status !== 'cancelled';
  const canCancel = demo.canManage !== false && demo.status === 'scheduled';

  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => {
        if (!saveAttendance.isPending && !cancelDemo.isPending) onOpenChange(nextOpen);
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
                <p className="text-sm font-medium">{demo.participants.length}/{demo.capacity}</p>
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
                    <div>
                      <Label className="sr-only" htmlFor={`demo-attendance-${participant.leadId}`}>
                        {t('demoAttendance')}
                      </Label>
                      <Select
                        value={attendance[participant.leadId] || ''}
                        onValueChange={(value) => setAttendance((current) => ({
                          ...current,
                          [participant.leadId]: value as 'attended' | 'no_show',
                        }))}
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
                  disabled={attendanceEntries === 0 || saveAttendance.isPending}
                  onClick={() => saveAttendance.mutate()}
                >
                  {saveAttendance.isPending ? t('saving') : t('saveAttendance')}
                </Button>
              ) : null}
            </div>
          </DialogFooter>
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
