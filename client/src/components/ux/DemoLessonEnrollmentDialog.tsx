import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  CalendarPlus2,
  Check,
  Clock3,
  Loader2,
  MapPin,
  Search,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  demoLessonQueryKeys,
  demoLessonsApi,
  type DemoLesson,
} from '@/features/demo-lessons/api';
import { invalidateSalesLeadData } from '@/features/sales/queries';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { ACADEMY_TIME_ZONE } from '@/lib/localeFormat';

const ACTIVE_PARTICIPANT_STATUSES = new Set(['invited', 'confirmed', 'attended', 'no_show']);

export interface DemoLessonEnrollmentLead {
  id: number;
  contactName: string;
  studentName?: string | null;
  courseId?: number | null;
  schoolId?: number | null;
}

type EnrollmentState = 'available' | 'already_enrolled' | 'full' | 'lead_busy' | 'closed';

const isActiveParticipant = (status: string) => ACTIVE_PARTICIPANT_STATUSES.has(status);

const lessonEndsAt = (demo: DemoLesson) => (
  new Date(demo.scheduledAt).getTime() + Number(demo.durationMinutes) * 60_000
);

export const getDemoEnrollmentState = (
  demo: DemoLesson,
  leadId: number,
  demos: DemoLesson[],
  now = Date.now(),
): EnrollmentState => {
  const startsAt = new Date(demo.scheduledAt).getTime();
  if (demo.status !== 'scheduled' || !Number.isFinite(startsAt) || startsAt <= now) return 'closed';
  if (demo.participants.some((participant) => (
    Number(participant.leadId) === leadId && isActiveParticipant(participant.status)
  ))) return 'already_enrolled';
  const activeCount = demo.participants.filter((participant) => isActiveParticipant(participant.status)).length;
  if (activeCount >= Number(demo.capacity)) return 'full';
  const endsAt = lessonEndsAt(demo);
  const hasOverlap = demos.some((candidate) => (
    Number(candidate.id) !== Number(demo.id)
    && candidate.status === 'scheduled'
    && candidate.participants.some((participant) => (
      Number(participant.leadId) === leadId && isActiveParticipant(participant.status)
    ))
    && new Date(candidate.scheduledAt).getTime() < endsAt
    && lessonEndsAt(candidate) > startsAt
  ));
  return hasOverlap ? 'lead_busy' : 'available';
};

const activeParticipantCount = (demo: DemoLesson) => (
  demo.participants.filter((participant) => isActiveParticipant(participant.status)).length
);

export function DemoLessonEnrollmentDialog({
  open,
  onOpenChange,
  lead,
  onCreateNew,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: DemoLessonEnrollmentLead | null;
  onCreateNew?: () => void;
}) {
  const { t, language } = useTranslation();
  const queryClient = useQueryClient();
  const [selectedDemoId, setSelectedDemoId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  useEffect(() => {
    setSelectedDemoId(null);
    setSearch('');
  }, [lead?.id, open]);

  const demoQuery = useQuery({
    queryKey: demoLessonQueryKeys.enrollment,
    queryFn: demoLessonsApi.listUpcoming,
    enabled: open && Boolean(lead),
    staleTime: 15_000,
  });
  const demos = useMemo(() => demoQuery.data ?? [], [demoQuery.data]);
  const upcomingDemos = useMemo(() => demos.filter((demo) => (
    lead && getDemoEnrollmentState(demo, lead.id, demos) !== 'closed'
  )), [demos, lead]);
  const visibleDemos = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase();
    if (!normalized) return upcomingDemos;
    return upcomingDemos.filter((demo) => [
      demo.courseName,
      demo.teacherName,
      demo.schoolName,
      demo.roomName,
    ].some((value) => value?.toLocaleLowerCase().includes(normalized)));
  }, [search, upcomingDemos]);

  const enroll = useMutation({
    mutationFn: () => demoLessonsApi.enroll(Number(selectedDemoId), { leadIds: [Number(lead?.id)] }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: demoLessonQueryKeys.all }),
        invalidateSalesLeadData(queryClient, lead?.id),
      ]);
      toast({
        title: t('demoEnrollmentSaved'),
        description: t('demoEnrollmentSavedDescription'),
      });
      onOpenChange(false);
    },
    onError: (error: Error) => toast({
      title: t('demoEnrollmentFailed'),
      description: error.message,
      variant: 'destructive',
    }),
  });

  const locale = language === 'ru' ? 'ru-RU' : 'en-US';
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: ACADEMY_TIME_ZONE,
  }), [locale]);
  const timeFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: ACADEMY_TIME_ZONE,
  }), [locale]);
  const leadName = lead?.studentName?.trim() || lead?.contactName || '';

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !enroll.isPending && onOpenChange(nextOpen)}>
      {/* DialogContent carries a `grid` class that Tailwind emits after `flex`,
          so declaring rows is what actually bounds the scrollable middle. */}
      <DialogContent className="grid max-h-[90vh] max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-6 pb-5 pt-6 pr-12">
          <DialogTitle>{t('enrollInDemoLesson')}</DialogTitle>
          <DialogDescription>
            {t('enrollLeadInDemoDescription').replace('{lead}', leadName)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4 px-6">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/45 px-3 py-2 text-sm">
            <UserRound className="size-4 shrink-0 text-primary" />
            <span className="min-w-0 truncate font-medium">{leadName}</span>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setSelectedDemoId(null);
              }}
              placeholder={t('searchDemoLessons')}
              className="pl-9"
            />
          </div>

          {demoQuery.isError ? (
            <Alert variant="destructive">
              <AlertTitle>{t('failedToLoadDemoLessons')}</AlertTitle>
              <AlertDescription className="mt-2">
                <Button type="button" variant="outline" size="sm" onClick={() => demoQuery.refetch()}>
                  {t('retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : demoQuery.isLoading ? (
            <div className="flex min-h-56 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" /> {t('loading')}
            </div>
          ) : visibleDemos.length > 0 ? (
            <ScrollArea className="min-h-0 flex-1 pr-3">
              <div role="radiogroup" className="flex flex-col gap-2 pb-1" aria-label={t('enrollInDemoLesson')}>
                {visibleDemos.map((demo) => {
                  const state = getDemoEnrollmentState(demo, Number(lead?.id), demos);
                  const disabled = state !== 'available';
                  const selected = selectedDemoId === demo.id;
                  const startsAt = new Date(demo.scheduledAt);
                  const endsAt = new Date(lessonEndsAt(demo));
                  const availableSeats = Math.max(0, Number(demo.capacity) - activeParticipantCount(demo));
                  const statusLabel = state === 'already_enrolled'
                    ? t('demoAlreadyEnrolled')
                    : state === 'full'
                      ? t('demoNoSeats')
                      : state === 'lead_busy'
                        ? t('demoLeadBusy')
                        : t('demoSeatsAvailable')
                          .replace('{available}', String(availableSeats))
                          .replace('{capacity}', String(demo.capacity));
                  return (
                    <button
                      key={demo.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={disabled}
                      onClick={() => setSelectedDemoId(demo.id)}
                      className={cn(
                        'grid w-full grid-cols-[6.25rem_1fr_auto] items-stretch overflow-hidden rounded-xl border bg-card text-left outline-none transition-[border-color,box-shadow,background-color] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                        selected && 'border-primary bg-primary/[0.035] shadow-sm',
                        !selected && !disabled && 'border-border hover:border-primary/45 hover:shadow-sm',
                        disabled && 'cursor-not-allowed border-border/60 opacity-55',
                      )}
                    >
                      <span className="flex flex-col justify-center border-r border-border/70 bg-muted/45 px-3 py-3">
                        <span className="text-xs font-semibold capitalize text-foreground">
                          {dateFormatter.format(startsAt)}
                        </span>
                        <span className="mt-1 flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
                          <Clock3 className="size-3.5" />
                          {timeFormatter.format(startsAt)}–{timeFormatter.format(endsAt)}
                        </span>
                      </span>
                      <span className="min-w-0 px-3 py-3">
                        <span className="block truncate text-sm font-semibold">{demo.courseName}</span>
                        <span className="mt-1 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                          <UserRound className="size-3.5 shrink-0" /> {demo.teacherName}
                        </span>
                        <span className="mt-1 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                          <MapPin className="size-3.5 shrink-0" />
                          {demo.format === 'online'
                            ? t('demoOnlineLocation')
                            : [demo.schoolName, demo.roomName].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="flex min-w-32 flex-col items-end justify-between gap-2 px-3 py-3">
                        {selected ? <Check className="size-4 text-primary" /> : <CalendarDays className="size-4 text-muted-foreground" />}
                        <Badge variant={state === 'available' ? 'secondary' : 'outline'} className="max-w-40 whitespace-normal text-right">
                          <UsersRound className="size-3" /> {statusLabel}
                        </Badge>
                      </span>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          ) : (
            <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 text-center">
              <CalendarDays className="mb-3 size-8 text-muted-foreground/55" />
              <p className="text-sm font-medium">{search ? t('noSearchResults') : t('noUpcomingDemoLessons')}</p>
              {!search ? (
                <p className="mt-1 max-w-md text-sm text-muted-foreground">{t('noUpcomingDemoLessonsDescription')}</p>
              ) : null}
            </div>
          )}
        </div>

        <DialogFooter className={cn(
          'border-t border-border px-6 pb-6 pt-4',
          onCreateNew ? 'sm:justify-between' : 'sm:justify-end',
        )}>
          {onCreateNew ? (
            <Button type="button" variant="outline" onClick={onCreateNew} disabled={enroll.isPending}>
              <CalendarPlus2 data-icon="inline-start" />
              {t('createDemoLesson')}
            </Button>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={enroll.isPending}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => enroll.mutate()}
              disabled={!selectedDemoId || enroll.isPending}
            >
              {enroll.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Check data-icon="inline-start" />}
              {enroll.isPending ? t('saving') : t('enrollInDemoLesson')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
