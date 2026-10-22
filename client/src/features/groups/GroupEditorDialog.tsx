import { EmployeeIdentity } from '@/components/ux/EmployeeIdentity';
import { EmployeeCardButton } from '@/features/employees/EmployeeCardTrigger';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { FieldErrors } from 'react-hook-form';
import type { GroupValues } from '@/lib/academyResourceSchemas';
import { CompactModalSection } from '@/components/ux/CompactModalSection';
import {
  CalendarClock,
  CalendarRange,
  GraduationCap,
  RotateCcw,
  TriangleAlert,
  UsersRound,
} from 'lucide-react';
import { GroupIdentityFields } from './GroupIdentityFields';
import { GroupLessonSelect } from './GroupLessonSelect';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { GroupStatusBadge } from '@/components/ux/teacher/TeacherStatusBadge';
import { UnsavedChangesDialog } from '@/components/ux/UnsavedChangesGuard';
import { FutureGroupStartDialog } from '@/components/ux/FutureGroupStartDialog';
import { GroupStatusField } from '@/components/ux/GroupStatusField';
import { WeekScheduleEditor, type WeekScheduleItem } from '@/components/ux/WeekScheduleEditor';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  getGroupScheduleValidationError,
  getMinimumGroupEndDate,
  normalizeWeeklySchedule,
  type GroupScheduleValidationError,
} from '@shared/scheduling';
import type { ScheduleClash, TeacherConflict } from './editorInsights';
import { formatSlotTime, groupNameParts, summarizeSchedule } from './presentation';
import { useGroupEditor, type GroupEditorProps } from './useGroupEditor';

const SCHEDULE_ERROR_KEYS = {
  groupScheduleRequired: 'groupScheduleRequired',
  groupScheduleInvalid: 'groupScheduleInvalid',
  groupScheduleOverlap: 'groupScheduleOverlap',
} as const satisfies Record<GroupScheduleValidationError, TranslationKey>;

const CAPACITY_PRESETS = [6, 8, 10, 12, 15] as const;
const DURATION_PRESETS = [60, 90, 120] as const;

type EditorSectionId = 'identity' | 'place' | 'schedule' | 'dates';
const FIELD_SECTIONS: Partial<Record<keyof GroupValues, EditorSectionId>> = {
  name: 'identity', nameSuffix: 'identity', deliveryMode: 'identity', trainingType: 'identity',
  status: 'identity', maxStudents: 'identity', courseId: 'place', schoolId: 'place',
  roomId: 'place', teacherId: 'place', selectedCourseLessonIds: 'dates', lessonCount: 'dates',
  lessonDurationMinutes: 'dates', startDate: 'dates', endDate: 'dates',
};

function QuickNumberPresets({
  options,
  currentValue,
  unit,
  onSelect,
}: {
  options: readonly number[];
  currentValue: number;
  unit?: string;
  onSelect: (value: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 pt-0.5">
      {options.map((preset) => {
        const active = Number(currentValue) === preset;
        return (
          <button
            key={preset}
            type="button"
            onClick={() => onSelect(preset)}
            className={cn(
              'rounded-md border px-2 py-0.5 text-[11px] tabular-nums transition-colors',
              active
                ? 'border-primary/40 bg-primary/10 font-semibold text-primary'
                : 'border-border/70 bg-muted/35 text-muted-foreground hover:bg-muted/70 hover:text-foreground',
            )}
          >
            {unit ? `${preset} ${unit}` : preset}
          </button>
        );
      })}
    </div>
  );
}

function ClashNotice({ title, clashes, shortDayNames }: { title: string; clashes: ScheduleClash[]; shortDayNames: string[] }) {
  return (
    <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-900 dark:text-amber-100">
      <p className="flex items-center gap-2 font-medium">
        <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
        {title}
      </p>
      <ul className="mt-1.5 space-y-1 pl-6 text-xs">
        {clashes.slice(0, 3).map((clash) => (
          <li key={`${clash.group.id}-${clash.dayOfWeek}-${clash.startMinutes}`} className="tabular-nums">
            {shortDayNames[clash.dayOfWeek - 1]} {formatSlotTime(clash)} · {groupNameParts(clash.group.name).shortLabel}
          </li>
        ))}
      </ul>
    </div>
  );
}

function useTeacherConflictLabel() {
  const { t } = useTranslation();
  return (conflict: TeacherConflict | null) => {
    if (conflict?.issue === 'otherBranch') return t('groupTeacherOtherBranch');
    if (conflict?.issue === 'offHours') return t('groupTeacherOffHours');
    if (conflict?.issue === 'busy' && conflict.clash) {
      return t('groupScheduleOverlapsWith').replace('{group}', groupNameParts(conflict.clash.group.name).shortLabel);
    }
    return null;
  };
}

function computeWeeklyHours(schedule: WeekScheduleItem[], fallbackMinutes: number) {
  const normalized = normalizeWeeklySchedule(schedule, fallbackMinutes);
  const totalMinutes = normalized.reduce((sum, item) => sum + Math.max(0, item.endMinutes - item.startMinutes), 0);
  const hours = totalMinutes / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

export function GroupEditorDialog(props: GroupEditorProps) {
  const { open, group: editingGroup } = props;
  const {
    t, language, schools, courses, groupForm, groupGuard, groupSchedule, updateGroupSchedule,
    selectedGroupSchoolId, selectedGroupStartDate, minimumGroupEndDate,
    isGroupEndDateTooEarly, groupRooms, saveGroup, submitGroupValues,
    autoNaming, groupCode, groupCodeError, codeCatalogue, trainingType,
    futureGroupStartValues, setFutureGroupStartValues,
    scheduleError, setScheduleError, followEndDate, applyScheduleEndDate, releaseEndDate,
    roomClashes, busyRoomIds, selectedTeacherConflict, groupTeachers,
    selectedCourse, updateSelectedCourse, updateSelectedLessons,
  } = useGroupEditor(props);
  const teacherConflictLabel = useTeacherConflictLabel()(selectedTeacherConflict);
  const scheduleRef = useRef<HTMLElement>(null);
  const [openSections, setOpenSections] = useState<Record<EditorSectionId, boolean>>({
    identity: true, place: false, schedule: false, dates: false,
  });
  useEffect(() => {
    if (open) setOpenSections({ identity: true, place: false, schedule: false, dates: false });
  }, [open, editingGroup?.id]);
  const setSectionOpen = (section: EditorSectionId, expanded: boolean) => {
    setOpenSections((current) => ({ ...current, [section]: expanded }));
  };
  const revealField = (field: keyof GroupValues) => {
    const section = FIELD_SECTIONS[field];
    if (section) setSectionOpen(section, true);
    window.requestAnimationFrame(() => groupForm.setFocus(field === 'name' && autoNaming ? 'nameSuffix' : field));
  };
  const revealErrors = (errors: FieldErrors<GroupValues>) => {
    const fields = (Object.keys(FIELD_SECTIONS) as (keyof GroupValues)[]).filter((field) => errors[field]);
    setOpenSections((current) => {
      const next = { ...current };
      fields.forEach((field) => { const section = FIELD_SECTIONS[field]; if (section) next[section] = true; });
      return next;
    });
    const firstField = fields.find((field) => field !== 'name' || !autoNaming || Boolean(groupCode)) ?? fields[0];
    if (firstField) revealField(firstField);
    return fields.length > 0;
  };
  const dayNames = [t('monday'), t('tuesday'), t('wednesday'), t('thursday'), t('friday'), t('saturday'), t('sunday')];
  const shortDayNames = useMemo(() => [t('mondayShort'), t('tuesdayShort'), t('wednesdayShort'), t('thursdayShort'),
    t('fridayShort'), t('saturdayShort'), t('sundayShort')], [t]);
  const shortDate = (key: string) => new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  }).format(new Date(`${key}T00:00:00Z`));

  const watchedStatus = groupForm.watch('status');
  const watchedName = groupForm.watch('name');
  const watchedTeacherId = groupForm.watch('teacherId');
  const selectedTeacher = groupTeachers.find((teacher) => String(teacher.id) === watchedTeacherId);
  const selectedSchool = schools.find((school) => String(school.id) === selectedGroupSchoolId);
  const watchedMaxStudents = Number(groupForm.watch('maxStudents')) || 0;
  const watchedRoomId = groupForm.watch('roomId');
  const watchedLessonCount = Number(groupForm.watch('lessonCount')) || 0;
  const watchedDuration = Number(groupForm.watch('lessonDurationMinutes')) || 120;
  const watchedEndDate = groupForm.watch('endDate');

  const selectedRoom = useMemo(
    () => groupRooms.find((room) => String(room.id) === watchedRoomId),
    [groupRooms, watchedRoomId],
  );
  const roomCapacityExceeded = Boolean(
    selectedRoom && watchedMaxStudents > 0 && selectedRoom.capacity < watchedMaxStudents,
  );

  const weeklyHours = useMemo(
    () => computeWeeklyHours(groupSchedule, watchedDuration),
    [groupSchedule, watchedDuration],
  );
  const totalCourseHours = useMemo(() => {
    const hours = (watchedLessonCount * watchedDuration) / 60;
    return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  }, [watchedDuration, watchedLessonCount]);

  const scheduleSummaryText = useMemo(() => {
    const slots = normalizeWeeklySchedule(groupSchedule, watchedDuration);
    if (slots.length === 0) return '';
    return summarizeSchedule(slots, shortDayNames)
      .map((entry) => `${entry.days} ${entry.time}`)
      .join(' · ');
  }, [groupSchedule, shortDayNames, watchedDuration]);

  /* A missing schedule used to surface only as a toast after "Save"; now it
     sits under the schedule itself, which scrolls into view. */
  const showScheduleError = (focus = true) => {
    const problem = getGroupScheduleValidationError(groupSchedule);
    setScheduleError(problem);
    if (problem) {
      setSectionOpen('schedule', true);
      if (focus) window.requestAnimationFrame(() => {
        scheduleRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const invalidTime = scheduleRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
        const firstDay = scheduleRef.current?.querySelector<HTMLElement>('[role="checkbox"]');
        (invalidTime ?? firstDay)?.focus();
      });
    }
    return problem;
  };

  const handleFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.requestSubmit();
    }
  };

  return <>
      <Dialog open={open} onOpenChange={(nextOpen) => { if (!saveGroup.isPending) groupGuard.handleOpenChange(nextOpen); }}>
        <DialogContent aria-describedby={undefined} className="compact-modal flex max-h-[calc(100dvh-2rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="compact-modal-header shrink-0 pr-12 text-left">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20" aria-hidden="true">
                  <UsersRound className="size-4" />
                </span>
                <div className="min-w-0">
                  <DialogTitle className="text-base font-semibold tracking-tight sm:text-lg">
                    {editingGroup ? t('editGroup') : t('createGroup')}
                  </DialogTitle>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {groupCode ? (
                  <span className="rounded-md border border-primary/25 bg-primary/8 px-2 py-0.5 font-mono text-xs font-semibold text-primary">
                    {groupCode}
                  </span>
                ) : null}
                <GroupStatusBadge status={watchedStatus} />
              </div>
            </div>
          </DialogHeader>
          <Form {...groupForm}>
            <form
              noValidate
              className="flex min-h-0 flex-1 flex-col"
              onKeyDown={handleFormKeyDown}
              onSubmit={groupForm.handleSubmit((values) => {
                if (showScheduleError()) return;
                const earliestEndDate = getMinimumGroupEndDate({
                  startDate: values.startDate,
                  lessonCount: Number(values.lessonCount),
                  schedule: groupSchedule,
                });
                if (earliestEndDate && values.endDate && values.endDate < earliestEndDate) {
                  const formattedDate = new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    timeZone: 'UTC',
                  }).format(new Date(`${earliestEndDate}T00:00:00Z`));
                  groupForm.setError('endDate', {
                    type: 'scheduleRange',
                    message: t('groupDateRangeTooShort').replace('{date}', formattedDate),
                  });
                  revealField('endDate');
                  return;
                }
                submitGroupValues(values);
                const errors = Object.fromEntries((Object.keys(FIELD_SECTIONS) as (keyof GroupValues)[])
                  .map((field) => [field, groupForm.getFieldState(field).error])) as FieldErrors<GroupValues>;
                revealErrors(errors);
              }, (errors) => { showScheduleError(!revealErrors(errors)); })}
            >
              <div className="compact-modal-body min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain">
                <CompactModalSection disabled={saveGroup.isPending} contentClassName="space-y-3"
                  title={t('group')} icon={UsersRound} tone="sky"
                  open={openSections.identity} onOpenChange={(expanded) => setSectionOpen('identity', expanded)}
                  summary={[watchedName, watchedMaxStudents > 0 ? t('groupRoomCapacity').replace('{count}', String(watchedMaxStudents)) : ''].filter(Boolean).join(' · ')}
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <GroupIdentityFields code={groupCode} error={groupCodeError} pending={!editingGroup && codeCatalogue.isFetching}
                      editing={Boolean(editingGroup)} coded={autoNaming}
                      onRetry={!editingGroup && codeCatalogue.isError ? () => { void codeCatalogue.refetch(); } : undefined} />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <GroupStatusField />
                    <FormField control={groupForm.control} name="maxStudents" render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t('groupCapacity')}</FormLabel>
                        <FormControl><Input type="number" min="1" max={autoNaming && trainingType === 'IND' ? 1 : undefined} {...field} /></FormControl>
                        {(!autoNaming || trainingType !== 'IND') ? (
                          <QuickNumberPresets
                            options={CAPACITY_PRESETS}
                            currentValue={Number(field.value)}
                            onSelect={(preset) => groupForm.setValue('maxStudents', preset, { shouldDirty: true, shouldValidate: true })}
                          />
                        ) : null}
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </CompactModalSection>

                <CompactModalSection disabled={saveGroup.isPending} contentClassName="space-y-3"
                  title={t('groupEditorPlaceSection')} icon={GraduationCap} tone="teal"
                  open={openSections.place} onOpenChange={(expanded) => setSectionOpen('place', expanded)}
                  summary={[selectedCourse?.name, selectedSchool?.name, selectedRoom?.name,
                    selectedTeacher?.fullName || (watchedTeacherId === String(editingGroup?.teacherId) ? editingGroup?.teacherName : '')].filter(Boolean).join(' · ')}
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <FormField control={groupForm.control} name="courseId" render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t('course')}</FormLabel>
                        <Select value={field.value} onValueChange={updateSelectedCourse}>
                          <FormControl><SelectTrigger ref={field.ref} onBlur={field.onBlur}><SelectValue placeholder={t('selectCourse')} /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectGroup>
                              {courses.filter((course) => course.isActive !== false || course.id === editingGroup?.courseId).map((course) => (
                                <SelectItem key={course.id} value={String(course.id)}>{course.name}</SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={groupForm.control} name="schoolId" render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t('school')}</FormLabel>
                        <Select value={field.value} onValueChange={(value) => {
                          field.onChange(value);
                          if (value !== selectedGroupSchoolId) groupForm.setValue('roomId', '');
                        }}>
                          <FormControl><SelectTrigger ref={field.ref} onBlur={field.onBlur}><SelectValue placeholder={t('selectSchool')} /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectGroup>
                              {schools.filter((school) => school.isActive !== false || school.id === editingGroup?.schoolId).map((school) => (
                                <SelectItem key={school.id} value={String(school.id)}>{school.name}</SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={groupForm.control} name="roomId" render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t('room')}</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange} disabled={!selectedGroupSchoolId}>
                          <FormControl><SelectTrigger ref={field.ref} onBlur={field.onBlur}><SelectValue placeholder={t('roomRequired')} /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectGroup>
                              {groupRooms.map((room) => (
                                <SelectItem key={room.id} value={String(room.id)} trailing={<>
                                  <span className="tabular-nums">{t('groupRoomCapacity').replace('{count}', String(room.capacity))}</span>
                                  {busyRoomIds.has(room.id)
                                    ? <span className="font-medium text-amber-700 dark:text-amber-300">· {t('demoResourceBusyShort')}</span>
                                    : null}
                                </>}>
                                  {room.name}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        {roomCapacityExceeded && selectedRoom ? (
                          <p role="status" className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-200">
                            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                            <span>
                              {t('groupRoomCapacityWarning')
                                .replace('{room}', String(selectedRoom.capacity))
                                .replace('{group}', String(watchedMaxStudents))}
                            </span>
                          </p>
                        ) : null}
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={groupForm.control} name="teacherId" render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center justify-between gap-2"><FormLabel required={!editingGroup || Boolean(editingGroup.teacherId)}>{t('teacher')}</FormLabel><EmployeeCardButton
                          userId={groupTeachers.find(teacher => String(teacher.id) === field.value)?.userId ?? (field.value === String(editingGroup?.teacherId) ? editingGroup?.teacherUserId : undefined)}
                          name={groupTeachers.find(teacher => String(teacher.id) === field.value)?.fullName ?? editingGroup?.teacherName} /></div>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl><SelectTrigger ref={field.ref} onBlur={field.onBlur}><SelectValue placeholder={t('selectTeacher')}>
                            {field.value === String(editingGroup?.teacherId) && !groupTeachers.some((teacher) => String(teacher.id) === field.value)
                              ? <EmployeeIdentity userId={editingGroup?.teacherUserId} name={editingGroup?.teacherName || t('notAssigned')} /> : undefined}
                          </SelectValue></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectGroup>
                              {groupTeachers.map((teacher) => (
                                <SelectItem key={teacher.id} value={String(teacher.id)} textValue={teacher.fullName}><EmployeeIdentity userId={teacher.userId} name={teacher.fullName} /></SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        {groupTeachers.length === 0 ? <p className="text-xs text-muted-foreground">{t('noTeachers')}</p> : null}
                        {teacherConflictLabel ? (
                          <p role="status" className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-200">
                            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                            <span>{teacherConflictLabel}</span>
                          </p>
                        ) : null}
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </CompactModalSection>

                <CompactModalSection disabled={saveGroup.isPending} contentClassName="space-y-3"
                  ref={scheduleRef} title={t('schedule')} icon={CalendarClock} tone="violet"
                  open={openSections.schedule} onOpenChange={(expanded) => setSectionOpen('schedule', expanded)}
                  summary={scheduleSummaryText || t('groupsWithoutSchedule')}
                  actions={groupSchedule.length > 0 ? <span className="whitespace-nowrap pr-3 text-xs font-medium tabular-nums text-violet-800 dark:text-violet-200">
                    {t('groupScheduleWeeklySummary').replace('{days}', String(groupSchedule.length)).replace('{hours}', weeklyHours)}
                  </span> : undefined}
                >
                  <WeekScheduleEditor
                    value={groupSchedule}
                    onChange={updateGroupSchedule}
                    dayNames={dayNames}
                    startLabel={t('start')}
                    endLabel={t('end')}
                    defaultDurationMinutes={watchedDuration}
                  />
                  {scheduleError ? (
                    <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive">
                      {t(SCHEDULE_ERROR_KEYS[scheduleError])}
                    </p>
                  ) : null}
                  {roomClashes.length > 0 ? (
                    <ClashNotice title={t('roomOccupied')} clashes={roomClashes} shortDayNames={shortDayNames} />
                  ) : null}
                </CompactModalSection>

                <CompactModalSection disabled={saveGroup.isPending} contentClassName="space-y-3"
                  title={t('groupEditorDatesSection')} icon={CalendarRange} tone="amber"
                  open={openSections.dates} onOpenChange={(expanded) => setSectionOpen('dates', expanded)}
                  summary={[
                    selectedGroupStartDate && watchedEndDate ? `${shortDate(selectedGroupStartDate)} – ${shortDate(watchedEndDate)}` : '',
                    watchedLessonCount > 0 ? t('groupLessonPlanValue').replace('{count}', String(watchedLessonCount)).replace('{minutes}', String(watchedDuration)) : '',
                    watchedLessonCount > 0 ? t('groupTotalHoursSummary').replace('{hours}', totalCourseHours) : '',
                  ].filter(Boolean).join(' · ')}
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <FormField control={groupForm.control} name="selectedCourseLessonIds" render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t('groupCourseLessons')}</FormLabel>
                        <FormControl><GroupLessonSelect program={selectedCourse?.program}
                          value={field.value} onChange={updateSelectedLessons} ref={field.ref} onBlur={field.onBlur}
                          disabled={!selectedCourse} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={groupForm.control} name="lessonDurationMinutes" render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t('lessonDurationMinutes')}</FormLabel>
                        <FormControl><Input type="number" min="15" step="15" {...field} /></FormControl>
                        <QuickNumberPresets
                          options={DURATION_PRESETS}
                          currentValue={Number(field.value)}
                          unit={t('minuteShort')}
                          onSelect={(preset) => groupForm.setValue('lessonDurationMinutes', preset, { shouldDirty: true, shouldValidate: true })}
                        />
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={groupForm.control} name="startDate" render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t('startDate')}</FormLabel>
                        <FormControl><Input type="date" {...field} onChange={(event) => {
                          field.onChange(event);
                          followEndDate({ startDate: event.target.value });
                        }} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={groupForm.control} name="endDate" render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t('endDate')}</FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            min={minimumGroupEndDate || selectedGroupStartDate || undefined}
                            aria-invalid={isGroupEndDateTooEarly}
                            {...field}
                            onChange={(event) => {
                              field.onChange(event);
                              releaseEndDate();
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                        {minimumGroupEndDate && field.value !== minimumGroupEndDate ? (
                          <Button type="button" variant="outline" size="sm" className="h-7 w-fit gap-1.5 px-2.5 text-xs" onClick={applyScheduleEndDate}>
                            <RotateCcw className="size-3" aria-hidden="true" />
                            {t('groupEndDateApplySchedule').replace('{date}', shortDate(minimumGroupEndDate))}
                          </Button>
                        ) : null}
                      </FormItem>
                    )} />
                  </div>
                </CompactModalSection>

              </div>

              <div className="compact-modal-footer flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="hidden min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground sm:flex">
                  {scheduleSummaryText ? (
                    <span className="truncate rounded-md border border-border/70 bg-muted/40 px-2 py-1 font-medium text-foreground">
                      {scheduleSummaryText}
                    </span>
                  ) : null}
                  {watchedLessonCount > 0 ? (
                    <span className="rounded-md border border-border/70 bg-muted/40 px-2 py-1 tabular-nums">
                      {t('groupLessonPlanValue')
                        .replace('{count}', String(watchedLessonCount))
                        .replace('{minutes}', String(watchedDuration))}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-col-reverse gap-2 sm:ml-auto sm:flex-row sm:items-center">
                  <Button type="button" variant="outline" disabled={saveGroup.isPending} onClick={() => groupGuard.handleOpenChange(false)}>
                    {t('cancel')}
                  </Button>
                  {/* Without a course and a branch there is no code yet; saving then
                      points at those two fields instead of sitting greyed out. */}
                  <Button type="submit" disabled={saveGroup.isPending
                    || (!editingGroup && (Boolean(groupCodeError) || codeCatalogue.isFetching))}>
                    {saveGroup.isPending ? t('saving') : editingGroup ? t('saveChanges') : t('createGroup')}
                  </Button>
                </div>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <FutureGroupStartDialog
        values={futureGroupStartValues}
        isPending={saveGroup.isPending}
        onDismiss={() => setFutureGroupStartValues(null)}
        onReturnToStartDate={() => revealField('startDate')}
        onStatusChange={(status) => groupForm.setValue('status', status)}
        onSave={(values) => saveGroup.mutate(values)}
      />

    <UnsavedChangesDialog open={groupGuard.confirmationOpen}
      onOpenChange={groupGuard.setConfirmationOpen} onDiscard={groupGuard.discardChanges} />
  </>;
}
