import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { GraduationCap, Loader2, Plus, Save, Users } from 'lucide-react';
import { leadsApi } from '@/features/leads/api';
import { studentsApi } from '@/features/students/api';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { academyToday } from '@/lib/localeFormat';
import { localizeApiErrorMessage } from '@/lib/queryClient';
import { cn } from '@/lib/utils';
import { PhoneInput } from '@/components/ux/FormattedInputs';
import { Badge } from '@/components/ui/badge';
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export type LeadStudentGroupOption = {
  id: number;
  name: string;
  courseId?: number | null;
  courseName?: string | null;
  schoolId?: number | null;
  schoolName?: string | null;
  status?: string;
  currentStudents?: number;
  reservedStudents?: number;
  maxStudents?: number;
};

type CreatedLeadStudent = {
  id: number;
  studentName?: string | null;
};

export type EditableLeadStudent = CreatedLeadStudent & {
  studentAge?: number | null;
  phone?: string | null;
  groups?: Array<{
    groupId: number;
    groupName: string;
    courseId?: number | null;
    courseName?: string | null;
    schoolId?: number | null;
    isPrimary?: boolean;
  }>;
};

const studentSchema = z.object({
  studentName: z.string().trim().min(1, 'studentNameRequired'),
  studentAge: z.string().refine(
    (value) => value === '' || (Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 120),
    'invalidStudentAge',
  ),
  phone: z.string().trim().refine((value) => value === '' || value.replace(/\D/g, '').length >= 7, 'invalidStudentPhone'),
  groupIds: z.array(z.string()),
  primaryGroupId: z.string(),
  enrolledAt: z.string(),
  demoOnly: z.boolean(),
}).superRefine((value, context) => {
  if (
    !value.demoOnly
    && value.groupIds.length > 0
    && (!value.primaryGroupId || !value.groupIds.includes(value.primaryGroupId))
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['primaryGroupId'],
    });
  }
});

type StudentFormValues = z.infer<typeof studentSchema>;

const todayInputValue = academyToday;

const EMPTY_STUDENT: StudentFormValues = {
  studentName: '',
  studentAge: '',
  phone: '',
  groupIds: [],
  primaryGroupId: '',
  enrolledAt: todayInputValue(),
  demoOnly: false,
};

interface CreateLeadStudentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: number;
  contactName: string;
  groups: LeadStudentGroupOption[];
  purpose?: 'enrollment' | 'demo';
  onCreated: (student: CreatedLeadStudent) => void | Promise<void>;
}

interface EditLeadStudentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: number;
  contactName: string;
  groups: LeadStudentGroupOption[];
  student: EditableLeadStudent;
  onUpdated: (student: CreatedLeadStudent) => void | Promise<void>;
}

type LeadStudentFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: number;
  contactName: string;
  groups: LeadStudentGroupOption[];
  purpose?: 'enrollment' | 'demo';
} & (
  | {
    mode: 'create';
    student?: never;
    onCreated: (student: CreatedLeadStudent) => void | Promise<void>;
  }
  | {
    mode: 'edit';
    student: EditableLeadStudent;
    onUpdated: (student: CreatedLeadStudent) => void | Promise<void>;
  }
);

export function CreateLeadStudentDialog(props: CreateLeadStudentDialogProps) {
  return <LeadStudentFormDialog {...props} mode="create" />;
}

export function EditLeadStudentDialog(props: EditLeadStudentDialogProps) {
  return <LeadStudentFormDialog {...props} mode="edit" purpose="enrollment" />;
}

function LeadStudentFormDialog({
  open,
  onOpenChange,
  leadId,
  contactName,
  groups,
  purpose = 'enrollment',
  ...modeProps
}: LeadStudentFormDialogProps) {
  const { t } = useTranslation();
  const isEditing = modeProps.mode === 'edit';
  const editedStudent = modeProps.mode === 'edit' ? modeProps.student : null;
  const currentGroupIds = useMemo(
    () => (editedStudent?.groups ?? []).map((group) => String(group.groupId)),
    [editedStudent?.groups],
  );
  const currentPrimaryGroupId = String(
    editedStudent?.groups?.find((group) => group.isPrimary)?.groupId ?? '',
  );
  const initialValues = useMemo<StudentFormValues>(() => isEditing ? {
    studentName: editedStudent?.studentName ?? '',
    studentAge: editedStudent?.studentAge ? String(editedStudent.studentAge) : '',
    phone: editedStudent?.phone ?? '',
    groupIds: currentGroupIds,
    primaryGroupId: currentPrimaryGroupId,
    enrolledAt: todayInputValue(),
    demoOnly: false,
  } : {
    ...EMPTY_STUDENT,
    enrolledAt: todayInputValue(),
    demoOnly: purpose === 'demo',
  }, [
    currentGroupIds,
    currentPrimaryGroupId,
    editedStudent?.phone,
    editedStudent?.studentAge,
    editedStudent?.studentName,
    isEditing,
    purpose,
  ]);
  const form = useForm<StudentFormValues>({
    resolver: zodResolver(studentSchema),
    defaultValues: initialValues,
  });
  const [createdCount, setCreatedCount] = useState(0);
  const selectedGroupIds = form.watch('groupIds');
  const primaryGroupId = form.watch('primaryGroupId');

  const availableGroups = useMemo(() => {
    const options = new Map(groups.map((group) => [group.id, group]));
    if (editedStudent) {
      for (const group of editedStudent.groups ?? []) {
        if (!options.has(group.groupId)) {
          options.set(group.groupId, {
            id: group.groupId,
            name: group.groupName,
            courseId: group.courseId,
            courseName: group.courseName,
            schoolId: group.schoolId,
          });
        }
      }
    }
    return Array.from(options.values()).filter((group) => (
      currentGroupIds.includes(String(group.id))
      || ['open', 'in_progress'].includes(String(group.status))
    ));
  }, [currentGroupIds, editedStudent, groups]);
  const selectedGroups = useMemo(() => availableGroups.filter((group) => (
    selectedGroupIds.includes(String(group.id))
  )), [availableGroups, selectedGroupIds]);

  useEffect(() => {
    if (!open) return;
    form.reset(initialValues);
    setCreatedCount(0);
  }, [form, initialValues, open]);

  useEffect(() => {
    if (selectedGroupIds.length === 0) {
      if (primaryGroupId) form.setValue('primaryGroupId', '', { shouldValidate: true });
      return;
    }
    if (!selectedGroupIds.includes(primaryGroupId)) {
      form.setValue('primaryGroupId', selectedGroupIds[0], { shouldValidate: true });
    }
  }, [form, primaryGroupId, selectedGroupIds]);

  const saveStudent = useMutation({
    mutationFn: async ({ values }: { values: StudentFormValues; createAnother: boolean }) => {
      if (modeProps.mode === 'edit') {
        const updatedStudent = await studentsApi.updateDetails<CreatedLeadStudent>(
          modeProps.student.id,
          {
            studentName: values.studentName,
            studentAge: values.studentAge ? Number(values.studentAge) : null,
            phone: values.phone || null,
          },
        );
        const currentGroupIdSet = new Set(currentGroupIds);
        for (const groupId of values.groupIds) {
          const promoteExistingGroup = groupId === values.primaryGroupId
            && groupId !== currentPrimaryGroupId;
          if (!currentGroupIdSet.has(groupId) || promoteExistingGroup) {
            await studentsApi.addGroup(
              modeProps.student.id,
              Number(groupId),
              groupId === values.primaryGroupId,
            );
          }
        }
        return updatedStudent;
      }
      return leadsApi.createStudent<CreatedLeadStudent>(leadId, {
        studentName: values.studentName,
        studentAge: values.studentAge ? Number(values.studentAge) : null,
        phone: values.phone || null,
        groupIds: values.demoOnly ? [] : values.groupIds.map(Number),
        primaryGroupId: values.demoOnly || !values.primaryGroupId ? null : Number(values.primaryGroupId),
        enrolledAt: values.demoOnly || values.groupIds.length === 0 ? null : values.enrolledAt,
        demoOnly: values.demoOnly,
      });
    },
    onSuccess: async (student, variables) => {
      if (modeProps.mode === 'edit') {
        await modeProps.onUpdated(student);
        toast({ title: t('studentUpdated') });
        onOpenChange(false);
        return;
      }
      await modeProps.onCreated(student);
      setCreatedCount((count) => count + 1);
      toast({
        title: t('studentCreated'),
        description: purpose === 'demo'
          ? t('demoStudentCreatedFromLead')
          : variables.values.groupIds.length > 0
            ? t('studentCreatedFromLead')
            : t('studentCreatedWithoutGroup'),
      });
      if (!variables.createAnother) {
        onOpenChange(false);
        return;
      }
      form.reset({
        ...EMPTY_STUDENT,
        phone: variables.values.phone,
        enrolledAt: variables.values.enrolledAt || todayInputValue(),
        demoOnly: purpose === 'demo',
      });
      form.setFocus('studentName');
    },
    onError: (error: Error) => toast({
      title: isEditing ? t('studentUpdateFailed') : t('studentCreateFailed'),
      description: localizeApiErrorMessage(error.message, (error as Error & { status?: number }).status ?? 0),
      variant: 'destructive',
    }),
  });

  const groupError = form.formState.errors.groupIds?.message || form.formState.errors.primaryGroupId?.message;
  const dialogDescription = isEditing
    ? t('editStudentForContact')
    : purpose === 'demo'
      ? t('createDemoStudentForContact')
      : t('createStudentForContact');

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !saveStudent.isPending && onOpenChange(nextOpen)}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <GraduationCap className="size-5" />
            </span>
            {isEditing ? t('editStudent') : t('createStudent')}
            {!isEditing && createdCount > 0 ? (
              <Badge variant="secondary">
                {t('studentsCreatedCount').replace('{count}', String(createdCount))}
              </Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            {dialogDescription.replace('{name}', contactName)}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={form.handleSubmit((values) => saveStudent.mutate({ values, createAnother: false }))}
          >
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-y-auto overscroll-contain px-6 py-4 md:grid-cols-2">
            <FormField
              control={form.control}
              name="studentName"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>{t('studentName')}</FormLabel>
                  <FormControl><Input {...field} autoFocus aria-invalid={fieldState.invalid} /></FormControl>
                  {fieldState.error ? <p className="text-sm font-medium text-destructive">{t('studentNameRequired')}</p> : null}
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="studentAge"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>{t('age')}</FormLabel>
                  <FormControl><Input {...field} type="number" min="1" max="120" aria-invalid={fieldState.invalid} /></FormControl>
                  {fieldState.error ? <p className="text-sm font-medium text-destructive">{t('invalidStudentAge')}</p> : null}
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>{t('studentPhone')}</FormLabel>
                  <FormControl>
                    <PhoneInput value={field.value} onValueChange={field.onChange} />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">{t('studentPhoneOptionalHint')}</p>
                  {fieldState.error ? <p className="text-sm font-medium text-destructive">{t('invalidStudentPhone')}</p> : null}
                </FormItem>
              )}
            />
            {purpose === 'enrollment' && selectedGroupIds.length > 0 ? (
              <FormField
                control={form.control}
                name="enrolledAt"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>{t('enrollmentDate')}</FormLabel>
                    <FormControl><Input {...field} type="date" aria-invalid={fieldState.invalid} /></FormControl>
                  </FormItem>
                )}
              />
            ) : null}

            {purpose === 'enrollment' ? <div className="md:col-span-2">
              <div className="mb-2 flex items-center justify-between gap-3">
                <FormLabel>{t('chooseGroupsOptional')}</FormLabel>
                <Badge variant="secondary">{t('selectedGroupsCount').replace('{count}', String(selectedGroupIds.length))}</Badge>
              </div>
              <div className="grid max-h-56 grid-cols-1 gap-2 overflow-y-auto rounded-xl border border-border bg-muted/20 p-2 md:grid-cols-2">
                {availableGroups.length === 0 ? (
                  <div className="col-span-full flex items-center gap-2 px-2 py-6 text-sm text-muted-foreground">
                    <Users className="size-4" />
                    {t('noAvailableGroups')}
                  </div>
                ) : availableGroups.map((group) => {
                  const value = String(group.id);
                  const checked = selectedGroupIds.includes(value);
                  const occupied = Number(group.currentStudents || 0) + Number(group.reservedStudents || 0);
                  const capacity = Number(group.maxStudents || 12);
                  const full = occupied >= capacity;
                  const labelId = `lead-student-group-${group.id}`;
                  return (
                    <label
                      key={group.id}
                      id={labelId}
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-lg border border-transparent bg-background p-3 transition-colors hover:border-primary/30 has-[[data-state=checked]]:border-primary/40 has-[[data-state=checked]]:bg-primary/5',
                        !checked && full && 'cursor-not-allowed opacity-60',
                        isEditing && currentGroupIds.includes(value) && 'cursor-default',
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={(!checked && full) || (isEditing && currentGroupIds.includes(value))}
                        aria-labelledby={labelId}
                        onCheckedChange={(nextChecked) => {
                          const next = nextChecked
                            ? [...selectedGroupIds, value]
                            : selectedGroupIds.filter((id) => id !== value);
                          form.setValue('groupIds', next, { shouldDirty: true, shouldValidate: true });
                        }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{group.name}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {[group.courseName, group.schoolName].filter(Boolean).join(' · ') || t('group')}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{occupied}/{capacity}</span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{t('studentGroupCanBeAssignedLater')}</p>
              {groupError ? <p className="mt-2 text-sm font-medium text-destructive">{t('studentGroupRequired')}</p> : null}
            </div> : null}

            {purpose === 'enrollment' && selectedGroups.length > 1 ? (
              <FormField
                control={form.control}
                name="primaryGroupId"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>{t('primaryGroup')}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectGroup>
                          {selectedGroups.map((group) => (
                            <SelectItem key={group.id} value={String(group.id)}>{group.name}</SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
            ) : null}
            </div>

            <DialogFooter className="shrink-0 border-t bg-background/95 px-6 py-4 sm:flex-wrap">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saveStudent.isPending}>
                {t('cancel')}
              </Button>
              {!isEditing ? <Button
                type="button"
                variant="secondary"
                disabled={saveStudent.isPending}
                onClick={() => form.handleSubmit((values) => saveStudent.mutate({ values, createAnother: true }))()}
              >
                <Plus data-icon="inline-start" />
                {t('createAndAddAnotherStudent')}
              </Button> : null}
              <Button type="submit" disabled={saveStudent.isPending}>
                {saveStudent.isPending
                  ? <Loader2 className="animate-spin" data-icon="inline-start" />
                  : isEditing
                    ? <Save data-icon="inline-start" />
                    : <Plus data-icon="inline-start" />}
                {saveStudent.isPending ? t('saving') : isEditing ? t('saveChanges') : t('createStudent')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
