import { useEffect, useMemo, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm, type FieldErrors } from 'react-hook-form';
import { z } from 'zod';
import { BookOpen, GraduationCap, Loader2, Plus, Save, UserRound, Users } from 'lucide-react';
import { leadsApi } from '@/features/leads/api';
import { studentsApi } from '@/features/students/api';
import { StudentContractFields } from '@/features/student-contracts/StudentContractFields';
import { useStudentContract } from '@/features/student-contracts/useStudentContract';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { learningCapabilitiesQuery } from '@/features/learning-rollout/api';
import { academyToday } from '@/lib/localeFormat';
import { localizeApiErrorMessage } from '@/lib/queryClient';
import { cn } from '@/lib/utils';
import { CurrencyInput, PhoneInput } from '@/components/ux/FormattedInputs';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import { LocalizedFormMessage } from '@/components/ux/lead/LeadSheetControls';
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
import { CompactModalSection } from './CompactModalSection';

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
  expectedPaymentUzs?: number | null;
  updatedAt?: string | null;
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
  expectedPaymentUzs: z.string().refine((value) => value === '' || (
    /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= 2_147_483_647
  ), 'invalidData'),
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
type StudentSaveIntent = { values: StudentFormValues; createAnother: boolean };

const todayInputValue = academyToday;

const EMPTY_STUDENT: StudentFormValues = {
  studentName: '',
  studentAge: '',
  phone: '',
  expectedPaymentUzs: '',
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
  identityChoicesEnabled?: boolean;
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
  const capabilities = useQuery({ ...learningCapabilitiesQuery, enabled: props.open });
  return <LeadStudentFormDialog {...props} mode="create" identityChoicesEnabled={capabilities.data?.portalEnabled === true} />;
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
  identityChoicesEnabled = false,
  ...modeProps
}: LeadStudentFormDialogProps) {
  const { t } = useTranslation();
  const isEditing = modeProps.mode === 'edit';
  const showIdentityChoices = identityChoicesEnabled && !isEditing;
  const editedStudent = modeProps.mode === 'edit' ? modeProps.student : null;
  const expectedPaymentUzs = editedStudent?.expectedPaymentUzs;
  const studentUpdatedAt = editedStudent?.updatedAt;
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
    expectedPaymentUzs: expectedPaymentUzs == null ? '' : String(expectedPaymentUzs),
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
    expectedPaymentUzs,
    isEditing,
    purpose,
  ]);
  const form = useForm<StudentFormValues>({
    resolver: zodResolver(studentSchema),
    defaultValues: initialValues,
  });
  const [createdCount, setCreatedCount] = useState(0);
  const [whoStudies, setWhoStudies] = useState<'lead' | 'child' | 'other' | ''>('');
  const [whoStudiesError, setWhoStudiesError] = useState(false);
  const [enrollmentOpen, setEnrollmentOpen] = useState(false);
  const enrollmentRef = useRef<HTMLElement>(null);
  const openedFormKey = useRef<string | null>(null);
  const paymentSnapshot = useRef({ amount: expectedPaymentUzs ?? null, updatedAt: studentUpdatedAt });
  const selectedGroupIds = form.watch('groupIds');
  const primaryGroupId = form.watch('primaryGroupId');
  const contract = useStudentContract({ studentId: editedStudent?.id, leadId, open });

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
    if (!open) { openedFormKey.current = null; return; }
    const formKey = `${leadId}:${editedStudent?.id ?? 'create'}:${purpose}`;
    const opening = openedFormKey.current !== formKey;
    if (!opening && form.formState.isDirty) return;
    form.reset(initialValues);
    paymentSnapshot.current = { amount: expectedPaymentUzs ?? null, updatedAt: studentUpdatedAt };
    openedFormKey.current = formKey;
    if (opening) {
      setCreatedCount(0);
      setWhoStudies('');
      setWhoStudiesError(false);
      setEnrollmentOpen(false);
    }
  }, [editedStudent?.id, expectedPaymentUzs, form, initialValues, leadId, studentUpdatedAt, open, purpose]);

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
    mutationFn: async ({ values }: StudentSaveIntent) => {
      if (!await contract.saveNumber()) throw new Error('studentContractSaveFailed');
      const amount = values.expectedPaymentUzs === '' ? null : Number(values.expectedPaymentUzs);
      const payment = amount === paymentSnapshot.current.amount ? {} : { expectedPaymentUzs: amount };
      if (modeProps.mode === 'edit') {
        const updatedStudent = await studentsApi.updateDetails<CreatedLeadStudent>(
          modeProps.student.id,
          {
            studentName: values.studentName,
            studentAge: values.studentAge ? Number(values.studentAge) : null,
            phone: values.phone || null,
            ...payment,
            expectedStudentUpdatedAt: paymentSnapshot.current.updatedAt,
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
        ...(purpose === 'enrollment' ? { expectedPaymentUzs: amount } : {}),
        ...(contract.draftId ? { contractDraftId: contract.draftId } : {}),
      });
    },
    onSuccess: async (student, variables) => {
      if (modeProps.mode === 'edit') {
        await modeProps.onUpdated(student);
        toast({ title: t('studentUpdated') });
        onOpenChange(false);
        return;
      }
      contract.releaseAttachedDraft();
      await modeProps.onCreated(student);
      setCreatedCount((count) => count + 1);
      toast({
        title: t('studentCreated'),
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
      paymentSnapshot.current = { amount: null, updatedAt: undefined };
      setWhoStudies(''); setWhoStudiesError(false);
      setEnrollmentOpen(false);
      form.setFocus('studentName');
    },
    onError: (error: Error) => toast({
      title: isEditing ? t('studentUpdateFailed') : t('studentCreateFailed'),
      description: localizeApiErrorMessage(error.message, (error as Error & { status?: number }).status ?? 0),
      variant: 'destructive',
    }),
  });
  const isPending = saveStudent.isPending || contract.isPending;
  const saveDisabled = isPending || contract.isLoading || Boolean(contract.loadError);
  const guard = useUnsavedChangesGuard({
    open,
    onOpenChange,
    isDirty: form.formState.isDirty || Boolean(whoStudies) || contract.numberChanged,
    isPending,
  });
  const requestSave = (intent: Pick<StudentSaveIntent, 'values' | 'createAnother'>) => {
    if (saveDisabled) return;
    if (showIdentityChoices && !whoStudies) {
      setWhoStudiesError(true);
      document.getElementById('lead-student-person-lead')?.focus();
      return;
    }
    saveStudent.mutate(intent);
  };

  const groupError = form.formState.errors.groupIds?.message || form.formState.errors.primaryGroupId?.message;
  const showEnrolledAt = purpose === 'enrollment' && selectedGroupIds.length > 0;
  const revealErrors = (errors: FieldErrors<StudentFormValues>) => {
    if (errors.expectedPaymentUzs || errors.enrolledAt || errors.groupIds || errors.primaryGroupId) {
      setEnrollmentOpen(true);
      const firstField = Object.keys(errors)[0] as keyof StudentFormValues;
      requestAnimationFrame(() => {
        if (firstField === 'groupIds') enrollmentRef.current?.focus();
        else form.setFocus(firstField);
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={guard.handleOpenChange}>
      <DialogContent className="compact-modal flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader data-topographic="header" className="compact-modal-header shrink-0 space-y-1 border-b px-4 py-3 sm:px-5">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <GraduationCap className="size-4" />
            </span>
            {isEditing ? t('editStudent') : t('createStudent')}
            {!isEditing && createdCount > 0 ? (
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                {t('studentsCreatedCount').replace('{count}', String(createdCount))}
              </Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {showIdentityChoices ? `${t('studentLinkedLead')}: ${contactName}` : contactName}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.stopPropagation();
              void form.handleSubmit((values) => requestSave({ values, createAnother: false }), revealErrors)(event);
            }}
          >
            <div className="compact-modal-body min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3 sm:px-5">
              <CompactModalSection
                title={t('studentDetails')}
                icon={UserRound}
                tone="sky"
                collapsible={false}
                disabled={isPending}
                contentClassName="grid grid-cols-1 gap-3 sm:grid-cols-12"
              >
                {showIdentityChoices ? (
                  <fieldset className="space-y-1.5 sm:col-span-12" disabled={saveStudent.isPending}>
                    <legend className="text-xs font-medium">{t('lmsLeadWhoStudies')}</legend>
                    <div className="grid gap-1.5 sm:grid-cols-3">
                      {(['lead', 'child', 'other'] as const).map((person) => (
                        <label
                          key={person}
                          className={cn(
                            'flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted/40',
                            whoStudies === person && 'border-primary bg-primary/5 text-primary',
                          )}
                        >
                          <input
                            id={`lead-student-person-${person}`}
                            type="radio"
                            name="lead-student-person"
                            value={person}
                            checked={whoStudies === person}
                            aria-invalid={whoStudiesError}
                            aria-describedby={whoStudiesError ? 'lead-student-person-error' : undefined}
                            onChange={() => {
                              setWhoStudies(person);
                              setWhoStudiesError(false);
                              form.setValue('studentName', person === 'lead' ? contactName : '', {
                                shouldDirty: true,
                                shouldValidate: true,
                              });
                            }}
                          />
                          {t(({ lead: 'lmsLeadContactStudies', child: 'lmsLeadChildStudies', other: 'lmsLeadOtherStudies' } as const)[person])}
                        </label>
                      ))}
                    </div>
                    {whoStudiesError ? (
                      <p id="lead-student-person-error" role="alert" className="text-xs font-medium text-destructive">
                        {t('lmsLeadWhoStudiesRequired')}
                      </p>
                    ) : null}
                  </fieldset>
                ) : null}

                <FormField
                  control={form.control}
                  name="studentName"
                  render={({ field, fieldState }) => (
                    <FormItem className="space-y-1 sm:col-span-8">
                      <FormLabel className="text-xs">{t('studentName')}</FormLabel>
                      <FormControl>
                        <Input {...field} autoFocus className="h-8 text-xs" aria-invalid={fieldState.invalid} />
                      </FormControl>
                      {fieldState.error ? (
                        <p className="text-xs font-medium text-destructive">{t('studentNameRequired')}</p>
                      ) : null}
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="studentAge"
                  render={({ field, fieldState }) => (
                    <FormItem className="space-y-1 sm:col-span-4">
                      <FormLabel className="text-xs">{t('age')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          min="1"
                          max="120"
                          className="h-8 text-xs"
                          aria-invalid={fieldState.invalid}
                        />
                      </FormControl>
                      {fieldState.error ? (
                        <p className="text-xs font-medium text-destructive">{t('invalidStudentAge')}</p>
                      ) : null}
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field, fieldState }) => (
                    <FormItem className="space-y-1 sm:col-span-12">
                      <FormLabel className="text-xs">{t('studentPhoneOptional')}</FormLabel>
                      <FormControl>
                        <PhoneInput {...field} onValueChange={field.onChange} className="h-8 text-xs" aria-invalid={fieldState.invalid} />
                      </FormControl>
                      {fieldState.error ? (
                        <p className="text-xs font-medium text-destructive">{t('invalidStudentPhone')}</p>
                      ) : null}
                    </FormItem>
                  )}
                />
              </CompactModalSection>
              {purpose === 'enrollment' ? (
                <CompactModalSection
                  ref={enrollmentRef}
                  title={t('studentLearning')}
                  summary={selectedGroups.map((group) => group.name).join(' · ') || t('noGroup')}
                  icon={BookOpen}
                  tone="teal"
                  count={selectedGroups.length}
                  open={enrollmentOpen}
                  onOpenChange={setEnrollmentOpen}
                  disabled={isPending}
                  contentClassName="grid grid-cols-1 gap-3 sm:grid-cols-12"
                >
                  <FormField
                    control={form.control}
                    name="expectedPaymentUzs"
                    render={({ field, fieldState }) => (
                      <FormItem className="space-y-1 sm:col-span-6">
                        <FormLabel className="text-xs">{t('expectedPayment')}</FormLabel>
                        <FormControl>
                          <CurrencyInput
                            {...field}
                            onValueChange={field.onChange}
                            className="h-8 text-xs"
                            aria-invalid={fieldState.invalid}
                          />
                        </FormControl>
                        <LocalizedFormMessage />
                      </FormItem>
                    )}
                  />
                  {showEnrolledAt ? (
                    <FormField
                      control={form.control}
                      name="enrolledAt"
                      render={({ field, fieldState }) => (
                        <FormItem className="space-y-1 sm:col-span-6">
                          <FormLabel className="text-xs">{t('enrollmentDate')}</FormLabel>
                          <FormControl>
                            <Input {...field} type="date" className="h-8 text-xs" aria-invalid={fieldState.invalid} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  ) : null}

                  <div className="space-y-1.5 sm:col-span-12">
                    <div className="flex items-center justify-between gap-2">
                      <FormLabel className="text-xs">{t('chooseGroupsOptional')}</FormLabel>
                      <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                        {t('selectedGroupsCount').replace('{count}', String(selectedGroupIds.length))}
                      </Badge>
                    </div>
                    <div className="grid max-h-40 grid-cols-1 gap-1.5 overflow-y-auto rounded-lg border border-border bg-muted/20 p-1.5 sm:grid-cols-2">
                      {availableGroups.length === 0 ? (
                        <div className="col-span-full flex items-center gap-2 px-2 py-4 text-xs text-muted-foreground">
                          <Users className="size-3.5" />
                          {t('noAvailableGroups')}
                        </div>
                      ) : (
                        availableGroups.map((group) => {
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
                                'flex cursor-pointer items-start gap-2 rounded-md border border-transparent bg-background px-2.5 py-2 transition-colors hover:border-primary/30 has-[[data-state=checked]]:border-primary/40 has-[[data-state=checked]]:bg-primary/5',
                                !checked && full && 'cursor-not-allowed opacity-60',
                                isEditing && currentGroupIds.includes(value) && 'cursor-default',
                              )}
                            >
                              <Checkbox
                                checked={checked}
                                disabled={(!checked && full) || (isEditing && currentGroupIds.includes(value))}
                                aria-labelledby={labelId}
                                className="mt-0.5"
                                onCheckedChange={(nextChecked) => {
                                  const next = nextChecked
                                    ? [...selectedGroupIds, value]
                                    : selectedGroupIds.filter((id) => id !== value);
                                  form.setValue('groupIds', next, { shouldDirty: true, shouldValidate: true });
                                }}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-medium leading-tight">{group.name}</span>
                                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                                  {[group.courseName, group.schoolName].filter(Boolean).join(' · ') || t('group')}
                                </span>
                              </span>
                              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                                {occupied}/{capacity}
                              </span>
                            </label>
                          );
                        })
                      )}
                    </div>
                    {groupError ? (
                      <p className="text-xs font-medium text-destructive">{t('studentGroupRequired')}</p>
                    ) : null}
                  </div>

                  {selectedGroups.length > 1 ? (
                    <FormField
                      control={form.control}
                      name="primaryGroupId"
                      render={({ field }) => (
                        <FormItem className="space-y-1 sm:col-span-12">
                          <FormLabel className="text-xs">{t('primaryGroup')}</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger ref={field.ref} className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectGroup>
                                {selectedGroups.map((group) => (
                                  <SelectItem key={group.id} value={String(group.id)} className="text-xs">
                                    {group.name}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                  ) : null}
                </CompactModalSection>
              ) : null}

              <StudentContractFields
                key={editedStudent ? `student:${editedStudent.id}` : `lead:${leadId}`}
                controls={contract}
                disabled={saveStudent.isPending}
                compact
              />
            </div>

            <DialogFooter className="compact-modal-footer shrink-0 border-t px-4 py-2.5 sm:flex-wrap sm:px-5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => guard.handleOpenChange(false)}
                disabled={isPending}
              >
                {t('cancel')}
              </Button>
              {!isEditing ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-8 text-xs"
                  disabled={saveDisabled}
                  onClick={() => form.handleSubmit((values) => requestSave({ values, createAnother: true }), revealErrors)()}
                >
                  <Plus className="size-3.5" data-icon="inline-start" />
                  {t('createAndAddAnotherStudent')}
                </Button>
              ) : null}
              <Button type="submit" size="sm" className="h-8 text-xs" disabled={saveDisabled}>
                {saveStudent.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" data-icon="inline-start" />
                ) : isEditing ? (
                  <Save className="size-3.5" data-icon="inline-start" />
                ) : (
                  <Plus className="size-3.5" data-icon="inline-start" />
                )}
                {saveStudent.isPending ? t('saving') : isEditing ? t('saveChanges') : t('createStudent')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
      <UnsavedChangesDialog
        open={guard.confirmationOpen}
        onOpenChange={guard.setConfirmationOpen}
        onDiscard={guard.discardChanges}
      />
    </Dialog>
  );
}
