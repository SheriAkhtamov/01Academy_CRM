import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarPlus2,
  CheckCircle2,
  CircleAlert,
  Clock3,
  LoaderCircle,
  UserRoundCheck,
} from 'lucide-react';
import type { DemoLessonMutation } from '@shared/contracts/demo-lessons';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  UnsavedChangesDialog,
  useUnsavedChangesGuard,
} from '@/components/ux/UnsavedChangesGuard';
import {
  demoLessonQueryKeys,
  demoLessonsApi,
  type DemoLesson,
  type DemoResourceAvailability,
} from '@/features/demo-lessons/api';
import { invalidateSalesLeadData } from '@/features/sales/queries';
import { useTranslation } from '@/hooks/useTranslation';
import { academyToday } from '@/lib/localeFormat';
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
  /** Booking straight from a calendar slot: `yyyy-MM-dd` and `HH:mm`. */
  initialDate?: string;
  initialTime?: string;
  onCreated?: (demo: DemoLesson) => void;
}

const ACADEMY_UTC_OFFSET_MINUTES = 5 * 60;
const academyWallClock = (instant: Date) => new Date(
  instant.getTime() + ACADEMY_UTC_OFFSET_MINUTES * 60_000,
);
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
  initialDate,
  initialTime,
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
  const [notes, setNotes] = useState('');
  // Values the form was seeded with. Comparing them against the live fields
  // tells "the user typed something" apart from "a background refetch replaced
  // the props", so reseeding never wipes in-progress input.
  const seededValuesRef = useRef<Record<string, string>>({});
  const [seededValues, setSeededValues] = useState<Record<string, string>>({});

  const activeLeads = useMemo(
    () => leads.filter((lead) => !lead.isArchived && lead.statusCode !== 'paid'),
    [leads],
  );
  // The dialog only books resources: the lead it was opened from is the single
  // participant, everyone else is enrolled later from the lead card.
  const initialLead = useMemo(() => (
    initialLeadId
      ? activeLeads.find((lead) => Number(lead.id) === Number(initialLeadId)) ?? null
      : null
  ), [activeLeads, initialLeadId]);
  const participantIds = useMemo(
    () => (initialLead ? [Number(initialLead.id)] : []),
    [initialLead],
  );
  const participantKey = participantIds.join(',');
  const scheduledAt = academyDateTime(demoDate, demoTime);
  const duration = Number(durationMinutes);

  useEffect(() => {
    if (!open) {
      seededValuesRef.current = {};
      setSeededValues({});
      return;
    }
    const current: Record<string, string> = {
      format, courseId, schoolId, teacherId, roomId,
      demoDate, demoTime, durationMinutes, notes,
    };
    // Re-seed only while every field still holds its seeded value. Once the
    // user edits anything, background refetches must not reset their draft.
    const previousSeeded = seededValuesRef.current;
    const untouched = Object.entries(previousSeeded).every(
      ([key, value]) => current[key] === value,
    );
    if (previousSeeded && !untouched) return;
    const nextCourseId = initialLead?.courseId ? String(initialLead.courseId) : '';
    const courseDuration = courses.find((course) => String(course.id) === nextCourseId)
      ?.lessonDurationMinutes;
    const defaults = defaultDemoDateTime();
    const next: Record<string, string> = {
      format: 'offline',
      courseId: nextCourseId,
      schoolId: initialSchoolId
        ? String(initialSchoolId)
        : initialLead?.schoolId
          ? String(initialLead.schoolId)
          : '',
      teacherId: '',
      roomId: '',
      demoDate: initialDate || defaults.date,
      demoTime: initialTime || defaults.time,
      durationMinutes: String(Number(courseDuration) >= 15 ? courseDuration : 60),
      notes: '',
    };
    setFormat(next.format as 'offline' | 'online');
    setCourseId(next.courseId);
    setSchoolId(next.schoolId);
    setTeacherId(next.teacherId);
    setRoomId(next.roomId);
    setDemoDate(next.demoDate);
    setDemoTime(next.demoTime);
    setDurationMinutes(next.durationMinutes);
    setNotes(next.notes);
    seededValuesRef.current = next;
    setSeededValues(next);
  }, [courses, demoDate, demoTime, durationMinutes, format, courseId, schoolId, teacherId, roomId, notes, initialDate, initialLead, initialSchoolId, initialTime, open]);

  const isDirty = useMemo(() => Object.entries(seededValues).some(([key, value]) => ({
    format, courseId, schoolId, teacherId, roomId, demoDate, demoTime, durationMinutes, notes,
  } as Record<string, string>)[key] !== value), [seededValues, format, courseId, schoolId, teacherId, roomId, demoDate, demoTime, durationMinutes, notes]);

  const demoGuard = useUnsavedChangesGuard({
    open,
    isDirty,
    onOpenChange,
  });

  const seededDuration = Number(seededValues.durationMinutes);
  const durationOutOfRange = Boolean(durationMinutes)
    && !(Number(durationMinutes) >= 15 && Number(durationMinutes) <= 480)
    && Number(durationMinutes) !== seededDuration;

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
  const unavailableLabel = (reason: string | null) => {
    if (reason === 'inactive') return t('demoResourceInactive');
    return t('demoResourceBusyShort');
  };
  const conflictMessage = resourceAvailability.data?.participantConflict
    ? t('demoParticipantBusy')
    : selectedTeacher && !selectedTeacher.available
      ? selectedTeacher.reason === 'inactive' ? t('teacherNotActive') : t('demoTeacherBusy')
      : format === 'offline' && selectedRoom && !selectedRoom.available
        ? selectedRoom.reason === 'inactive'
          ? t('demoRoomInactive')
          : t('roomOccupied')
        : null;

  const mutationPayload = useMemo<DemoLessonMutation | null>(() => {
    if (!availabilityRequest || !teacherId || (format === 'offline' && !roomId)) return null;
    return {
      ...availabilityRequest,
      teacherId: Number(teacherId),
      roomId: format === 'offline' ? Number(roomId) : null,
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
    && resourceAvailability.data
    && !resourceAvailability.data.participantConflict
    && resourcesSelected
    && !resourceAvailability.isFetching
    && !createDemo.isPending,
  );

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (createDemo.isPending) return;
      demoGuard.handleOpenChange(nextOpen);
    }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus2 data-icon="inline-start" />
            {t('createDemoLesson')}
          </DialogTitle>
          <DialogDescription>{t('createDemoLessonDescription')}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-6 py-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
          <div className="grid grid-cols-tile gap-4">
            <div className="space-y-2">
              <Label htmlFor="demo-date">{t('dateColumn')}</Label>
              <Input
                id="demo-date"
                type="date"
                min={academyToday()}
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
                        {room.name}
                        {room.available ? '' : ` · ${unavailableLabel(room.reason)}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>

          <div aria-live="polite">
            {durationOutOfRange ? (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertDescription>{t('demoDurationRangeHint')}</AlertDescription>
              </Alert>
            ) : !availabilityRequest ? (
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
        </div>

        <DialogFooter className="shrink-0 border-t bg-background/95 px-6 py-4">
          <Button type="button" variant="outline" onClick={() => demoGuard.handleOpenChange(false)} disabled={createDemo.isPending}>
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

      <UnsavedChangesDialog
        open={demoGuard.confirmationOpen}
        onOpenChange={demoGuard.setConfirmationOpen}
        onDiscard={demoGuard.discardChanges}
      />
    </Dialog>
  );
}
