import { GroupIdentityFields } from './GroupIdentityFields';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LocalizedFormMessage } from '@/components/ux/lead/LeadSheetControls';
import { UnsavedChangesDialog } from '@/components/ux/UnsavedChangesGuard';
import { FutureGroupStartDialog } from '@/components/ux/FutureGroupStartDialog';
import { GroupStatusField } from '@/components/ux/GroupStatusField';
import { WeekScheduleEditor } from '@/components/ux/WeekScheduleEditor';
import { getGroupScheduleValidationError, getMinimumGroupEndDate } from '@shared/scheduling';
import { toast } from '@/hooks/use-toast';
import { AUTO_TEACHER_VALUE, useGroupEditor, type GroupEditorProps } from './useGroupEditor';

export function GroupEditorDialog(props: GroupEditorProps) {
  const { open, group: editingGroup } = props;
  const {
    t, language, schools, courses, groupForm, groupGuard, groupSchedule, setGroupSchedule,
    selectedGroupSchoolId, selectedGroupStartDate, minimumGroupEndDate,
    isGroupEndDateTooEarly, groupRooms, groupTeachers, saveGroup, submitGroupValues,
    autoNaming, groupCode, groupCodeError, codeCatalogue, trainingType,
    futureGroupStartValues, setFutureGroupStartValues,
  } = useGroupEditor(props);
  const dayNames = [t('monday'), t('tuesday'), t('wednesday'), t('thursday'), t('friday'), t('saturday'), t('sunday')];
  return <>
      <Dialog open={open} onOpenChange={(nextOpen) => { if (!saveGroup.isPending) groupGuard.handleOpenChange(nextOpen); }}>
        <DialogContent aria-describedby={undefined} className="flex max-h-[calc(100dvh-2rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle>{editingGroup ? t('editGroup') : t('createGroup')}</DialogTitle>
          </DialogHeader>
          <Form {...groupForm}>
            <form
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={groupForm.handleSubmit((values) => {
                const scheduleError = getGroupScheduleValidationError(groupSchedule);
                if (scheduleError) {
                  const title = scheduleError === 'groupScheduleRequired'
                    ? t('groupScheduleRequired')
                    : scheduleError === 'groupScheduleInvalid'
                      ? t('groupScheduleInvalid')
                      : t('groupScheduleOverlap');
                  toast({ title, variant: 'destructive' });
                  return;
                }
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
              })}
            >
              <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-6 py-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                {autoNaming ? <GroupIdentityFields code={groupCode} error={groupCodeError} pending={codeCatalogue.isFetching}
                  editing={Boolean(editingGroup)} /> : <>
                <FormField control={groupForm.control} name="name" render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel required>{t('groupName')}</FormLabel>
                    <FormControl><Input {...field} placeholder={t('groupNamePlaceholder')} /></FormControl>
                    <LocalizedFormMessage />
                  </FormItem>
                )} />
                </>}
                <GroupStatusField />
                <FormField control={groupForm.control} name="maxStudents" render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t('groupCapacity')}</FormLabel>
                    <FormControl><Input type="number" min="1" max={autoNaming && trainingType === 'IND' ? 1 : undefined} {...field} /></FormControl>
                    <LocalizedFormMessage />
                  </FormItem>
                )} />
                <FormField control={groupForm.control} name="courseId" render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t('course')}</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl><SelectTrigger><SelectValue placeholder={t('selectCourse')} /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectGroup>
                          {courses.filter((course) => course.isActive !== false || course.id === editingGroup?.courseId).map((course) => (
                            <SelectItem key={course.id} value={String(course.id)}>{course.name}</SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <LocalizedFormMessage />
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
                    <LocalizedFormMessage />
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
                            <SelectItem key={room.id} value={String(room.id)}>
                              {room.name} · {room.capacity} {t('students')}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <LocalizedFormMessage />
                  </FormItem>
                )} />
                <FormField control={groupForm.control} name="teacherId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('teacher')}</FormLabel>
                    <Select value={field.value || AUTO_TEACHER_VALUE} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue placeholder={t('selectTeacher')} /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value={AUTO_TEACHER_VALUE}>{t('teacherAutoSelect')}</SelectItem>
                          {groupTeachers.map((teacher) => (
                            <SelectItem key={teacher.id} value={String(teacher.id)}>
                              {teacher.fullName}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {groupTeachers.length === 0 ? (
                      <p className="text-xs text-muted-foreground">{t('noTeachers')}</p>
                    ) : null}
                    <LocalizedFormMessage />
                  </FormItem>
                )} />
                <FormField control={groupForm.control} name="lessonCount" render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t('lessonsCount')}</FormLabel>
                    <FormControl><Input type="number" min="1" {...field} /></FormControl>
                    <LocalizedFormMessage />
                  </FormItem>
                )} />
                <FormField control={groupForm.control} name="lessonDurationMinutes" render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t('lessonDurationMinutes')}</FormLabel>
                    <FormControl><Input type="number" min="15" step="15" {...field} /></FormControl>
                    <LocalizedFormMessage />
                  </FormItem>
                )} />
                <FormField control={groupForm.control} name="startDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t('startDate')}</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <LocalizedFormMessage />
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
                      />
                    </FormControl>
                    <LocalizedFormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="flex flex-col gap-2">
                <div>
                  <p className="text-sm font-medium text-foreground">{t('schedule')}</p>
                </div>
                <WeekScheduleEditor
                  value={groupSchedule}
                  onChange={setGroupSchedule}
                  dayNames={dayNames}
                  startLabel={t('start')}
                  endLabel={t('end')}
                />
              </div>
              </div>

              <div className="flex shrink-0 justify-end gap-2 border-t bg-background/95 px-6 py-4">
                <Button type="button" variant="outline" onClick={() => groupGuard.handleOpenChange(false)}>
                  {t('cancel')}
                </Button>
                <Button type="submit" disabled={saveGroup.isPending || (autoNaming && !groupCode)}>
                  {saveGroup.isPending ? t('saving') : t('save')}
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
