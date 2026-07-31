import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus2, Search, UsersRound } from 'lucide-react';
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
import { AvailabilityCalendar } from '@/components/ux/AvailabilityCalendar';
import {
  demoLessonQueryKeys,
  demoLessonsApi,
  type AvailabilitySlot,
  type DemoLesson,
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
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<number>>(new Set());
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null);
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
  const selectedLeadKey = useMemo(
    () => [...selectedLeadIds].sort((left, right) => left - right).join(','),
    [selectedLeadIds],
  );

  useEffect(() => {
    if (!open) return;
    const initialLead = initialLeadId
      ? activeLeads.find((lead) => Number(lead.id) === Number(initialLeadId))
      : null;
    setSelectedLeadIds(initialLead ? new Set([initialLead.id]) : new Set());
    setCourseId(initialLead?.courseId ? String(initialLead.courseId) : '');
    setSchoolId(initialSchoolId
      ? String(initialSchoolId)
      : initialLead?.schoolId
        ? String(initialLead.schoolId)
        : '');
    setFormat('offline');
    setSelectedSlot(null);
    setLeadSearch('');
    setNotes('');
  }, [activeLeads, initialLeadId, initialSchoolId, open]);

  useEffect(() => {
    setSelectedSlot(null);
  }, [courseId, format, schoolId, selectedLeadKey]);

  const createDemo = useMutation({
    mutationFn: async () => {
      if (!selectedSlot) throw new Error(t('selectDemoSlot'));
      const durationMinutes = Math.round(
        (new Date(selectedSlot.endsAt).getTime() - new Date(selectedSlot.startsAt).getTime()) / 60_000,
      );
      return demoLessonsApi.create({
        courseId: Number(courseId),
        schoolId: Number(schoolId),
        roomId: format === 'offline' ? Number(selectedSlot.roomId) : null,
        teacherId: selectedSlot.teacherId,
        scheduledAt: selectedSlot.startsAt,
        durationMinutes,
        format,
        capacity: selectedLeadIds.size,
        participantIds: [...selectedLeadIds],
        notes: notes.trim() || null,
      });
    },
    onSuccess: async (demo) => {
      await Promise.all([
        invalidateSalesLeadData(queryClient),
        queryClient.invalidateQueries({ queryKey: demoLessonQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: demoLessonQueryKeys.availability }),
      ]);
      toast({ title: t('demoLessonCreated'), description: t('demoLessonCreatedDescription') });
      onOpenChange(false);
      onCreated?.(demo);
    },
    onError: async (error: Error & { status?: number }) => {
      if (error.status === 409) {
        setSelectedSlot(null);
        await queryClient.invalidateQueries({ queryKey: demoLessonQueryKeys.availability });
      }
      toast({ title: t('demoLessonCreateFailed'), description: error.message, variant: 'destructive' });
    },
  });

  const toggleLead = (leadId: number, checked: boolean) => {
    setSelectedLeadIds((current) => {
      const next = new Set(current);
      if (checked) next.add(leadId);
      else next.delete(leadId);
      return next;
    });
  };

  const canSubmit = Boolean(
    courseId
    && schoolId
    && selectedLeadIds.size > 0
    && selectedSlot
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
            <Select value={format} onValueChange={(value) => setFormat(value as 'offline' | 'online')}>
              <SelectTrigger id="demo-format"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="offline">{t('offline')}</SelectItem>
                <SelectItem value="online">{t('online')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="demo-school">{t('school')}</Label>
            <Select value={schoolId} onValueChange={setSchoolId}>
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
            <Select value={courseId} onValueChange={setCourseId}>
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

        <AvailabilityCalendar
          schoolId={Number(schoolId) || null}
          courseId={Number(courseId) || null}
          value={selectedSlot}
          onChange={setSelectedSlot}
          format={format}
          participantCount={Math.max(1, selectedLeadIds.size)}
          participantIds={[...selectedLeadIds]}
          excludeLeadId={selectedLeadIds.size === 1 ? [...selectedLeadIds][0] : null}
        />

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
            <CalendarPlus2 data-icon="inline-start" />
            {createDemo.isPending ? t('saving') : t('bookDemoLesson')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
