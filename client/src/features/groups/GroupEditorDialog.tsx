import { forwardRef, useRef, type ReactNode } from 'react';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import { GroupIdentityFields } from './GroupIdentityFields';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UnsavedChangesDialog } from '@/components/ux/UnsavedChangesGuard';
import { FutureGroupStartDialog } from '@/components/ux/FutureGroupStartDialog';
import { GroupStatusField } from '@/components/ux/GroupStatusField';
import { WeekScheduleEditor } from '@/components/ux/WeekScheduleEditor';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { getGroupScheduleValidationError, getMinimumGroupEndDate, type GroupScheduleValidationError } from '@shared/scheduling';
import type { ScheduleClash, TeacherFit } from './editorInsights';
import { formatSlotTime, groupNameParts } from './presentation';
import { AUTO_TEACHER_VALUE, useGroupEditor, type GroupEditorProps } from './useGroupEditor';

const SCHEDULE_ERROR_KEYS = {
  groupScheduleRequired: 'groupScheduleRequired',
  groupScheduleInvalid: 'groupScheduleInvalid',
  groupScheduleOverlap: 'groupScheduleOverlap',
} as const satisfies Record<GroupScheduleValidationError, TranslationKey>;

const EditorSection = forwardRef<HTMLFieldSetElement, { title?: string; children: ReactNode }>(({ title, children }, ref) => (
  <fieldset ref={ref} className="min-w-0 space-y-3">
    {title ? <legend className="mb-3 text-sm font-semibold text-foreground">{title}</legend> : null}
    {children}
  </fieldset>
));
EditorSection.displayName = 'EditorSection';

function ClashNotice({ title, clashes, shortDayNames }: { title: string; clashes: ScheduleClash[]; shortDayNames: string[] }) {
  return (
    <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
      <p className="flex items-center gap-2 font-medium">
        <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
        {title}
      </p>
      <ul className="mt-1 space-y-0.5 pl-6 text-xs">
        {clashes.slice(0, 3).map((clash) => (
          <li key={`${clash.group.id}-${clash.dayOfWeek}-${clash.startMinutes}`}>
            {shortDayNames[clash.dayOfWeek - 1]} {formatSlotTime(clash)} · {groupNameParts(clash.group.name).shortLabel}
          </li>
        ))}
      </ul>
    </div>
  );
}

function useTeacherFitLabel() {
  const { t } = useTranslation();
  return (fit: TeacherFit | undefined) => {
    if (!fit) return null;
    if (fit.issue === 'otherBranch') return { text: t('groupTeacherOtherBranch'), warn: true };
    if (fit.issue === 'offHours') return { text: t('groupTeacherOffHours'), warn: true };
    if (fit.issue === 'busy' && fit.clash) {
      return { text: t('groupScheduleOverlapsWith').replace('{group}', groupNameParts(fit.clash.group.name).shortLabel), warn: true };
    }
    return fit.teachesCourse ? { text: t('groupTeacherFits'), warn: false } : { text: t('groupTeacherOtherCourse'), warn: false };
  };
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
    roomClashes, busyRoomIds, teacherFits, rankedTeachers,
  } = useGroupEditor(props);
  const teacherFitLabel = useTeacherFitLabel();
  const scheduleRef = useRef<HTMLFieldSetElement>(null);
  const dayNames = [t('monday'), t('tuesday'), t('wednesday'), t('thursday'), t('friday'), t('saturday'), t('sunday')];
  const shortDayNames = [t('mondayShort'), t('tuesdayShort'), t('wednesdayShort'), t('thursdayShort'),
    t('fridayShort'), t('saturdayShort'), t('sundayShort')];
  const shortDate = (key: string) => new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  }).format(new Date(`${key}T00:00:00Z`));

  /* A missing schedule used to surface only as a toast after "Save"; now it
     sits under the schedule itself, which scrolls into view. */
  const showScheduleError = () => {
    const problem = getGroupScheduleValidationError(groupSchedule);
    setScheduleError(problem);
    if (problem) scheduleRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return problem;
  };

  return <>
      <Dialog open={open} onOpenChange={(nextOpen) => { if (!saveGroup.isPending) groupGuard.handleOpenChange(nextOpen); }}>
        <DialogContent aria-describedby={undefined} className="flex max-h-[calc(100dvh-2rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle>{editingGroup ? t('editGroup') : t('createGroup')}</DialogTitle>
          </DialogHeader>
          <Form {...groupForm}>
            <form
              className="flex min-h-0 flex-1 flex-col"
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
              <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-6 py-5">
                <EditorSection title={t('group')}>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {autoNaming ? <GroupIdentityFields code={groupCode} error={groupCodeError} pending={!editingGroup && codeCatalogue.isFetching}
                      editing={Boolean(editingGroup)} onRetry={!editingGroup && codeCatalogue.isError ? () => { void codeCatalogue.refetch(); } : undefined} /> : (
                      <FormField control={groupForm.control} name="name" render={({ field }) => (
                        <FormItem className="md:col-span-2">
                          <FormLabel required>{t('groupName')}</FormLabel>
                          <FormControl><Input {...field} placeholder={t('groupNamePlaceholder')} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    )}
                    <GroupStatusField />
                    <FormField control={groupForm.control} name="maxStudents" render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t('groupCapacity')}</FormLabel>
                        <FormControl><Input type="number" min="1" max={autoNaming && trainingType === 'IND' ? 1 : undefined} {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </EditorSection>

                <EditorSection title={t('groupEditorPlaceSection')}>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <FormField control={groupForm.control} name="courseId" render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t('course')}</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
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
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </EditorSection>

                <EditorSection ref={scheduleRef} title={t('schedule')}>
                  <WeekScheduleEditor
                    value={groupSchedule}
                    onChange={updateGroupSchedule}
                    dayNames={dayNames}
                    startLabel={t('start')}
                    endLabel={t('end')}
                  />
                  {scheduleError ? (
                    <p role="alert" className="text-sm font-medium text-destructive">{t(SCHEDULE_ERROR_KEYS[scheduleError])}</p>
                  ) : null}
                  {roomClashes.length > 0 ? (
                    <ClashNotice title={t('roomOccupied')} clashes={roomClashes} shortDayNames={shortDayNames} />
                  ) : null}
                </EditorSection>

                <EditorSection title={t('groupEditorDatesSection')}>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <FormField control={groupForm.control} name="lessonCount" render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t('lessonsCount')}</FormLabel>
                        <FormControl><Input type="number" min="1" {...field} onChange={(event) => {
                          field.onChange(event);
                          followEndDate({ lessonCount: Number(event.target.value) });
                        }} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={groupForm.control} name="lessonDurationMinutes" render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t('lessonDurationMinutes')}</FormLabel>
                        <FormControl><Input type="number" min="15" step="15" {...field} /></FormControl>
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
                          <Button type="button" variant="link" size="sm" className="h-auto gap-1 p-0 text-xs" onClick={applyScheduleEndDate}>
                            <RotateCcw className="size-3" aria-hidden="true" />
                            {t('groupEndDateApplySchedule').replace('{date}', shortDate(minimumGroupEndDate))}
                          </Button>
                        ) : null}
                      </FormItem>
                    )} />
                  </div>
                </EditorSection>

                <EditorSection>
                  <FormField control={groupForm.control} name="teacherId" render={({ field }) => {
                    const selectedFit = field.value && field.value !== AUTO_TEACHER_VALUE ? teacherFits.get(Number(field.value)) : undefined;
                    const selectedLabel = selectedFit?.issue ? teacherFitLabel(selectedFit) : null;
                    return (
                      <FormItem className="md:max-w-md">
                        <FormLabel>{t('teacher')}</FormLabel>
                        <Select value={field.value || AUTO_TEACHER_VALUE} onValueChange={field.onChange}>
                          <FormControl><SelectTrigger><SelectValue placeholder={t('selectTeacher')}>
                            {field.value === String(editingGroup?.teacherId) && !rankedTeachers.some((teacher) => String(teacher.id) === field.value)
                              ? editingGroup?.teacherName : undefined}
                          </SelectValue></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value={AUTO_TEACHER_VALUE}>{t('teacherAutoSelect')}</SelectItem>
                              {rankedTeachers.map((teacher) => {
                                const fit = teacherFitLabel(teacherFits.get(teacher.id));
                                return (
                                  <SelectItem key={teacher.id} value={String(teacher.id)} trailing={fit ? (
                                    <span className={cn(fit.warn ? 'text-amber-700 dark:text-amber-300'
                                      : teacherFits.get(teacher.id)?.teachesCourse ? 'text-emerald-700 dark:text-emerald-300' : undefined)}>
                                      {fit.text}
                                    </span>
                                  ) : undefined}>
                                    {teacher.fullName}
                                  </SelectItem>
                                );
                              })}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        {rankedTeachers.length === 0 ? (
                          <p className="text-xs text-muted-foreground">{t('noTeachers')}</p>
                        ) : null}
                        {selectedLabel ? (
                          <p role="status" className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
                            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                            <span>{t('teacherUnavailableForGroup')} {selectedLabel.text}</span>
                          </p>
                        ) : null}
                        <FormMessage />
                      </FormItem>
                    );
                  }} />
                </EditorSection>
              </div>

              <div className="flex shrink-0 justify-end gap-2 border-t bg-background/95 px-6 py-4">
                <Button type="button" variant="outline" onClick={() => groupGuard.handleOpenChange(false)}>
                  {t('cancel')}
                </Button>
                {/* Without a course and a branch there is no code yet; saving then
                    points at those two fields instead of sitting greyed out. */}
                <Button type="submit" disabled={saveGroup.isPending
                  || (!editingGroup && (Boolean(groupCodeError) || codeCatalogue.isFetching))}>
                  {saveGroup.isPending ? t('saving') : editingGroup ? t('saveChanges') : t('createGroup')}
                </Button>
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
