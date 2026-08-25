import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { GraduationCap, Loader2, Plus, Users } from 'lucide-react';
import { leadsApi } from '@/features/leads/api';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { academyToday } from '@/lib/localeFormat';
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
  if (value.demoOnly) return;
  if (value.groupIds.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['groupIds'],
    });
  }
  if (!value.primaryGroupId || !value.groupIds.includes(value.primaryGroupId)) {
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

export function CreateLeadStudentDialog({
  open,
  onOpenChange,
  leadId,
  contactName,
  groups,
  purpose = 'enrollment',
  onCreated,
}: CreateLeadStudentDialogProps) {
  const { t } = useTranslation();
  const form = useForm<StudentFormValues>({
    resolver: zodResolver(studentSchema),
    defaultValues: { ...EMPTY_STUDENT, demoOnly: purpose === 'demo' },
  });
  const [createdCount, setCreatedCount] = useState(0);
  const selectedGroupIds = form.watch('groupIds');
  const primaryGroupId = form.watch('primaryGroupId');

  const availableGroups = useMemo(() => groups.filter((group) => (
    ['open', 'in_progress'].includes(String(group.status))
  )), [groups]);
  const selectedGroups = useMemo(() => availableGroups.filter((group) => (
    selectedGroupIds.includes(String(group.id))
  )), [availableGroups, selectedGroupIds]);

  useEffect(() => {
    if (!open) {
      form.reset({
        ...EMPTY_STUDENT,
        enrolledAt: todayInputValue(),
        demoOnly: purpose === 'demo',
      });
      setCreatedCount(0);
    }
  }, [form, open, purpose]);

  useEffect(() => {
    if (selectedGroupIds.length === 0) {
      if (primaryGroupId) form.setValue('primaryGroupId', '', { shouldValidate: true });
      return;
    }
    if (!selectedGroupIds.includes(primaryGroupId)) {
      form.setValue('primaryGroupId', selectedGroupIds[0], { shouldValidate: true });
    }
  }, [form, primaryGroupId, selectedGroupIds]);

  const createStudent = useMutation({
    mutationFn: ({ values }: { values: StudentFormValues; createAnother: boolean }) => leadsApi.createStudent<CreatedLeadStudent>(
      leadId,
      {
        studentName: values.studentName,
        studentAge: values.studentAge ? Number(values.studentAge) : null,
        phone: values.phone || null,
        groupIds: values.demoOnly ? [] : values.groupIds.map(Number),
        primaryGroupId: values.demoOnly ? null : Number(values.primaryGroupId),
        enrolledAt: values.demoOnly ? null : values.enrolledAt,
        demoOnly: values.demoOnly,
      },
    ),
    onSuccess: async (student, variables) => {
      await onCreated(student);
      setCreatedCount((count) => count + 1);
      toast({
        title: t('studentCreated'),
        description: purpose === 'demo'
          ? t('demoStudentCreatedFromLead')
          : t('studentCreatedFromLead'),
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
      title: t('studentCreateFailed'),
      description: error.message,
      variant: 'destructive',
    }),
  });

  const groupError = form.formState.errors.groupIds?.message || form.formState.errors.primaryGroupId?.message;
  const dialogDescription = purpose === 'demo'
    ? t('createDemoStudentForContact')
    : t('createStudentForContact');

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !createStudent.isPending && onOpenChange(nextOpen)}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <GraduationCap className="size-5" />
            </span>
            {t('createStudent')}
            {createdCount > 0 ? (
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
            onSubmit={form.handleSubmit((values) => createStudent.mutate({ values, createAnother: false }))}
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
            {purpose === 'enrollment' ? (
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
                <FormLabel>{t('chooseGroups')}</FormLabel>
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
                      className="flex cursor-pointer items-start gap-3 rounded-lg border border-transparent bg-background p-3 transition-colors hover:border-primary/30 has-[[data-state=checked]]:border-primary/40 has-[[data-state=checked]]:bg-primary/5 has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60"
                    >
                      <Checkbox
                        checked={checked}
                        disabled={!checked && full}
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
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={createStudent.isPending}>
                {t('cancel')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={createStudent.isPending || (purpose === 'enrollment' && availableGroups.length === 0)}
                onClick={() => form.handleSubmit((values) => createStudent.mutate({ values, createAnother: true }))()}
              >
                <Plus data-icon="inline-start" />
                {t('createAndAddAnotherStudent')}
              </Button>
              <Button type="submit" disabled={createStudent.isPending || (purpose === 'enrollment' && availableGroups.length === 0)}>
                {createStudent.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
                {createStudent.isPending ? t('saving') : t('createStudent')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
