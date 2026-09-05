import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, type FieldErrors, type FieldPath } from 'react-hook-form';
import { Link } from 'wouter';
import { z } from 'zod';
import { leadsApi } from '@/features/leads/api';
import { invalidateLeadData, useLeadDetailsQuery } from '@/features/leads/queries';
import { ActivityTimeline } from '@/features/leads/ui/LeadActivity';
import { boardApi, boardQueryKeys } from '@/features/board/api';
import { paymentsApi } from '@/features/payments/api';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { useOnlinePbxCall } from '@/hooks/useOnlinePbxCall';
import type { TranslationKey } from '@/lib/i18n';
import { leadMergeErrorMessage } from '@/lib/leadMerge';
import { deadlineInputToInstant, nextPaymentDate } from '@/lib/leadScheduleInputs';
import { cn } from '@/lib/utils';
import { CurrencyInput, PhoneInput } from '@/components/ux/FormattedInputs';
import { LeadWorkspaceHeader } from '@/components/ux/lead/LeadWorkspaceHeader';
import { LeadSaveBar } from '@/components/ux/lead/LeadSaveBar';
import { LeadNextAction } from '@/components/ux/lead/LeadNextAction';
import { CreateLeadStudentDialog } from '@/components/ux/CreateLeadStudentDialog';
import { DemoLessonDialog, type DemoLessonDialogLead } from '@/components/ux/DemoLessonDialog';
import { DemoLessonEnrollmentDialog } from '@/components/ux/DemoLessonEnrollmentDialog';
import { LeadTagsEditor } from '@/components/ux/lead/LeadTagsEditor';
import { LeadSocialAccountsEditor } from '@/components/ux/lead/LeadSocialAccountsEditor';
import { LeadArchiveActions } from '@/components/ux/lead/LeadArchiveActions';
import { AssignLeadToSelfDialog } from '@/features/sales/ui/AssignLeadToSelfDialog';
import {
  LocalizedFormMessage,
  SegmentedControl,
  TabCount,
} from '@/components/ux/lead/LeadSheetControls';
import {
  LeadMergeConflictDialog,
  type LeadMergeDialogLead,
} from '@/components/ux/LeadMergeConflictDialog';
import {
  UnsavedChangesDialog,
  useUnsavedChangesGuard,
} from '@/components/ux/UnsavedChangesGuard';
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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
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
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { getInitials } from '@/lib/auth';
import {
  compactPhoneNumbers,
  isSyntheticInstagramPhone,
  leadMessageTarget,
  primaryVisibleLeadPhone,
  uniquePhoneNumbers,
  visibleLeadPhones,
} from '@/lib/leadContact';
import {
  AlertCircle,
  ArrowRight,
  Banknote,
  Briefcase,
  CheckCircle2,
  ClipboardList,
  Clock3,
  CreditCard,
  CalendarClock,
  CalendarPlus2,
  ExternalLink,
  History,
  Loader2,
  MessageSquare,
  Plus,
  Trash2,
  UserRound,
  GraduationCap,
  Users,
  Wallet,
} from 'lucide-react';
import { PAYMENT_DISCOUNTS, PAYMENT_METHODS, PAYMENT_TYPES } from '@shared/academy';
import type { LeadChannelView } from '@shared/lead-channels';
import type { LeadTagView } from '@shared/lead-tags';
import type { TelephonyCallStatus } from '@/lib/telephony';

type LeadSheetTab = 'deal' | 'activity' | 'payment' | 'tasks';
interface LeadDetails {
  id: number;
  contactName: string;
  courseId?: number | null;
  schoolId?: number | null;
  phone?: string | null;
  phoneNumbers?: string[];
  sourceId?: number | null;
  sourceName?: string | null;
  sourceChannel?: string | null;
  tags?: LeadTagView[];
  statusCode: string;
  isArchived?: boolean;
  managerId?: number | null;
  managerName?: string | null;
  comment?: string | null;
  language?: string | null;
  students?: Array<{
    id: number;
    managerId?: number | null;
    studentName?: string | null;
    studentAge?: number | null;
    phone?: string | null;
    status: string;
    courseName?: string | null;
    schoolName?: string | null;
    groups?: Array<{
      groupId: number;
      groupName: string;
      courseId?: number | null;
      courseName?: string | null;
      schoolId?: number | null;
      isPrimary?: boolean;
      enrolledAt?: string | null;
    }>;
  }>;
  expectedPaymentUzs?: number | null;
  offerPriceUzs?: number | null;
  firstContactAt?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  channels?: LeadChannelView[];
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
  comments?: Array<{
    id: number;
    leadId: number;
    authorId?: number | null;
    authorName?: string | null;
    body: string;
    createdAt?: string | null;
  }>;
  communications?: Array<{
    id: number;
    channel: string;
    result?: string | null;
    comment?: string | null;
    createdAt?: string | null;
  }>;
  calls?: Array<{
    id: number;
    direction: 'incoming' | 'outgoing';
    status: TelephonyCallStatus;
    phone: string;
    startedAt: string;
    answeredAt?: string | null;
    endedAt?: string | null;
    durationSeconds: number;
    talkSeconds: number;
    hangupCause?: string | null;
    userId?: number | null;
    userName?: string | null;
    note?: string | null;
    noteAuthorId?: number | null;
    noteAuthorName?: string | null;
    noteUpdatedAt?: string | null;
    hasRecording: boolean;
  }>;
  tasks?: Array<{
    id: number;
    title: string;
    description?: string | null;
    dueAt?: string | null;
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
    studentId?: number | null;
    studentName?: string | null;
  }>;
}

interface LeadDetailSheetProps {
  leadId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: LeadSheetTab;
  courses: Array<{ id: number; name: string }>;
  schools?: Array<{ id: number; name: string; isActive?: boolean }>;
  demoLeads?: DemoLessonDialogLead[];
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
  statuses: Array<{
    code: string;
    name: string;
    isActive?: boolean;
    isPipeline?: boolean;
    color?: string;
    sortOrder?: number;
  }>;
  managers: Array<{ id: number; fullName: string }>;
  currentUserId?: number;
  canClaimUnassignedLead?: boolean;
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
const leadSchema = z.object({
  contactName: z.string().trim().min(1, 'fillRequiredFields'),
  phoneNumbers: z.array(optionalPhoneString).min(1).refine(uniquePhoneNumbers, 'duplicatePhoneInForm'),
  sourceId: z.string().min(1, 'fillRequiredFields'),
  language: z.string(),
  expectedPaymentUzs: optionalNumberString,
});

const paymentSchema = z.object({
  studentId: z.string().min(1, 'studentSelectionRequired'),
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
type PaymentFormValues = z.infer<typeof paymentSchema>;
type TaskFormValues = z.infer<typeof taskSchema>;
type PaymentMutationVariables = {
  values: PaymentFormValues;
  assignToSelf?: boolean;
};

const leadToFormValues = (lead: LeadDetails): LeadFormValues => ({
  contactName: lead.contactName ?? '',
  phoneNumbers: visibleLeadPhones(lead).length ? visibleLeadPhones(lead) : [''],
  sourceId: lead.sourceId ? String(lead.sourceId) : '',
  language: lead.language ?? 'ru',
  expectedPaymentUzs: lead.expectedPaymentUzs ? String(lead.expectedPaymentUzs) : '',
});

export function LeadDetailSheet({
  leadId,
  open,
  onOpenChange,
  initialTab = 'deal',
  groups,
  courses,
  schools = [],
  demoLeads = [],
  sources,
  statuses,
  managers,
  currentUserId,
  canClaimUnassignedLead = false,
  leadStatusName,
  dateTime,
  money,
  onChanged,
  onMerged,
}: LeadDetailSheetProps) {
  const { t, language } = useTranslation();
  const onlinePbxCall = useOnlinePbxCall();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<LeadSheetTab>(initialTab);
  const [pendingManagerId, setPendingManagerId] = useState<number | null>(null);
  const [pendingPaymentClaim, setPendingPaymentClaim] = useState<PaymentFormValues | null>(null);
  const [duplicateHint, setDuplicateHint] = useState<DuplicateLeadHint | null>(null);
  const [createStudentOpen, setCreateStudentOpen] = useState(false);
  const [demoEnrollmentOpen, setDemoEnrollmentOpen] = useState(false);
  const [createDemoOpen, setCreateDemoOpen] = useState(false);
  const [demoCreationStudentIds, setDemoCreationStudentIds] = useState<number[]>([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [socialAccountsDirty, setSocialAccountsDirty] = useState(false);
  const studentsCardRef = useRef<HTMLDivElement | null>(null);
  const contactsCardRef = useRef<HTMLDivElement | null>(null);
  const detailsCardRef = useRef<HTMLDivElement | null>(null);
  const commentRef = useRef<HTMLTextAreaElement | null>(null);
  const tasksCardRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [focusTarget, setFocusTarget] = useState<'contacts' | 'students' | 'details' | 'comment' | 'task' | 'tasks' | null>(null);
  const [invalidField, setInvalidField] = useState<FieldPath<LeadFormValues> | null>(null);
  const [removePhoneIndex, setRemovePhoneIndex] = useState<number | null>(null);

  const leadQuery = useLeadDetailsQuery<LeadDetails>(leadId, open);

  const leadForm = useForm<LeadFormValues>({
    resolver: zodResolver(leadSchema),
    defaultValues: {
      contactName: '',
      phoneNumbers: [''],
      sourceId: '',
      language: 'ru',
      expectedPaymentUzs: '',
    },
  });
  const paymentForm = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      studentId: '',
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

  // Closing the sheet must not silently discard what the user typed in any tab:
  // the deal form, an unsent payment, a task draft, or a comment draft.
  const sheetHasUnsavedChanges = leadForm.formState.isDirty
    || paymentForm.formState.isDirty
    || taskForm.formState.isDirty
    || commentDraft.trim().length > 0
    || socialAccountsDirty;
  const closeSheet = useCallback((nextOpen: boolean) => {
    if (!nextOpen) setTagDropdownOpen(false);
    onOpenChange(nextOpen);
  }, [onOpenChange]);
  const unsavedGuard = useUnsavedChangesGuard({
    open,
    isDirty: sheetHasUnsavedChanges,
    onOpenChange: closeSheet,
  });

  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [initialTab, open, leadId]);

  // Per-lead drafts must not leak into another lead when the sheet switches
  // records while staying open (e.g. after a merge opens the retained lead).
  useEffect(() => {
    setCommentDraft('');
    setPendingPaymentClaim(null);
    taskForm.reset({ title: '', deadlineAt: '', description: '' });
    setDuplicateHint(null);
    setSocialAccountsDirty(false);
    setFocusTarget(null);
    setInvalidField(null);
    setRemovePhoneIndex(null);
  }, [leadId, taskForm]);

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
      lead.sourceId ?? '',
      lead.language ?? '',
      lead.expectedPaymentUzs ?? '',
    ].join('|');
  }, [leadQuery.data]);

  const transientSnapshotKey = useMemo(() => {
    const lead = leadQuery.data;
    if (!lead) return null;
    return [
      lead.id,
      lead.expectedPaymentUzs ?? '',
      lead.offerPriceUzs ?? '',
      (lead.students ?? []).map((student) => student.id).join(','),
      (lead.payments ?? []).map((p) => `${p.id}:${p.paidUntil ?? ''}`).join(','),
    ].join('|');
  }, [leadQuery.data]);

  useEffect(() => {
    const lead = leadQuery.data;
    if (!open || !lead || !leadSnapshotKey) return;

    // A draft belongs to the lead it was typed on. When the sheet swaps records
    // while staying open, every form is reseeded even mid-edit: keeping the old
    // draft would show another lead's data and mark an untouched lead dirty.
    const changedLead = hydratedLeadId.current !== lead.id;

    // Reseed the deal form only when the lead itself changes, or when the
    // server data changed AND the user is not mid-edit in the deal tab.
    if (hydratedLeadKey.current !== leadSnapshotKey) {
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
      if (changedLead || !paymentDirty || hydratedTransientKey.current === null) {
        paymentForm.reset({
          studentId: lead.students?.length === 1 ? String(lead.students[0].id) : '',
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
  }, [open, leadQuery.data, leadSnapshotKey, transientSnapshotKey, leadForm, paymentForm]);

  // Reset hydration tracking when the sheet closes so reopening reseeds cleanly.
  useEffect(() => {
    if (!open) {
      hydratedLeadKey.current = null;
      hydratedLeadId.current = null;
      hydratedTransientKey.current = null;
      setPendingManagerId(null);
      setFocusTarget(null);
      setInvalidField(null);
      setRemovePhoneIndex(null);
      setPendingPaymentClaim(null);
      setDuplicateHint(null);
      setCreateStudentOpen(false);
      setDemoCreationStudentIds([]);
      setTagDropdownOpen(false);
      setSocialAccountsDirty(false);
      setCommentDraft('');
      taskForm.reset({ title: '', deadlineAt: '', description: '' });
      // Drop unsaved edits so the dirty flag clears; reopening reseeds the
      // forms from the (possibly cached) lead data because the hydration
      // effect above re-runs on `open` with the tracking keys nulled here.
      leadForm.reset();
      paymentForm.reset();
    }
  }, [open, leadForm, paymentForm, taskForm]);

  const finishMutation = async (title: string) => {
    toast({ title });
    await leadQuery.refetch();
    onChanged();
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

      return leadsApi.update<LeadDetails>(leadId!, {
        ...rest,
        expectedUpdatedAt: currentLead?.updatedAt,
        ...(hasOnlyHiddenInstagramPhone ? {} : { phoneNumbers: nextPhoneNumbers }),
        sourceId: Number(values.sourceId),
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

  const mergeLeads = useMutation({
    mutationFn: ({ retainedLeadId, duplicateLeadId }: { retainedLeadId: number; duplicateLeadId: number }) =>
      leadsApi.merge<{ retainedLead: LeadDetails }>({ retainedLeadId, duplicateLeadId }),
    onSuccess: async (result: { retainedLead: LeadDetails }) => {
      const retainedLeadId = Number(result.retainedLead.id);
      setDuplicateHint(null);
      await invalidateLeadData(queryClient, retainedLeadId);
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
    mutationFn: (managerId: number) => leadsApi.assign(leadId!, { managerId }),
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

  const addLeadComment = useMutation({
    mutationFn: (body: string) =>
      leadsApi.addComment(leadId!, { body }),
    onSuccess: async () => {
      setCommentDraft('');
      await finishMutation(t('leadCommentAdded'));
    },
    onError: (error: Error) => toast({
      title: t('leadCommentAddFailed'),
      description: error.message,
      variant: 'destructive',
    }),
  });

  const createPayment = useMutation({
    mutationFn: ({ values, assignToSelf }: PaymentMutationVariables) =>
      paymentsApi.create({
        leadId: leadId!,
        studentId: Number(values.studentId),
        amountUzs: Number(values.amountUzs),
        method: values.method,
        type: values.type,
        discount: values.discount,
        paidUntil: values.paidUntil || undefined,
        comment: values.comment,
        status: 'paid',
        assignToSelf,
      }),
    onSuccess: async () => {
      setPendingPaymentClaim(null);
      const refreshed = await leadQuery.refetch();
      const refreshedLead = refreshed.data;
      paymentForm.reset({
        studentId: refreshedLead?.students?.length === 1 ? String(refreshedLead.students[0].id) : '',
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
        title: t('paymentSaved'),
        description: t('paymentSavedDesc'),
      });
    },
    onError: (
      error: Error & { rawMessage?: string },
      variables: PaymentMutationVariables,
    ) => {
      if (
        canClaimUnassignedLead
        && !variables.assignToSelf
        && error.rawMessage === 'leadAssignmentRequired'
      ) {
        setPendingPaymentClaim(variables.values);
        return;
      }
      toast({ title: t('paymentSaveFailed'), description: error.message, variant: 'destructive' });
    },
  });

  const createTask = useMutation({
    mutationFn: (values: TaskFormValues) => boardApi.createTask({
      title: values.title,
      description: values.description,
      dueAt: values.deadlineAt ? deadlineInputToInstant(values.deadlineAt) : null,
      assigneeId: currentUserId,
      status: 'backlog',
      priority: 'normal',
      leadId: leadId!,
    }),
    onSuccess: async () => {
      taskForm.reset({ title: '', deadlineAt: '', description: '' });
      await queryClient.invalidateQueries({ queryKey: boardQueryKeys.all });
      await finishMutation(t('taskCreated'));
    },
    onError: (error: Error) => toast({ title: t('taskCreateFailed'), description: error.message, variant: 'destructive' }),
  });

  const updateTask = useMutation({
    mutationFn: (taskId: number) => boardApi.updateTaskStatus(taskId, 'done'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: boardQueryKeys.all });
      await finishMutation(t('taskUpdated'));
    },
    onError: (error: Error) => toast({ title: t('taskUpdateFailed'), description: error.message, variant: 'destructive' }),
  });

  const phoneNumbersRaw = leadForm.watch('phoneNumbers');
  const phoneValues = useMemo(() => (phoneNumbersRaw && phoneNumbersRaw.length > 0 ? phoneNumbersRaw : ['']), [phoneNumbersRaw]);
  // Parallel stable ids so deleting a middle phone does not shift input
  // identity across rows (see matching logic in the new-lead form).
  const phoneKeySequence = useRef(0);
  const [phoneKeys, setPhoneKeys] = useState<string[]>(() => phoneValues.map((_, i) => `lead-phone-${i}`));
  useEffect(() => {
    setPhoneKeys((current) => {
      if (current.length === phoneValues.length) return current;
      if (current.length > phoneValues.length) return current.slice(0, phoneValues.length);
      return [...current, ...phoneValues.slice(current.length).map(() => `lead-phone-new-${phoneKeySequence.current++}`)];
    });
  }, [phoneValues]);
  const addLeadPhoneRow = () => {
    setPhoneKeys((current) => [...current, `lead-phone-new-${phoneKeySequence.current++}`]);
    leadForm.setValue('phoneNumbers', [...phoneValues, ''], { shouldDirty: true, shouldValidate: true });
  };
  const removeLeadPhoneRow = (index: number) => {
    setPhoneKeys((current) => current.filter((_, i) => i !== index));
    const nextPhones = phoneValues.filter((__, phoneIndex) => phoneIndex !== index);
    leadForm.setValue('phoneNumbers', nextPhones.length > 0 ? nextPhones : [''], {
      shouldDirty: true,
      shouldValidate: true,
    });
  };
  const phoneNumbersMessage = typeof leadForm.formState.errors.phoneNumbers?.message === 'string'
    ? leadForm.formState.errors.phoneNumbers.message as TranslationKey
    : null;
  const lead = leadQuery.data;
  const visiblePhoneNumbers = visibleLeadPhones(lead);
  const primaryPhone = primaryVisibleLeadPhone(lead);
  const messageTarget = leadMessageTarget(lead);

  const submitPayment = (values: PaymentFormValues) => {
    const selectedStudent = lead?.students?.find(
      (student) => Number(student.id) === Number(values.studentId),
    );
    const assignmentMissing = Boolean(
      (lead && !lead.managerId)
      || (selectedStudent && !selectedStudent.managerId),
    );
    const assignedToAnotherManager = Boolean(
      (lead?.managerId && Number(lead.managerId) !== Number(currentUserId))
      || (
        selectedStudent?.managerId
        && Number(selectedStudent.managerId) !== Number(currentUserId)
      ),
    );
    if (canClaimUnassignedLead && assignmentMissing && !assignedToAnotherManager) {
      setPendingPaymentClaim(values);
      return;
    }
    createPayment.mutate({ values });
  };

  const copyPhone = async (phone: string) => {
    try {
      await navigator.clipboard.writeText(phone);
      toast({ title: t('phoneCopied'), description: phone });
    } catch {
      toast({ title: t('copyFailed'), variant: 'destructive' });
    }
  };

  const navigateTo = (tab: LeadSheetTab, target: typeof focusTarget = null) => {
    setActiveTab(tab);
    setFocusTarget(target);
    if (!target) scrollRef.current?.scrollTo({ top: 0 });
  };
  const goToStudents = () => navigateTo('deal', 'students');

  useEffect(() => {
    if (!open || !lead?.id || !focusTarget) return;
    const frame = requestAnimationFrame(() => {
      const target = focusTarget === 'contacts' ? contactsCardRef.current
        : focusTarget === 'students' ? studentsCardRef.current
          : focusTarget === 'details' ? detailsCardRef.current
            : focusTarget === 'comment' ? commentRef.current
              : focusTarget === 'tasks' ? tasksCardRef.current : null;
      target?.scrollIntoView({ block: 'start' });
      target?.focus({ preventScroll: true });
      if (focusTarget === 'task') taskForm.setFocus('title');
      if (invalidField) {
        leadForm.setFocus(invalidField);
        setInvalidField(null);
      }
      setFocusTarget(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTab, focusTarget, open, lead?.id, invalidField, leadForm, taskForm]);

  const showDealErrors = (errors: FieldErrors<LeadFormValues>) => {
    const field = Object.keys(errors)[0] as keyof LeadFormValues | undefined;
    if (!field) return;
    const phoneErrorIndex = Array.isArray(errors.phoneNumbers) ? errors.phoneNumbers.findIndex(Boolean) : 0;
    setInvalidField(field === 'phoneNumbers' ? `phoneNumbers.${Math.max(0, phoneErrorIndex)}` : field);
    navigateTo('deal', field === 'sourceId' || field === 'expectedPaymentUzs' ? 'details' : 'contacts');
  };
  const saveDeal = leadForm.handleSubmit((values) => {
    if (!updateLead.isPending) updateLead.mutate(values);
  }, showDealErrors);

  const dealFormDirty = leadForm.formState.isDirty;
  const activityCount = lead
    ? (lead.comments?.length ?? 0)
      + (lead.history?.length ?? 0)
      + (lead.communications?.length ?? 0)
      + (lead.calls?.length ?? 0)
      + (lead.assignmentHistory?.length ?? 0)
      + (lead.payments?.length ?? 0)
    : 0;
  const paymentsCount = lead?.payments?.length ?? 0;
  const openTasks = (lead?.tasks ?? []).filter((task) => task.status !== 'done');
  const hasOverdueTask = openTasks.some((task) => (
    Boolean(task.dueAt) && new Date(task.dueAt!).getTime() < Date.now()
  ));

  const totalPaidUzs = (lead?.payments ?? [])
    .filter((payment) => payment.status === 'paid')
    .reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0);
  const latestPaidUntil = (lead?.payments ?? []).reduce<string | null>((latest, payment) => {
    if (!payment.paidUntil) return latest;
    const timestamp = new Date(payment.paidUntil).getTime();
    if (!Number.isFinite(timestamp)) return latest;
    if (!latest || timestamp > new Date(latest).getTime()) return payment.paidUntil;
    return latest;
  }, null);

  const dateOnly = (value: string | null | undefined) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString(language === 'ru' ? 'ru-RU' : 'en-US');
  };

  const paymentMethodLabel = (method?: string | null) => (
    method && method in paymentMethodTranslationKeys
      ? t(paymentMethodTranslationKeys[method as keyof typeof paymentMethodTranslationKeys])
      : method ?? ''
  );
  const paymentTypeLabel = (type?: string | null) => (
    type && type in paymentTypeTranslationKeys
      ? t(paymentTypeTranslationKeys[type as keyof typeof paymentTypeTranslationKeys])
      : type ?? ''
  );
  const paymentDiscountLabel = (discount?: string | null) => (
    discount && discount in paymentDiscountTranslationKeys
      ? t(paymentDiscountTranslationKeys[discount as keyof typeof paymentDiscountTranslationKeys])
      : discount ?? ''
  );

  return (
    <Sheet
      open={open}
      onOpenChange={unsavedGuard.handleOpenChange}
    >
      <SheetContent
        className="flex h-[100dvh] w-full flex-col gap-0 overflow-hidden p-0 sm:w-full sm:max-w-4xl"
        onKeyDown={(event) => {
          if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="alertdialog"]') !== event.currentTarget) return;
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            if (leadForm.formState.isDirty && !updateLead.isPending) void saveDeal();
          }
        }}
        onEscapeKeyDown={(event) => {
          if (tagDropdownOpen) event.preventDefault();
        }}
      >
        {leadQuery.isError ? (
          <div className="flex flex-col gap-5 p-4 sm:p-6">
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
          <div className="flex flex-col gap-4 overflow-y-auto p-4 sm:p-6">
            <SheetTitle className="sr-only">{t('lead')}</SheetTitle>
            <SheetDescription className="sr-only">{t('loading')}</SheetDescription>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-72 w-full" />
          </div>
        ) : (
          <>
            <LeadWorkspaceHeader
              lead={lead}
              visiblePhoneNumbers={visiblePhoneNumbers}
              primaryPhone={primaryPhone}
              messageTarget={messageTarget}
              statuses={statuses}
              leadStatusName={leadStatusName}
              onlinePbxCall={onlinePbxCall}
              copyPhone={copyPhone}
              onNote={() => navigateTo('activity', 'comment')}
              onTask={() => navigateTo('tasks', 'task')}
            />

            <Tabs
              value={activeTab}
              onValueChange={(value) => navigateTo(value as LeadSheetTab)}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="shrink-0 border-b border-border bg-background px-4 py-2.5 sm:px-6">
                <TabsList className="grid h-auto w-full grid-cols-4 gap-1">
                  <TabsTrigger value="deal" className="min-w-0 gap-1 px-1 py-2 text-xs text-foreground/80 sm:gap-1.5 sm:px-3 sm:text-sm [&>svg]:hidden sm:[&>svg]:block">
                    <UserRound data-icon="inline-start" />
                    {t('dealTab')}
                    {dealFormDirty ? (
                      <span
                        className="size-1.5 rounded-full bg-amber-500"
                        title={t('unsavedChanges')}
                        aria-hidden="true"
                      />
                    ) : null}
                  </TabsTrigger>
                  <TabsTrigger value="activity" className="min-w-0 gap-1 px-1 py-2 text-xs text-foreground/80 sm:gap-1.5 sm:px-3 sm:text-sm [&>svg]:hidden sm:[&>svg]:block">
                    <History data-icon="inline-start" />
                    {t('activityTab')}
                    <span className="hidden sm:inline-flex"><TabCount value={activityCount} /></span>
                  </TabsTrigger>
                  <TabsTrigger value="payment" className="min-w-0 gap-1 px-1 py-2 text-xs text-foreground/80 sm:gap-1.5 sm:px-3 sm:text-sm [&>svg]:hidden sm:[&>svg]:block">
                    <CreditCard data-icon="inline-start" />
                    {t('payment')}
                    <span className="hidden sm:inline-flex"><TabCount value={paymentsCount} /></span>
                  </TabsTrigger>
                  <TabsTrigger value="tasks" className="min-w-0 gap-1 px-1 py-2 text-xs text-foreground/80 sm:gap-1.5 sm:px-3 sm:text-sm [&>svg]:hidden sm:[&>svg]:block">
                    <ClipboardList data-icon="inline-start" />
                    {t('taskBoard')}
                    <TabCount value={openTasks.length} tone={hasOverdueTask ? 'warning' : undefined} />
                  </TabsTrigger>
                </TabsList>
              </div>

              <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-muted/20 p-4 sm:p-6">
                <TabsContent forceMount hidden={activeTab !== 'deal'} value="deal" className="mt-0 space-y-4 data-[state=inactive]:hidden">
                  {!lead.isArchived ? (
                    <LeadNextAction
                      tasks={lead.tasks ?? []}
                      hasContact={Boolean(primaryPhone || messageTarget || lead.channels?.length)}
                      hasStudents={Boolean(lead.students?.length)}
                      dateTime={dateTime}
                      onContact={() => navigateTo('deal', 'contacts')}
                      onStudent={() => setCreateStudentOpen(true)}
                      onTask={() => navigateTo('tasks', 'task')}
                      onViewTasks={() => navigateTo('tasks', 'tasks')}
                    />
                  ) : null}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <nav aria-label={t('leadWorkspaceSections')} className="flex flex-wrap gap-1">
                      <Button type="button" size="sm" variant="ghost" onClick={() => navigateTo('deal', 'contacts')}>{t('leadWorkspaceContacts')}</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={goToStudents}>
                        {t('students')}<TabCount value={lead.students?.length ?? 0} />
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => navigateTo('deal', 'details')}>{t('leadWorkspaceDetails')}</Button>
                    </nav>
                    <div className="flex flex-wrap gap-2">
                      {!lead.isArchived && lead.statusCode !== 'paid' ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => setDemoEnrollmentOpen(true)}>
                          <CalendarPlus2 data-icon="inline-start" />
                          {t('bookDemoLesson')}
                        </Button>
                      ) : null}
                      <Button type="button" variant="outline" size="sm" onClick={() => navigateTo('payment')}>
                        <CreditCard data-icon="inline-start" />
                        {lead.statusCode === 'paid' ? t('recordAnotherPayment') : t('payment')}
                      </Button>

                    </div>
                  </div>
                  <Form {...leadForm}>
                    <form id="lead-details-form" onSubmit={saveDeal}>
                      <fieldset disabled={updateLead.isPending} className="flex min-w-0 flex-col gap-4">
                        <Card ref={contactsCardRef} tabIndex={-1} className="scroll-mt-4 shadow-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                              <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />
                              {t('contactInformation')}
                            </CardTitle>
                            <p className="text-sm text-muted-foreground">{t('leadWorkspaceContactHint')}</p>
                          </CardHeader>
                          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div className="space-y-4">
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
                              <FormField
                                control={leadForm.control}
                                name="language"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>{t('communicationLanguage')}</FormLabel>
                                    <SegmentedControl
                                      ariaLabel={t('communicationLanguage')}
                                      value={field.value}
                                      onChange={field.onChange}
                                      options={[
                                        { value: 'ru', label: t('russian') },
                                        { value: 'uz', label: t('uzbekLang') },
                                        { value: 'en', label: t('english') },
                                      ]}
                                    />
                                    <LocalizedFormMessage />
                                  </FormItem>
                                )}
                              />
                            </div>
                            <div className="flex flex-col gap-3">
                              {phoneValues.map((_, index) => (
                                <FormField
                                  key={phoneKeys[index] ?? `lead-phone-fallback-${index}`}
                                  control={leadForm.control}
                                  name={`phoneNumbers.${index}`}
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>{index === 0 ? t('phone') : `${t('phone')} ${index + 1}`}</FormLabel>
                                      <div className="flex gap-2">
                                        <FormControl>
                                          <PhoneInput ref={field.ref} name={field.name} onBlur={field.onBlur} value={field.value} onValueChange={field.onChange} />
                                        </FormControl>
                                        {phoneValues.length > 1 ? (
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            aria-label={t('removePhone')}
                                            onClick={() => setRemovePhoneIndex(index)}
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
                                onClick={addLeadPhoneRow}
                              >
                                <Plus data-icon="inline-start" />
                                {t('addPhone')}
                              </Button>
                            </div>
                            <LeadSocialAccountsEditor
                              leadId={lead.id}
                              leadName={lead.contactName}
                              managerId={lead.managerId}
                              channels={lead.channels}
                              canClaimUnassignedLead={canClaimUnassignedLead}
                              onDirtyChange={setSocialAccountsDirty}
                              onChanged={async () => {
                                await leadQuery.refetch();
                                onChanged();
                              }}
                            />
                          </CardContent>
                        </Card>

                        <Card ref={studentsCardRef} tabIndex={-1} className="scroll-mt-4 overflow-hidden shadow-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <CardHeader className="flex flex-col items-start justify-between gap-3 space-y-0 sm:flex-row">
                            <div>
                              <CardTitle className="flex items-center gap-2 text-base">
                                <GraduationCap className="size-4 text-muted-foreground" aria-hidden="true" />
                                {t('students')}
                                <Badge variant="secondary">{lead.students?.length ?? 0}</Badge>
                              </CardTitle>
                              <p className="mt-1 text-sm text-muted-foreground">{t('leadStudentsHint')}</p>
                            </div>
                            <Button type="button" size="sm" onClick={() => setCreateStudentOpen(true)}>
                              <Plus data-icon="inline-start" />
                              {t('createStudent')}
                            </Button>
                          </CardHeader>
                          <CardContent className="p-0">
                            {(lead.students ?? []).length === 0 ? (
                              <div className="flex flex-col items-center px-6 py-8 text-center">
                                <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                                  <Users className="size-5" />
                                </span>
                                <p className="font-medium">{t('noStudentsForLead')}</p>
                                <p className="mt-1 max-w-md text-sm text-muted-foreground">{t('noStudentsForLeadHint')}</p>
                              </div>
                            ) : (
                              <div className="divide-y divide-border">
                                {lead.students?.map((student) => {
                                  const studentGroups = student.groups ?? [];
                                  return (
                                    <div key={student.id} className="flex items-start gap-3 px-5 py-4 transition-colors hover:bg-muted/30">
                                      <Avatar className="size-10 border border-border bg-primary/5">
                                        <AvatarFallback className="text-primary">{getInitials(student.studentName || t('student'))}</AvatarFallback>
                                      </Avatar>
                                      <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <p className="font-medium">{student.studentName || t('student')}</p>
                                          {student.studentAge ? <Badge variant="outline">{t('ageLabel')} {student.studentAge}</Badge> : null}
                                        </div>
                                        <p className="mt-1 text-sm text-muted-foreground">
                                          {[student.courseName, student.schoolName, student.phone].filter(Boolean).join(' · ') || t('noData')}
                                        </p>
                                        {studentGroups.length > 0 ? (
                                          <div className="mt-2 flex flex-wrap gap-1.5">
                                            {studentGroups.map((group) => (
                                              <Badge key={group.groupId} variant={group.isPrimary ? 'secondary' : 'outline'}>
                                                {group.groupName}
                                              </Badge>
                                            ))}
                                          </div>
                                        ) : null}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </CardContent>
                        </Card>

                        <Card ref={detailsCardRef} tabIndex={-1} className="scroll-mt-4 shadow-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                              <Briefcase className="size-4 text-muted-foreground" aria-hidden="true" />
                              {t('dealDetails')}
                            </CardTitle>
                            <p className="text-sm text-muted-foreground">{t('leadWorkspaceDealHint')}</p>
                          </CardHeader>
                          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div className="md:col-span-2">
                              <LeadTagsEditor
                  leadId={lead.id}
                  automaticTag={lead.sourceName}
                  tags={lead.tags}
                  onChanged={onChanged}
                  onDropdownOpenChange={setTagDropdownOpen}
                />
                            </div>
                            <FormField
                              control={leadForm.control}
                              name="sourceId"
                              render={({ field, fieldState }) => (
                                <FormItem>
                                  <FormLabel>{t('source')}</FormLabel>
                                  <Select value={field.value} onValueChange={field.onChange}>
                                    <FormControl><SelectTrigger ref={field.ref} aria-invalid={fieldState.invalid}><SelectValue /></SelectTrigger></FormControl>
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
                              name="expectedPaymentUzs"
                              render={({ field, fieldState }) => (
                                <FormItem>
                                  <FormLabel>{t('expectedPayment')}</FormLabel>
                                  <FormControl>
                                    <CurrencyInput
                                      ref={field.ref}
                                      onBlur={field.onBlur}
                                      name={field.name}
                                      value={field.value}
                                      onValueChange={field.onChange}
                                      aria-invalid={fieldState.invalid}
                                    />
                                  </FormControl>
                                  <LocalizedFormMessage />
                                </FormItem>
                              )}
                            />
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
                              <p className="text-xs text-muted-foreground">{t('managerTransferHint')}</p>
                            </FormItem>
                          </CardContent>
                        </Card>

                      </fieldset>
                    </form>
                  </Form>
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background p-4">
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <p>{t('leadSheetCreated')}: {dateTime(lead.createdAt)}</p>
                      {lead.firstContactAt ? <p>{t('leadStatusFirstContact')}: {dateTime(lead.firstContactAt)}</p> : null}
                    </div>
                    <LeadArchiveActions
                  key={`${lead.id}-${Boolean(lead.isArchived)}`}
                  lead={lead}
                  statuses={statuses}
                  canClaimUnassignedLead={canClaimUnassignedLead}
                  leadStatusName={leadStatusName}
                  onChanged={onChanged}
                />
                  </div>
                </TabsContent>

                <TabsContent value="activity" className="mt-0">
                  <ActivityTimeline
                    lead={lead}
                    dateTime={dateTime}
                    leadStatusName={leadStatusName}
                    money={money}
                    composer={(
                      <form
                        className="rounded-xl border border-border bg-muted/20 p-3 transition-colors focus-within:border-primary/40 focus-within:bg-background"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const body = commentDraft.trim();
                          if (body && !addLeadComment.isPending) addLeadComment.mutate(body);
                        }}
                      >
                        <Textarea
                          ref={commentRef}
                          aria-label={t('leadWorkspaceNote')}
                          value={commentDraft}
                          onChange={(event) => setCommentDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                              event.preventDefault();
                              const body = commentDraft.trim();
                              if (body && !addLeadComment.isPending) addLeadComment.mutate(body);
                            }
                          }}
                          placeholder={t('addCommentPlaceholder')}
                          rows={3}
                          className="resize-none border-0 bg-transparent p-1 shadow-none focus-visible:ring-0"
                        />
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <span className="text-xs text-muted-foreground/70">{t('ctrlEnterToSend')}</span>
                          <Button
                            type="submit"
                            size="sm"
                            disabled={addLeadComment.isPending || !commentDraft.trim()}
                          >
                            {addLeadComment.isPending ? (
                              <Loader2 className="animate-spin" data-icon="inline-start" />
                            ) : (
                              <MessageSquare data-icon="inline-start" />
                            )}
                            {t('send')}
                          </Button>
                        </div>
                      </form>
                    )}
                  />
                </TabsContent>

                <TabsContent value="payment" className="mt-0">
                  <div className="flex flex-col gap-5">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                        <Banknote className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="truncate text-xs text-muted-foreground">{t('expectedPayment')}</p>
                          <p className="truncate text-sm font-semibold tabular-nums">
                            {lead.expectedPaymentUzs || lead.offerPriceUzs
                              ? money(lead.expectedPaymentUzs ?? lead.offerPriceUzs)
                              : '—'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                        <Wallet className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="truncate text-xs text-muted-foreground">{t('totalPaidLabel')}</p>
                          <p className="truncate text-sm font-semibold tabular-nums">
                            {totalPaidUzs > 0 ? money(totalPaidUzs) : '—'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                        <CalendarClock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="truncate text-xs text-muted-foreground">{t('paidUntil')}</p>
                          <p className="truncate text-sm font-semibold tabular-nums">{dateOnly(latestPaidUntil)}</p>
                        </div>
                      </div>
                    </div>

                    {lead.statusCode === 'paid' ? (
                      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <span className="text-foreground/80">{t('recurringPaymentHint')}</span>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">{t('leadSheetPaymentFormHint')}</p>
                    )}
                    {(lead.students ?? []).length === 0 ? (
                      <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-8 text-center">
                        <GraduationCap className="mb-3 size-8 text-muted-foreground" aria-hidden="true" />
                        <p className="font-medium">{t('studentRequiredForPayment')}</p>
                        <p className="mt-1 max-w-md text-sm text-muted-foreground">{t('studentRequiredForPaymentHint')}</p>
                        <Button type="button" variant="outline" className="mt-4" onClick={goToStudents}>
                          {t('goToStudents')}
                          <ArrowRight data-icon="inline-end" />
                        </Button>
                      </div>
                    ) : (
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <CreditCard className="size-4 text-muted-foreground" aria-hidden="true" />
                          {lead.statusCode === 'paid' ? t('recordAnotherPayment') : t('recordPayment')}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                          <Form {...paymentForm}>
                          <form className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={paymentForm.handleSubmit(submitPayment)}>
                            <FormField
                              control={paymentForm.control}
                              name="studentId"
                              render={({ field, fieldState }) => (
                                <FormItem className="md:col-span-2">
                                  <FormLabel>{t('paymentStudent')}</FormLabel>
                                  <Select value={field.value} onValueChange={field.onChange}>
                                    <FormControl><SelectTrigger aria-invalid={fieldState.invalid}><SelectValue placeholder={t('selectStudent')} /></SelectTrigger></FormControl>
                                    <SelectContent>
                                      <SelectGroup>
                                        {lead.students?.map((student) => (
                                          <SelectItem key={student.id} value={String(student.id)}>
                                            {student.studentName || `${t('student')} #${student.id}`}
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
                              name="amountUzs"
                              render={({ field, fieldState }) => (
                                <FormItem>
                                  <FormLabel>{t('amount')}</FormLabel>
                                  <FormControl>
                                    <CurrencyInput
                                      value={field.value}
                                      onValueChange={field.onChange}
                                      aria-invalid={fieldState.invalid}
                                    />
                                  </FormControl>
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
                              name="method"
                              render={({ field }) => (
                                <FormItem className="md:col-span-2">
                                  <FormLabel>{t('paymentMethod')}</FormLabel>
                                  <SegmentedControl
                                    ariaLabel={t('paymentMethod')}
                                    value={field.value}
                                    onChange={field.onChange}
                                    options={PAYMENT_METHODS.map((method) => ({
                                      value: method,
                                      label: t(paymentMethodTranslationKeys[method]),
                                    }))}
                                  />
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
                    )}

                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Wallet className="size-4 text-muted-foreground" aria-hidden="true" />
                          {t('paymentHistory')}
                          {paymentsCount > 0 ? <Badge variant="secondary">{paymentsCount}</Badge> : null}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-0 divide-y divide-border">
                        {(lead.payments ?? []).length === 0 ? (
                          <p className="py-3 text-sm text-muted-foreground">{t('noPayments')}</p>
                        ) : (
                          lead.payments?.map((payment) => (
                            <div key={payment.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                              <div className="flex min-w-0 items-start gap-3">
                                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                                  <CreditCard className="size-4" aria-hidden="true" />
                                </span>
                                <div className="min-w-0">
                                  <p className="font-semibold tabular-nums">{money(payment.amountUzs)}</p>
                                  <p className="mt-0.5 text-xs text-muted-foreground">
                                    {[
                                      paymentMethodLabel(payment.method),
                                      paymentTypeLabel(payment.type),
                                      payment.discount && payment.discount !== 'none'
                                        ? paymentDiscountLabel(payment.discount)
                                        : null,
                                    ].filter(Boolean).join(' · ')}
                                  </p>
                                  {payment.studentName ? <p className="mt-0.5 text-xs text-muted-foreground">{t('student')}: {payment.studentName}</p> : null}
                                  {payment.paidUntil ? <p className="mt-0.5 text-xs text-muted-foreground">{t('paidUntil')}: {dateOnly(payment.paidUntil)}</p> : null}
                                  {payment.comment ? <p className="mt-0.5 text-xs text-muted-foreground">{payment.comment}</p> : null}
                                </div>
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
                    <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-medium">{t('leadTasks')}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{t('leadTasksBoardHint')}</p>
                      </div>
                      <Button asChild type="button" variant="outline" size="sm" className="shrink-0 bg-background">
                        <Link href="/tasks">
                          <ExternalLink data-icon="inline-start" />
                          {t('taskBoard')}
                        </Link>
                      </Button>
                    </div>
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Plus className="size-4 text-muted-foreground" aria-hidden="true" />
                          {t('newTask')}
                        </CardTitle>
                      </CardHeader>
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
                                {createTask.isPending
                                  ? <Loader2 className="animate-spin" data-icon="inline-start" />
                                  : <ClipboardList data-icon="inline-start" />}
                                {t('createTask')}
                              </Button>
                            </div>
                          </form>
                        </Form>
                      </CardContent>
                    </Card>

                    <Card ref={tasksCardRef} tabIndex={-1} className="scroll-mt-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <ClipboardList className="size-4 text-muted-foreground" aria-hidden="true" />
                          {t('leadTasks')}
                          {(lead.tasks ?? []).length > 0 ? (
                            <Badge variant="secondary">{(lead.tasks ?? []).length}</Badge>
                          ) : null}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-0 divide-y divide-border">
                        {(lead.tasks ?? []).length === 0 ? (
                          <p className="py-3 text-sm text-muted-foreground">{t('noTasksAssigned')}</p>
                        ) : (
                          [...(lead.tasks ?? [])].sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done')
                            || (a.dueAt ? new Date(a.dueAt).getTime() : Infinity) - (b.dueAt ? new Date(b.dueAt).getTime() : Infinity)).map((task) => {
                            const isDone = task.status === 'done';
                            const isOverdue = !isDone
                              && Boolean(task.dueAt)
                              && new Date(task.dueAt!).getTime() < Date.now();
                            return (
                              <div key={task.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                                <div className="flex min-w-0 items-start gap-3">
                                  <span
                                    className={cn(
                                      'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full',
                                      isDone
                                        ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300'
                                        : isOverdue
                                          ? 'bg-destructive/10 text-destructive'
                                          : 'bg-muted text-muted-foreground',
                                    )}
                                  >
                                    {isDone
                                      ? <CheckCircle2 className="size-4" aria-hidden="true" />
                                      : <ClipboardList className="size-4" aria-hidden="true" />}
                                  </span>
                                  <div className="min-w-0">
                                    <p className={cn('break-words text-sm font-medium', isDone && 'text-muted-foreground line-through')}>
                                      {task.title}
                                    </p>
                                    {task.description ? <p className="mt-1 text-xs text-muted-foreground">{task.description}</p> : null}
                                    {task.dueAt ? (
                                      <p
                                        className={cn(
                                          'mt-1 inline-flex items-center gap-1 text-xs',
                                          isOverdue ? 'font-medium text-destructive' : 'text-muted-foreground',
                                        )}
                                      >
                                        <Clock3 className="size-3" aria-hidden="true" />
                                        {dateTime(task.dueAt)}
                                      </p>
                                    ) : null}
                                  </div>
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                                  <Badge variant={isDone ? 'success' : isOverdue ? 'destructive' : 'outline'}>
                                    {isDone ? t('taskDone') : isOverdue ? t('taskOverdue') : t('taskInProgress')}
                                  </Badge>
                                  {!isDone ? (
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
                            );
                          })
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>
              </div>
            </Tabs>
            <LeadSaveBar
              key={lead.id}
              dirty={dealFormDirty}
              pending={updateLead.isPending}
              onDiscard={() => leadForm.reset(leadToFormValues(lead))}
            />
          </>
        )}
      </SheetContent>
      <AlertDialog open={removePhoneIndex !== null} onOpenChange={(nextOpen) => { if (!nextOpen) setRemovePhoneIndex(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('leadWorkspaceRemovePhoneTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {removePhoneIndex !== null ? phoneValues[removePhoneIndex] : null} {t('leadWorkspaceRemovePhoneHint')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (removePhoneIndex !== null) removeLeadPhoneRow(removePhoneIndex); }}>
              {t('removePhone')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AssignLeadToSelfDialog
        open={pendingPaymentClaim !== null}
        leadName={lead?.contactName}
        description={t('leadActionRequiresAssignmentDescription')}
        confirmLabel={t('assignToMeAndContinue')}
        isPending={createPayment.isPending}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPendingPaymentClaim(null);
        }}
        onConfirm={() => {
          if (pendingPaymentClaim) {
            createPayment.mutate({ values: pendingPaymentClaim, assignToSelf: true });
          }
        }}
      />
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
      {lead ? (
        <CreateLeadStudentDialog
          open={createStudentOpen}
          onOpenChange={setCreateStudentOpen}
          leadId={lead.id}
          contactName={lead.contactName}
          groups={groups}
          onCreated={async () => {
            hydratedTransientKey.current = null;
            await leadQuery.refetch();
            onChanged();
          }}
        />
      ) : null}
      {lead ? (
        <DemoLessonEnrollmentDialog
          open={demoEnrollmentOpen}
          onOpenChange={setDemoEnrollmentOpen}
          lead={{
            id: lead.id,
            contactName: lead.contactName,
            studentName: lead.students?.[0]?.studentName,
            courseId: lead.courseId,
            schoolId: lead.schoolId,
          }}
          onCreateNew={(studentIds) => {
            setDemoCreationStudentIds(studentIds);
            setDemoEnrollmentOpen(false);
            setCreateDemoOpen(true);
          }}
        />
      ) : null}
      {lead ? (
        <DemoLessonDialog
          open={createDemoOpen}
          onOpenChange={setCreateDemoOpen}
          leads={demoLeads}
          courses={courses}
          schools={schools}
          initialLeadId={lead.id}
          initialStudentIds={demoCreationStudentIds}
          initialSchoolId={lead.schoolId}
          onCreated={onChanged}
        />
      ) : null}
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
      <UnsavedChangesDialog
        open={unsavedGuard.confirmationOpen}
        onOpenChange={unsavedGuard.setConfirmationOpen}
        onDiscard={unsavedGuard.discardChanges}
      />
    </Sheet>
  );
}
