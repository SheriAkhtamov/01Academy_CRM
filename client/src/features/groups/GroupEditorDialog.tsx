import { EmployeeIdentity } from '@/components/ux/EmployeeIdentity';
import { EmployeeCardButton } from '@/features/employees/EmployeeCardTrigger';
import { forwardRef, useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react';
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

const EditorSection = forwardRef<
  HTMLFieldSetElement,
  { title?: string; icon?: ReactNode; badge?: ReactNode; className?: string; children: ReactNode }
>(({ title, icon, badge, className, children }, ref) => (
  <fieldset
    ref={ref}
    className={cn(
      'min-w-0 space-y-4 rounded-xl border border-border/80 bg-card p-4 shadow-2xs sm:p-5',
      className,
    )}
  >
    {title ? (
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2.5">
          {icon ? (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden="true">
              {icon}
            </span>
          ) : null}
          <legend className="text-sm font-semibold tracking-tight text-foreground">{title}</legend>
        </div>
        {badge ? <div className="flex flex-wrap items-center gap-1.5">{badge}</div> : null}
      </div>
    ) : null}
    {children}
  </fieldset>
));
EditorSection.displayName = 'EditorSection';

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
  const scheduleRef = useRef<HTMLFieldSetElement>(null);
  const dayNames = [t('monday'), t('tuesday'), t('wednesday'), t('thursday'), t('friday'), t('saturday'), t('sunday')];
  const shortDayNames = useMemo(() => [t('mondayShort'), t('tuesdayShort'), t('wednesdayShort'), t('thursdayShort'),
    t('fridayShort'), t('saturdayShort'), t('sundayShort')], [t]);
  const shortDate = (key: string) => new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  }).format(new Date(`${key}T00:00:00Z`));

  const watchedStatus = groupForm.watch('status');
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
  const showScheduleError = () => {
    const problem = getGroupScheduleValidationError(groupSchedule);
    setScheduleError(problem);
    if (problem) scheduleRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
        <DialogContent aria-describedby={undefined} className="flex max-h-[calc(100dvh-2rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b border-border/80 bg-card/80 px-4 py-3.5 pr-12 text-left sm:px-6">
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
                  }, { shouldFocus: true });
                  return;
                }
                submitGroupValues(values);
              }, () => { showScheduleError(); })}
            >
              <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto overscroll-contain bg-muted/15 px-4 py-4 sm:px-6 sm:py-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] lg:items-start">
                <EditorSection
                  title={t('group')}
                  icon={<UsersRound className="size-4" />}
                  className="lg:col-start-1 lg:row-start-1"
                  badge={watchedMaxStudents > 0 ? (
                    <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                      {t('groupRoomCapacity').replace('{count}', String(watchedMaxStudents))}
                    </span>
                  ) : null}
                >
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <GroupIdentityFields code={groupCode} error={groupCodeError} pending={!editingGroup && codeCatalogue.isFetching}
                      editing={Boolean(editingGroup)} coded={autoNaming}
                      onRetry={!editingGroup && codeCatalogue.isError ? () => { void codeCatalogue.refetch(); } : undefined} />
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                </EditorSection>

                <EditorSection
                  title={t('groupEditorPlaceSection')}
                  icon={<GraduationCap className="size-4" />}
                  className="lg:col-start-1 lg:row-start-2"
                  badge={selectedRoom ? (
                    <span className={cn(
                      'rounded-md px-2 py-0.5 text-xs font-medium tabular-nums',
                      roomCapacityExceeded
                        ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                        : 'bg-muted text-muted-foreground',
                    )}>
                      {selectedRoom.name} · {t('groupRoomCapacity').replace('{count}', String(selectedRoom.capacity))}
                    </span>
                  ) : null}
                >
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormField control={groupForm.control} name="courseId" render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t('course')}</FormLabel>
                        <Select value={field.value} onValueChange={updateSelectedCourse}>
                          <FormControl><SelectTrigger><SelectValue placeholder={t('selectCourse')} /></SelectTrigger></FormControl>
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
                          <FormControl><SelectTrigger><SelectValue placeholder={t('selectSchool')} /></SelectTrigger></FormControl>
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
                          <FormControl><SelectTrigger><SelectValue placeholder={t('roomRequired')} /></SelectTrigger></FormControl>
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
                </EditorSection>

                <EditorSection
                  ref={scheduleRef}
                  title={t('schedule')}
                  icon={<CalendarClock className="size-4" />}
                  className="lg:col-start-2 lg:row-start-1 lg:row-span-3"
                  badge={groupSchedule.length > 0 ? (
                    <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
                      {t('groupScheduleWeeklySummary')
                        .replace('{days}', String(groupSchedule.length))
                        .replace('{hours}', weeklyHours)}
                    </span>
                  ) : (
                    <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {t('groupsWithoutSchedule')}
                    </span>
                  )}
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
                </EditorSection>

                <EditorSection
                  title={t('groupEditorDatesSection')}
                  icon={<CalendarRange className="size-4" />}
                  className="lg:col-start-1 lg:row-start-3"
                  badge={
                    <>
                      {watchedLessonCount > 0 ? (
                        <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                          {t('groupTotalHoursSummary').replace('{hours}', totalCourseHours)}
                        </span>
                      ) : null}
                      {selectedGroupStartDate && watchedEndDate ? (
                        <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
                          {shortDate(selectedGroupStartDate)} – {shortDate(watchedEndDate)}
                        </span>
                      ) : null}
                    </>
                  }
                >
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                </EditorSection>

              </div>

              <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-border/80 bg-card/95 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
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
        onReturnToStartDate={() => window.requestAnimationFrame(() => groupForm.setFocus('startDate'))}
        onStatusChange={(status) => groupForm.setValue('status', status)}
        onSave={(values) => saveGroup.mutate(values)}
      />

    <UnsavedChangesDialog open={groupGuard.confirmationOpen}
      onOpenChange={groupGuard.setConfirmationOpen} onDiscard={groupGuard.discardChanges} />
  </>;
}
