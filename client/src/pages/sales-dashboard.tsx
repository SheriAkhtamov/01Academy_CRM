import { useCallback, useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { useLocation, useSearch } from 'wouter';
import { z } from 'zod';
import type { CreateAcademyLeadRequest } from '@shared/contracts/academy-leads';
import { leadsApi } from '@/features/leads/api';
import { invalidateSalesLeadData, salesQueryKeys } from '@/features/sales/queries';
import { useLeadFilters } from '@/features/sales/useLeadFilters';
import { useLeadViewTracking } from '@/features/sales/useLeadViewTracking';
import { useSalesPipelineBulkActions } from '@/features/sales/useSalesPipelineBulkActions';
import { SalesBulkActionsButton, SalesOverviewSection, SalesPipelineSection } from '@/features/sales/ui/SalesSections';
import { ArchiveTab } from '@/features/sales/ui/ArchiveTab';
import { AssignLeadToSelfDialog } from '@/features/sales/ui/AssignLeadToSelfDialog';
import { studentsApi } from '@/features/students/api';
import { useTranslation } from '@/hooks/useTranslation';
import { translations, type TranslationKey } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';
import { useOnlinePbxCall } from '@/hooks/useOnlinePbxCall';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ux/EmptyState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  useFormField,
} from '@/components/ui/form';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DataTable } from '@/components/ux/DataTable';
import { LeadDetailSheet } from '@/components/ux/LeadDetailSheet';
import { LeadFiltersDialog } from '@/components/ux/LeadFiltersDialog';
import { leadMatchesFilters } from '@/lib/leadFilters';
import { submitOnEnter } from '@/lib/submitOnEnter';
import { LeadMergeConflictDialog } from '@/components/ux/LeadMergeConflictDialog';
import { StudentDetailSheet } from '@/components/ux/StudentDetailSheet';
import { PageHeader } from '@/components/ux/PageHeader';
import { ReportingDateRangeFilter } from '@/components/ux/ReportingDateRangeFilter';
import { ModulePage, ModulePageBody } from '@/components/ux/ModulePage';
import { AnalyticsChartsSkeleton } from '@/components/ux/analytics/AnalyticsChartCard';
import { PhoneInput } from '@/components/ux/FormattedInputs';
import { SalesScheduleCalendar } from '@/components/ux/SalesScheduleCalendar';
import { SalesOverviewMetrics } from '@/components/ux/SalesOverviewMetrics';
import { SalesOverviewEmployeeFilter } from '@/components/ux/SalesOverviewEmployeeFilter';
import { useCeoCopy } from '@/hooks/useCeoCopy';
import { leadMessageTarget, primaryVisibleLeadPhone } from '@/lib/leadContact';
import { leadMergeErrorMessage } from '@/lib/leadMerge';
import { localizeApiErrorMessage } from '@/lib/queryClient';
import { MODULE_NAVIGATION, moduleSectionLabelKey } from '@/lib/moduleNavigation';
import { addReportingDays, isInReportingRange, isReportingPresetKey, reportingRangeForPreset } from '@/lib/reportingDateRange';
import { useStickyState } from '@/hooks/useStickyState';
import {
  UnsavedChangesDialog,
  useUnsavedChangesGuard,
} from '@/components/ux/UnsavedChangesGuard';
import {
  getAssignedModules,
  hasLeadershipAccess,
  LEAD_ARCHIVE_REASONS,
} from '@shared/academy';
import {
  AlertCircle,
  Archive,
  Plus,
  TrendingUp,
  Trash2,
  UserCheck,
} from 'lucide-react';
import type { LeadTagView } from '@shared/lead-tags';
import { ACADEMY_TIME_ZONE } from '@/lib/localeFormat';

type SalesSection = 'overview' | 'pipeline' | 'archive' | 'schedule' | 'students';
type LeadSheetTab = 'deal' | 'activity' | 'payment' | 'tasks';
type QuickAction = 'payment' | 'call' | 'message';

interface Lead {
  id: number;
  contactName: string;
  studentName?: string | null;
  studentAge?: number;
  courseId?: number | null;
  schoolId?: number | null;
  phone?: string | null;
  phoneNumbers?: string[];
  messenger?: string | null;
  sourceId?: number;
  sourceName?: string;
  sourceChannel?: string | null;
  tags?: LeadTagView[];
  statusCode: string;
  managerId?: number | null;
  managerName?: string | null;
  comment?: string;
  createdAt: string;
  firstViewedAt?: string | null;
  language?: string | null;
  demoAt?: string | null;
  expectedPaymentUzs?: number;
  offerPriceUzs?: number;
  firstContactAt?: string;
  isArchived?: boolean;
  archiveReason?: string | null;
  archivedAt?: string | null;
  archivedBy?: number | null;
  archivedByName?: string | null;
}

interface DuplicateClientHint {
  entityType?: 'lead' | 'student';
  id: number;
  leadId?: number | null;
  name?: string | null;
  phone?: string | null;
  phoneNumbers?: string[];
  messenger?: string | null;
  statusCode?: string | null;
  managerName?: string | null;
  isArchived?: boolean;
  canMerge?: boolean;
}

interface Student {
  id: number;
  leadId?: number;
  groupId?: number;
  groupName?: string;
  groupIds?: number[];
  groupNames?: string[];
  groups?: Array<{
    groupId: number;
    groupName: string;
    courseId?: number;
    courseName?: string;
    schoolId?: number;
    isPrimary?: boolean;
    enrolledAt?: string;
  }>;
  courseId?: number;
  courseName?: string;
  contactName: string;
  phone: string | null;
  studentName?: string;
  studentAge?: number;
  managerId?: number;
  managerName?: string;
  status: string;
  attendancePercent: number;
  progressPercent: number;
  nextPaymentAt?: string;
  enrolledAt?: string;
  createdAt: string;
  paymentStatus?: string;
  riskFlags?: string[];
  referralCode?: string;
}

interface PipelineStatus {
  code: string;
  name: string;
  color: string;
  sortOrder: number;
  isPipeline?: boolean;
  isActive?: boolean;
}

interface PendingLeadMove {
  lead: Lead;
  statusCode: string;
}

const archiveReasonTranslationKeys = Object.fromEntries(
  LEAD_ARCHIVE_REASONS.map((reason) => [reason.code, reason.translationKey]),
) as Record<string, TranslationKey>;

const paymentStatusTranslationKeys: Record<string, TranslationKey> = {
  paid: 'paymentStatusPaid',
  pending: 'paymentStatusPending',
  overdue: 'paymentStatusOverdue',
};

const formValidationTranslationKeys = ['duplicatePhoneInForm'] as const satisfies readonly TranslationKey[];

const SALES_SECTION_PATHS: Record<SalesSection, string> = {
  overview: '/sales',
  pipeline: '/sales/pipeline',
  archive: '/sales/archive',
  schedule: '/sales/schedule',
  students: '/sales/clients',
};

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

const createLeadPayload = (values: CreateLeadFormValues): CreateAcademyLeadRequest => ({
  ...values,
  phoneNumbers: compactPhoneNumbers(values.phoneNumbers),
  sourceId: Number(values.sourceId),
  managerId: values.managerId ? Number(values.managerId) : undefined,
});
const uniquePhoneNumbers = (values: string[]) => {
  const keys = values.map(phoneKey).filter(Boolean);
  return new Set(keys).size === keys.length;
};

const createLeadSchema = z.object({
  contactName: z.string().trim().min(1, 'fillRequiredFields'),
  phoneNumbers: z.array(optionalPhoneString).min(1).refine(
    uniquePhoneNumbers,
    formValidationTranslationKeys[0],
  ),
  sourceId: z.string().min(1, 'fillRequiredFields'),
  managerId: z.string().min(1, 'fillRequiredFields'),
  comment: z.string(),
  language: z.enum(['ru', 'uz', 'en']),
});

type CreateLeadFormValues = z.infer<typeof createLeadSchema>;

const EMPTY_LEAD_FORM: CreateLeadFormValues = {
  contactName: '',
  phoneNumbers: [''],
  sourceId: '',
  managerId: '',
  comment: '',
  language: 'ru',
};

function LocalizedFormMessage() {
  const { t } = useTranslation();
  const { error, formMessageId } = useFormField();
  if (!error?.message) return null;
  const message = String(error.message);
  const key = Object.prototype.hasOwnProperty.call(translations, message)
    ? message as TranslationKey
    : 'invalidData';

  return (
    <p id={formMessageId} className="text-sm font-medium text-destructive">
      {t(key)}
    </p>
  );
}

function ArchiveLeadDialog({
  lead,
  reason,
  customReason,
  onReasonChange,
  onCustomReasonChange,
  onClose,
  onConfirm,
  isPending,
  t,
}: {
  lead: Lead | null;
  reason: string;
  customReason: string;
  onReasonChange: (reason: string) => void;
  onCustomReasonChange: (reason: string) => void;
  onClose: () => void;
  onConfirm: (lead: Lead, assignToSelf: boolean) => void;
  isPending: boolean;
  t: (key: TranslationKey) => string;
}) {
  const needsManager = Boolean(lead && !lead.managerId);

  useEffect(() => {
    if (!lead) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isPending) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isPending, lead, onClose]);

  if (!lead) return null;

  return (
    <Dialog open={Boolean(lead)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle id="archive-lead-title">{t('archiveLead')}</DialogTitle>
          <DialogDescription id="archive-lead-description">
            {lead.contactName ? `${lead.contactName}. ` : null}
            {t('archiveLeadDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {needsManager ? (
            <Alert>
              <AlertCircle />
              <AlertTitle>{t('leadRequiresResponsibleManager')}</AlertTitle>
              <AlertDescription>{t('leadRequiresResponsibleManagerDescription')}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <label htmlFor="archive-reason" className="text-sm font-medium leading-none">
              {t('archiveReason')}
            </label>
            <Select
              value={reason}
              onValueChange={onReasonChange}
              disabled={isPending}
            >
              <SelectTrigger id="archive-reason" className="w-full">
                <SelectValue placeholder={t('chooseArchiveReason')} />
              </SelectTrigger>
              <SelectContent>
                {LEAD_ARCHIVE_REASONS.map((archiveReason) => (
                  <SelectItem key={archiveReason.code} value={archiveReason.code}>
                    {t(archiveReason.translationKey as TranslationKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {reason === 'other' ? (
            <div className="space-y-2">
              <label htmlFor="archive-custom-reason" className="text-sm font-medium leading-none">
                {t('archiveCustomReason')}
              </label>
              <Input
                id="archive-custom-reason"
                value={customReason}
                onChange={(event) => onCustomReasonChange(event.target.value)}
                onKeyDown={submitOnEnter(() => onConfirm(lead, needsManager), {
                  disabled: !customReason.trim() || isPending,
                })}
                placeholder={t('archiveCustomReasonPlaceholder')}
                maxLength={80}
                disabled={isPending}
                autoFocus
              />
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (!reason || (reason === 'other' && !customReason.trim())) return;
                onConfirm(lead, needsManager);
              }}
              disabled={!reason || (reason === 'other' && !customReason.trim()) || isPending}
            >
              {needsManager ? <UserCheck data-icon="inline-start" /> : <Archive data-icon="inline-start" />}
              {isPending ? t('saving') : needsManager ? t('assignToMeAndArchive') : t('sendToArchive')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AssignLeadBeforeMoveDialog({
  pendingMove,
  managers,
  canChooseAnyManager,
  currentUserId,
  managerId,
  onManagerIdChange,
  onClose,
  onConfirm,
  isPending,
  t,
}: {
  pendingMove: PendingLeadMove | null;
  managers: Array<{ id: number; fullName: string }>;
  canChooseAnyManager: boolean;
  currentUserId?: number;
  managerId: string;
  onManagerIdChange: (managerId: string) => void;
  onClose: () => void;
  onConfirm: (managerId: number) => void;
  isPending: boolean;
  t: (key: TranslationKey) => string;
}) {
  if (!pendingMove) return null;

  const selectedManagerId = canChooseAnyManager ? Number(managerId) : Number(currentUserId);
  const canConfirm = Number.isInteger(selectedManagerId) && selectedManagerId > 0;

  if (!canChooseAnyManager) {
    return (
      <AssignLeadToSelfDialog
        open
        leadName={pendingMove.lead.contactName}
        description={t('leadMoveRequiresResponsibleManagerDescription')}
        confirmLabel={t('assignToMeAndMove')}
        isPending={isPending}
        confirmDisabled={!canConfirm}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        onConfirm={() => onConfirm(selectedManagerId)}
      />
    );
  }

  return (
    <Dialog open onOpenChange={(open) => {
      if (!open && !isPending) onClose();
    }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('leadRequiresResponsibleManager')}</DialogTitle>
          <DialogDescription>
            {pendingMove.lead.contactName ? `${pendingMove.lead.contactName}. ` : null}
            {t('leadMoveRequiresResponsibleManagerDescription')}
          </DialogDescription>
        </DialogHeader>

        <Alert>
          <AlertCircle />
          <AlertTitle>{t('leadRequiresResponsibleManager')}</AlertTitle>
          <AlertDescription>{t('leadMoveRequiresResponsibleManagerDescription')}</AlertDescription>
        </Alert>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="lead-move-manager">
            {t('responsibleManager')}
          </label>
          <Select value={managerId} onValueChange={onManagerIdChange} disabled={isPending}>
            <SelectTrigger id="lead-move-manager">
              <SelectValue placeholder={t('selectResponsibleManager')} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {managers.map((manager) => (
                  <SelectItem key={manager.id} value={String(manager.id)}>{manager.fullName}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            disabled={!canConfirm || isPending}
            onClick={() => onConfirm(selectedManagerId)}
          >
            <UserCheck data-icon="inline-start" />
            {isPending ? t('saving') : t('assignManagerAndMove')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function SalesDashboard({ section = 'overview' }: { section?: SalesSection }) {
  const { t, language } = useTranslation();
  const ceoCopy = useCeoCopy();
  const locale = language === 'ru' ? 'ru-RU' : 'en-US';
  const { user } = useAuth();
  const { startCall: startOnlinePbxCall } = useOnlinePbxCall();
  const isAdministrationModule = hasLeadershipAccess(user);
  const hasSalesModule = getAssignedModules(user).includes('sales');
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const routeSearch = useSearch();
  const pagePath = SALES_SECTION_PATHS[section];
  const riskFilter = new URLSearchParams(routeSearch).get('risk');
  const requestedOverviewManagerId = new URLSearchParams(routeSearch).get('manager');

  const money = (value: number | string | null | undefined) =>
    `${Number(value || 0).toLocaleString(locale)}${t('uzs')}`;

  const dateTime = (value: string | null | undefined) => {
    if (!value) return t('noData');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t('noData');
    return date.toLocaleString(locale, {
      timeZone: ACADEMY_TIME_ZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const paymentStatusName = (code: string | null | undefined) => {
    if (!code) return t('noData');
    const key = paymentStatusTranslationKeys[code];
    return key ? t(key) : code;
  };

  const [leadDialogOpen, setLeadDialogOpen] = useState(false);
  const [duplicateHint, setDuplicateHint] = useState<DuplicateClientHint | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [leadSheetOpen, setLeadSheetOpen] = useState(false);
  const [leadSheetTab, setLeadSheetTab] = useState<LeadSheetTab>('deal');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [studentSheetOpen, setStudentSheetOpen] = useState(false);
  const [archiveDialogLead, setArchiveDialogLead] = useState<Lead | null>(null);
  const [archiveReason, setArchiveReason] = useState('');
  const [archiveCustomReason, setArchiveCustomReason] = useState('');
  const [pendingLeadMove, setPendingLeadMove] = useState<PendingLeadMove | null>(null);
  const [pendingLeadMoveManagerId, setPendingLeadMoveManagerId] = useState('');
  // The reporting preset sticks: switching sections and coming back used to
  // silently reset the metrics to "today" mid-comparison.
  const [storedReportingPreset, setStoredReportingPreset] = useStickyState<string>('sales-overview-range', 'last30');
  const [reportingRange, setReportingRange] = useState(() => (
    isReportingPresetKey(storedReportingPreset)
      ? reportingRangeForPreset(storedReportingPreset)
      : reportingRangeForPreset('last30')
  ));
  const handleReportingRangeChange = useCallback((next: typeof reportingRange) => {
    setReportingRange(next);
    setStoredReportingPreset(next.preset);
  }, [setStoredReportingPreset]);

  const replaceSalesParams = useCallback((changes: Record<string, string | null>, options?: { push?: boolean }) => {
    const params = new URLSearchParams(routeSearch);
    Object.entries(changes).forEach(([key, value]) => {
      if (value === null) params.delete(key);
      else params.set(key, value);
    });
    const query = params.toString();
    // Push when opening a sheet so browser Back closes it instead of leaving
    // the page; closing strips the param in place.
    setLocation(query ? `${pagePath}?${query}` : pagePath, { replace: !options?.push });
  }, [pagePath, routeSearch, setLocation]);

  const { data, error, isError, isLoading, refetch } = useQuery<any>({
    queryKey: salesQueryKeys.module,
  });
  const { data: users = [] } = useQuery<any[]>({
    queryKey: ['/api/users'],
  });

  const leadStatusName = (code: string) => {
    return data?.statuses?.find((status: any) => status.code === code)?.name ?? code;
  };
  const leadStatusColor = (code: string) =>
    data?.statuses?.find((status: PipelineStatus) => status.code === code)?.color ?? '#64748b';

  const archiveReasonName = (code: string | null | undefined) => {
    if (!code) return t('noData');
    const key = archiveReasonTranslationKeys[code];
    if (key) return t(key);
    return code;
  };

  const invalidate = () => invalidateSalesLeadData(queryClient);
  const currentSalesManagerId = hasSalesModule && user?.id ? String(user.id) : '';
  const leadFormDefaults = useMemo<CreateLeadFormValues>(() => ({
    ...EMPTY_LEAD_FORM,
    managerId: currentSalesManagerId,
  }), [currentSalesManagerId]);

  const leadForm = useForm<CreateLeadFormValues>({
    resolver: zodResolver(createLeadSchema),
    defaultValues: leadFormDefaults,
  });

  useEffect(() => {
    if (!leadForm.formState.isDirty) {
      leadForm.reset(leadFormDefaults);
    }
  }, [leadForm, leadFormDefaults, leadForm.formState.isDirty]);

  const myLeads = useMemo<Lead[]>(() => {
    if (!data?.leads) return [];
    return data.leads;
  }, [data?.leads]);

  const archivedLeads = useMemo<Lead[]>(() => {
    if (!data?.archivedLeads) return [];
    return data.archivedLeads;
  }, [data?.archivedLeads]);

  const myStudents = useMemo<Student[]>(() => {
    if (!data?.students) return [];
    return data.students;
  }, [data?.students]);

  const studentsForCurrentRisk = useMemo(() => {
    if (riskFilter === 'overdue') {
      const now = new Date();
      return myStudents.filter((student) => student.paymentStatus === 'overdue'
        || Boolean(student.nextPaymentAt && new Date(student.nextPaymentAt) < now));
    }
    if (riskFilter === 'low-attendance') {
      const attendanceTarget = Number(data?.constants?.targets?.attendance ?? 70);
      return myStudents.filter((student) => (
        student.riskFlags?.includes('attendance_below_70')
        || (
          Number(student.attendancePercent || 0) > 0
          && Number(student.attendancePercent || 0) < attendanceTarget
        )
      ));
    }
    return myStudents;
  }, [data?.constants?.targets?.attendance, myStudents, riskFilter]);

  const myPayments = useMemo<any[]>(() => {
    if (!data?.payments) return [];
    return data.payments;
  }, [data?.payments]);

  const salesManagers = useMemo(
    () => users
      .filter((employee) => getAssignedModules(employee).includes('sales') && employee.isActive)
      .map((employee) => ({ id: employee.id, fullName: employee.fullName })),
    [users],
  );
  const leadManagerOptions = useMemo(() => {
    if (!currentSalesManagerId || !user?.fullName) return salesManagers;
    const currentUserListed = salesManagers.some((manager) => Number(manager.id) === Number(currentSalesManagerId));
    if (currentUserListed) return salesManagers;
    return [{ id: Number(currentSalesManagerId), fullName: user.fullName }, ...salesManagers];
  }, [currentSalesManagerId, salesManagers, user?.fullName]);
  const overviewManagerOptions = useMemo(() => {
    if (isAdministrationModule) return leadManagerOptions;
    return leadManagerOptions.filter(
      (manager) => Number(manager.id) === Number(currentSalesManagerId),
    );
  }, [currentSalesManagerId, isAdministrationModule, leadManagerOptions]);
  const defaultOverviewManagerId = currentSalesManagerId || 'all';
  const requestedManagerIsAvailable = isAdministrationModule && Boolean(
    requestedOverviewManagerId === 'all'
    || overviewManagerOptions.some(
      (manager) => String(manager.id) === requestedOverviewManagerId,
    ),
  );
  const overviewManagerId = requestedManagerIsAvailable
    ? requestedOverviewManagerId!
    : defaultOverviewManagerId;
  const overviewManagerNumericId = overviewManagerId === 'all'
    ? null
    : Number(overviewManagerId);

  const activePipelineStatuses = useMemo(
    (): PipelineStatus[] => [...(data?.statuses ?? [])]
      .filter((status: any) => status.isActive !== false && status.isPipeline !== false)
      .sort((left: any, right: any) => Number(left.sortOrder) - Number(right.sortOrder)),
    [data?.statuses],
  );

  const activePipelineCodes = useMemo(
    () => new Set(activePipelineStatuses.map((status: any) => status.code)),
    [activePipelineStatuses],
  );

  const pipelineLeads = useMemo(
    () => myLeads.filter((lead) => !lead.isArchived && activePipelineCodes.has(lead.statusCode)),
    [activePipelineCodes, myLeads],
  );
  const { filters: leadFilters, applyFilters } = useLeadFilters({ urlSync: section === 'pipeline' });
  const filteredPipelineLeads = useMemo(
    () => pipelineLeads.filter((lead) => leadMatchesFilters(lead, leadFilters)),
    [leadFilters, pipelineLeads],
  );
  const pipelineBulkActions = useSalesPipelineBulkActions({ leads: filteredPipelineLeads, statuses: activePipelineStatuses });

  const overviewLeads = useMemo(() => {
    if (overviewManagerNumericId === null) return myLeads;
    return myLeads.filter(
      (lead) => Number(lead.managerId) === overviewManagerNumericId,
    );
  }, [myLeads, overviewManagerNumericId]);

  const overviewStudents = useMemo(() => {
    if (overviewManagerNumericId === null) return myStudents;
    return myStudents.filter(
      (student) => Number(student.managerId) === overviewManagerNumericId,
    );
  }, [myStudents, overviewManagerNumericId]);

  const overviewPayments = useMemo(() => {
    if (overviewManagerNumericId === null) return myPayments;
    const managerLeadIds = new Set(
      [...myLeads, ...archivedLeads]
        .filter((lead) => Number(lead.managerId) === overviewManagerNumericId)
        .map((lead) => Number(lead.id)),
    );
    const managerStudentIds = new Set(
      overviewStudents.map((student) => Number(student.id)),
    );
    return myPayments.filter((payment) => (
      managerStudentIds.has(Number(payment.studentId))
      || managerLeadIds.has(Number(payment.leadId))
    ));
  }, [archivedLeads, myLeads, myPayments, overviewManagerNumericId, overviewStudents]);

  const periodLeads = useMemo(
    () => overviewLeads.filter((lead) => isInReportingRange(lead.createdAt, reportingRange)),
    [overviewLeads, reportingRange],
  );
  const previousRange = useMemo(() => {
    const fromDate = new Date(`${reportingRange.from}T00:00:00Z`).getTime();
    const toDate = new Date(`${reportingRange.to}T00:00:00Z`).getTime();
    const days = Math.max(1, Math.round((toDate - fromDate) / 86_400_000) + 1);
    return {
      from: addReportingDays(reportingRange.from, -days),
      to: addReportingDays(reportingRange.from, -1),
    };
  }, [reportingRange]);
  const previousPeriodLeads = useMemo(
    () => overviewLeads.filter((lead) => isInReportingRange(lead.createdAt, previousRange)),
    [overviewLeads, previousRange],
  );
  const previousPeriodStudents = useMemo(
    () => overviewStudents.filter((student) => isInReportingRange(student.enrolledAt || student.createdAt, previousRange)),
    [overviewStudents, previousRange],
  );
  const periodStudents = useMemo(
    () => overviewStudents.filter((student) => isInReportingRange(student.enrolledAt || student.createdAt, reportingRange)),
    [overviewStudents, reportingRange],
  );
  const periodPayments = useMemo(
    () => overviewPayments.filter((payment) => (
      payment.status === 'paid'
      && isInReportingRange(payment.paidAt || payment.createdAt, reportingRange)
    )),
    [overviewPayments, reportingRange],
  );

  const managerStats = useMemo(() => {
    const newLeadsPeriod = periodLeads.length;
    const activeLeads = periodLeads.filter(
      (lead) => !lead.isArchived && lead.statusCode !== 'paid' && activePipelineCodes.has(lead.statusCode),
    ).length;
    const totalStudents = periodStudents.length;

    const paidLeads = periodLeads.filter((lead) => lead.statusCode === 'paid').length;
    const totalManagedLeads = periodLeads.length;
    const conversionRate = totalManagedLeads > 0 ? Math.round((paidLeads / totalManagedLeads) * 100) : 0;

    const previousActiveLeads = previousPeriodLeads.filter(
      (lead) => !lead.isArchived && lead.statusCode !== 'paid' && activePipelineCodes.has(lead.statusCode),
    ).length;
    const previousTotalStudents = previousPeriodStudents.length;
    const previousPaidLeads = previousPeriodLeads.filter((lead) => lead.statusCode === 'paid').length;
    const previousConversionRate = previousPeriodLeads.length > 0
      ? Math.round((previousPaidLeads / previousPeriodLeads.length) * 100)
      : 0;

    return {
      newLeadsPeriod,
      activeLeads,
      totalStudents,
      conversionRate,
      activeLeadsPrevious: previousActiveLeads,
      totalStudentsPrevious: previousTotalStudents,
      conversionRatePrevious: previousConversionRate,
    };
  }, [activePipelineCodes, periodLeads, periodStudents, previousPeriodLeads, previousPeriodStudents]);

  const createLead = useMutation({
    mutationFn: (values: CreateLeadFormValues) => leadsApi.create(createLeadPayload(values)),
    onSuccess: () => {
      toast({ title: t('leadCreated'), description: t('leadCreatedDesc') });
      leadForm.reset(leadFormDefaults);
      setDuplicateHint(null);
      setLeadDialogOpen(false);
      invalidate();
    },
    onError: (error: any) => {
      const duplicate = error?.data?.duplicate as DuplicateClientHint | undefined;
      if (error?.status === 409 && duplicate) {
        setDuplicateHint(duplicate);
        toast({ title: t('clientAlreadyExists') });
        return;
      }
      toast({
        title: t('leadCreateFailed'),
        description: localizeApiErrorMessage(error.message, error.status ?? 0),
        variant: 'destructive',
      });
    },
  });

  const mergeLeadDraft = useMutation({
    mutationFn: ({ retainedLeadId, values }: { retainedLeadId: number; values: CreateLeadFormValues }) =>
      leadsApi.mergeDraft<Lead>({ retainedLeadId, draft: createLeadPayload(values) }),
    onSuccess: (retainedLead: Lead) => {
      toast({ title: t('leadMergeCompleted'), description: t('leadMergeCompletedDescription') });
      leadForm.reset(leadFormDefaults);
      setDuplicateHint(null);
      setLeadDialogOpen(false);
      invalidate();
      openLead(retainedLead.id);
    },
    onError: (error: any) => toast({
      title: t('leadMergeFailed'),
      description: leadMergeErrorMessage(t, error?.data?.error),
      variant: 'destructive',
    }),
  });

  const updateLead = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      leadsApi.update<Lead>(id, payload),
    onSuccess: () => {
      toast({ title: t('statusUpdated') });
      invalidate();
    },
    onError: (error: any) => toast({
      title: t('statusNotUpdated'),
      description: localizeApiErrorMessage(error.message, error.status ?? 0),
      variant: 'destructive',
    }),
  });

  const assignAndMoveLead = useMutation({
    mutationFn: ({ leadId, statusCode, managerId }: { leadId: number; statusCode: string; managerId: number }) =>
      leadsApi.update<Lead>(leadId, { statusCode, managerId }),
    onSuccess: () => {
      setPendingLeadMove(null);
      setPendingLeadMoveManagerId('');
      toast({ title: t('leadAssignedAndMoved') });
      invalidate();
    },
    onError: (error: Error) => toast({
      title: t('statusNotUpdated'),
      description: localizeApiErrorMessage(error.message, (error as { status?: number }).status ?? 0),
      variant: 'destructive',
    }),
  });

  const archiveLead = useMutation({
    mutationFn: ({ id, reason, customReason, assignToSelf }: { id: number; reason: string; customReason?: string; assignToSelf?: boolean }) =>
      leadsApi.archive<Lead>(id, { reason, customReason, assignToSelf }),
    onSuccess: (_lead, variables) => {
      toast({ title: variables.assignToSelf ? t('leadAssignedAndArchived') : t('leadArchived') });
      setArchiveDialogLead(null);
      setArchiveReason('');
      setArchiveCustomReason('');
      if (selectedLeadId === variables.id) {
        setLeadSheetOpen(false);
        setSelectedLeadId(null);
        replaceSalesParams({ lead: null });
      }
      invalidate();
    },
    onError: (error: any) => toast({
      title: t('leadArchiveFailed'),
      description: localizeApiErrorMessage(error.message, error.status ?? 0),
      variant: 'destructive',
    }),
  });

  const restoreLead = useMutation({
    mutationFn: ({ id, statusCode }: { id: number; statusCode: string }) =>
      leadsApi.restore<Lead>(id, { statusCode }),
    onSuccess: () => {
      toast({ title: t('leadRestored') });
      invalidate();
    },
    onError: (error: any) => toast({
      title: t('leadRestoreFailed'),
      description: localizeApiErrorMessage(error.message, error.status ?? 0),
      variant: 'destructive',
    }),
  });

  const updateStudentStatus = useMutation({
    mutationFn: ({ id, status, exitReason }: { id: number; status: string; exitReason?: string }) =>
      studentsApi.updateStatus<Student>(id, status, exitReason),
    onSuccess: (student) => {
      toast({ title: ceoCopy.student.updated });
      setSelectedStudent((current) => current?.id === student.id ? { ...current, ...student } : current);
      invalidate();
    },
    onError: (error: Error) => toast({
      title: ceoCopy.student.updateFailed,
      description: localizeApiErrorMessage(error.message, (error as { status?: number }).status ?? 0),
      variant: 'destructive',
    }),
  });

  const addStudentGroup = useMutation({
    mutationFn: ({ id, groupId, isPrimary }: { id: number; groupId: number; isPrimary?: boolean }) =>
      studentsApi.addGroup<Student>(id, groupId, isPrimary),
    onSuccess: () => {
      toast({ title: t('studentGroupAdded') });
      invalidate();
    },
    onError: (error: Error) => toast({
      title: t('studentGroupUpdateFailed'),
      description: localizeApiErrorMessage(error.message, (error as { status?: number }).status ?? 0),
      variant: 'destructive',
    }),
  });

  const removeStudentGroup = useMutation({
    mutationFn: ({ id, groupId }: { id: number; groupId: number }) =>
      studentsApi.removeGroup<Student>(id, groupId),
    onSuccess: () => {
      toast({ title: t('studentGroupRemoved') });
      invalidate();
    },
    onError: (error: any) => toast({
      title: t('studentGroupUpdateFailed'),
      description: error?.data?.error === 'studentRequiresAtLeastOneGroup'
        ? t('studentRequiresAtLeastOneGroup')
        : localizeApiErrorMessage(error.message ?? '', error.status ?? 0),
      variant: 'destructive',
    }),
  });

  // The red "new lead" dot stays until its card is actually opened.
  useLeadViewTracking({ leadId: selectedLeadId, open: leadSheetOpen, leads: myLeads });

  const openLead = useCallback((leadId: number, tab: LeadSheetTab = "deal") => {
    setSelectedLeadId(leadId);
    setLeadSheetTab(tab);
    setLeadSheetOpen(true);
    replaceSalesParams({ lead: String(leadId), student: null }, { push: true });
  }, [replaceSalesParams]);

  const handleLeadSheetState = useCallback((open: boolean) => {
    setLeadSheetOpen(open);
    if (!open) {
      setSelectedLeadId(null);
      replaceSalesParams({ lead: null });
    }
  }, [replaceSalesParams]);

  const openStudent = useCallback((student: Student) => {
    setSelectedStudent(student);
    setStudentSheetOpen(true);
    replaceSalesParams({ student: String(student.id), lead: null }, { push: true });
  }, [replaceSalesParams]);

  const handleStudentSheetState = useCallback((open: boolean) => {
    setStudentSheetOpen(open);
    if (!open) {
      setSelectedStudent(null);
      replaceSalesParams({ student: null });
    }
  }, [replaceSalesParams]);

  useEffect(() => {
    if (!data) return;
    const params = new URLSearchParams(routeSearch);
    const leadId = Number(params.get('lead'));
    const studentId = Number(params.get('student'));

    if (Number.isFinite(leadId) && leadId > 0 && leadId !== selectedLeadId) {
      setSelectedLeadId(leadId);
      setLeadSheetTab('deal');
      setLeadSheetOpen(true);
    }
    if (Number.isFinite(studentId) && studentId > 0 && selectedStudent?.id !== studentId) {
      const student = myStudents.find((item) => item.id === studentId);
      if (student) {
        setSelectedStudent(student);
        setStudentSheetOpen(true);
      }
    }
  }, [data, myStudents, routeSearch, selectedLeadId, selectedStudent?.id]);

  const requestLeadStatusChange = useCallback(async (leadId: number, statusCode: string) => {
    const lead = myLeads.find((item) => item.id === leadId);
    if (!lead) return false;
    if (!lead.managerId) {
      setPendingLeadMove({ lead, statusCode });
      setPendingLeadMoveManagerId(isAdministrationModule ? '' : String(user?.id ?? ''));
      return false;
    }
    await updateLead.mutateAsync({ id: leadId, payload: { statusCode } });
    return true;
  }, [isAdministrationModule, myLeads, updateLead, user?.id]);

  const handleQuickAction = useCallback((action: QuickAction, lead: Lead) => {
    if (action === 'payment') {
      openLead(lead.id, 'payment');
      return;
    }
    if (action === 'call') {
      const phone = primaryVisibleLeadPhone(lead);
      if (!phone) {
        toast({ title: t('phoneNotProvided'), variant: 'destructive' });
        return;
      }
      startOnlinePbxCall(phone);
      return;
    }
    if (action === 'message') {
      const target = leadMessageTarget(lead);
      if (!target) {
        toast({ title: t('contactMethodNotProvided'), variant: 'destructive' });
        return;
      }
      if (target.external) {
        window.open(target.href, '_blank', 'noopener,noreferrer');
      } else {
        setLocation(target.href);
      }
      return;
    }
  }, [openLead, setLocation, startOnlinePbxCall, t]);

  const openArchiveDialog = useCallback((lead: Lead) => {
    setArchiveDialogLead(lead);
    setArchiveReason('');
    setArchiveCustomReason('');
  }, []);

  const handleArchiveDialogState = useCallback((open: boolean) => {
    if (!open) {
      setArchiveDialogLead(null);
      setArchiveReason('');
      setArchiveCustomReason('');
    }
  }, []);

  const handleLeadDialogState = useCallback((open: boolean) => {
    setLeadDialogOpen(open);
    if (!open) {
      leadForm.reset(leadFormDefaults);
      setDuplicateHint(null);
    }
  }, [leadForm, leadFormDefaults]);
  const leadDialogGuard = useUnsavedChangesGuard({
    open: leadDialogOpen,
    isDirty: leadForm.formState.isDirty,
    onOpenChange: handleLeadDialogState,
  });

  const managerFunnel = useMemo(() => {
    const statusIndex = new Map(activePipelineStatuses.map((status, index) => [status.code, index]));
    const visibleLeads = periodLeads.filter((lead) => !lead.isArchived);
    return activePipelineStatuses.map((status, index) => {
      const count = visibleLeads.filter((lead) => {
        const currentIndex = statusIndex.get(lead.statusCode);
        return currentIndex !== undefined && currentIndex >= index;
      }).length;
      return {
        code: status.code,
        count,
        color: status.color,
      };
    });
  }, [activePipelineStatuses, periodLeads]);

  const contained = section !== 'overview';

  if (isLoading) {
    return (
      <ModulePage contained={contained}>
        <ModulePageBody contained={contained} ariaLabel={t('loading')}>
          <div className="space-y-6">
            <Skeleton className="h-10 w-64" />
            <div className="grid grid-cols-tile gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-28" />
              ))}
            </div>
            <AnalyticsChartsSkeleton />
          </div>
        </ModulePageBody>
      </ModulePage>
    );
  }

  if (isError || !data) {
    return (
      <ModulePage contained={contained}>
        <ModulePageBody contained={contained} ariaLabel={t('failedToLoadData')}>
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>{t('failedToLoadData')}</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-3">
              <span>{error instanceof Error ? error.message : t('errorOccurred')}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
                {t('retry')}
              </Button>
            </AlertDescription>
          </Alert>
        </ModulePageBody>
      </ModulePage>
    );
  }

  const sectionTitle: Record<SalesSection, string> = {
    overview: t(moduleSectionLabelKey('sales', 'overview')),
    pipeline: t(moduleSectionLabelKey('sales', 'pipeline')),
    archive: t(moduleSectionLabelKey('sales', 'archive')),
    schedule: t(moduleSectionLabelKey('sales', 'schedule')),
    students: isAdministrationModule ? t('allClients') : t('myStudents'),
  };
  const sectionSubtitle = section === 'overview'
    ? t('salesOverviewSubtitle')
    : section === 'schedule'
      ? t('salesScheduleSubtitle')
      : section === 'archive'
        ? t('leadArchiveDescription')
        : isAdministrationModule
          ? t('globalSalesModuleDescription')
          : t('salesManagerModule');
  const ownsContentScroll = ['pipeline', 'archive', 'schedule', 'students'].includes(section);
  return (
    <ModulePage contained={contained} className={contained ? undefined : 'overflow-x-clip'}>
      <PageHeader
        title={sectionTitle[section]}
        subtitle={sectionSubtitle}
        breadcrumbs={[
          { label: t(MODULE_NAVIGATION.sales.nameKey), href: '/sales' },
          ...(section === 'overview' ? [] : [{ label: sectionTitle[section] }]),
        ]}
        actions={
          section === 'pipeline' ? (
            <div className="flex flex-wrap gap-2">
              <SalesBulkActionsButton selectedCount={pipelineBulkActions.selectedLeadIds.size} onClick={() => pipelineBulkActions.setDialogOpen(true)} />
              <Button size="sm" onClick={() => setLeadDialogOpen(true)}>
                <Plus data-icon="inline-start" />{t('newApplication')}
              </Button>
              <LeadFiltersDialog
                filters={leadFilters}
                onApply={applyFilters}
                sources={data.sources ?? []}
                leads={pipelineLeads}
              />
            </div>
          ) : undefined
        }
      />

      <ModulePageBody
        contained={contained}
        scroll={ownsContentScroll ? 'hidden' : 'auto'}
        ariaLabel={sectionTitle[section]}
      >

      {section === 'overview' ? (
        <div className="space-y-5">
          <Card
            className="sticky top-2 z-20 border-border/60 bg-card/95 shadow-sm backdrop-blur"
            role="group"
            aria-label={t('salesOverviewFilters')}
          >
            <CardContent className="flex flex-col gap-2 p-2 xl:flex-row xl:items-center">
              <ReportingDateRangeFilter
                className="border-0 bg-transparent shadow-none xl:min-w-0 xl:flex-1"
                value={reportingRange}
                onChange={handleReportingRangeChange}
              />
              <span className="hidden w-px self-stretch bg-border xl:block" aria-hidden="true" />
              <SalesOverviewEmployeeFilter
                className="border-0 bg-transparent shadow-none"
                value={overviewManagerId}
                managers={overviewManagerOptions}
                canViewAllManagers={isAdministrationModule}
                onChange={(managerId) => replaceSalesParams({
                  manager: managerId === defaultOverviewManagerId ? null : managerId,
                })}
              />
            </CardContent>
          </Card>
          <SalesOverviewMetrics
            reportingRange={reportingRange}
            managerId={overviewManagerNumericId}
            isAdministrationModule={isAdministrationModule}
            stats={managerStats}
            payments={overviewPayments}
            funnel={managerFunnel}
            leadStatusName={leadStatusName}
            statusColor={leadStatusColor}
            money={money}
            onNavigate={(target) => setLocation(SALES_SECTION_PATHS[target])}
            onExpandPeriod={() => handleReportingRangeChange(reportingRangeForPreset('last30'))}
          />
          <SalesOverviewSection
            payments={periodPayments}
            leads={periodLeads}
            reportingRange={reportingRange}
            money={money}
          />
        </div>
      ) : null}

      {section === 'pipeline' ? (
        <SalesPipelineSection
          leadStatusName={leadStatusName}
          leads={filteredPipelineLeads}
          activePipelineStatuses={activePipelineStatuses}
          onLeadClick={(lead) => openLead(lead.id)}
          onQuickAction={handleQuickAction}
          onArchiveLead={openArchiveDialog}
          onStatusChange={async (leadId, statusCode) => {
            if (statusCode === 'paid') {
              // The move is rejected (the card snaps back): explain why instead
              // of leaving the user to guess.
              toast({ title: t('paidMoveRequiresPaymentTitle'), description: t('paidMoveRequiresPaymentDescription') });
              openLead(leadId, 'payment');
              return false;
            }
            return requestLeadStatusChange(leadId, statusCode);
          }}
          isPending={updateLead.isPending || assignAndMoveLead.isPending}
          showManager={isAdministrationModule}
          selectedLeadIds={pipelineBulkActions.selectedLeadIds}
          onSelectedLeadIdsChange={pipelineBulkActions.setSelectedLeadIds}
          managers={salesManagers}
          canManageAllLeads={isAdministrationModule}
          bulkActions={pipelineBulkActions}
        />
      ) : null}

      {section === 'archive' ? (
        <ArchiveTab
          t={t}
          leads={archivedLeads}
          activePipelineStatuses={activePipelineStatuses}
          leadStatusName={leadStatusName}
          archiveReasonName={archiveReasonName}
          dateTime={dateTime}
          onLeadClick={(lead) => openLead(lead.id)}
          onRestore={(leadId, statusCode) => restoreLead.mutate({ id: leadId, statusCode })}
          isPending={restoreLead.isPending}
        />
      ) : null}

      {section === 'schedule' ? (
        <SalesScheduleCalendar
          groups={data.groups ?? []}
          lessons={data.lessons ?? []}
          courses={data.courses ?? []}
          schools={data.schools ?? []}
          leads={pipelineLeads}
          onOpenLead={openLead}
        />
      ) : null}

      {section === 'students' ? (
        <StudentsTab
          t={t}
          myStudents={studentsForCurrentRisk}
          paymentStatusName={paymentStatusName}
          dateTime={dateTime}
          data={data}
          selectedStudent={selectedStudent}
          studentSheetOpen={studentSheetOpen}
          openStudent={openStudent}
          openLead={openLead}
          onStudentSheetOpenChange={handleStudentSheetState}
          onUpdateStudentStatus={isAdministrationModule
            ? (id, status, exitReason) => updateStudentStatus.mutateAsync({ id, status, exitReason })
            : undefined}
          onAddStudentGroup={isAdministrationModule
            ? (id, groupId, isPrimary) => addStudentGroup.mutateAsync({ id, groupId, isPrimary })
            : undefined}
          onRemoveStudentGroup={isAdministrationModule
            ? (id, groupId) => removeStudentGroup.mutateAsync({ id, groupId })
            : undefined}
          title={riskFilter === 'overdue'
            ? ceoCopy.student.overdueStudents
            : riskFilter === 'low-attendance'
              ? ceoCopy.student.lowAttendanceStudents
              : sectionTitle.students}
          showManager={isAdministrationModule}
        />
      ) : null}

      </ModulePageBody>

      <ArchiveLeadDialog
        lead={archiveDialogLead}
        reason={archiveReason}
        customReason={archiveCustomReason}
        onReasonChange={setArchiveReason}
        onCustomReasonChange={setArchiveCustomReason}
        onClose={() => handleArchiveDialogState(false)}
        onConfirm={(lead, assignToSelf) => archiveLead.mutate({
          id: lead.id,
          reason: archiveReason,
          customReason: archiveReason === 'other' ? archiveCustomReason.trim() : undefined,
          assignToSelf,
        })}
        isPending={archiveLead.isPending}
        t={t}
      />

      <AssignLeadBeforeMoveDialog
        pendingMove={pendingLeadMove}
        managers={salesManagers}
        canChooseAnyManager={isAdministrationModule}
        currentUserId={user?.id}
        managerId={pendingLeadMoveManagerId}
        onManagerIdChange={setPendingLeadMoveManagerId}
        onClose={() => {
          if (assignAndMoveLead.isPending) return;
          setPendingLeadMove(null);
          setPendingLeadMoveManagerId('');
        }}
        onConfirm={(managerId) => {
          if (!pendingLeadMove) return;
          assignAndMoveLead.mutate({
            leadId: pendingLeadMove.lead.id,
            statusCode: pendingLeadMove.statusCode,
            managerId,
          });
        }}
        isPending={assignAndMoveLead.isPending}
        t={t}
      />

      <Dialog open={leadDialogOpen} onOpenChange={leadDialogGuard.handleOpenChange}>
        <DialogContent className="max-h-[90dvh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('newApplication')}</DialogTitle>
            <DialogDescription className="sr-only">{t('formCreation')} {t('newApplication')}</DialogDescription>
          </DialogHeader>
          <LeadForm
            t={t}
            form={leadForm}
            createLead={createLead}
            data={data}
            managers={leadManagerOptions}
            managerSelectDisabled={hasSalesModule && !isAdministrationModule}
          />
        </DialogContent>
      </Dialog>
      <LeadMergeConflictDialog
        open={Boolean(duplicateHint)}
        mode="draft"
        currentLead={{
          name: leadForm.getValues('contactName'),
          phoneNumbers: compactPhoneNumbers(leadForm.getValues('phoneNumbers')),
        }}
        existingLead={duplicateHint ? {
          ...duplicateHint,
          id: duplicateHint.entityType === 'lead' ? duplicateHint.id : duplicateHint.leadId,
          statusName: duplicateHint.statusCode ? leadStatusName(duplicateHint.statusCode) : undefined,
        } : null}
        isPending={mergeLeadDraft.isPending}
        onCancel={() => setDuplicateHint(null)}
        onOpenExisting={() => {
          if (!duplicateHint) return;
          const targetLeadId = duplicateHint.entityType === 'lead' ? duplicateHint.id : duplicateHint.leadId;
          if (!targetLeadId) return;
          leadForm.reset(leadFormDefaults);
          setDuplicateHint(null);
          setLeadDialogOpen(false);
          openLead(targetLeadId);
        }}
        onMergeIntoExisting={() => {
          if (!duplicateHint) return;
          const targetLeadId = duplicateHint.entityType === 'lead' ? duplicateHint.id : duplicateHint.leadId;
          if (!targetLeadId) return;
          mergeLeadDraft.mutate({ retainedLeadId: targetLeadId, values: leadForm.getValues() });
        }}
      />
      <UnsavedChangesDialog
        open={leadDialogGuard.confirmationOpen}
        onOpenChange={leadDialogGuard.setConfirmationOpen}
        onDiscard={leadDialogGuard.discardChanges}
      />
      <LeadDetailSheet
        leadId={selectedLeadId}
        open={leadSheetOpen}
        onOpenChange={handleLeadSheetState}
        initialTab={leadSheetTab}
        courses={data.courses ?? []}
        schools={data.schools ?? []}
        demoLeads={pipelineLeads}
        groups={data.groups ?? []}
        sources={data.sources ?? []}
        statuses={data.statuses ?? []}
        managers={isAdministrationModule
          ? salesManagers
          : salesManagers.filter((manager) => Number(manager.id) === Number(user?.id))}
        currentUserId={user?.id}
        canClaimUnassignedLead={hasSalesModule && !isAdministrationModule}
        leadStatusName={leadStatusName}
        dateTime={dateTime}
        money={money}
        onChanged={invalidate}
        onMerged={(retainedLeadId) => {
          setSelectedLeadId(retainedLeadId);
          setLeadSheetOpen(true);
          replaceSalesParams({ lead: String(retainedLeadId) });
        }}
      />
    </ModulePage>
  );
}
// ---- Sub-components for tabs ----

function StudentsTab({
  t,
  myStudents,
  paymentStatusName,
  dateTime,
  data,
  selectedStudent,
  studentSheetOpen,
  openStudent,
  openLead,
  onStudentSheetOpenChange,
  onUpdateStudentStatus,
  onAddStudentGroup,
  onRemoveStudentGroup,
  title,
  showManager,
}: {
  t: (key: TranslationKey) => string;
  myStudents: Student[];
  paymentStatusName: (code: string | null | undefined) => string;
  dateTime: (v: string | null | undefined) => string;
  data: any;
  selectedStudent: Student | null;
  studentSheetOpen: boolean;
  openStudent: (student: Student) => void;
  openLead: (leadId: number, tab?: LeadSheetTab) => void;
  onStudentSheetOpenChange: (open: boolean) => void;
  onUpdateStudentStatus?: (id: number, status: string, exitReason?: string) => Promise<unknown>;
  onAddStudentGroup?: (id: number, groupId: number, isPrimary?: boolean) => Promise<unknown>;
  onRemoveStudentGroup?: (id: number, groupId: number) => Promise<unknown>;
  title: string;
  showManager: boolean;
}) {
  const columns = [
    {
      key: 'studentName',
      header: t('student'),
      sortable: true,
      accessor: (student: Student) => student.studentName || student.contactName,
      render: (student: Student) => (
        <div>
          <div className="font-medium text-foreground">{student.studentName || student.contactName}</div>
          <div className="text-xs text-muted-foreground">{student.phone}</div>
        </div>
      ),
    },
    {
      key: 'groupId',
      header: t('group'),
      sortable: true,
      accessor: (student: Student) => student.groupNames?.join(', ') || student.groupName,
      render: (student: Student) => (
        <span className="line-clamp-2 text-muted-foreground">
          {student.groupNames?.join(', ') || student.groupName || t('noGroup')}
        </span>
      ),
    },
    {
      key: 'courseId',
      header: t('course'),
      sortable: true,
      accessor: (student: Student) => student.courseName,
      render: (student: Student) => <span className="text-muted-foreground">{student.courseName || t('noCourse')}</span>,
    },
    ...(showManager ? [{
      key: 'managerName',
      header: t('manager'),
      sortable: true,
      accessor: (student: Student) => student.managerName || t('noData'),
      render: (student: Student) => <span className="text-muted-foreground">{student.managerName || t('noData')}</span>,
    }] : []),
    {
      key: 'attendancePercent',
      header: t('attendanceLabel'),
      sortable: true,
      accessor: (student: Student) => student.attendancePercent,
      render: (student: Student) => (
        <div className="w-28">
          <div className="flex justify-between text-xs mb-1">
            <span className="tabular-nums text-muted-foreground">{student.attendancePercent}%</span>
          </div>
          <Progress value={student.attendancePercent} />
        </div>
      ),
    },
    {
      key: 'progressPercent',
      header: t('progressLabel'),
      sortable: true,
      accessor: (student: Student) => student.progressPercent,
      render: (student: Student) => (
        <div className="w-28">
          <div className="flex justify-between text-xs mb-1">
            <span className="tabular-nums text-muted-foreground">{student.progressPercent}%</span>
          </div>
          <Progress value={student.progressPercent} />
        </div>
      ),
    },
    {
      key: 'paymentStatus',
      header: t('paymentStatus'),
      sortable: true,
      // Sort by the same derived value the cell renders, so a row displaying
      // "Overdue" cannot sort as if it were "pending".
      accessor: (student: Student) => {
        const isOverdue = student.nextPaymentAt && new Date(student.nextPaymentAt) < new Date();
        return isOverdue ? 'overdue' : student.paymentStatus ?? 'paid';
      },
      render: (student: Student) => {
        const isOverdue = student.nextPaymentAt && new Date(student.nextPaymentAt) < new Date();
        const paymentStatus = isOverdue ? 'overdue' : student.paymentStatus ?? 'paid';
        return (
          <Badge variant={paymentStatus === 'overdue' ? 'destructive' : paymentStatus === 'paid' ? 'success' : 'warning'}>
            {paymentStatusName(paymentStatus)}
          </Badge>
        );
      },
    },
  ];

  return (
    <div className="h-full min-h-0">
      <Card className="flex h-full min-h-0 flex-col overflow-hidden">
        <CardHeader className="shrink-0 pb-4">
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 p-0">
          <DataTable
            rootClassName="flex h-full min-h-0 flex-col"
            className="min-h-0 flex-1 overflow-auto overscroll-contain"
            columns={columns}
            data={myStudents}
            keyExtractor={(student: Student) => `student-${student.id}`}
            emptyState={
              <div className="p-8">
                <EmptyState title={t('noClientsYet')} description={t('noClientsYetDesc')} icon={UserCheck} />
              </div>
            }
            onRowClick={openStudent}
          />
        </CardContent>
      </Card>
      <StudentDetailSheet
        student={myStudents.find((student) => student.id === selectedStudent?.id) ?? selectedStudent}
        open={studentSheetOpen}
        onOpenChange={onStudentSheetOpenChange}
        onRecordPayment={(leadId) => openLead(leadId, 'payment')}
        onUpdateStatus={onUpdateStudentStatus}
        onAddGroup={onAddStudentGroup}
        onRemoveGroup={onRemoveStudentGroup}
        data={{ projects: data.projects, payments: data.payments, referrals: data.referrals, groups: data.groups }}
        dateTime={dateTime}
      />
    </div>
  );
}

// ---- Lead Form Component ----

function LeadForm({
  t,
  form,
  createLead,
  data,
  managers,
  managerSelectDisabled,
}: {
  t: (key: TranslationKey) => string;
  form: UseFormReturn<CreateLeadFormValues>;
  createLead: any;
  data: any;
  managers: Array<{ id: number; fullName: string }>;
  managerSelectDisabled: boolean;
}) {
  const phoneNumbersRaw = form.watch('phoneNumbers');
  const phoneValues = useMemo(() => (phoneNumbersRaw && phoneNumbersRaw.length > 0 ? phoneNumbersRaw : ['']), [phoneNumbersRaw]);
  /*
    Parallel stable ids for the phone rows: React must not reuse one input's
    DOM node for a different logical phone after deleting a middle row (focus
    and IME composition would attach to the wrong field). RHF's useFieldArray
    cannot type arrays of plain strings, so ids are tracked alongside.
  */
  const [phoneKeys, setPhoneKeys] = useState<string[]>(() => phoneValues.map((_, i) => `phone-${Date.now()}-${i}`));
  useEffect(() => {
    setPhoneKeys((current) => {
      if (current.length === phoneValues.length) return current;
      if (current.length > phoneValues.length) return current.slice(0, phoneValues.length);
      return [...current, ...phoneValues.slice(current.length).map((_, i) => `phone-new-${Date.now()}-${current.length + i}`)];
    });
  }, [phoneValues]);
  const addPhoneRow = () => {
    setPhoneKeys((current) => [...current, `phone-new-${Date.now()}-${current.length}`]);
    form.setValue('phoneNumbers', [...phoneValues, ''], { shouldDirty: true, shouldValidate: true });
  };
  const removePhoneRow = (index: number) => {
    setPhoneKeys((current) => current.filter((_, i) => i !== index));
    const nextPhones = phoneValues.filter((__, phoneIndex) => phoneIndex !== index);
    form.setValue('phoneNumbers', nextPhones.length > 0 ? nextPhones : [''], {
      shouldDirty: true,
      shouldValidate: true,
    });
  };
  const activeSources = (data.sources ?? []).filter((source: any) => source.isActive !== false);
  const phoneNumbersMessage = typeof form.formState.errors.phoneNumbers?.message === 'string'
    ? form.formState.errors.phoneNumbers.message as TranslationKey
    : null;

  return (
    <Form {...form}>
      <form
        className="grid grid-cols-1 gap-3 md:grid-cols-2"
        onSubmit={form.handleSubmit((values) => createLead.mutate(values))}
      >
        <FormField
          control={form.control}
          name="contactName"
          render={({ field }) => (
            <FormItem>
              <FormLabel required>{t('contactPersonName')}</FormLabel>
              <FormControl><Input {...field} placeholder={t('parentNamePlaceholder')} /></FormControl>
              <LocalizedFormMessage />
            </FormItem>
          )}
        />
        <div className="flex flex-col gap-3">
          {phoneValues.map((_, index) => (
            <FormField
              // Stable per-row ids: deleting a middle phone must not shift
              // input identity (focus/cursor jumps).
              key={phoneKeys[index] ?? `phone-fallback-${index}`}
              control={form.control}
              name={`phoneNumbers.${index}`}
              render={({ field }) => (
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
                      />
                    </FormControl>
                    {phoneValues.length > 1 ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={t('removePhone')}
                        onClick={() => removePhoneRow(index)}
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
          <Button type="button" variant="outline" size="sm" className="w-fit" onClick={addPhoneRow}>
            <Plus data-icon="inline-start" />
            {t('addPhone')}
          </Button>
        </div>
        <FormField
          control={form.control}
          name="sourceId"
          render={({ field }) => (
            <FormItem>
              <FormLabel required>{t('source')}</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl><SelectTrigger><SelectValue placeholder={t('selectSource')} /></SelectTrigger></FormControl>
                <SelectContent>
                  <SelectGroup>
                    {activeSources.map((source: any) => (
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
          control={form.control}
          name="managerId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('responsibleManager')}</FormLabel>
              <Select
                value={field.value}
                onValueChange={field.onChange}
                disabled={managerSelectDisabled || createLead.isPending}
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
              <LocalizedFormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
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
                    <SelectItem value="en">{t('english')}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <LocalizedFormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="comment"
          render={({ field }) => (
            <FormItem className="md:col-span-2">
              <FormLabel>{t('comment')}</FormLabel>
              <FormControl><Input {...field} placeholder={t('commentPlaceholder')} /></FormControl>
              <LocalizedFormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end md:col-span-2">
          <Button type="submit" disabled={createLead.isPending}>
            <Plus data-icon="inline-start" />
            {createLead.isPending ? t('saving') : t('createLead')}
          </Button>
        </div>
      </form>
    </Form>
  );
}
