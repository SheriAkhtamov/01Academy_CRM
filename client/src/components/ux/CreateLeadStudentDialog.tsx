import { useEffect, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { GraduationCap, Loader2, Plus, Users } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
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
  groupIds: z.array(z.string()).min(1, 'studentGroupRequired'),
  primaryGroupId: z.string().min(1, 'studentGroupRequired'),
  enrolledAt: z.string().min(1, 'fillRequiredFields'),
});

type StudentFormValues = z.infer<typeof studentSchema>;

const todayInputValue = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

const EMPTY_STUDENT: StudentFormValues = {
  studentName: '',
  studentAge: '',
  phone: '',
  groupIds: [],
  primaryGroupId: '',
  enrolledAt: todayInputValue(),
};

interface CreateLeadStudentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: number;
  contactName: string;
  groups: LeadStudentGroupOption[];
  onCreated: (student: CreatedLeadStudent) => void | Promise<void>;
}

export function CreateLeadStudentDialog({
  open,
  onOpenChange,
  leadId,
  contactName,
  groups,
  onCreated,
}: CreateLeadStudentDialogProps) {
  const { t } = useTranslation();
  const form = useForm<StudentFormValues>({
    resolver: zodResolver(studentSchema),
    defaultValues: EMPTY_STUDENT,
  });
  const selectedGroupIds = form.watch('groupIds');
  const primaryGroupId = form.watch('primaryGroupId');

  const availableGroups = useMemo(() => groups.filter((group) => (
    ['open', 'in_progress'].includes(String(group.status))
  )), [groups]);
  const selectedGroups = useMemo(() => availableGroups.filter((group) => (
    selectedGroupIds.includes(String(group.id))
  )), [availableGroups, selectedGroupIds]);

  useEffect(() => {
    if (!open) form.reset({ ...EMPTY_STUDENT, enrolledAt: todayInputValue() });
  }, [form, open]);

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
    mutationFn: (values: StudentFormValues) => apiRequest(
      'POST',
      `/api/academy/leads/${leadId}/students`,
      {
        studentName: values.studentName,
        studentAge: values.studentAge ? Number(values.studentAge) : null,
        phone: values.phone || null,
        groupIds: values.groupIds.map(Number),
        primaryGroupId: Number(values.primaryGroupId),
        enrolledAt: values.enrolledAt,
      },
    ) as Promise<CreatedLeadStudent>,
    onSuccess: async (student) => {
      await onCreated(student);
      toast({ title: t('studentCreated'), description: t('studentCreatedFromLead') });
      onOpenChange(false);
    },
    onError: (error: Error) => toast({
      title: t('studentCreateFailed'),
      description: error.message,
      variant: 'destructive',
    }),
  });

  const groupError = form.formState.errors.groupIds?.message || form.formState.errors.primaryGroupId?.message;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <GraduationCap className="size-5" />
            </span>
            {t('createStudent')}
          </DialogTitle>
          <DialogDescription>{t('createStudentForContact').replace('{name}', contactName)}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form className="grid grid-cols-1 gap-5 md:grid-cols-2" onSubmit={form.handleSubmit((values) => createStudent.mutate(values))}>
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

            <div className="md:col-span-2">
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
            </div>

            {selectedGroups.length > 1 ? (
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

            <DialogFooter className="md:col-span-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={createStudent.isPending}>
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={createStudent.isPending || availableGroups.length === 0}>
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
