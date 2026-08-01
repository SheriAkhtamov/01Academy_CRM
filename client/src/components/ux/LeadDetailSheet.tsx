import { useEffect, useMemo, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link } from 'wouter';
import { z } from 'zod';
import { leadsApi } from '@/features/leads/api';
import { invalidateLeadData, useLeadDetailsQuery } from '@/features/leads/queries';
import { ActivityTimeline, LeadCommentsCard } from '@/features/leads/ui/LeadActivity';
import { boardApi, boardQueryKeys } from '@/features/board/api';
import { paymentsApi } from '@/features/payments/api';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { useOnlinePbxCall } from '@/hooks/useOnlinePbxCall';
import { translations, type TranslationKey } from '@/lib/i18n';
import { leadMergeErrorMessage } from '@/lib/leadMerge';
import { CurrencyInput, PhoneInput } from '@/components/ux/FormattedInputs';
import { LeadChannelLinks } from '@/components/ux/LeadChannelLinks';
import { CreateLeadStudentDialog } from '@/components/ux/CreateLeadStudentDialog';
import { LocalizedFormMessage } from '@/components/ux/lead/LocalizedFormMessage';
import {
  LeadPaymentTab,
  paymentSchema,
  paymentSummaryLine,
  type PaymentFormValues,
} from '@/components/ux/lead/LeadPaymentTab';
import { LeadTasksTab, taskSchema, type TaskFormValues } from '@/components/ux/lead/LeadTasksTab';
import {
  UnsavedChangesDialog,
  useUnsavedChangesGuard,
} from '@/components/ux/UnsavedChangesGuard';
import { DemoLessonDialog, type DemoLessonDialogLead } from '@/components/ux/DemoLessonDialog';
import ConfirmDialog from '@/components/ConfirmDialog';
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
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { getInitials } from '@/lib/auth';
import {
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
  CalendarPlus2,
  ExternalLink,
  History,
  Loader2,
  LockKeyhole,
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
  X,
} from 'lucide-react';
import { LEAD_STATUSES, PAYMENT_DISCOUNTS, PAYMENT_METHODS, PAYMENT_TYPES } from '@shared/academy';
import type { LeadChannelView } from '@shared/lead-channels';
import {
  MAX_LEAD_TAG_NAME_LENGTH,
  leadTagNameKey,
  normalizeLeadTagName,
  type LeadTagOption,
  type LeadTagView,
} from '@shared/lead-tags';
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
  sourceId: z.string().min(1, 'fillRequiredFields'),
  language: z.string(),
  statusCode: z.string(),
  expectedPaymentUzs: optionalNumberString,
});

type LeadFormValues = z.infer<typeof leadSchema>;

const leadToFormValues = (lead: LeadDetails): LeadFormValues => ({
  contactName: lead.contactName ?? '',
  phoneNumbers: visibleLeadPhones(lead).length ? visibleLeadPhones(lead) : [''],
  sourceId: lead.sourceId ? String(lead.sourceId) : '',
  language: lead.language ?? 'ru',
  statusCode: lead.statusCode,
  expectedPaymentUzs: lead.expectedPaymentUzs ? String(lead.expectedPaymentUzs) : '',
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

/** Small count next to a tab label so managers see where the data is without clicking. */
function TabCount({ value }: { value: number }) {
  if (value <= 0) return null;
  return (
    <span className="rounded-full bg-muted px-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
      {value}
    </span>
  );
}

interface LeadTagsEditorProps {
  leadId: number;
  automaticTag?: string | null;
  tags?: LeadTagView[];
  onChanged: () => void;
  onDropdownOpenChange: (open: boolean) => void;
}

type LeadTagSuggestion =
  | {
      key: string;
      kind: 'existing';
      name: string;
      option: LeadTagOption;
    }
  | {
      key: string;
      kind: 'create';
      name: string;
    };

function LeadTagsEditor({
  leadId,
  automaticTag,
  tags = [],
  onChanged,
  onDropdownOpenChange,
}: LeadTagsEditorProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [customTagName, setCustomTagName] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [tagToRemove, setTagToRemove] = useState<LeadTagView | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = `lead-${leadId}-tag-options`;

  const tagOptionsQuery = useQuery<LeadTagOption[]>({
    queryKey: ['/api/academy/lead-tags'],
  });

  const automaticTagKey = leadTagNameKey(automaticTag);
  const manualTags = tags;
  const assignedTagKeys = useMemo(
    () => new Set([
      automaticTagKey,
      ...tags.map((tag) => leadTagNameKey(tag.name)),
    ].filter(Boolean)),
    [automaticTagKey, tags],
  );
  const availableOptions = useMemo(
    () => (tagOptionsQuery.data ?? []).filter((option) => (
      !assignedTagKeys.has(leadTagNameKey(option.name))
    )),
    [assignedTagKeys, tagOptionsQuery.data],
  );
  const normalizedCustomTag = normalizeLeadTagName(customTagName);
  const customTagKey = normalizedCustomTag?.normalizedName ?? '';
  const matchingOptions = useMemo(
    () => availableOptions
      .filter((option) => (
        !customTagKey || leadTagNameKey(option.name).includes(customTagKey)
      ))
      .slice(0, 8),
    [availableOptions, customTagKey],
  );
  const exactOption = availableOptions.find(
    (option) => leadTagNameKey(option.name) === customTagKey,
  );
  const canAddCustomTag = Boolean(
    normalizedCustomTag
      && !assignedTagKeys.has(normalizedCustomTag.normalizedName)
      && !exactOption,
  );
  const suggestions: LeadTagSuggestion[] = [
    ...(normalizedCustomTag && canAddCustomTag
      ? [{
          key: `create:${normalizedCustomTag.normalizedName}`,
          kind: 'create' as const,
          name: normalizedCustomTag.name,
        }]
      : []),
    ...matchingOptions.map((option) => ({
      key: option.id === null
        ? `source:${leadTagNameKey(option.name)}`
        : `tag:${option.id}`,
      kind: 'existing' as const,
      name: option.name,
      option,
    })),
  ];
  const resolvedActiveSuggestionIndex = suggestions.length === 0
    ? -1
    : Math.min(activeSuggestionIndex, suggestions.length - 1);
  const activeSuggestion = suggestions[resolvedActiveSuggestionIndex];

  const refreshTags = async () => {
    await invalidateLeadData(queryClient, leadId);
    onChanged();
  };

  const addTag = useMutation({
    mutationFn: (payload: { tagId: number } | { name: string }) =>
      leadsApi.addTag<{ created?: boolean }>(leadId, payload),
    onSuccess: async (result: { created?: boolean }) => {
      setCustomTagName('');
      setIsOpen(false);
      onDropdownOpenChange(false);
      setActiveSuggestionIndex(0);
      await refreshTags();
      toast({
        title: result.created ? t('leadTagAdded') : t('leadTagAlreadyAssigned'),
      });
    },
    onError: (error: Error) => toast({
      title: t('leadTagAddFailed'),
      description: error.message,
      variant: 'destructive',
    }),
  });

  const removeTag = useMutation({
    mutationFn: (tag: LeadTagView) =>
      leadsApi.removeTag(leadId, tag.id),
    onSuccess: async () => {
      setTagToRemove(null);
      await refreshTags();
      toast({ title: t('leadTagRemoved') });
    },
    onError: (error: Error) => {
      toast({
        title: t('leadTagRemoveFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });
  const isBusy = addTag.isPending || removeTag.isPending;
  const setDropdownOpen = (nextOpen: boolean) => {
    setIsOpen(nextOpen);
    onDropdownOpenChange(nextOpen);
  };

  useEffect(() => {
    if (!isOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!editorRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
        onDropdownOpenChange(false);
      }
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [isOpen, onDropdownOpenChange]);

  const submitSuggestion = (suggestion: LeadTagSuggestion | undefined) => {
    if (!suggestion || isBusy) return;
    if (suggestion.kind === 'existing') {
      addTag.mutate(
        suggestion.option.id === null
          ? { name: suggestion.option.name }
          : { tagId: suggestion.option.id },
      );
      return;
    }
    addTag.mutate({ name: suggestion.name });
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setDropdownOpen(true);
      if (suggestions.length === 0) return;
      setActiveSuggestionIndex((current) => {
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        return (current + direction + suggestions.length) % suggestions.length;
      });
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      submitSuggestion(activeSuggestion);
    }
  };

  return (
    <div
      ref={editorRef}
      className="mt-3 text-left"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDropdownOpen(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && isOpen) {
          event.preventDefault();
          setDropdownOpen(false);
        }
      }}
    >
      <label
        htmlFor={`lead-${leadId}-tag-input`}
        className="mb-1.5 flex items-center gap-1 text-xs font-medium text-foreground"
      >
        <Tag className="size-3.5" aria-hidden="true" />
        {t('leadTags')}
      </label>
      <span id={`lead-${leadId}-tag-hint`} className="sr-only">
        {t('leadTagsHint')}
      </span>

      <div className="relative">
        <div
          className="flex min-h-10 w-full cursor-text flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 shadow-2xs transition-[border-color,box-shadow] hover:border-primary/50 focus-within:border-primary-500 focus-within:ring-4 focus-within:ring-primary/15"
          onMouseDown={(event) => {
            const target = event.target as Element;
            if (target.closest('button, input')) return;
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          {automaticTag ? (
            <Badge
              variant="outline"
              className="h-6 max-w-full shrink-0 gap-1 px-2 py-0"
              title={t('automaticTag')}
            >
              <span className="truncate">{automaticTag}</span>
              <LockKeyhole className="size-3 shrink-0" aria-hidden="true" />
              <span className="sr-only">{t('automaticTag')}</span>
            </Badge>
          ) : null}
          {manualTags.map((tag) => {
            const isRemoving = removeTag.isPending && removeTag.variables?.id === tag.id;
            return (
              <Badge
                key={tag.id}
                variant="secondary"
                className="h-6 max-w-full shrink-0 gap-1 py-0 pl-2 pr-1"
              >
                <span className="truncate">{tag.name}</span>
                <button
                  type="button"
                  className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
                  aria-label={`${t('removeLeadTag')} ${tag.name}`}
                  disabled={isBusy}
                  onClick={() => {
                    setDropdownOpen(false);
                    setTagToRemove(tag);
                  }}
                >
                  {isRemoving ? (
                    <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                  ) : (
                    <X className="size-3" aria-hidden="true" />
                  )}
                </button>
              </Badge>
            );
          })}

          <input
            ref={inputRef}
            id={`lead-${leadId}-tag-input`}
            role="combobox"
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded={isOpen}
            aria-activedescendant={
              isOpen && activeSuggestion
                ? `${listboxId}-option-${resolvedActiveSuggestionIndex}`
                : undefined
            }
            aria-describedby={`lead-${leadId}-tag-hint`}
            autoComplete="off"
            className="h-6 min-w-32 flex-1 bg-transparent px-1 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-wait"
            value={customTagName}
            maxLength={MAX_LEAD_TAG_NAME_LENGTH}
            placeholder={t('customTagPlaceholder')}
            disabled={isBusy}
            onFocus={() => {
              setActiveSuggestionIndex(0);
              setDropdownOpen(true);
            }}
            onChange={(event) => {
              setCustomTagName(event.target.value);
              setActiveSuggestionIndex(0);
              setDropdownOpen(true);
            }}
            onKeyDown={handleInputKeyDown}
          />
          {addTag.isPending || tagOptionsQuery.isLoading ? (
            <Loader2 className="mr-1 size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : null}
        </div>

        {isOpen ? (
          <div
            id={listboxId}
            role="listbox"
            aria-label={t('selectTag')}
            className="absolute inset-x-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
          >
            {tagOptionsQuery.isLoading ? (
              <div className="flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                {t('loading')}
              </div>
            ) : null}
            {tagOptionsQuery.isError ? (
              <div className="px-2 py-2 text-sm text-destructive">
                {t('leadTagsLoadFailed')}
              </div>
            ) : null}
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.key}
                id={`${listboxId}-option-${index}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={index === resolvedActiveSuggestionIndex}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground aria-selected:bg-accent aria-selected:text-accent-foreground"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveSuggestionIndex(index)}
                onClick={() => submitSuggestion(suggestion)}
              >
                {suggestion.kind === 'create' ? (
                  <Plus className="size-4 shrink-0" aria-hidden="true" />
                ) : (
                  <Tag className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {suggestion.kind === 'create'
                    ? `${t('addTag')}: “${suggestion.name}”`
                    : suggestion.name}
                </span>
              </button>
            ))}
            {!tagOptionsQuery.isLoading
              && !tagOptionsQuery.isError
              && suggestions.length === 0 ? (
                <div className="px-2 py-2 text-sm text-muted-foreground">
                  {customTagKey && assignedTagKeys.has(customTagKey)
                    ? t('leadTagAlreadyAssigned')
                    : t('noTagOptions')}
                </div>
              ) : null}
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={tagToRemove !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !removeTag.isPending) setTagToRemove(null);
        }}
        title={t('removeLeadTag')}
        description={tagToRemove
          ? t('removeLeadTagConfirm').replace('{tag}', tagToRemove.name)
          : ''}
        confirmLabel={t('delete')}
        variant="destructive"
        isPending={removeTag.isPending}
        keepOpenOnConfirm
        onConfirm={() => {
          if (tagToRemove) removeTag.mutate(tagToRemove);
        }}
      />
    </div>
  );
}

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
  const [createStudentOpen, setCreateStudentOpen] = useState(false);
  const [createDemoOpen, setCreateDemoOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);

  const leadQuery = useLeadDetailsQuery<LeadDetails>(leadId, open);

  const leadForm = useForm<LeadFormValues>({
    resolver: zodResolver(leadSchema),
    defaultValues: {
      contactName: '',
      phoneNumbers: [''],
      sourceId: '',
      language: 'ru',
      statusCode: 'new_request',
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
      lead.sourceId ?? '',
      lead.language ?? '',
      lead.statusCode,
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
  }, [leadQuery.data, leadSnapshotKey, transientSnapshotKey, leadForm, paymentForm]);

  // Reset hydration tracking when the sheet closes so reopening reseeds cleanly.
  useEffect(() => {
    if (!open) {
      hydratedLeadKey.current = null;
      hydratedLeadId.current = null;
      hydratedTransientKey.current = null;
      setPendingManagerId(null);
      setDuplicateHint(null);
      setCreateStudentOpen(false);
      setCommentDraft('');
    }
  }, [open]);

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
    // The sheet stays open: reassigning is part of working a deal, and closing
    // it used to throw away whatever the manager was doing on the other tabs.
    onSuccess: async () => {
      setPendingManagerId(null);
      toast({ title: t('leadTransferred') });
      await leadQuery.refetch();
      onChanged();
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
    mutationFn: (values: PaymentFormValues) =>
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
      }),
    onSuccess: async () => {
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
    onError: (error: Error) => toast({ title: t('paymentSaveFailed'), description: error.message, variant: 'destructive' }),
  });

  const createTask = useMutation({
    mutationFn: (values: TaskFormValues) => boardApi.createTask({
      title: values.title,
      description: values.description,
      dueAt: values.deadlineAt ? new Date(values.deadlineAt).toISOString() : null,
      assigneeId: currentUserId,
      status: 'backlog',
      priority: 'normal',
      leadId: leadId!,
    }),
    onSuccess: async () => {
      taskForm.reset({ title: '', deadlineAt: '', description: '' });
      await queryClient.invalidateQueries({ queryKey: boardQueryKeys.tasks });
      await finishMutation(t('taskCreated'));
    },
    onError: (error: Error) => toast({ title: t('taskCreateFailed'), description: error.message, variant: 'destructive' }),
  });

  const updateTask = useMutation({
    mutationFn: (taskId: number) => boardApi.updateTaskStatus(taskId, 'done'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: boardQueryKeys.tasks });
      await finishMutation(t('taskUpdated'));
    },
    onError: (error: Error) => toast({ title: t('taskUpdateFailed'), description: error.message, variant: 'destructive' }),
  });

  const phoneNumbers = leadForm.watch('phoneNumbers') ?? [''];
  const phoneValues = phoneNumbers.length > 0 ? phoneNumbers : [''];
  const phoneNumbersMessage = typeof leadForm.formState.errors.phoneNumbers?.message === 'string'
    ? leadForm.formState.errors.phoneNumbers.message as TranslationKey
    : null;
  const lead = leadQuery.data;
  const visiblePhoneNumbers = visibleLeadPhones(lead);
  const primaryPhone = primaryVisibleLeadPhone(lead);
  const messageTarget = leadMessageTarget(lead);
  const isPaidLead = lead?.statusCode === 'paid';
  const isDealDirty = leadForm.formState.isDirty;

  const activityCount = lead
    ? (lead.comments?.length ?? 0)
      + (lead.history?.length ?? 0)
      + (lead.communications?.length ?? 0)
      + (lead.calls?.length ?? 0)
      + (lead.assignmentHistory?.length ?? 0)
      + (lead.payments?.length ?? 0)
    : 0;
  const openTaskCount = (lead?.tasks ?? []).filter((task) => task.status !== 'done').length;

  // Editing the deal is the one destructive-on-close action in this sheet, so
  // closing while the form is dirty asks before throwing the edits away.
  const closeGuard = useUnsavedChangesGuard({
    open,
    isDirty: isDealDirty,
    onOpenChange: (nextOpen) => {
      if (!nextOpen) setTagDropdownOpen(false);
      onOpenChange(nextOpen);
    },
  });

  return (
    <Sheet open={open} onOpenChange={closeGuard.handleOpenChange}>
      <SheetContent
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
        onEscapeKeyDown={(event) => {
          if (tagDropdownOpen) event.preventDefault();
        }}
      >
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
            <SheetHeader className="shrink-0 space-y-3 border-b border-border bg-muted/30 px-6 pb-4 pr-14 pt-5">
              <div className="flex items-start gap-3">
                <Avatar className="size-11 border border-border bg-background">
                  <AvatarFallback>{getInitials(lead.contactName)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <SheetTitle className="truncate text-lg">{lead.contactName}</SheetTitle>
                    <Badge variant={isPaidLead ? 'success' : 'secondary'}>
                      {leadStatusName(lead.statusCode)}
                    </Badge>
                  </div>
                  <SheetDescription className="sr-only">{t('lead')}</SheetDescription>

                  {/* One wrapped meta row keeps the header short on laptops and phones. */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {visiblePhoneNumbers.length > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="size-3.5" aria-hidden="true" />
                        {visiblePhoneNumbers.join(', ')}
                      </span>
                    ) : (
                      <span className="italic">{t('leadSheetNoContactInfo')}</span>
                    )}
                    {(lead.students ?? []).length > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <GraduationCap className="size-3.5" aria-hidden="true" />
                        {lead.students?.length ?? 0} {t('studentsCount')}
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1">
                      <UserRoundCog className="size-3.5" aria-hidden="true" />
                      {lead.managerName || t('notAssigned')}
                    </span>
                    {lead.firstContactAt ? (
                      <span className="inline-flex items-center gap-1" title={t('leadStatusFirstContact')}>
                        <CalendarClock className="size-3.5" aria-hidden="true" />
                        {dateTime(lead.firstContactAt)}
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1" title={t('leadSheetCreated')}>
                      <Clock3 className="size-3.5" aria-hidden="true" />
                      {dateTime(lead.createdAt)}
                    </span>
                  </div>
                </div>
              </div>

              <LeadTagsEditor
                leadId={lead.id}
                automaticTag={lead.sourceName}
                tags={lead.tags}
                onChanged={onChanged}
                onDropdownOpenChange={setTagDropdownOpen}
              />

              {/* Quick actions — what a manager does from any tab. */}
              <div className="flex flex-wrap gap-2">
                <LeadChannelLinks channels={lead.channels} leadId={lead.id} />
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
                {!lead.isArchived && !isPaidLead ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => setCreateDemoOpen(true)}>
                    <CalendarPlus2 data-icon="inline-start" />
                    {t('bookDemoLesson')}
                  </Button>
                ) : null}
                <Button size="sm" onClick={() => setActiveTab('payment')}>
                  <CreditCard data-icon="inline-start" />
                  {isPaidLead ? t('recordAnotherPayment') : t('payment')}
                </Button>
              </div>
            </SheetHeader>

            <Tabs
              value={activeTab}
              onValueChange={(value) => setActiveTab(value as LeadSheetTab)}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="shrink-0 border-b border-border bg-background px-6 py-3">
                <TabsList className="flex h-auto w-full justify-start overflow-x-auto">
                  <TabsTrigger value="deal" className="shrink-0 gap-1.5">
                    <UserRound data-icon="inline-start" />
                    {t('dealTab')}
                    {isDealDirty ? (
                      <span className="size-1.5 rounded-full bg-primary" aria-label={t('unsavedChanges')} />
                    ) : null}
                  </TabsTrigger>
                  <TabsTrigger value="activity" className="shrink-0 gap-1.5">
                    <History data-icon="inline-start" />
                    {t('activityTab')}
                    <TabCount value={activityCount} />
                  </TabsTrigger>
                  <TabsTrigger value="payment" className="shrink-0 gap-1.5">
                    <CreditCard data-icon="inline-start" />
                    {t('payment')}
                    <TabCount value={lead.payments?.length ?? 0} />
                  </TabsTrigger>
                  <TabsTrigger value="tasks" className="shrink-0 gap-1.5">
                    <ClipboardList data-icon="inline-start" />
                    {t('leadTasks')}
                    <TabCount value={openTaskCount} />
                  </TabsTrigger>
                </TabsList>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">
                <TabsContent value="deal" className="mt-0 space-y-5">
                  <Form {...leadForm}>
                    <form className="flex flex-col gap-5" onSubmit={leadForm.handleSubmit((values) => updateLead.mutate(values))}>
                      <Card>
                        <CardHeader><CardTitle>{t('contactInformation')}</CardTitle></CardHeader>
                        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          {(lead.channels ?? []).length > 0 ? (
                            <FormItem className="md:col-span-2">
                              <FormLabel>{t('contactChannels')}</FormLabel>
                              <LeadChannelLinks channels={lead.channels} leadId={lead.id} showLabels />
                            </FormItem>
                          ) : null}
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
                                render={({ field, fieldState }) => (
                                  <FormItem>
                                    <FormLabel>{index === 0 ? t('phone') : `${t('phone')} ${index + 1}`}</FormLabel>
                                    <div className="flex gap-2">
                                      <FormControl>
                                        <PhoneInput
                                          ref={field.ref}
                                          name={field.name}
                                          value={field.value}
                                          onBlur={field.onBlur}
                                          onValueChange={field.onChange}
                                          aria-invalid={fieldState.invalid}
                                        />
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

                      <Card className="overflow-hidden">
                        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 bg-muted/20">
                          <div>
                            <CardTitle className="flex items-center gap-2">
                              <GraduationCap className="size-5 text-primary" />
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
                                  <div key={student.id} className="flex items-start gap-3 px-5 py-4">
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
                                  // "Paid" is never set by hand — it is the result of
                                  // recording a payment, so say that instead of silently
                                  // jumping to another tab.
                                  if (value === 'paid') {
                                    setActiveTab('payment');
                                    toast({ title: t('leadStatusPaidNeedsPayment') });
                                    return;
                                  }
                                  field.onChange(value);
                                }} disabled={isPaidLead}>
                                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                  <SelectContent>
                                    <SelectGroup>
                                      {(statuses.length > 0 ? statuses : LEAD_STATUSES).filter((status) => (
                                        (!('isActive' in status) || status.isActive !== false) && (
                                          isPaidLead
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
                            name="expectedPaymentUzs"
                            render={({ field, fieldState }) => (
                              <FormItem>
                                <FormLabel>{t('expectedPayment')}</FormLabel>
                                <FormControl>
                                  <CurrencyInput
                                    ref={field.ref}
                                    name={field.name}
                                    value={field.value}
                                    onBlur={field.onBlur}
                                    onValueChange={field.onChange}
                                    aria-invalid={fieldState.invalid}
                                  />
                                </FormControl>
                                <LocalizedFormMessage />
                              </FormItem>
                            )}
                          />
                        </CardContent>
                      </Card>

                      {/* Save stays reachable without scrolling back through the form. */}
                      <div className="sticky bottom-0 -mx-6 -mb-6 flex flex-wrap items-center justify-end gap-3 border-t border-border bg-background/95 px-6 py-3 backdrop-blur">
                        {isDealDirty ? (
                          <p className="mr-auto text-sm text-muted-foreground">{t('unsavedChanges')}</p>
                        ) : null}
                        {isDealDirty ? (
                          <Button
                            type="button"
                            variant="outline"
                            disabled={updateLead.isPending}
                            onClick={() => leadForm.reset(leadToFormValues(lead))}
                          >
                            {t('reset')}
                          </Button>
                        ) : null}
                        <Button type="submit" disabled={updateLead.isPending || !isDealDirty}>
                          <Save data-icon="inline-start" />
                          {updateLead.isPending ? t('saving') : t('saveChanges')}
                        </Button>
                      </div>
                    </form>
                  </Form>
                </TabsContent>

                <TabsContent value="activity" className="mt-0">
                  <div className="flex flex-col gap-5">
                    <LeadCommentsCard
                      comments={lead.comments ?? []}
                      draft={commentDraft}
                      isPending={addLeadComment.isPending}
                      dateTime={dateTime}
                      onDraftChange={setCommentDraft}
                      onSubmit={() => {
                        const body = commentDraft.trim();
                        if (body) addLeadComment.mutate(body);
                      }}
                    />

                    <ActivityTimeline
                      lead={lead}
                      dateTime={dateTime}
                      leadStatusName={leadStatusName}
                      money={money}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="payment" className="mt-0">
                  <LeadPaymentTab
                    form={paymentForm}
                    students={lead.students ?? []}
                    payments={lead.payments ?? []}
                    isPaidLead={isPaidLead}
                    isPending={createPayment.isPending}
                    onSubmit={(values) => createPayment.mutate(values)}
                    onCreateStudent={() => setCreateStudentOpen(true)}
                    dateTime={dateTime}
                    money={money}
                  />
                </TabsContent>

                <TabsContent value="tasks" className="mt-0">
                  <LeadTasksTab
                    form={taskForm}
                    tasks={lead.tasks ?? []}
                    isCreating={createTask.isPending}
                    isCompleting={updateTask.isPending}
                    onSubmit={(values) => createTask.mutate(values)}
                    onCompleteTask={(taskId) => updateTask.mutate(taskId)}
                    dateTime={dateTime}
                  />
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
        <DemoLessonDialog
          open={createDemoOpen}
          onOpenChange={setCreateDemoOpen}
          leads={demoLeads}
          courses={courses}
          schools={schools}
          initialLeadId={lead.id}
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
        open={closeGuard.confirmationOpen}
        onOpenChange={closeGuard.setConfirmationOpen}
        onDiscard={closeGuard.discardChanges}
      />
    </Sheet>
  );
}
