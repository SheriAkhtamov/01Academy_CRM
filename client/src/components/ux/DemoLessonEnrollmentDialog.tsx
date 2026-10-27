import { EmployeeIdentity } from '@/components/ux/EmployeeIdentity';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  CalendarPlus2,
  Check,
  Clock3,
  MapPin,
  Search,
  UsersRound,
} from 'lucide-react';
import { CompactModalSection } from '@/components/ux/CompactModalSection';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { CreateLeadStudentDialog } from '@/components/ux/CreateLeadStudentDialog';
import {
  demoLessonQueryKeys,
  demoLessonsApi,
  type DemoLesson,
} from '@/features/demo-lessons/api';
import { invalidateSalesLeadData } from '@/features/sales/queries';
import { useLeadDetailsQuery } from '@/features/leads/queries';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { ACADEMY_TIME_ZONE } from '@/lib/localeFormat';
import { OrbitSpinner } from '@/components/ui/orbit-spinner';

const ACTIVE_PARTICIPANT_STATUSES = new Set(['invited', 'confirmed', 'attended', 'no_show']);

export interface DemoLessonEnrollmentLead {
  id: number;
  contactName: string;
  studentName?: string | null;
  courseId?: number | null;
  schoolId?: number | null;
}

interface DemoEnrollmentStudent {
  id: number;
  studentName?: string | null;
  studentAge?: number | null;
  status: string;
}

interface DemoEnrollmentLeadDetails {
  id: number;
  students?: DemoEnrollmentStudent[];
}

type EnrollmentState = 'available' | 'already_enrolled' | 'lead_busy' | 'closed';

const isActiveParticipant = (status: string) => ACTIVE_PARTICIPANT_STATUSES.has(status);

const lessonEndsAt = (demo: DemoLesson) => (
  new Date(demo.scheduledAt).getTime() + Number(demo.durationMinutes) * 60_000
);

export const getDemoEnrollmentState = (
  demo: DemoLesson,
  studentIds: readonly number[],
  demos: DemoLesson[],
  now = Date.now(),
): EnrollmentState => {
  const startsAt = new Date(demo.scheduledAt).getTime();
  if (demo.status !== 'scheduled' || !Number.isFinite(startsAt) || startsAt <= now) return 'closed';
  if (demo.participants.some((participant) => (
    studentIds.includes(Number(participant.studentId)) && isActiveParticipant(participant.status)
  ))) return 'already_enrolled';
  const endsAt = lessonEndsAt(demo);
  const hasOverlap = demos.some((candidate) => (
    Number(candidate.id) !== Number(demo.id)
    && candidate.status === 'scheduled'
    && candidate.participants.some((participant) => (
      studentIds.includes(Number(participant.studentId)) && isActiveParticipant(participant.status)
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
  onCreateNew?: (studentIds: number[]) => void;
}) {
  const { t, language } = useTranslation();
  const queryClient = useQueryClient();
  const [selectedDemoId, setSelectedDemoId] = useState<number | null>(null);
  const [selectedStudentIds, setSelectedStudentIds] = useState<number[]>([]);
  const [createStudentOpen, setCreateStudentOpen] = useState(false);
  const [search, setSearch] = useState('');
  useEffect(() => {
    setSelectedDemoId(null);
    setSelectedStudentIds([]);
    setCreateStudentOpen(false);
    setSearch('');
  }, [lead?.id, open]);

  const leadDetailsQuery = useLeadDetailsQuery<DemoEnrollmentLeadDetails>(lead?.id ?? null, open);
  const students = useMemo(() => leadDetailsQuery.data?.students ?? [], [leadDetailsQuery.data]);

  useEffect(() => {
    if (!open || students.length !== 1 || selectedStudentIds.length > 0) return;
    setSelectedStudentIds([students[0].id]);
  }, [open, selectedStudentIds.length, students]);

  const demoQuery = useQuery({
    queryKey: demoLessonQueryKeys.enrollment,
    queryFn: demoLessonsApi.listUpcoming,
    enabled: open && Boolean(lead),
    staleTime: 15_000,
  });
  const demos = useMemo(() => demoQuery.data ?? [], [demoQuery.data]);
  const upcomingDemos = useMemo(() => demos.filter((demo) => (
    getDemoEnrollmentState(demo, selectedStudentIds, demos) !== 'closed'
  )), [demos, selectedStudentIds]);
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
    mutationFn: () => demoLessonsApi.enroll(Number(selectedDemoId), { studentIds: selectedStudentIds }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: demoLessonQueryKeys.all }),
        invalidateSalesLeadData(queryClient, lead?.id),
      ]);
      toast({
        title: t('demoEnrollmentSaved'),
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

  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => !enroll.isPending && onOpenChange(nextOpen)}>
        {/* DialogContent carries a `grid` class that Tailwind emits after `flex`,
          so declaring rows is what actually bounds the scrollable middle. */}
        <DialogContent aria-describedby={undefined} className="compact-modal grid max-h-[calc(100dvh-2rem)] max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-0">
          <DialogHeader className="compact-modal-header">
            <DialogTitle>{t('enrollInDemoLesson')}</DialogTitle>
          </DialogHeader>

          <div className="compact-modal-body space-y-3 overflow-y-auto overscroll-contain">
            <CompactModalSection
              title={t('demoStudents')}
              summary={t('selectedStudentsCount').replace('{count}', String(selectedStudentIds.length))}
              icon={UsersRound}
              tone="teal"
              collapsible={false}
              disabled={enroll.isPending}
              actions={(
                <Button type="button" size="sm" variant="outline" onClick={() => setCreateStudentOpen(true)} disabled={enroll.isPending}>
                  {t('createStudentForDemo')}
                </Button>
              )}
            >
              {leadDetailsQuery.isLoading ? (
                <div className="flex min-h-16 items-center justify-center text-sm text-muted-foreground">
                  <OrbitSpinner className="mr-2 size-4" /> {t('loading')}
                </div>
              ) : leadDetailsQuery.isError ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p role="alert" className="text-sm text-destructive">{t('failedToLoadData')}</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => leadDetailsQuery.refetch()}>
                    {t('retry')}
                  </Button>
                </div>
              ) : students.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-background px-4 py-3 text-sm">
                  <p className="font-medium">{t('noStudentsForDemo')}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {students.map((student) => {
                    const checked = selectedStudentIds.includes(student.id);
                    const labelId = `demo-student-${student.id}`;
                    return (
                      <label
                        key={student.id}
                        id={labelId}
                        className="flex cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-background px-2.5 py-2 has-[[data-state=checked]]:border-teal-600/60 has-[[data-state=checked]]:bg-teal-500/10"
                      >
                        <Checkbox
                          checked={checked}
                          aria-labelledby={labelId}
                          onCheckedChange={(nextChecked) => {
                            setSelectedStudentIds((current) => nextChecked
                              ? [...current, student.id]
                              : current.filter((id) => id !== student.id));
                            setSelectedDemoId(null);
                          }}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {student.studentName || t('student')}
                          </span>
                          {student.studentAge ? (
                            <span className="block text-xs text-muted-foreground">
                              {student.studentAge} {t('years')}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </CompactModalSection>

            <CompactModalSection title={t('demoLesson')} icon={CalendarDays} tone="sky" collapsible={false} disabled={enroll.isPending} contentClassName="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setSelectedDemoId(null);
                  }}
                  placeholder={t('search')}
                  aria-label={t('searchDemoLessons')}
                  className="pl-9"
                />
              </div>

              {demoQuery.isError ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p role="alert" className="text-sm text-destructive">{t('failedToLoadDemoLessons')}</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => demoQuery.refetch()}>
                    {t('retry')}
                  </Button>
                </div>
              ) : demoQuery.isLoading ? (
                <div className="flex min-h-28 items-center justify-center text-sm text-muted-foreground">
                  <OrbitSpinner className="mr-2 size-4" /> {t('loading')}
                </div>
              ) : visibleDemos.length > 0 ? (
                <div role="radiogroup" className="flex flex-col gap-2 pb-1" aria-label={t('enrollInDemoLesson')}>
                  {visibleDemos.map((demo) => {
                    const state = getDemoEnrollmentState(demo, selectedStudentIds, demos);
                    const disabled = state !== 'available';
                    const selected = selectedDemoId === demo.id;
                    const startsAt = new Date(demo.scheduledAt);
                    const endsAt = new Date(lessonEndsAt(demo));
                    const statusLabel = state === 'already_enrolled'
                      ? t('demoAlreadyEnrolled')
                      : state === 'lead_busy'
                        ? t('demoLeadBusy')
                        : t('demoEnrolledCount')
                          .replace('{count}', String(activeParticipantCount(demo)));
                    return (
                      <button
                        key={demo.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={disabled}
                        onClick={() => setSelectedDemoId(demo.id)}
                        className={cn(
                          'grid w-full grid-cols-1 items-stretch overflow-hidden rounded-lg border bg-card text-left outline-none transition-[border-color,box-shadow,background-color] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:grid-cols-[6.25rem_minmax(0,1fr)_auto]',
                          selected && 'border-sky-600 bg-sky-500/10',
                          !selected && !disabled && 'border-border-strong hover:border-sky-600/60 hover:bg-sky-500/5',
                          disabled && 'cursor-not-allowed border-border/60 opacity-55',
                        )}
                      >
                        <span className="flex flex-col justify-center border-b border-border/70 bg-violet-500/10 px-3 py-2 sm:border-b-0 sm:border-r">
                          <span className="text-xs font-semibold capitalize text-foreground">
                            {dateFormatter.format(startsAt)}
                          </span>
                          <span className="mt-1 flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
                            <Clock3 className="size-3.5" />
                            {timeFormatter.format(startsAt)}–{timeFormatter.format(endsAt)}
                          </span>
                        </span>
                        <span className="min-w-0 px-3 py-2">
                          <span className="block truncate text-sm font-semibold">{demo.courseName}</span>
                          <span className="mt-1 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                            <EmployeeIdentity interactive={false} userId={demo.teacherUserId} name={demo.teacherName} avatarClassName="size-6" />
                          </span>
                          <span className="mt-1 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                            <MapPin className="size-3.5 shrink-0" />
                            {demo.format === 'online'
                              ? t('demoOnlineLocation')
                              : [demo.schoolName, demo.roomName].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                        <span className="flex min-w-0 items-center justify-between gap-2 px-3 pb-2 sm:min-w-32 sm:flex-col sm:items-end sm:py-2">
                          {selected ? <Check className="size-4 text-primary" /> : <CalendarDays className="size-4 text-muted-foreground" />}
                          <Badge variant={state === 'available' ? 'secondary' : 'outline'} className="max-w-40 whitespace-normal text-right">
                            <UsersRound className="size-3" /> {statusLabel}
                          </Badge>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex min-h-28 flex-col items-center justify-center rounded-lg border border-dashed border-border-strong px-3 py-4 text-center">
                  <CalendarDays className="mb-3 size-8 text-muted-foreground/55" />
                  <p className="text-sm font-medium">{search ? t('noSearchResults') : t('noUpcomingDemoLessons')}</p>
                </div>
              )}
            </CompactModalSection>
          </div>

          <DialogFooter className={cn(
            'compact-modal-footer',
            onCreateNew ? 'sm:justify-between' : 'sm:justify-end',
          )}>
            {onCreateNew ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => onCreateNew(selectedStudentIds)}
                disabled={selectedStudentIds.length === 0 || enroll.isPending}
              >
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
                disabled={selectedStudentIds.length === 0 || !selectedDemoId || enroll.isPending}
              >
                {enroll.isPending ? <OrbitSpinner className="" data-icon="inline-start" /> : <Check data-icon="inline-start" />}
                {enroll.isPending ? t('saving') : t('enrollInDemoLesson')}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {lead ? (
        <CreateLeadStudentDialog
          open={createStudentOpen}
          onOpenChange={setCreateStudentOpen}
          leadId={lead.id}
          contactName={lead.contactName}
          groups={[]}
          purpose="demo"
          onCreated={async (student) => {
            setSelectedStudentIds((current) => (
              current.includes(student.id) ? current : [...current, student.id]
            ));
            await leadDetailsQuery.refetch();
          }}
        />
      ) : null}
    </>
  );
}
