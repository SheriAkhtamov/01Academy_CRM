import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarPlus2,
  CheckCircle2,
  CircleAlert,
  Clock3,
  LoaderCircle,
  Search,
  UserRoundCheck,
  UsersRound,
} from 'lucide-react';
import type { DemoLessonMutation } from '@shared/contracts/demo-lessons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  demoLessonQueryKeys,
  demoLessonsApi,
  type DemoLesson,
  type DemoResourceAvailability,
} from '@/features/demo-lessons/api';
import { invalidateSalesLeadData } from '@/features/sales/queries';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';

export interface DemoLessonDialogLead {
  id: number;
  contactName: string;
  studentName?: string | null;
  studentAge?: number | null;
  courseId?: number | null;
  schoolId?: number | null;
  managerId?: number | null;
  isArchived?: boolean;
  statusCode?: string | null;
}

interface DemoLessonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leads: DemoLessonDialogLead[];
  courses: Array<{ id: number; name: string; lessonDurationMinutes?: number | null }>;
  schools: Array<{ id: number; name: string; isActive?: boolean }>;
  initialLeadId?: number | null;
  initialSchoolId?: number | null;
  onCreated?: (demo: DemoLesson) => void;
}

const ACADEMY_UTC_OFFSET_MINUTES = 5 * 60;
const academyWallClock = (instant: Date) => new Date(
  instant.getTime() + ACADEMY_UTC_OFFSET_MINUTES * 60_000,
);
const academyDateKey = (instant: Date) => academyWallClock(instant).toISOString().slice(0, 10);
const defaultDemoDateTime = () => {
  const shiftedNow = academyWallClock(new Date());
  const interval = 30 * 60_000;
  const rounded = new Date(Math.ceil((shiftedNow.getTime() + 60_000) / interval) * interval);
  return {
    date: rounded.toISOString().slice(0, 10),
    time: rounded.toISOString().slice(11, 16),
  };
};
const academyDateTime = (date: string, time: string) => (
  date && time ? `${date}T${time}:00+05:00` : ''
);

export function DemoLessonDialog({
  open,
  onOpenChange,
  leads,
  courses,
  schools,
  initialLeadId,
  initialSchoolId,
  onCreated,
}: DemoLessonDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [format, setFormat] = useState<'offline' | 'online'>('offline');
  const [courseId, setCourseId] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [demoDate, setDemoDate] = useState('');
  const [demoTime, setDemoTime] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('60');
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<number>>(new Set());
  const [leadSearch, setLeadSearch] = useState('');
  const [notes, setNotes] = useState('');

  const activeLeads = useMemo(
    () => leads.filter((lead) => !lead.isArchived && lead.statusCode !== 'paid'),
    [leads],
  );
  const filteredLeads = useMemo(() => {
    const query = leadSearch.trim().toLocaleLowerCase();
    if (!query) return activeLeads;
    return activeLeads.filter((lead) => (
      lead.contactName.toLocaleLowerCase().includes(query)
      || String(lead.studentName ?? '').toLocaleLowerCase().includes(query)
    ));
  }, [activeLeads, leadSearch]);
  const participantIds = useMemo(
    () => [...selectedLeadIds].sort((left, right) => left - right),
    [selectedLeadIds],
  );
  const participantKey = participantIds.join(',');
  const scheduledAt = academyDateTime(demoDate, demoTime);
  const duration = Number(durationMinutes);

  useEffect(() => {
    if (!open) return;
    const initialLead = initialLeadId
      ? activeLeads.find((lead) => Number(lead.id) === Number(initialLeadId))
      : null;
    const nextCourseId = initialLead?.courseId ? String(initialLead.courseId) : '';
    const courseDuration = courses.find((course) => String(course.id) === nextCourseId)
      ?.lessonDurationMinutes;
    const defaults = defaultDemoDateTime();
    setSelectedLeadIds(initialLead ? new Set([initialLead.id]) : new Set());
    setCourseId(nextCourseId);
    setSchoolId(initialSchoolId
      ? String(initialSchoolId)
      : initialLead?.schoolId
        ? String(initialLead.schoolId)
        : '');
    setTeacherId('');
    setRoomId('');
    setDemoDate(defaults.date);
    setDemoTime(defaults.time);
    setDurationMinutes(String(Number(courseDuration) >= 15 ? courseDuration : 60));
    setFormat('offline');
    setLeadSearch('');
    setNotes('');
  }, [activeLeads, courses, initialLeadId, initialSchoolId, open]);

  const availabilityRequest = useMemo(() => {
    if (
      !courseId
      || !schoolId
      || !scheduledAt
      || !Number.isInteger(duration)
      || duration < 15
      || duration > 480
    ) return null;
    return {
      courseId: Number(courseId),
      schoolId: Number(schoolId),
      scheduledAt,
      durationMinutes: duration,
      format,
      participantIds,
    };
  }, [courseId, duration, format, participantIds, scheduledAt, schoolId]);

  const resourceAvailability = useQuery<DemoResourceAvailability>({
    queryKey: [
      ...demoLessonQueryKeys.resourceAvailability,
      courseId,
      schoolId,
      scheduledAt,
      duration,
      format,
      participantKey,
    ],
    queryFn: () => demoLessonsApi.resourceAvailability(availabilityRequest!),
    enabled: open && Boolean(availabilityRequest),
    retry: false,
  });
  const teachers = resourceAvailability.data?.teachers ?? [];
  const rooms = resourceAvailability.data?.rooms ?? [];
  const selectedTeacher = teachers.find((teacher) => String(teacher.id) === teacherId);
  const selectedRoom = rooms.find((room) => String(room.id) === roomId);

  const handleCourseChange = (value: string) => {
    const courseDuration = courses.find((course) => String(course.id) === value)
      ?.lessonDurationMinutes;
    setCourseId(value);
    setDurationMinutes(String(Number(courseDuration) >= 15 ? courseDuration : 60));
  };
  const handleSchoolChange = (value: string) => {
    setSchoolId(value);
    setRoomId('');
  };
  const handleFormatChange = (value: 'offline' | 'online') => {
    setFormat(value);
    if (value === 'online') setRoomId('');
  };
  const toggleLead = (leadId: number, checked: boolean) => {
    setSelectedLeadIds((current) => {
      const next = new Set(current);
      if (checked) next.add(leadId);
      else next.delete(leadId);
      return next;
    });
  };
  const unavailableLabel = (reason: string | null) => {
    if (reason === 'inactive') return t('demoResourceInactive');
    if (reason === 'too_small') return t('demoRoomTooSmallShort');
    return t('demoResourceBusyShort');
  };
  const conflictMessage = resourceAvailability.data?.participantConflict
    ? t('demoParticipantBusy')
    : selectedTeacher && !selectedTeacher.available
      ? selectedTeacher.reason === 'inactive' ? t('teacherNotActive') : t('demoTeacherBusy')
      : format === 'offline' && selectedRoom && !selectedRoom.available
        ? selectedRoom.reason === 'too_small'
          ? t('demoExceedsRoomCapacity')
          : selectedRoom.reason === 'inactive'
            ? t('demoRoomInactive')
            : t('roomOccupied')
        : null;

  const mutationPayload = useMemo<DemoLessonMutation | null>(() => {
    if (!availabilityRequest || !teacherId || (format === 'offline' && !roomId)) return null;
    return {
      ...availabilityRequest,
      teacherId: Number(teacherId),
      roomId: format === 'offline' ? Number(roomId) : null,
      capacity: participantIds.length,
      participantIds,
      notes: notes.trim() || null,
    };
  }, [availabilityRequest, format, notes, participantIds, roomId, teacherId]);

  const createDemo = useMutation({
    mutationFn: async () => {
      if (!mutationPayload) throw new Error(t('fillRequiredFields'));
      return demoLessonsApi.create(mutationPayload);
    },
    onSuccess: async (demo) => {
      await Promise.all([
        invalidateSalesLeadData(queryClient),
        queryClient.invalidateQueries({ queryKey: demoLessonQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: demoLessonQueryKeys.availability }),
        queryClient.invalidateQueries({ queryKey: demoLessonQueryKeys.resourceAvailability }),
      ]);
      toast({ title: t('demoLessonCreated'), description: t('demoLessonCreatedDescription') });
      onOpenChange(false);
      onCreated?.(demo);
    },
    onError: async (error: Error & { status?: number }) => {
      if (error.status === 409) {
        await queryClient.invalidateQueries({ queryKey: demoLessonQueryKeys.resourceAvailability });
      }
      toast({ title: t('demoLessonCreateFailed'), description: error.message, variant: 'destructive' });
    },
  });

  const resourcesSelected = Boolean(
    selectedTeacher?.available
    && (format === 'online' || selectedRoom?.available),
  );
  const canSubmit = Boolean(
    mutationPayload
    && participantIds.length > 0
    && resourceAvailability.data
    && !resourceAvailability.data.participantConflict
    && resourcesSelected
    && !resourceAvailability.isFetching
    && !createDemo.isPending,
  );

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!createDemo.isPending) onOpenChange(nextOpen);
    }}>
      <DialogContent className="max-h-[92dvh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus2 data-icon="inline-start" />
            {t('createDemoLesson')}
          </DialogTitle>
          <DialogDescription>{t('createDemoLessonDescription')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="demo-format">{t('demoFormat')}</Label>
            <Select value={format} onValueChange={(value) => handleFormatChange(value as 'offline' | 'online')}>
              <SelectTrigger id="demo-format"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="offline">{t('offline')}</SelectItem>
                <SelectItem value="online">{t('online')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="demo-school">{t('school')}</Label>
            <Select value={schoolId} onValueChange={handleSchoolChange}>
              <SelectTrigger id="demo-school"><SelectValue placeholder={t('selectSchool')} /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {schools.filter((school) => school.isActive !== false).map((school) => (
                    <SelectItem key={school.id} value={String(school.id)}>{school.name}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="demo-course">{t('course')}</Label>
            <Select value={courseId} onValueChange={handleCourseChange}>
              <SelectTrigger id="demo-course"><SelectValue placeholder={t('selectCourse')} /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {courses.map((course) => (
                    <SelectItem key={course.id} value={String(course.id)}>{course.name}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-4 rounded-xl border border-border p-4">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Clock3 data-icon="inline-start" />{t('demoScheduleDetails')}
            </p>
            <p className="text-xs text-muted-foreground">{t('demoTimeZoneHint')}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="demo-date">{t('dateColumn')}</Label>
              <Input
                id="demo-date"
                type="date"
                min={academyDateKey(new Date())}
                value={demoDate}
                onChange={(event) => setDemoDate(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="demo-time">{t('time')}</Label>
              <Input
                id="demo-time"
                type="time"
                step={900}
                value={demoTime}
                onChange={(event) => setDemoTime(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="demo-duration">{t('demoDurationMinutes')}</Label>
              <Input
                id="demo-duration"
                type="number"
                min={15}
                max={480}
                step={15}
                value={durationMinutes}
                onChange={(event) => setDurationMinutes(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="demo-teacher">{t('teacher')}</Label>
              <Select value={teacherId} onValueChange={setTeacherId} disabled={!resourceAvailability.data}>
                <SelectTrigger id="demo-teacher"><SelectValue placeholder={t('selectTeacher')} /></SelectTrigger>
                <SelectContent>
                  {teachers.map((teacher) => (
                    <SelectItem key={teacher.id} value={String(teacher.id)} disabled={!teacher.available}>
                      {teacher.fullName}{teacher.available ? '' : ` · ${unavailableLabel(teacher.reason)}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {format === 'offline' ? (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="demo-room">{t('room')}</Label>
                <Select value={roomId} onValueChange={setRoomId} disabled={!resourceAvailability.data}>
                  <SelectTrigger id="demo-room"><SelectValue placeholder={t('selectDemoRoom')} /></SelectTrigger>
                  <SelectContent>
                    {rooms.map((room) => (
                      <SelectItem key={room.id} value={String(room.id)} disabled={!room.available}>
                        {room.name} · {room.capacity} {t('seats')}
                        {room.available ? '' : ` · ${unavailableLabel(room.reason)}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>

          <div aria-live="polite">
            {!availabilityRequest ? (
              <p className="text-sm text-muted-foreground">{t('completeDemoScheduleForAvailability')}</p>
            ) : resourceAvailability.isFetching ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />{t('checkingAvailability')}
              </p>
            ) : resourceAvailability.isError ? (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                  <span>{resourceAvailability.error.message}</span>
                  <Button type="button" size="sm" variant="outline" onClick={() => resourceAvailability.refetch()}>
                    {t('retry')}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : conflictMessage ? (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertDescription>{conflictMessage}</AlertDescription>
              </Alert>
            ) : resourcesSelected ? (
              <Alert>
                <CheckCircle2 />
                <AlertDescription>{t('demoResourcesAvailable')}</AlertDescription>
              </Alert>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <UserRoundCheck className="size-4" />{t('selectDemoResources')}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold">
                <UsersRound data-icon="inline-start" />{t('demoParticipants')}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('demoParticipantsSelected').replace('{count}', String(selectedLeadIds.size))}
              </p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={leadSearch}
                onChange={(event) => setLeadSearch(event.target.value)}
                placeholder={t('searchLeadsForDemo')}
                className="pl-9"
              />
            </div>
          </div>
          <ScrollArea className="h-44 rounded-lg border border-border">
            <div className="grid gap-1 p-2 sm:grid-cols-2">
              {filteredLeads.map((lead) => {
                const checked = selectedLeadIds.has(lead.id);
                return (
                  <Label
                    key={lead.id}
                    htmlFor={`demo-lead-${lead.id}`}
                    className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-muted focus-within:ring-2 focus-within:ring-ring"
                  >
                    <Checkbox
                      id={`demo-lead-${lead.id}`}
                      checked={checked}
                      onCheckedChange={(value) => toggleLead(lead.id, value === true)}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{lead.studentName || lead.contactName}</span>
                      {lead.studentName ? (
                        <span className="block truncate text-xs text-muted-foreground">{lead.contactName}</span>
                      ) : null}
                    </span>
                  </Label>
                );
              })}
              {filteredLeads.length === 0 ? (
                <p className="col-span-full p-5 text-center text-sm text-muted-foreground">{t('noLeadsFound')}</p>
              ) : null}
            </div>
          </ScrollArea>
        </div>

        <div className="space-y-2">
          <Label htmlFor="demo-notes">{t('comment')}</Label>
          <Textarea
            id="demo-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={t('demoNotesPlaceholder')}
            maxLength={2_000}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={createDemo.isPending}>
            {t('cancel')}
          </Button>
          <Button type="button" onClick={() => createDemo.mutate()} disabled={!canSubmit}>
            {createDemo.isPending
              ? <LoaderCircle className="animate-spin" data-icon="inline-start" />
              : <CalendarPlus2 data-icon="inline-start" />}
            {createDemo.isPending ? t('saving') : t('bookDemoLesson')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
