import { useEffect, useMemo, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { apiRequest } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { useOnlinePbxCall } from '@/hooks/useOnlinePbxCall';
import type { TranslationKey } from '@/lib/i18n';
import { leadMergeErrorMessage } from '@/lib/leadMerge';
import { PhoneInput } from '@/components/ux/FormattedInputs';
import {
  LeadMergeConflictDialog,
  type LeadMergeDialogLead,
} from '@/components/ux/LeadMergeConflictDialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  useFormField,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { getInitials } from '@/lib/auth';
import {
  isInstagramLead,
  isSyntheticInstagramPhone,
  leadMessageTarget,
  primaryVisibleLeadPhone,
  visibleLeadPhones,
} from '@/lib/leadContact';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Clock3,
  CreditCard,
  CalendarClock,
  ChevronsUpDown,
  ExternalLink,
  History,
  Loader2,
  MessageSquare,
  Phone,
  Plus,
  Save,
  Trash2,
  UserRoundCog,
  UserRound,
  GraduationCap,
  Tag,
  Users,
} from 'lucide-react';
import { LEAD_STATUSES, PAYMENT_DISCOUNTS, PAYMENT_METHODS, PAYMENT_TYPES } from '@shared/academy';

type LeadSheetTab = 'deal' | 'activity' | 'payment' | 'tasks';

interface LeadDetails {
  id: number;
  contactName: string;
  phone?: string | null;
  phoneNumbers?: string[];
  messenger?: string | null;
  studentName?: string | null;
  studentAge?: number | null;
  courseId?: number | null;
  courseName?: string | null;
  schoolId?: number | null;
  schoolName?: string | null;
  sourceId?: number | null;
  sourceName?: string | null;
  sourceChannel?: string | null;
  statusCode: string;
  managerId?: number | null;
  managerName?: string | null;
  comment?: string | null;
  language?: string | null;
  enrolledGroupId?: number | null;
  studentId?: number | null;
  primaryGroupId?: number | null;
  groupIds?: number[];
  groups?: Array<{
    groupId: number;
    groupName: string;
    courseId?: number | null;
    courseName?: string | null;
    schoolId?: number | null;
    isPrimary?: boolean;
    enrolledAt?: string | null;
  }>;
  expectedPaymentUzs?: number | null;
  offerPriceUzs?: number | null;
  firstContactAt?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  history?: Array<{
    id: number;
    fromStatusCode?: string | null;
    toStatusCode: string;
    enteredAt?: string | null;
    comment?: string | null;
  }>;
  assignmentHistory?: Array<{
    id: number;
    fromManagerId?: number | null;
    fromManagerName?: string | null;
    toManagerId: number;
    toManagerName?: string | null;
    changedBy?: number | null;
    changedByName?: string | null;
    comment?: string | null;
    createdAt?: string | null;
  }>;
  communications?: Array<{
    id: number;
    channel: string;
    result?: string | null;
    comment?: string | null;
    createdAt?: string | null;
  }>;
  tasks?: Array<{
    id: number;
    title: string;
    description?: string | null;
    deadlineAt?: string | null;
    status: string;
  }>;
  payments?: Array<{
    id: number;
    amountUzs: number;
    method: string;
    type?: string | null;
    discount?: string | null;
    paidUntil?: string | null;
    comment?: string | null;
    status: string;
    paidAt?: string | null;
    createdAt?: string | null;
  }>;
}

interface LeadDetailSheetProps {
  leadId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: LeadSheetTab;
  courses: Array<{ id: number; name: string }>;
  groups: Array<{
    id: number;
    name: string;
    courseId?: number | null;
    schoolId?: number | null;
    status?: string;
    currentStudents?: number;
    reservedStudents?: number;
    maxStudents?: number;
  }>;
  sources: Array<{ id: number; name: string }>;
  statuses: Array<{ code: string; name: string; isActive?: boolean }>;
  managers: Array<{ id: number; fullName: string }>;
  currentUserId?: number;
  leadStatusName: (code: string) => string;
  dateTime: (value: string | null | undefined) => string;
  money: (value: number | string | null | undefined) => string;
  onChanged: () => void;
  onMerged?: (retainedLeadId: number) => void;
}

interface DuplicateLeadHint extends LeadMergeDialogLead {
  entityType?: 'lead' | 'student';
  leadId?: number | null;
  statusCode?: string | null;
}

const optionalNumberString = z.string().refine(
  (value) => value === '' || (Number.isFinite(Number(value)) && Number(value) >= 0),
  'invalidData',
);

const optionalPhoneString = z.string().trim().refine(
  (value) => value === '' || value.length >= 7,
  'invalidData',
);

const phoneKey = (value: string | null | undefined) => String(value ?? '').replace(/\D/g, '');
const compactPhoneNumbers = (values: string[]) => {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const trimmed = value.trim();
    const key = phoneKey(trimmed);
    if (!trimmed || !key || seen.has(key)) return [];
    seen.add(key);
    return [trimmed];
  });
};
const uniquePhoneNumbers = (values: string[]) => {
  const keys = values.map(phoneKey).filter(Boolean);
  return new Set(keys).size === keys.length;
};

const leadSchema = z.object({
  contactName: z.string().trim().min(1, 'fillRequiredFields'),
  phoneNumbers: z.array(optionalPhoneString).min(1).refine(uniquePhoneNumbers, 'duplicatePhoneInForm'),
  messenger: z.string(),
  studentName: z.string(),
  studentAge: optionalNumberString,
  courseId: z.string(),
  sourceId: z.string().min(1, 'fillRequiredFields'),
  enrolledGroupId: z.string(),
  language: z.string(),
  statusCode: z.string(),
  expectedPaymentUzs: optionalNumberString,
  comment: z.string(),
});

const contactSchema = z.object({
  channel: z.string().min(1, 'fillRequiredFields'),
  result: z.string().trim().min(1, 'fillRequiredFields'),
  comment: z.string(),
});

const paymentSchema = z.object({
  amountUzs: z.string().refine((value) => Number(value) > 0, 'fillRequiredFields'),
  method: z.string().min(1, 'fillRequiredFields'),
  type: z.string().min(1, 'fillRequiredFields'),
  discount: z.string().min(1, 'fillRequiredFields'),
  paidUntil: z.string(),
  comment: z.string(),
});

const paymentDiscountTranslationKeys = {
  promo_20: 'paymentDiscountPromo20',
  family_15: 'paymentDiscountFamily15',
  referral_15: 'paymentDiscountReferral15',
  none: 'paymentDiscountNone',
} as const satisfies Record<(typeof PAYMENT_DISCOUNTS)[number], TranslationKey>;

const paymentMethodTranslationKeys = {
  cash: 'paymentMethodCash',
  transfer: 'paymentMethodTransfer',
  card: 'paymentMethodCard',
} as const satisfies Record<(typeof PAYMENT_METHODS)[number], TranslationKey>;

const paymentTypeTranslationKeys = {
  full: 'paymentTypeFull',
  installment_1_2: 'paymentTypeInstallmentOne',
  installment_2_2: 'paymentTypeInstallmentTwo',
} as const satisfies Record<(typeof PAYMENT_TYPES)[number], TranslationKey>;

const taskSchema = z.object({
  title: z.string().trim().min(1, 'fillRequiredFields'),
  deadlineAt: z.string(),
  description: z.string(),
});

type LeadFormValues = z.infer<typeof leadSchema>;
type ContactFormValues = z.infer<typeof contactSchema>;
type PaymentFormValues = z.infer<typeof paymentSchema>;
type TaskFormValues = z.infer<typeof taskSchema>;

const leadToFormValues = (lead: LeadDetails): LeadFormValues => ({
  contactName: lead.contactName ?? '',
  phoneNumbers: visibleLeadPhones(lead).length ? visibleLeadPhones(lead) : [''],
  messenger: lead.messenger ?? '',
  studentName: lead.studentName ?? '',
  studentAge: lead.studentAge ? String(lead.studentAge) : '',
  courseId: lead.courseId ? String(lead.courseId) : '',
  sourceId: lead.sourceId ? String(lead.sourceId) : '',
  enrolledGroupId: lead.enrolledGroupId ? String(lead.enrolledGroupId) : '',
  language: lead.language ?? 'ru',
  statusCode: lead.statusCode,
  expectedPaymentUzs: lead.expectedPaymentUzs ? String(lead.expectedPaymentUzs) : '',
  comment: lead.comment ?? '',
});

const toInputDate = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const nextPaymentDate = (payments?: LeadDetails['payments']) => {
  const latestPaidUntil = (payments ?? []).reduce((latest, payment) => {
    if (!payment.paidUntil) return latest;
    const timestamp = new Date(payment.paidUntil).getTime();
    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
  }, 0);
  const baseTimestamp = Math.max(Date.now(), latestPaidUntil);
  return toInputDate(new Date(baseTimestamp + 30 * 24 * 60 * 60 * 1000).toISOString());
};

function LocalizedFormMessage() {
  const { t } = useTranslation();
  const { error, formMessageId } = useFormField();
  if (!error?.message) return null;
  const key = String(error.message) as TranslationKey;
  return (
    <p id={formMessageId} className="text-sm font-medium text-destructive">
      {t(key)}
    </p>
  );
}

export function LeadDetailSheet({
  leadId,
  open,
  onOpenChange,
  initialTab = 'deal',
  courses,
  groups,
  sources,
  statuses,
  managers,
  currentUserId,
  leadStatusName,
  dateTime,
  money,
  onChanged,
  onMerged,
}: LeadDetailSheetProps) {
  const { t } = useTranslation();
  const onlinePbxCall = useOnlinePbxCall();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<LeadSheetTab>(initialTab);
  const [pendingManagerId, setPendingManagerId] = useState<number | null>(null);
  const [duplicateHint, setDuplicateHint] = useState<DuplicateLeadHint | null>(null);

  const leadQuery = useQuery<LeadDetails>({
    queryKey: ['/api/academy/leads', leadId],
    queryFn: () => apiRequest('GET', `/api/academy/leads/${leadId}`),
    enabled: open && leadId !== null,
  });

  const leadForm = useForm<LeadFormValues>({
    resolver: zodResolver(leadSchema),
    defaultValues: {
      contactName: '',
      phoneNumbers: [''],
      messenger: '',
      studentName: '',
      studentAge: '',
      courseId: '',
      sourceId: '',
      enrolledGroupId: '',
      language: 'ru',
      statusCode: 'new_request',
      expectedPaymentUzs: '',
      comment: '',
    },
  });
  const contactForm = useForm<ContactFormValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: { channel: 'call', result: '', comment: '' },
  });
  const paymentForm = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      amountUzs: '',
      method: 'transfer',
      type: 'full',
      discount: 'none',
      paidUntil: '',
      comment: '',
    },
  });
  const taskForm = useForm<TaskFormValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: { title: '', deadlineAt: '', description: '' },
  });

  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [initialTab, open]);

  // Track which lead snapshot we last hydrated the forms from. Background refetches
  // (e.g. after recording a contact) must NOT wipe what the user is typing in other tabs,
  // so we only reseed when the lead identity changes or when the deal data itself changed
  // AND the user hasn't started editing the affected form.
  const hydratedLeadKey = useRef<string | null>(null);
  const hydratedLeadId = useRef<number | null>(null);
  const hydratedTransientKey = useRef<string | null>(null);

  const leadSnapshotKey = useMemo(() => {
    const lead = leadQuery.data;
    if (!lead) return null;
    return [
      lead.id,
      lead.contactName,
      (lead.phoneNumbers?.length ? lead.phoneNumbers : lead.phone ? [lead.phone] : ['']).join(','),
      lead.messenger ?? '',
      lead.studentName ?? '',
      lead.studentAge ?? '',
      lead.courseId ?? '',
      lead.sourceId ?? '',
      lead.enrolledGroupId ?? '',
      lead.language ?? '',
      lead.statusCode,
      lead.expectedPaymentUzs ?? '',
      lead.comment ?? '',
    ].join('|');
  }, [leadQuery.data]);

  const transientSnapshotKey = useMemo(() => {
    const lead = leadQuery.data;
    if (!lead) return null;
    return [
      lead.id,
      lead.expectedPaymentUzs ?? '',
      lead.offerPriceUzs ?? '',
      (lead.payments ?? []).map((p) => `${p.id}:${p.paidUntil ?? ''}`).join(','),
    ].join('|');
  }, [leadQuery.data]);

  useEffect(() => {
    const lead = leadQuery.data;
    if (!lead || !leadSnapshotKey) return;

    // Reseed the deal form only when the lead itself changes, or when the
    // server data changed AND the user is not mid-edit in the deal tab.
    if (hydratedLeadKey.current !== leadSnapshotKey) {
      const changedLead = hydratedLeadId.current !== lead.id;
      leadForm.reset(
        leadToFormValues(lead),
        changedLead ? undefined : { keepDirtyValues: true },
      );
      hydratedLeadKey.current = leadSnapshotKey;
      hydratedLeadId.current = lead.id;
    }

    // The payment form is a transient single-shot action. Only reseed it on first
    // load or when the underlying amount changed and the user is not editing it.
    if (hydratedTransientKey.current !== transientSnapshotKey) {
      const paymentDirty = paymentForm.formState.isDirty;
      if (!paymentDirty || hydratedTransientKey.current === null) {
        paymentForm.reset({
          amountUzs: String(lead.expectedPaymentUzs ?? lead.offerPriceUzs ?? ''),
          method: 'transfer',
          type: 'full',
          discount: 'none',
          paidUntil: nextPaymentDate(lead.payments),
          comment: '',
        });
      }
      hydratedTransientKey.current = transientSnapshotKey;
    }
  }, [leadQuery.data, leadSnapshotKey, transientSnapshotKey, leadForm, paymentForm]);

  // Reset hydration tracking when the sheet closes so reopening reseeds cleanly.
  useEffect(() => {
    if (!open) {
      hydratedLeadKey.current = null;
      hydratedLeadId.current = null;
      hydratedTransientKey.current = null;
      setPendingManagerId(null);
      setDuplicateHint(null);
    }
  }, [open]);

  const finishMutation = async (title: string) => {
    toast({ title });
    await leadQuery.refetch();
    onChanged();
  };

  const refreshLeadGroups = async () => {
    const refetch = leadQuery.refetch();
    onChanged();
    await refetch;
  };

  const updateLead = useMutation({
    mutationFn: (values: LeadFormValues) => {
      const { phoneNumbers, ...rest } = values;
      const nextPhoneNumbers = compactPhoneNumbers(phoneNumbers);
      const currentLead = leadQuery.data;
      const hasOnlyHiddenInstagramPhone = Boolean(
        currentLead
        && nextPhoneNumbers.length === 0
        && visibleLeadPhones(currentLead).length === 0
        && (
          isSyntheticInstagramPhone(currentLead.phone)
          || (currentLead.phoneNumbers ?? []).some(isSyntheticInstagramPhone)
        ),
      );

      return apiRequest('PATCH', `/api/academy/leads/${leadId}`, {
        ...rest,
        expectedUpdatedAt: currentLead?.updatedAt,
        ...(hasOnlyHiddenInstagramPhone ? {} : { phoneNumbers: nextPhoneNumbers }),
        studentAge: values.studentAge ? Number(values.studentAge) : null,
        courseId: values.courseId ? Number(values.courseId) : null,
        sourceId: Number(values.sourceId),
        enrolledGroupId: values.enrolledGroupId ? Number(values.enrolledGroupId) : null,
        expectedPaymentUzs: values.expectedPaymentUzs ? Number(values.expectedPaymentUzs) : null,
      });
    },
    onSuccess: async (updatedLead: LeadDetails) => {
      leadForm.reset(leadToFormValues(updatedLead));
      hydratedLeadKey.current = null;
      hydratedLeadId.current = updatedLead.id;
      await finishMutation(t('leadSaved'));
    },
    onError: (error: any) => {
      const duplicate = error?.data?.duplicate as DuplicateLeadHint | undefined;
      if (error?.status === 409 && duplicate) {
        setDuplicateHint({
          ...duplicate,
          id: duplicate.entityType === 'lead' ? duplicate.id : duplicate.leadId,
          statusName: duplicate.statusCode ? leadStatusName(duplicate.statusCode) : undefined,
        });
        return;
      }
      toast({ title: t('leadSaveFailed'), description: error.message, variant: 'destructive' });
    },
  });

  const addLeadGroup = useMutation({
    mutationFn: ({
      leadId: targetLeadId,
      studentId,
      groupId,
      isPrimary = false,
    }: {
      leadId: number;
      studentId?: number | null;
      groupId: number;
      isPrimary?: boolean;
    }) => apiRequest(
      'POST',
      studentId
        ? `/api/academy/students/${studentId}/groups`
        : `/api/academy/leads/${targetLeadId}/groups`,
      { groupId, isPrimary },
    ),
    onSuccess: refreshLeadGroups,
    onError: (error: Error) => toast({
      title: t('groupAddFailed'),
      description: error.message,
      variant: 'destructive',
    }),
  });

  const removeLeadGroup = useMutation({
    mutationFn: ({
      leadId: targetLeadId,
      studentId,
      groupId,
    }: {
      leadId: number;
      studentId?: number | null;
      groupId: number;
    }) => apiRequest(
      'DELETE',
      studentId
        ? `/api/academy/students/${studentId}/groups/${groupId}`
        : `/api/academy/leads/${targetLeadId}/groups/${groupId}`,
    ),
    onSuccess: refreshLeadGroups,
    onError: (error: Error) => toast({
      title: t('groupRemoveFailed'),
      description: error.message,
      variant: 'destructive',
    }),
  });

  const mergeLeads = useMutation({
    mutationFn: ({ retainedLeadId, duplicateLeadId }: { retainedLeadId: number; duplicateLeadId: number }) =>
      apiRequest('POST', '/api/academy/leads/merge', { retainedLeadId, duplicateLeadId }),
    onSuccess: async (result: { retainedLead: LeadDetails }) => {
      const retainedLeadId = Number(result.retainedLead.id);
      setDuplicateHint(null);
      await queryClient.invalidateQueries({ queryKey: ['/api/academy/leads'] });
      onChanged();
      toast({ title: t('leadMergeCompleted'), description: t('leadMergeCompletedDescription') });
      if (retainedLeadId === leadId) {
        hydratedLeadKey.current = null;
        await leadQuery.refetch();
      } else {
        onMerged?.(retainedLeadId);
      }
    },
    onError: (error: any) => toast({
      title: t('leadMergeFailed'),
      description: leadMergeErrorMessage(t, error?.data?.error),
      variant: 'destructive',
    }),
  });

  const assignLead = useMutation({
    mutationFn: (managerId: number) => apiRequest('POST', `/api/academy/leads/${leadId}/assign`, { managerId }),
    onSuccess: async () => {
      setPendingManagerId(null);
      toast({ title: t('leadTransferred') });
      onChanged();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      setPendingManagerId(null);
      toast({ title: t('leadTransferFailed'), description: error.message, variant: 'destructive' });
    },
  });

  const addContact = useMutation({
    mutationFn: (values: ContactFormValues) =>
      apiRequest('POST', `/api/academy/leads/${leadId}/contact`, values),
    onSuccess: async () => {
      contactForm.reset({ channel: 'call', result: '', comment: '' });
      await finishMutation(t('contactRecorded'));
    },
    onError: (error: Error) => toast({ title: t('contactRecordFailed'), description: error.message, variant: 'destructive' }),
  });

  const createPayment = useMutation({
    mutationFn: (values: PaymentFormValues) =>
      apiRequest('POST', '/api/academy/payments', {
        leadId,
        amountUzs: Number(values.amountUzs),
        method: values.method,
        type: values.type,
        discount: values.discount,
        paidUntil: values.paidUntil || undefined,
        comment: values.comment,
        status: 'paid',
      }),
    onSuccess: async () => {
      const clientExisted = leadQuery.data?.statusCode === 'paid';
      const refreshed = await leadQuery.refetch();
      const refreshedLead = refreshed.data;
      paymentForm.reset({
        amountUzs: String(refreshedLead?.expectedPaymentUzs ?? refreshedLead?.offerPriceUzs ?? ''),
        method: 'transfer',
        type: 'full',
        discount: 'none',
        paidUntil: nextPaymentDate(refreshedLead?.payments),
        comment: '',
      });
      hydratedTransientKey.current = null;
      onChanged();
      toast({
        title: clientExisted ? t('paymentSaved') : t('clientCreated'),
        description: clientExisted ? t('recurringPaymentSavedDesc') : t('paymentSavedDesc'),
      });
    },
    onError: (error: Error) => toast({ title: t('paymentSaveFailed'), description: error.message, variant: 'destructive' }),
  });

  const createTask = useMutation({
    mutationFn: (values: TaskFormValues) => apiRequest('POST', '/api/academy/tasks', {
      title: values.title,
      description: values.description,
      deadlineAt: values.deadlineAt ? new Date(values.deadlineAt).toISOString() : null,
      responsibleId: currentUserId,
      entityType: 'lead',
      entityId: leadId,
    }),
    onSuccess: async () => {
      taskForm.reset({ title: '', deadlineAt: '', description: '' });
      await finishMutation(t('taskCreated'));
    },
    onError: (error: Error) => toast({ title: t('taskCreateFailed'), description: error.message, variant: 'destructive' }),
  });

  const updateTask = useMutation({
    mutationFn: (taskId: number) => apiRequest('PATCH', `/api/academy/tasks/${taskId}`, {
      status: 'done',
      completedAt: new Date().toISOString(),
    }),
    onSuccess: () => finishMutation(t('taskUpdated')),
    onError: (error: Error) => toast({ title: t('taskUpdateFailed'), description: error.message, variant: 'destructive' }),
  });

  const phoneNumbers = leadForm.watch('phoneNumbers') ?? [''];
  const phoneValues = phoneNumbers.length > 0 ? phoneNumbers : [''];
  const phoneNumbersMessage = typeof leadForm.formState.errors.phoneNumbers?.message === 'string'
    ? leadForm.formState.errors.phoneNumbers.message as TranslationKey
    : null;
  const lead = leadQuery.data;
  const studentGroups = lead?.groups ?? [];
  const selectedGroupIds = useMemo(
    () => new Set((lead?.groups ?? []).map((group) => Number(group.groupId))),
    [lead?.groups],
  );
  const selectableGroups = useMemo(() => {
    return groups.filter((group) => {
      const isSelected = selectedGroupIds.has(Number(group.id));
      return isSelected || ['open', 'in_progress'].includes(String(group.status));
    });
  }, [groups, selectedGroupIds]);
  const primaryGroupId = Number(
    studentGroups.find((group) => group.isPrimary)?.groupId
    ?? lead?.primaryGroupId
    ?? lead?.enrolledGroupId
    ?? 0,
  ) || null;
  const groupMutationPending = addLeadGroup.isPending || removeLeadGroup.isPending;
  const visiblePhoneNumbers = visibleLeadPhones(lead);
  const primaryPhone = primaryVisibleLeadPhone(lead);
  const messageTarget = leadMessageTarget(lead);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-3xl">
        {leadQuery.isError ? (
          <div className="flex flex-col gap-5 p-6">
            <SheetTitle>{t('lead')}</SheetTitle>
            <SheetDescription>{t('failedToLoadData')}</SheetDescription>
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>{t('failedToLoadData')}</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-3">
                <span>{leadQuery.error instanceof Error ? leadQuery.error.message : t('errorOccurred')}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => leadQuery.refetch()}>
                  {t('retry')}
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        ) : leadQuery.isLoading || !lead ? (
          <div className="flex flex-col gap-5 p-6">
            <SheetTitle className="sr-only">{t('lead')}</SheetTitle>
            <SheetDescription className="sr-only">{t('loading')}</SheetDescription>
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-80 w-full" />
          </div>
        ) : (
          <>
            <SheetHeader className="border-b border-border bg-muted/30 p-6 pr-14">
              <div className="flex items-start gap-4">
                <Avatar className="size-12 border border-border bg-background">
                  <AvatarFallback>{getInitials(lead.contactName)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <SheetTitle className="truncate text-xl">{lead.contactName}</SheetTitle>
                    <Badge variant={lead.statusCode === 'paid' ? 'success' : 'secondary'}>
                      {leadStatusName(lead.statusCode)}
                    </Badge>
                  </div>
                  <SheetDescription className="sr-only">{t('lead')}</SheetDescription>

                  {/* Meta chips: only meaningful info shown, faded dots removed */}
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {visiblePhoneNumbers.length > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="size-3.5" />
                        {visiblePhoneNumbers.join(', ')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 italic">{t('leadSheetNoContactInfo')}</span>
                    )}
                    {lead.studentName ? (
                      <span className="inline-flex items-center gap-1">
                        <UserRound className="size-3.5" />
                        {lead.studentName}
                        {lead.studentAge ? `, ${lead.studentAge}` : ''}
                      </span>
                    ) : null}
                    {lead.courseName ? (
                      <span className="inline-flex items-center gap-1">
                        <GraduationCap className="size-3.5" />
                        {lead.courseName}
                      </span>
                    ) : null}
                    {lead.schoolName ? (
                      <span className="inline-flex items-center gap-1">
                        <Users className="size-3.5" />
                        {lead.schoolName}
                      </span>
                    ) : null}
                    {lead.sourceName ? (
                      <span className="inline-flex items-center gap-1">
                        <Tag className="size-3.5" />
                        {lead.sourceName}
                      </span>
                    ) : null}
                  </div>

                  {/* Manager line — single clean row */}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <UserRoundCog className="size-3.5" />
                      <span className="text-foreground/80">{t('manager')}:</span>
                      <span>{lead.managerName || t('notAssigned')}</span>
                    </span>
                    {lead.firstContactAt ? (
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="size-3.5" />
                        <span className="text-foreground/80">{t('leadStatusFirstContact')}:</span>
                        {dateTime(lead.firstContactAt)}
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1">
                      <Clock3 className="size-3.5" />
                      <span className="text-foreground/80">{t('leadSheetCreated')}:</span>
                      {dateTime(lead.createdAt)}
                    </span>
                  </div>

                  {/* Quick actions — single prominent CTA + secondary outline buttons */}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {primaryPhone ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={onlinePbxCall.isPending}
                        onClick={() => onlinePbxCall.startCall(primaryPhone)}
                      >
                        {onlinePbxCall.isPending && onlinePbxCall.pendingPhone === primaryPhone ? (
                          <Loader2 className="animate-spin" data-icon="inline-start" />
                        ) : (
                          <Phone data-icon="inline-start" />
                        )}
                        {t('callShort')}
                      </Button>
                    ) : null}
                    {messageTarget ? (
                      <Button asChild size="sm" variant="outline">
                        <a
                          href={messageTarget.href}
                          target={messageTarget.external ? '_blank' : undefined}
                          rel={messageTarget.external ? 'noreferrer' : undefined}
                        >
                          <MessageSquare data-icon="inline-start" />
                          {t('writeShort')}
                          {messageTarget.external ? <ExternalLink data-icon="inline-end" /> : null}
                        </a>
                      </Button>
                    ) : null}
                    <Button size="sm" onClick={() => setActiveTab('payment')}>
                      <CreditCard data-icon="inline-start" />
                      {lead.statusCode === 'paid' ? t('recordAnotherPayment') : t('payment')}
                    </Button>
                  </div>
                </div>
              </div>
            </SheetHeader>

            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as LeadSheetTab)}>
              <div className="sticky top-0 z-10 border-b border-border bg-background px-6 py-3">
                <TabsList className="flex h-auto w-full justify-start overflow-x-auto">
                  <TabsTrigger value="deal" className="shrink-0 gap-1.5"><UserRound data-icon="inline-start" />{t('dealTab')}</TabsTrigger>
                  <TabsTrigger value="activity" className="shrink-0 gap-1.5"><History data-icon="inline-start" />{t('activityTab')}</TabsTrigger>
                  <TabsTrigger value="payment" className="shrink-0 gap-1.5"><CreditCard data-icon="inline-start" />{t('payment')}</TabsTrigger>
                  <TabsTrigger value="tasks" className="shrink-0 gap-1.5"><ClipboardList data-icon="inline-start" />{t('myTasks')}</TabsTrigger>
                </TabsList>
              </div>

              <div className="p-6">
                <TabsContent value="deal" className="mt-0">
                  <Form {...leadForm}>
                    <form className="flex flex-col gap-5" onSubmit={leadForm.handleSubmit((values) => updateLead.mutate(values))}>
                      <Card>
                        <CardHeader><CardTitle>{t('clientAndStudent')}</CardTitle></CardHeader>
                        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <FormField
                            control={leadForm.control}
                            name="contactName"
                            render={({ field, fieldState }) => (
                              <FormItem>
                                <FormLabel>{t('contactPersonName')}</FormLabel>
                                <FormControl><Input {...field} aria-invalid={fieldState.invalid} /></FormControl>
                                <LocalizedFormMessage />
                              </FormItem>
                            )}
                          />
                          <div className="flex flex-col gap-3">
                            {phoneValues.map((_, index) => (
                              <FormField
                                key={index}
                                control={leadForm.control}
                                name={`phoneNumbers.${index}`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>{index === 0 ? t('phone') : `${t('phone')} ${index + 1}`}</FormLabel>
                                    <div className="flex gap-2">
                                      <FormControl>
                                        <PhoneInput value={field.value} onValueChange={field.onChange} />
                                      </FormControl>
                                      {phoneValues.length > 1 ? (
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="icon"
                                          aria-label={t('removePhone')}
                                          onClick={() => {
                                            const nextPhones = phoneValues.filter((__, phoneIndex) => phoneIndex !== index);
                                            leadForm.setValue('phoneNumbers', nextPhones.length > 0 ? nextPhones : [''], {
                                              shouldDirty: true,
                                              shouldValidate: true,
                                            });
                                          }}
                                        >
                                          <Trash2 />
                                        </Button>
                                      ) : null}
                                    </div>
                                    <LocalizedFormMessage />
                                  </FormItem>
                                )}
                              />
                            ))}
                            {phoneNumbersMessage ? (
                              <p className="text-sm font-medium text-destructive">{t(phoneNumbersMessage)}</p>
                            ) : null}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="w-fit"
                              onClick={() => {
                                leadForm.setValue('phoneNumbers', [...phoneValues, ''], {
                                  shouldDirty: true,
                                  shouldValidate: true,
                                });
                              }}
                            >
                              <Plus data-icon="inline-start" />
                              {t('addPhone')}
                            </Button>
                          </div>
                          <FormField
                            control={leadForm.control}
                            name="messenger"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{isInstagramLead(lead) ? t('instagramContactChannel') : t('telegramWhatsapp')}</FormLabel>
                                <FormControl><Input {...field} placeholder="@username" /></FormControl>
                                <LocalizedFormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={leadForm.control}
                            name="studentName"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t('studentName')}</FormLabel>
                                <FormControl><Input {...field} /></FormControl>
                                <LocalizedFormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={leadForm.control}
                            name="studentAge"
                            render={({ field, fieldState }) => (
                              <FormItem>
                                <FormLabel>{t('age')}</FormLabel>
                                <FormControl><Input {...field} type="number" min="1" aria-invalid={fieldState.invalid} /></FormControl>
                                <LocalizedFormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={leadForm.control}
                            name="language"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t('communicationLanguage')}</FormLabel>
                                <Select value={field.value} onValueChange={field.onChange}>
                                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                  <SelectContent>
                                    <SelectGroup>
                                      <SelectItem value="ru">{t('russian')}</SelectItem>
                                      <SelectItem value="uz">{t('uzbekLang')}</SelectItem>
                                    </SelectGroup>
                                  </SelectContent>
                                </Select>
                                <LocalizedFormMessage />
                              </FormItem>
                            )}
                          />
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader><CardTitle>{t('dealDetails')}</CardTitle></CardHeader>
                        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <FormItem>
                            <FormLabel>{t('responsibleManager')}</FormLabel>
                            <Select
                              value={lead.managerId ? String(lead.managerId) : undefined}
                              onValueChange={(value) => {
                                const nextManagerId = Number(value);
                                if (nextManagerId !== Number(lead.managerId)) setPendingManagerId(nextManagerId);
                              }}
                              disabled={assignLead.isPending}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder={t('selectManager')} />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectGroup>
                                  {managers.map((manager) => (
                                    <SelectItem key={manager.id} value={String(manager.id)}>
                                      {manager.fullName}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          </FormItem>
                          <FormField
                            control={leadForm.control}
                            name="statusCode"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t('status')}</FormLabel>
                                <Select value={field.value} onValueChange={(value) => {
                                  if (value === 'paid') {
                                    setActiveTab('payment');
                                    return;
                                  }
                                  field.onChange(value);
                                }} disabled={lead.statusCode === 'paid'}>
                                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                  <SelectContent>
                                    <SelectGroup>
                                      {(statuses.length > 0 ? statuses : LEAD_STATUSES).filter((status) => (
                                        (!('isActive' in status) || status.isActive !== false) && (
                                          lead.statusCode === 'paid'
                                            ? status.code === 'paid'
                                            : status.code !== 'paid'
                                        )
                                      )).map((status) => (
                                        <SelectItem key={status.code} value={status.code}>{leadStatusName(status.code)}</SelectItem>
                                      ))}
                                    </SelectGroup>
                                  </SelectContent>
                                </Select>
                                <LocalizedFormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={leadForm.control}
                            name="sourceId"
                            render={({ field, fieldState }) => (
                              <FormItem>
                                <FormLabel>{t('source')}</FormLabel>
                                <Select value={field.value} onValueChange={field.onChange}>
                                  <FormControl><SelectTrigger aria-invalid={fieldState.invalid}><SelectValue /></SelectTrigger></FormControl>
                                  <SelectContent>
                                    <SelectGroup>
                                      {sources.map((source) => (
                                        <SelectItem key={source.id} value={String(source.id)}>{source.name}</SelectItem>
                                      ))}
                                    </SelectGroup>
                                  </SelectContent>
                                </Select>
                                <LocalizedFormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={leadForm.control}
                            name="courseId"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t('course')}</FormLabel>
                                <Select value={field.value || 'none'} onValueChange={(value) => {
                                  const nextCourseId = value === 'none' ? '' : value;
                                  field.onChange(nextCourseId);
                                }}>
                                  <FormControl><SelectTrigger><SelectValue placeholder={t('courseNotSelected')} /></SelectTrigger></FormControl>
                                  <SelectContent>
                                    <SelectGroup>
                                      <SelectItem value="none">{t('courseNotSelected')}</SelectItem>
                                      {courses.map((course) => (
                                        <SelectItem key={course.id} value={String(course.id)}>{course.name}</SelectItem>
                                      ))}
                                    </SelectGroup>
                                  </SelectContent>
                                </Select>
                                <LocalizedFormMessage />
                              </FormItem>
                            )}
                          />
                          <FormItem>
                            <FormLabel htmlFor="lead-groups-trigger">{t('navGroups')}</FormLabel>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  id="lead-groups-trigger"
                                  type="button"
                                  variant="outline"
                                  className="h-auto min-h-10 w-full justify-between gap-2 px-3 py-2 font-normal"
                                >
                                  <span className="flex min-w-0 flex-1 flex-wrap gap-1.5 text-left">
                                    {studentGroups.length === 0 ? (
                                      <span className="text-muted-foreground">{t('noGroup')}</span>
                                    ) : (
                                      <>
                                        {studentGroups.slice(0, 2).map((group) => (
                                          <Badge
                                            key={group.groupId}
                                            variant="secondary"
                                            className={group.isPrimary ? 'border border-primary/30 bg-primary/10' : undefined}
                                          >
                                            <span className="max-w-56 truncate">{group.groupName}</span>
                                          </Badge>
                                        ))}
                                        {studentGroups.length > 2 ? (
                                          <Badge variant="outline">+{studentGroups.length - 2}</Badge>
                                        ) : null}
                                      </>
                                    )}
                                  </span>
                                  {groupMutationPending ? (
                                    <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                                  ) : (
                                    <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
                                  )}
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="start"
                                className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-72 max-w-[calc(100vw-2rem)]"
                              >
                                <DropdownMenuLabel>{t('chooseGroups')}</DropdownMenuLabel>
                                {selectableGroups.map((group) => {
                                  const groupId = Number(group.id);
                                  const isSelected = selectedGroupIds.has(groupId);
                                  const occupied = Number(group.currentStudents || 0) + Number(group.reservedStudents || 0);
                                  const isFull = occupied >= Number(group.maxStudents || 12);
                                  const cannotRemoveLastStudentGroup = Boolean(lead.studentId)
                                    && isSelected
                                    && studentGroups.length <= 1;
                                  return (
                                    <DropdownMenuCheckboxItem
                                      key={group.id}
                                      checked={isSelected}
                                      disabled={groupMutationPending || (!isSelected && isFull) || cannotRemoveLastStudentGroup}
                                      onSelect={(event) => event.preventDefault()}
                                      onCheckedChange={() => {
                                        if (isSelected) {
                                          removeLeadGroup.mutate({
                                            leadId: lead.id,
                                            studentId: lead.studentId,
                                            groupId,
                                          });
                                        } else {
                                          addLeadGroup.mutate({
                                            leadId: lead.id,
                                            studentId: lead.studentId,
                                            groupId,
                                          });
                                        }
                                      }}
                                    >
                                      <span className="min-w-0 flex-1 truncate">{group.name}</span>
                                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                        {occupied}/{group.maxStudents || 12}
                                      </span>
                                    </DropdownMenuCheckboxItem>
                                  );
                                })}

                                {studentGroups.length > 1 ? (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuLabel>{t('primaryGroup')}</DropdownMenuLabel>
                                    <DropdownMenuRadioGroup
                                      value={primaryGroupId ? String(primaryGroupId) : undefined}
                                      onValueChange={(value) => {
                                        const groupId = Number(value);
                                        if (!groupId || groupId === primaryGroupId) return;
                                        addLeadGroup.mutate({
                                          leadId: lead.id,
                                          studentId: lead.studentId,
                                          groupId,
                                          isPrimary: true,
                                        });
                                      }}
                                    >
                                      {studentGroups.map((group) => (
                                        <DropdownMenuRadioItem
                                          key={group.groupId}
                                          value={String(group.groupId)}
                                          disabled={groupMutationPending}
                                          onSelect={(event) => event.preventDefault()}
                                        >
                                          <span className="truncate">{group.groupName}</span>
                                        </DropdownMenuRadioItem>
                                      ))}
                                    </DropdownMenuRadioGroup>
                                  </>
                                ) : null}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </FormItem>
                          <FormField
                            control={leadForm.control}
                            name="expectedPaymentUzs"
                            render={({ field, fieldState }) => (
                              <FormItem>
                                <FormLabel>{t('expectedPayment')}</FormLabel>
                                <FormControl><Input {...field} type="number" min="0" aria-invalid={fieldState.invalid} /></FormControl>
                                <LocalizedFormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={leadForm.control}
                            name="comment"
                            render={({ field }) => (
                              <FormItem className="md:col-span-2">
                                <FormLabel>{t('comment')}</FormLabel>
                                <FormControl><Textarea {...field} /></FormControl>
                                <LocalizedFormMessage />
                              </FormItem>
                            )}
                          />
                        </CardContent>
                      </Card>

                      <div className="flex justify-end">
                        <Button type="submit" disabled={updateLead.isPending}>
                          <Save data-icon="inline-start" />
                          {updateLead.isPending ? t('saving') : t('saveChanges')}
                        </Button>
                      </div>
                    </form>
                  </Form>
                </TabsContent>

                <TabsContent value="activity" className="mt-0">
                  <div className="flex flex-col gap-5">
                    <Card>
                      <CardHeader><CardTitle>{t('recordContact')}</CardTitle></CardHeader>
                      <CardContent>
                        <Form {...contactForm}>
                          <form className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={contactForm.handleSubmit((values) => addContact.mutate(values))}>
                            <FormField
                              control={contactForm.control}
                              name="channel"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{t('channel')}</FormLabel>
                                  <Select value={field.value} onValueChange={field.onChange}>
                                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                    <SelectContent>
                                      <SelectGroup>
                                        <SelectItem value="call">{t('call')}</SelectItem>
                                        <SelectItem value="whatsapp">WhatsApp</SelectItem>
                                        <SelectItem value="telegram">Telegram</SelectItem>
                                      </SelectGroup>
                                    </SelectContent>
                                  </Select>
                                  <LocalizedFormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={contactForm.control}
                              name="result"
                              render={({ field, fieldState }) => (
                                <FormItem>
                                  <FormLabel>{t('contactResult')}</FormLabel>
                                  <FormControl><Input {...field} aria-invalid={fieldState.invalid} placeholder={t('contactResultPlaceholder')} /></FormControl>
                                  <LocalizedFormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={contactForm.control}
                              name="comment"
                              render={({ field }) => (
                                <FormItem className="md:col-span-2">
                                  <FormLabel>{t('comment')}</FormLabel>
                                  <FormControl><Textarea {...field} /></FormControl>
                                  <LocalizedFormMessage />
                                </FormItem>
                              )}
                            />
                            <div className="flex justify-end md:col-span-2">
                              <Button type="submit" disabled={addContact.isPending}>
                                <CheckCircle2 data-icon="inline-start" />
                                {t('saveContact')}
                              </Button>
                            </div>
                          </form>
                        </Form>
                      </CardContent>
                    </Card>

                    <ActivityTimeline
                      lead={lead}
                      dateTime={dateTime}
                      leadStatusName={leadStatusName}
                      money={money}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="payment" className="mt-0">
                  <div className="flex flex-col gap-5">
                    {lead.statusCode === 'paid' ? (
                      <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                        <span className="text-foreground/80">{t('recurringPaymentHint')}</span>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">{t('leadSheetPaymentFormHint')}</p>
                    )}
                    <Card>
                      <CardHeader>
                        <CardTitle>
                          {lead.statusCode === 'paid' ? t('recordAnotherPayment') : t('recordPayment')}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <Form {...paymentForm}>
                          <form className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={paymentForm.handleSubmit((values) => createPayment.mutate(values))}>
                            <FormField
                              control={paymentForm.control}
                              name="amountUzs"
                              render={({ field, fieldState }) => (
                                <FormItem>
                                  <FormLabel>{t('amount')}</FormLabel>
                                  <FormControl><Input {...field} type="number" min="1" aria-invalid={fieldState.invalid} /></FormControl>
                                  <LocalizedFormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={paymentForm.control}
                              name="method"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{t('paymentMethod')}</FormLabel>
                                  <Select value={field.value} onValueChange={field.onChange}>
                                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                    <SelectContent>
                                      <SelectGroup>
                                        {PAYMENT_METHODS.map((method) => (
                                          <SelectItem key={method} value={method}>
                                            {t(paymentMethodTranslationKeys[method])}
                                          </SelectItem>
                                        ))}
                                      </SelectGroup>
                                    </SelectContent>
                                  </Select>
                                  <LocalizedFormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={paymentForm.control}
                              name="type"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{t('paymentType')}</FormLabel>
                                  <Select value={field.value} onValueChange={field.onChange}>
                                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                    <SelectContent>
                                      <SelectGroup>
                                        {PAYMENT_TYPES.map((type) => (
                                          <SelectItem key={type} value={type}>
                                            {t(paymentTypeTranslationKeys[type])}
                                          </SelectItem>
                                        ))}
                                      </SelectGroup>
                                    </SelectContent>
                                  </Select>
                                  <LocalizedFormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={paymentForm.control}
                              name="discount"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{t('discount')}</FormLabel>
                                  <Select value={field.value} onValueChange={field.onChange}>
                                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                    <SelectContent>
                                      <SelectGroup>
                                        {PAYMENT_DISCOUNTS.map((discount) => (
                                          <SelectItem key={discount} value={discount}>
                                            {t(paymentDiscountTranslationKeys[discount])}
                                          </SelectItem>
                                        ))}
                                      </SelectGroup>
                                    </SelectContent>
                                  </Select>
                                  <LocalizedFormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={paymentForm.control}
                              name="paidUntil"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{t('paidUntil')}</FormLabel>
                                  <FormControl><Input {...field} type="date" /></FormControl>
                                  <LocalizedFormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={paymentForm.control}
                              name="comment"
                              render={({ field }) => (
                                <FormItem className="md:col-span-2">
                                  <FormLabel>{t('comment')}</FormLabel>
                                  <FormControl><Textarea {...field} /></FormControl>
                                  <LocalizedFormMessage />
                                </FormItem>
                              )}
                            />
                            <div className="flex flex-col items-end gap-2 md:col-span-2">
                              <p className="text-right text-xs text-muted-foreground">
                                {lead.statusCode === 'paid' ? t('recurringPaymentHint') : t('paymentCreatesClientHint')}
                              </p>
                              <Button type="submit" disabled={createPayment.isPending}>
                                <CreditCard data-icon="inline-start" />
                                {createPayment.isPending ? t('saving') : t('confirmPayment')}
                              </Button>
                            </div>
                          </form>
                        </Form>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader><CardTitle>{t('paymentHistory')}</CardTitle></CardHeader>
                      <CardContent className="flex flex-col gap-0 divide-y divide-border">
                        {(lead.payments ?? []).length === 0 ? (
                          <p className="py-3 text-sm text-muted-foreground">{t('noPayments')}</p>
                        ) : (
                          lead.payments?.map((payment) => (
                            <div key={payment.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                              <div className="min-w-0">
                                <p className="font-medium">{money(payment.amountUzs)}</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {[payment.method, payment.type, payment.discount].filter(Boolean).join(' · ')}
                                </p>
                                {payment.comment ? <p className="mt-1 text-xs text-muted-foreground">{payment.comment}</p> : null}
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                                <Badge variant={payment.status === 'paid' ? 'success' : payment.status === 'overdue' ? 'destructive' : 'warning'}>
                                  {payment.status === 'paid'
                                    ? t('paymentStatusPaid')
                                    : payment.status === 'overdue'
                                      ? t('paymentStatusOverdue')
                                      : t('paymentStatusPending')}
                                </Badge>
                                <p className="text-xs text-muted-foreground">{dateTime(payment.paidAt || payment.createdAt)}</p>
                              </div>
                            </div>
                          ))
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>

                <TabsContent value="tasks" className="mt-0">
                  <div className="flex flex-col gap-5">
                    <Card>
                      <CardHeader><CardTitle>{t('newTask')}</CardTitle></CardHeader>
                      <CardContent>
                        <Form {...taskForm}>
                          <form className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={taskForm.handleSubmit((values) => createTask.mutate(values))}>
                            <FormField
                              control={taskForm.control}
                              name="title"
                              render={({ field, fieldState }) => (
                                <FormItem>
                                  <FormLabel>{t('taskTitle')}</FormLabel>
                                  <FormControl><Input {...field} aria-invalid={fieldState.invalid} /></FormControl>
                                  <LocalizedFormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={taskForm.control}
                              name="deadlineAt"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{t('deadline')}</FormLabel>
                                  <FormControl><Input {...field} type="datetime-local" /></FormControl>
                                  <LocalizedFormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={taskForm.control}
                              name="description"
                              render={({ field }) => (
                                <FormItem className="md:col-span-2">
                                  <FormLabel>{t('description')}</FormLabel>
                                  <FormControl><Textarea {...field} /></FormControl>
                                  <LocalizedFormMessage />
                                </FormItem>
                              )}
                            />
                            <div className="flex justify-end md:col-span-2">
                              <Button type="submit" disabled={createTask.isPending}>
                                <ClipboardList data-icon="inline-start" />
                                {t('createTask')}
                              </Button>
                            </div>
                          </form>
                        </Form>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader><CardTitle>{t('leadTasks')}</CardTitle></CardHeader>
                      <CardContent className="flex flex-col gap-0 divide-y divide-border">
                        {(lead.tasks ?? []).length === 0 ? (
                          <p className="py-3 text-sm text-muted-foreground">{t('noTasksAssigned')}</p>
                        ) : (
                          lead.tasks?.map((task) => (
                            <div key={task.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{task.title}</p>
                                {task.description ? <p className="mt-1 text-xs text-muted-foreground">{task.description}</p> : null}
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                                <Badge variant={task.status === 'done' ? 'success' : 'outline'}>
                                  {task.status === 'done' ? t('taskDone') : t('taskInProgress')}
                                </Badge>
                                {task.deadlineAt ? <p className="text-xs text-muted-foreground">{dateTime(task.deadlineAt)}</p> : null}
                                {task.status !== 'done' ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2"
                                    disabled={updateTask.isPending}
                                    onClick={() => updateTask.mutate(task.id)}
                                  >
                                    <CheckCircle2 data-icon="inline-start" />
                                    {t('completeTask')}
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          ))
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>
              </div>
            </Tabs>
          </>
        )}
      </SheetContent>
      <AlertDialog open={pendingManagerId !== null} onOpenChange={(nextOpen) => {
        if (!nextOpen && !assignLead.isPending) setPendingManagerId(null);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmLeadTransfer')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('confirmLeadTransferDescription')
                .replace('{manager}', managers.find((manager) => manager.id === pendingManagerId)?.fullName ?? '')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={assignLead.isPending}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={assignLead.isPending || pendingManagerId === null}
              onClick={(event) => {
                event.preventDefault();
                if (pendingManagerId !== null) assignLead.mutate(pendingManagerId);
              }}
            >
              {assignLead.isPending ? t('saving') : t('transferLead')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <LeadMergeConflictDialog
        open={Boolean(duplicateHint && lead)}
        mode="persisted"
        currentLead={lead ? {
          id: lead.id,
          contactName: lead.contactName,
          phone: lead.phone,
          phoneNumbers: visibleLeadPhones(lead),
          managerName: lead.managerName,
          statusName: leadStatusName(lead.statusCode),
        } : {}}
        existingLead={duplicateHint}
        isPending={mergeLeads.isPending}
        onCancel={() => setDuplicateHint(null)}
        onOpenExisting={() => {
          if (!duplicateHint?.id) return;
          setDuplicateHint(null);
          onMerged?.(Number(duplicateHint.id));
        }}
        onKeepCurrent={() => {
          if (!lead?.id || !duplicateHint?.id) return;
          mergeLeads.mutate({ retainedLeadId: lead.id, duplicateLeadId: Number(duplicateHint.id) });
        }}
        onMergeIntoExisting={() => {
          if (!lead?.id || !duplicateHint?.id) return;
          mergeLeads.mutate({ retainedLeadId: Number(duplicateHint.id), duplicateLeadId: lead.id });
        }}
      />
    </Sheet>
  );
}

function ActivityTimeline({
  lead,
  dateTime,
  leadStatusName,
  money,
}: {
  lead: LeadDetails;
  dateTime: (value: string | null | undefined) => string;
  leadStatusName: (code: string) => string;
  money: (value: number | string | null | undefined) => string;
}) {
  const { t } = useTranslation();
  const items = [
    ...(lead.history ?? []).map((item) => ({
      id: `history-${item.id}`,
      at: item.enteredAt,
      title: leadStatusName(item.toStatusCode),
      text: item.comment,
      icon: History,
    })),
    ...(lead.communications ?? []).map((item) => ({
      id: `communication-${item.id}`,
      at: item.createdAt,
      title: `${t('contact')}: ${item.channel}`,
      text: [item.result, item.comment].filter(Boolean).join(' — '),
      icon: MessageSquare,
    })),
    ...(lead.assignmentHistory ?? []).map((item) => ({
      id: `assignment-${item.id}`,
      at: item.createdAt,
      title: t('leadTransferred'),
      text: [
        `${item.fromManagerName || t('notAssigned')} → ${item.toManagerName || t('notAssigned')}`,
        item.changedByName ? `${t('changedBy')}: ${item.changedByName}` : null,
        item.comment,
      ].filter(Boolean).join(' • '),
      icon: UserRoundCog,
    })),
    ...(lead.payments ?? []).map((item) => ({
      id: `payment-${item.id}`,
      at: item.paidAt ?? item.createdAt,
      title: `${t('payment')}: ${money(item.amountUzs)}`,
      text: item.method,
      icon: CreditCard,
    })),
  ].sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime());

  return (
    <Card>
      <CardHeader><CardTitle>{t('activityHistory')}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-0">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noActivityYet')}</p>
        ) : (
          <ol className="flex flex-col">
            {items.map((item, index) => {
              const Icon = item.icon;
              const isLast = index === items.length - 1;
              return (
                <li key={item.id} className="relative flex gap-3 pb-3 last:pb-0">
                  {/* vertical connector line */}
                  {!isLast ? (
                    <span
                      aria-hidden
                      className="absolute left-[18px] top-9 bottom-0 w-px bg-border"
                    />
                  ) : null}
                  <div className="relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full bg-muted ring-2 ring-background">
                    <Icon className="size-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1 pt-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium leading-tight">{item.title}</p>
                      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        <Clock3 className="size-3" />
                        {dateTime(item.at)}
                      </span>
                    </div>
                    {item.text ? <p className="mt-1 text-sm text-muted-foreground">{item.text}</p> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
