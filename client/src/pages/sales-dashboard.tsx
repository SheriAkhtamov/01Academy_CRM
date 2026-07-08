import { useCallback, useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { useLocation, useSearch } from 'wouter';
import { z } from 'zod';
import { apiRequest } from '@/lib/queryClient';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { KanbanBoard } from '@/components/ux/KanbanBoard';
import { LeadDetailSheet } from '@/components/ux/LeadDetailSheet';
import { StudentDetailSheet } from '@/components/ux/StudentDetailSheet';
import { PageHeader } from '@/components/ux/PageHeader';
import { DashboardCharts } from '@/components/ux/DashboardCharts';
import { PhoneInput } from '@/components/ux/FormattedInputs';
import { SalesScheduleCalendar } from '@/components/ux/SalesScheduleCalendar';
import { ceoCopy } from '@/components/ui/ceo-copy';
import { isInstagramLead, leadContactSummary, leadMessageTarget, primaryVisibleLeadPhone } from '@/lib/leadContact';
import {
  UnsavedChangesDialog,
  useUnsavedChangesGuard,
} from '@/components/ux/UnsavedChangesGuard';
import {
  getAssignedWorkspaces,
  hasLeadershipAccess,
  LEAD_ARCHIVE_REASONS,
  LEAD_STATUSES,
} from '@shared/academy';
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  GraduationCap,
  Megaphone,
  Percent,
  Plus,
  RotateCcw,
  TrendingUp,
  Trash2,
  UserCheck,
} from 'lucide-react';

type SalesSection = 'overview' | 'pipeline' | 'archive' | 'schedule' | 'students' | 'tasks';
type LeadSheetTab = 'deal' | 'activity' | 'payment' | 'tasks';
type QuickAction = 'qualify' | 'payment' | 'call' | 'message';

interface Lead {
  id: number;
  contactName: string;
  phone?: string | null;
  phoneNumbers?: string[];
  messenger?: string | null;
  studentName?: string;
  studentAge?: number;
  courseId?: number;
  courseName?: string;
  schoolId?: number;
  schoolName?: string;
  sourceId?: number;
  sourceName?: string;
  sourceChannel?: string | null;
  statusCode: string;
  managerId?: number | null;
  managerName?: string | null;
  comment?: string;
  createdAt: string;
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
}

interface Student {
  id: number;
  leadId?: number;
  groupId?: number;
  groupName?: string;
  courseId?: number;
  courseName?: string;
  contactName: string;
  phone: string;
  studentName?: string;
  studentAge?: number;
  managerId?: number;
  managerName?: string;
  status: string;
  attendancePercent: number;
  progressPercent: number;
  satisfactionAvg: number;
  nextPaymentAt?: string;
  createdAt: string;
  paymentStatus?: string;
  riskFlags?: string[];
  referralCode?: string;
}

interface Task {
  id: number;
  title: string;
  description?: string;
  responsibleId?: number;
  responsibleName?: string;
  deadlineAt?: string;
  status: string;
  entityType?: string;
  entityId?: number;
  createdAt?: string;
}

const statusColor = (code: string) => LEAD_STATUSES.find((s) => s.code === code)?.color ?? '#64748b';

const leadStatusTranslationKeys: Record<string, TranslationKey> = {
  new_request: 'leadStatusNewRequest',
  first_contact: 'leadStatusFirstContact',
  qualified: 'leadStatusQualified',
  demo_invited: 'leadStatusDemoInvited',
  demo_attended: 'leadStatusDemoAttended',
  offer: 'leadStatusOffer',
  thinking: 'leadStatusThinking',
  enrolled: 'leadStatusEnrolled',
  paid: 'leadStatusPaid',
  not_now: 'leadStatusNotNow',
};

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
  tasks: '/sales/tasks',
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
const uniquePhoneNumbers = (values: string[]) => {
  const keys = values.map(phoneKey).filter(Boolean);
  return new Set(keys).size === keys.length;
};

const createLeadSchema = z.object({
  contactName: z.string().trim().min(1, 'fillRequiredFields'),
  phoneNumbers: z.array(optionalPhoneString).min(1).refine(uniquePhoneNumbers, 'duplicatePhoneInForm'),
  messenger: z.string(),
  studentName: z.string(),
  studentAge: z.string().refine(
    (value) => value === '' || (Number.isFinite(Number(value)) && Number(value) > 0),
    'invalidData',
  ),
  courseId: z.string(),
  enrolledGroupId: z.string(),
  sourceId: z.string().min(1, 'fillRequiredFields'),
  managerId: z.string().min(1, 'fillRequiredFields'),
  comment: z.string(),
  language: z.string().min(1, 'fillRequiredFields'),
});

type CreateLeadFormValues = z.infer<typeof createLeadSchema>;

const EMPTY_LEAD_FORM: CreateLeadFormValues = {
  contactName: '',
  phoneNumbers: [''],
  messenger: '',
  studentName: '',
  studentAge: '',
  courseId: '',
  enrolledGroupId: '',
  sourceId: '',
  managerId: '',
  comment: '',
  language: 'ru',
};

function KpiCard({ title, value, detail, icon: Icon, tone = 'blue' }: {
  title: string;
  value: string | number;
  detail?: string;
  icon: any;
  tone?: 'blue' | 'green' | 'amber' | 'red' | 'slate';
}) {
  const toneClass = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    slate: 'bg-slate-100 text-slate-600',
  }[tone];

  return (
    <Card className="border-border/70 hover-lift group">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-slate-500 truncate">{title}</p>
            <div className="mt-1.5 text-[26px] font-bold text-slate-900 leading-tight tracking-tight tabular-nums">{value}</div>
            {detail && <p className="mt-1 text-xs text-slate-400 truncate">{detail}</p>}
          </div>
          <div className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110 ${toneClass}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

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

function EmptyState({ title, text, icon: Icon = TrendingUp }: { title: string; text: string; icon?: any }) {
  return (
    <Card className="border-dashed">
      <CardContent className="py-14 px-6 text-center">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-slate-100 flex items-center justify-center">
          <Icon className="h-7 w-7 text-slate-400" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-slate-900">{title}</h3>
        <p className="mt-1 text-sm text-slate-500 max-w-sm mx-auto">{text}</p>
      </CardContent>
    </Card>
  );
}

function ArchiveLeadDialog({
  lead,
  reason,
  onReasonChange,
  onClose,
  onConfirm,
  isPending,
  t,
}: {
  lead: Lead | null;
  reason: string;
  onReasonChange: (reason: string) => void;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm" role="presentation" onMouseDown={() => !isPending && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="archive-lead-title"
        aria-describedby="archive-lead-description"
        className="w-full max-w-md rounded-xl border border-border/70 bg-background p-6 shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="space-y-1.5">
          <h2 id="archive-lead-title" className="text-lg font-semibold leading-none tracking-tight">{t('archiveLead')}</h2>
          <p id="archive-lead-description" className="text-sm text-muted-foreground">
            {lead.contactName ? `${lead.contactName}. ` : null}
            {t('archiveLeadDescription')}
          </p>
        </div>

        <div className="mt-4 space-y-4">
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
            <select
              id="archive-reason"
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
              disabled={isPending}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-2xs outline-none transition-[border-color,box-shadow,background-color] duration-200 hover:border-slate-400 focus:border-primary-500 focus:ring-4 focus:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="" disabled>{t('chooseArchiveReason')}</option>
              {LEAD_ARCHIVE_REASONS.map((archiveReason) => (
                <option key={archiveReason.code} value={archiveReason.code}>
                  {t(archiveReason.translationKey as TranslationKey)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (!reason) return;
                onConfirm(lead, needsManager);
              }}
              disabled={!reason || isPending}
            >
              {needsManager ? <UserCheck data-icon="inline-start" /> : <Archive data-icon="inline-start" />}
              {isPending ? t('saving') : needsManager ? t('assignToMeAndArchive') : t('sendToArchive')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SalesDashboard({ section = 'overview' }: { section?: SalesSection }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdministrationWorkspace = hasLeadershipAccess(user);
  const hasSalesModule = getAssignedWorkspaces(user).includes('sales');
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const routeSearch = useSearch();
  const pagePath = SALES_SECTION_PATHS[section];
  const riskFilter = new URLSearchParams(routeSearch).get('risk');

  const money = (value: number | string | null | undefined) =>
    `${Number(value || 0).toLocaleString('ru-RU')} ${t('uzs')}`;

  const dateTime = (value: string | null | undefined) => {
    if (!value) return t('noData');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t('noData');
    return date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
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

  const replaceSalesParams = useCallback((changes: Record<string, string | null>) => {
    const params = new URLSearchParams(routeSearch);
    Object.entries(changes).forEach(([key, value]) => {
      if (value === null) params.delete(key);
      else params.set(key, value);
    });
    const query = params.toString();
    setLocation(query ? `${pagePath}?${query}` : pagePath, { replace: true });
  }, [pagePath, routeSearch, setLocation]);

  const { data, error, isError, isLoading, refetch } = useQuery<any>({
    queryKey: ['/api/academy/workspaces/sales'],
  });
  const { data: users = [] } = useQuery<any[]>({
    queryKey: ['/api/users'],
  });

  const leadStatusName = (code: string) => {
    const key = leadStatusTranslationKeys[code];
    if (key) return t(key);
    return data?.statuses?.find((status: any) => status.code === code)?.name ?? code;
  };

  const archiveReasonName = (code: string | null | undefined) => {
    if (!code) return t('noData');
    const key = archiveReasonTranslationKeys[code];
    if (key) return t(key);
    return code;
  };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['/api/academy/workspaces/sales'] });
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
      return myStudents.filter((student) => Number(student.attendancePercent || 0) > 0
        && Number(student.attendancePercent || 0) < attendanceTarget);
    }
    return myStudents;
  }, [data?.constants?.targets?.attendance, myStudents, riskFilter]);

  const myTasks = useMemo<Task[]>(() => {
    if (!data?.tasks) return [];
    return data.tasks;
  }, [data?.tasks]);

  const myPayments = useMemo<any[]>(() => {
    if (!data?.payments) return [];
    return data.payments;
  }, [data?.payments]);

  const salesManagers = useMemo(
    () => users
      .filter((employee) => getAssignedWorkspaces(employee).includes('sales') && employee.isActive)
      .map((employee) => ({ id: employee.id, fullName: employee.fullName })),
    [users],
  );
  const leadManagerOptions = useMemo(() => {
    if (!currentSalesManagerId || !user?.fullName) return salesManagers;
    const currentUserListed = salesManagers.some((manager) => Number(manager.id) === Number(currentSalesManagerId));
    if (currentUserListed) return salesManagers;
    return [{ id: Number(currentSalesManagerId), fullName: user.fullName }, ...salesManagers];
  }, [currentSalesManagerId, salesManagers, user?.fullName]);

  const activePipelineStatuses = useMemo(
    () => [...(data?.statuses ?? [])]
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

  const managerStats = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const newLeadsWeek = myLeads.filter((lead) => new Date(lead.createdAt) >= weekAgo).length;
    const activeLeads = myLeads.filter(
      (lead) => lead.statusCode !== 'paid' && activePipelineCodes.has(lead.statusCode),
    ).length;
    const totalStudents = myStudents.length;

    const paidLeads = myLeads.filter((lead) => lead.statusCode === 'paid').length;
    const totalManagedLeads = myLeads.length;
    const conversionRate = totalManagedLeads > 0 ? Math.round((paidLeads / totalManagedLeads) * 100) : 0;

    const overdueTasks = myTasks.filter(
      (task) => task.status !== 'done' && task.deadlineAt && new Date(task.deadlineAt) < now
    ).length;

    return { newLeadsWeek, activeLeads, totalStudents, conversionRate, overdueTasks };
  }, [activePipelineCodes, myLeads, myStudents, myTasks]);

  const createLead = useMutation({
    mutationFn: (values: CreateLeadFormValues) => apiRequest('POST', '/api/academy/leads', {
      ...values,
      phoneNumbers: compactPhoneNumbers(values.phoneNumbers),
      studentAge: values.studentAge ? Number(values.studentAge) : undefined,
      courseId: values.courseId ? Number(values.courseId) : undefined,
      enrolledGroupId: values.enrolledGroupId ? Number(values.enrolledGroupId) : undefined,
      sourceId: Number(values.sourceId),
      managerId: values.managerId ? Number(values.managerId) : undefined,
    }),
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
      toast({ title: t('leadCreateFailed'), description: error.message, variant: 'destructive' });
    },
  });

  const updateLead = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      apiRequest('PATCH', `/api/academy/leads/${id}`, payload),
    onSuccess: () => {
      toast({ title: t('statusUpdated') });
      invalidate();
    },
    onError: (error: any) => toast({ title: t('statusNotUpdated'), description: error.message, variant: 'destructive' }),
  });

  const archiveLead = useMutation({
    mutationFn: ({ id, reason, assignToSelf }: { id: number; reason: string; assignToSelf?: boolean }) =>
      apiRequest('POST', `/api/academy/leads/${id}/archive`, { reason, assignToSelf }),
    onSuccess: (_lead, variables) => {
      toast({ title: variables.assignToSelf ? t('leadAssignedAndArchived') : t('leadArchived') });
      setArchiveDialogLead(null);
      setArchiveReason('');
      if (selectedLeadId === variables.id) {
        setLeadSheetOpen(false);
        setSelectedLeadId(null);
        replaceSalesParams({ lead: null });
      }
      invalidate();
    },
    onError: (error: any) => toast({ title: t('leadArchiveFailed'), description: error.message, variant: 'destructive' }),
  });

  const restoreLead = useMutation({
    mutationFn: ({ id, statusCode }: { id: number; statusCode: string }) =>
      apiRequest('POST', `/api/academy/leads/${id}/restore`, { statusCode }),
    onSuccess: () => {
      toast({ title: t('leadRestored') });
      invalidate();
    },
    onError: (error: any) => toast({ title: t('leadRestoreFailed'), description: error.message, variant: 'destructive' }),
  });

  const updateTask = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      apiRequest('PATCH', `/api/academy/tasks/${id}`, payload),
    onSuccess: () => {
      toast({ title: t('taskUpdated') });
      invalidate();
    },
    onError: (error: any) => toast({ title: t('taskUpdateFailed'), description: error.message, variant: 'destructive' }),
  });

  const updateStudentStatus = useMutation({
    mutationFn: ({ id, status, exitReason }: { id: number; status: string; exitReason?: string }) =>
      apiRequest('PATCH', `/api/academy/students/${id}/status`, { status, exitReason }),
    onSuccess: (student) => {
      toast({ title: ceoCopy.student.updated });
      setSelectedStudent((current) => current?.id === student.id ? { ...current, ...student } : current);
      invalidate();
    },
    onError: (error: Error) => toast({ title: ceoCopy.student.updateFailed, description: error.message, variant: 'destructive' }),
  });

  const openLead = useCallback((leadId: number, tab: LeadSheetTab = 'deal') => {
    setSelectedLeadId(leadId);
    setLeadSheetTab(tab);
    setLeadSheetOpen(true);
    replaceSalesParams({ lead: String(leadId), student: null });
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
    replaceSalesParams({ student: String(student.id), lead: null });
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
      window.location.href = `tel:${phone.replace(/[^\d+]/g, '')}`;
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
    if (action === 'qualify') {
      if (!lead.studentName || !lead.studentAge || !lead.courseId) {
        openLead(lead.id, 'deal');
        toast({ title: t('completeQualificationFields') });
        return;
      }
      updateLead.mutate({ id: lead.id, payload: { statusCode: 'qualified' } });
      return;
    }
  }, [openLead, setLocation, t, toast, updateLead]);

  const openArchiveDialog = useCallback((lead: Lead) => {
    setArchiveDialogLead(lead);
    setArchiveReason('');
  }, []);

  const handleArchiveDialogState = useCallback((open: boolean) => {
    if (!open) {
      setArchiveDialogLead(null);
      setArchiveReason('');
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
    const funnelMap: Record<string, number> = {};
    LEAD_STATUSES.forEach((status) => {
      funnelMap[status.code] = myLeads.filter((l) => l.statusCode === status.code).length;
    });
    return LEAD_STATUSES.filter((s) => funnelMap[s.code] > 0).map((status) => ({
      code: status.code,
      count: funnelMap[status.code],
      color: status.color,
    }));
  }, [myLeads]);

  if (isLoading) {
    return (
      <div className="p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-[1600px] p-6 lg:p-8">
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
      </div>
    );
  }

  const sectionTitle: Record<SalesSection, string> = {
    overview: isAdministrationWorkspace
      ? t('salesWorkspace')
      : `${t('welcome')}, ${user?.fullName || t('manager')}!`,
    pipeline: t('pipeline'),
    archive: t('leadArchive'),
    schedule: t('salesSchedule'),
    students: isAdministrationWorkspace ? t('allClients') : t('myStudents'),
    tasks: isAdministrationWorkspace ? t('allTasks') : t('myTasks'),
  };
  const salesWorkspaceDescription = isAdministrationWorkspace
    ? t('globalSalesWorkspaceDescription')
    : t('salesManagerWorkspace');
  const sectionSubtitle = section === 'schedule'
    ? t('salesScheduleSubtitle')
    : section === 'archive'
      ? t('leadArchiveDescription')
      : salesWorkspaceDescription;
  return (
    <div className="mx-auto min-w-0 max-w-[1600px] overflow-x-clip p-6 lg:p-8">
      <PageHeader
        title={sectionTitle[section]}
        subtitle={sectionSubtitle}
        breadcrumbs={[
          { label: t('salesWorkspace'), href: '/sales' },
          ...(section === 'overview' ? [] : [{ label: sectionTitle[section] }]),
        ]}
        actions={
          section === 'overview' || section === 'pipeline' ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setLeadDialogOpen(true)}>
                <Plus data-icon="inline-start" />{t('newApplication')}
              </Button>
            </div>
          ) : undefined
        }
      />

      {section === 'overview' ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
            <KpiCard title={isAdministrationWorkspace ? t('newLeadsWeek') : t('myNewLeadsWeek')} value={managerStats.newLeadsWeek} detail={t('last7Days')} icon={Megaphone} tone="blue" />
            <KpiCard title={isAdministrationWorkspace ? t('activeLeads') : t('activeMyLeads')} value={managerStats.activeLeads} detail={t('inSalesPipeline')} icon={UserCheck} tone="amber" />
            <KpiCard title={isAdministrationWorkspace ? t('allClients') : t('myStudents')} value={managerStats.totalStudents} detail={isAdministrationWorkspace ? t('allManagers') : t('assignedToMe')} icon={GraduationCap} tone="green" />
            <KpiCard title={isAdministrationWorkspace ? t('conversionRate') : t('myConversion')} value={`${managerStats.conversionRate}%`} detail={t('paidOverAllLeads')} icon={Percent} tone={managerStats.conversionRate >= 30 ? 'green' : managerStats.conversionRate >= 15 ? 'amber' : 'red'} />
            <KpiCard title={isAdministrationWorkspace ? t('allTasks') : t('overdueTasks')} value={managerStats.overdueTasks} detail={managerStats.overdueTasks > 0 ? t('needsAttention') : t('allOnTime')} icon={AlertCircle} tone={managerStats.overdueTasks > 0 ? 'red' : 'green'} />
          </div>
          <OverviewTab
            t={t}
            payments={myPayments.filter((payment) => payment.status === 'paid')}
            managerFunnel={managerFunnel}
            managerStats={managerStats}
            leadStatusName={leadStatusName}
            money={money}
            myTasks={myTasks}
            dateTime={dateTime}
            openLead={openLead}
            noTasksText={isAdministrationWorkspace ? t('noSalesTasks') : t('noTasksAssigned')}
          />
        </div>
      ) : null}

      {section === 'pipeline' ? (
        <PipelineTab
          t={t}
          leadStatusName={leadStatusName}
          leads={pipelineLeads}
          activePipelineStatuses={activePipelineStatuses}
          onLeadClick={(lead) => openLead(lead.id)}
          onQuickAction={handleQuickAction}
          onArchiveLead={openArchiveDialog}
          onStatusChange={async (leadId, statusCode) => {
            if (statusCode === 'paid') {
              openLead(leadId, 'payment');
              return false;
            }
            await updateLead.mutateAsync({ id: leadId, payload: { statusCode } });
            return true;
          }}
          isPending={updateLead.isPending}
          showManager={isAdministrationWorkspace}
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
          onUpdateStudentStatus={isAdministrationWorkspace
            ? (id, status, exitReason) => updateStudentStatus.mutateAsync({ id, status, exitReason })
            : undefined}
          title={riskFilter === 'overdue'
            ? ceoCopy.student.overdueStudents
            : riskFilter === 'low-attendance'
              ? ceoCopy.student.lowAttendanceStudents
              : sectionTitle.students}
          showManager={isAdministrationWorkspace}
        />
      ) : null}

      {section === 'tasks' ? (
        <TasksTab
          t={t}
          myTasks={myTasks}
          updateTask={updateTask}
          dateTime={dateTime}
          openLead={(leadId) => openLead(leadId, 'tasks')}
          title={sectionTitle.tasks}
          noTasksText={isAdministrationWorkspace ? t('noSalesTasks') : t('noTasksAssigned')}
          showResponsible={isAdministrationWorkspace}
        />
      ) : null}

      <ArchiveLeadDialog
        lead={archiveDialogLead}
        reason={archiveReason}
        onReasonChange={setArchiveReason}
        onClose={() => handleArchiveDialogState(false)}
        onConfirm={(lead, assignToSelf) => archiveLead.mutate({ id: lead.id, reason: archiveReason, assignToSelf })}
        isPending={archiveLead.isPending}
        t={t}
      />

      <Dialog open={leadDialogOpen} onOpenChange={leadDialogGuard.handleOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
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
            managerSelectDisabled={hasSalesModule && !isAdministrationWorkspace}
            duplicateHint={duplicateHint}
            onOpenDuplicate={(duplicate) => {
              const targetLeadId = duplicate.entityType === 'lead' ? duplicate.id : duplicate.leadId;
              if (!targetLeadId) return;
              setLeadDialogOpen(false);
              setDuplicateHint(null);
              leadForm.reset(leadFormDefaults);
              openLead(targetLeadId);
            }}
          />
        </DialogContent>
      </Dialog>
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
        groups={data.groups ?? []}
        sources={data.sources ?? []}
        statuses={data.statuses ?? []}
        managers={salesManagers}
        currentUserId={user?.id}
        leadStatusName={leadStatusName}
        dateTime={dateTime}
        money={money}
        onChanged={invalidate}
      />
    </div>
  );
}
// ---- Sub-components for tabs ----

function OverviewTab({
  t,
  payments,
  managerFunnel,
  managerStats,
  leadStatusName,
  money,
  myTasks,
  dateTime,
  openLead,
  noTasksText,
}: {
  t: (key: TranslationKey) => string;
  payments: any[];
  managerFunnel: Array<{ code: string; count: number; color: string }>;
  managerStats: {
    newLeadsWeek: number;
    activeLeads: number;
    totalStudents: number;
    conversionRate: number;
    overdueTasks: number;
  };
  leadStatusName: (code: string) => string;
  money: (value: number | string | null | undefined) => string;
  myTasks: Task[];
  dateTime: (value: string | null | undefined) => string;
  openLead: (leadId: number, tab?: LeadSheetTab) => void;
  noTasksText: string;
}) {
  const priorityTasks = myTasks
    .filter((task) => task.status !== 'done')
    .sort((a, b) => new Date(a.deadlineAt || 0).getTime() - new Date(b.deadlineAt || 0).getTime())
    .slice(0, 5);

  return (
    <div className="flex flex-col gap-5">
      <DashboardCharts
        payments={payments}
        funnel={managerFunnel}
        analytics={{ summary: { newLeadsWeek: managerStats.newLeadsWeek } }}
        leadStatusName={leadStatusName}
        statusColor={statusColor}
        money={money}
      />
      <Card>
        <CardHeader>
          <CardTitle>{t('priorityTasks')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {priorityTasks.length === 0 ? (
            <EmptyState title={t('noTasks')} text={noTasksText} icon={ClipboardList} />
          ) : (
            priorityTasks.map((task) => (
              <button
                key={task.id}
                type="button"
                className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-left enabled:hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                disabled={task.entityType !== 'lead' || !task.entityId}
                onClick={() => task.entityType === 'lead' && task.entityId ? openLead(task.entityId, 'tasks') : undefined}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{task.title}</span>
                  {task.deadlineAt ? <span className="block text-xs text-muted-foreground">{dateTime(task.deadlineAt)}</span> : null}
                </span>
                <Badge variant={task.deadlineAt && new Date(task.deadlineAt) < new Date() ? 'destructive' : 'outline'}>
                  {task.deadlineAt && new Date(task.deadlineAt) < new Date() ? t('paymentStatusOverdue') : t('taskInProgress')}
                </Badge>
              </button>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PipelineTab({
  t,
  leadStatusName,
  leads,
  activePipelineStatuses,
  onLeadClick,
  onQuickAction,
  onArchiveLead,
  onStatusChange,
  isPending,
  showManager,
}: {
  t: (key: TranslationKey) => string;
  leadStatusName: (code: string) => string;
  leads: Lead[];
  activePipelineStatuses: readonly (typeof LEAD_STATUSES)[number][];
  onLeadClick: (lead: Lead) => void;
  onQuickAction: (action: QuickAction, lead: Lead) => void;
  onArchiveLead: (lead: Lead) => void;
  onStatusChange: (leadId: number, statusCode: string) => Promise<boolean>;
  isPending: boolean;
  showManager: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <KanbanBoard
        statuses={activePipelineStatuses.map((status) => ({
          code: status.code,
          name: leadStatusName(status.code),
          color: status.color,
          sortOrder: status.sortOrder,
        }))}
        leads={leads.map((lead) => ({
          ...lead,
          statusCode: lead.statusCode,
        }))}
        onStatusChange={onStatusChange}
        onQuickAction={(action, lead) => onQuickAction(action, lead as Lead)}
        onArchiveLead={(lead) => onArchiveLead(lead as Lead)}
        onLeadClick={(lead) => onLeadClick(lead as Lead)}
        isPending={isPending}
        showPaymentAction
        showManager={showManager}
      />
    </div>
  );
}

function ArchiveTab({
  t,
  leads,
  activePipelineStatuses,
  leadStatusName,
  archiveReasonName,
  dateTime,
  onLeadClick,
  onRestore,
  isPending,
}: {
  t: (key: TranslationKey) => string;
  leads: Lead[];
  activePipelineStatuses: readonly (typeof LEAD_STATUSES)[number][];
  leadStatusName: (code: string) => string;
  archiveReasonName: (code: string | null | undefined) => string;
  dateTime: (v: string | null | undefined) => string;
  onLeadClick: (lead: Lead) => void;
  onRestore: (leadId: number, statusCode: string) => void;
  isPending: boolean;
}) {
  const columns = [
    {
      key: 'contactName',
      header: t('lead'),
      sortable: true,
      accessor: (lead: Lead) => lead.contactName,
      render: (lead: Lead) => (
        <div>
          <div className="font-medium text-slate-900">{lead.contactName}</div>
          <div className="text-xs text-slate-500">{leadContactSummary(lead, t('noData'))}</div>
        </div>
      ),
    },
    {
      key: 'statusCode',
      header: t('status'),
      sortable: true,
      accessor: (lead: Lead) => leadStatusName(lead.statusCode),
      render: (lead: Lead) => (
        <Badge variant="outline">{leadStatusName(lead.statusCode)}</Badge>
      ),
    },
    {
      key: 'managerName',
      header: t('manager'),
      sortable: true,
      accessor: (lead: Lead) => lead.managerName || t('noData'),
      render: (lead: Lead) => <span className="text-slate-600">{lead.managerName || t('noData')}</span>,
    },
    {
      key: 'archiveReason',
      header: t('archiveReason'),
      sortable: true,
      accessor: (lead: Lead) => archiveReasonName(lead.archiveReason),
      render: (lead: Lead) => <span className="text-slate-600">{archiveReasonName(lead.archiveReason)}</span>,
    },
    {
      key: 'archivedAt',
      header: t('archivedAt'),
      sortable: true,
      accessor: (lead: Lead) => lead.archivedAt,
      render: (lead: Lead) => (
        <div>
          <div className="text-slate-600">{dateTime(lead.archivedAt)}</div>
          {lead.archivedByName ? (
            <div className="text-xs text-slate-500">{t('archivedBy')} {lead.archivedByName}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'restore',
      header: t('actions'),
      render: (lead: Lead) => (
        <div
          className="flex justify-end"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" disabled={isPending || activePipelineStatuses.length === 0}>
                <RotateCcw data-icon="inline-start" />
                {t('restoreLead')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                {activePipelineStatuses.map((status) => (
                  <DropdownMenuItem
                    key={status.code}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRestore(lead.id, status.code);
                    }}
                    disabled={isPending}
                  >
                    {t('restoreToStage')} {leadStatusName(status.code)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  return (
    <Card className="hover-lift">
      <CardHeader className="pb-4">
        <CardTitle>{t('leadArchive')}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <DataTable
          columns={columns}
          data={leads}
          keyExtractor={(lead: Lead) => `archived-lead-${lead.id}`}
          emptyState={
            <div className="p-8">
              <EmptyState title={t('noArchivedLeads')} text={t('noArchivedLeadsDesc')} icon={Archive} />
            </div>
          }
          onRowClick={onLeadClick}
        />
      </CardContent>
    </Card>
  );
}

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
          <div className="font-medium text-slate-900">{student.studentName || student.contactName}</div>
          <div className="text-xs text-slate-500">{student.phone}</div>
        </div>
      ),
    },
    {
      key: 'groupId',
      header: t('group'),
      sortable: true,
      accessor: (student: Student) => student.groupName,
      render: (student: Student) => <span className="text-slate-600">{student.groupName || t('noGroup')}</span>,
    },
    {
      key: 'courseId',
      header: t('course'),
      sortable: true,
      accessor: (student: Student) => student.courseName,
      render: (student: Student) => <span className="text-slate-600">{student.courseName || t('noCourse')}</span>,
    },
    ...(showManager ? [{
      key: 'managerName',
      header: t('manager'),
      sortable: true,
      accessor: (student: Student) => student.managerName || t('noData'),
      render: (student: Student) => <span className="text-slate-600">{student.managerName || t('noData')}</span>,
    }] : []),
    {
      key: 'attendancePercent',
      header: t('attendanceLabel'),
      sortable: true,
      accessor: (student: Student) => student.attendancePercent,
      render: (student: Student) => (
        <div className="w-28">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-500">{student.attendancePercent}%</span>
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
            <span className="text-slate-500">{student.progressPercent}%</span>
          </div>
          <Progress value={student.progressPercent} />
        </div>
      ),
    },
    {
      key: 'paymentStatus',
      header: t('paymentStatus'),
      sortable: true,
      accessor: (student: Student) => student.paymentStatus || student.status,
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
    <div className="space-y-5">
      <Card className="hover-lift">
        <CardHeader className="pb-4">
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={myStudents}
            keyExtractor={(student: Student) => `student-${student.id}`}
            emptyState={
              <div className="p-8">
                <EmptyState title={t('noClientsYet')} text={t('noClientsYetDesc')} icon={UserCheck} />
              </div>
            }
            onRowClick={openStudent}
          />
        </CardContent>
      </Card>
      <StudentDetailSheet
        student={selectedStudent}
        open={studentSheetOpen}
        onOpenChange={onStudentSheetOpenChange}
        onRecordPayment={(leadId) => openLead(leadId, 'payment')}
        onUpdateStatus={onUpdateStudentStatus}
        data={{ projects: data.projects, payments: data.payments, referrals: data.referrals }}
        dateTime={dateTime}
      />
    </div>
  );
}

function TasksTab({
  t,
  myTasks,
  updateTask,
  dateTime,
  openLead,
  title,
  noTasksText,
  showResponsible,
}: {
  t: (key: TranslationKey) => string;
  myTasks: Task[];
  updateTask: any;
  dateTime: (v: string | null | undefined) => string;
  openLead: (leadId: number) => void;
  title: string;
  noTasksText: string;
  showResponsible: boolean;
}) {
  const now = new Date();
  const sortedTasks = [...myTasks].sort((a, b) => {
    const aOverdue = a.deadlineAt && new Date(a.deadlineAt) < now && a.status !== 'done';
    const bOverdue = b.deadlineAt && new Date(b.deadlineAt) < now && b.status !== 'done';
    if (aOverdue && !bOverdue) return -1;
    if (!aOverdue && bOverdue) return 1;
    return new Date(a.deadlineAt || 0).getTime() - new Date(b.deadlineAt || 0).getTime();
  });

  return (
    <div className="space-y-5">
      <Card className="hover-lift">
        <CardHeader className="pb-4">
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {sortedTasks.length === 0 && (
            <EmptyState title={t('noTasks')} text={noTasksText} icon={ClipboardList} />
          )}
          {sortedTasks.map((task) => {
            const isOverdue = task.deadlineAt && new Date(task.deadlineAt) < now && task.status !== 'done';
            return (
              <div
                key={task.id}
                className={`rounded-lg border p-3 transition-colors hover:border-border hover:bg-muted/50 ${
                  isOverdue ? 'border-destructive/30 bg-destructive/10' : 'border-border/70'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {task.status === 'done' ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                    ) : isOverdue ? (
                      <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                    ) : (
                      <ClipboardList className="h-4 w-4 text-slate-400 shrink-0" />
                    )}
                    <p className={`text-sm font-medium truncate ${task.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-900'}`}>
                      {task.title}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={task.status === 'done' ? 'secondary' : isOverdue ? 'destructive' : 'outline'}>
                      {task.status === 'done' ? t('taskDone') : isOverdue ? t('paymentStatusOverdue') : t('taskInProgress')}
                    </Badge>
                    {task.status !== 'done' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        disabled={updateTask.isPending}
                        onClick={() => updateTask.mutate({
                          id: task.id,
                          payload: { status: 'done', completedAt: new Date().toISOString() },
                        })}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />{t('completeTask')}
                      </Button>
                    )}
                  </div>
                </div>
                {task.description && (
                  <p className="mt-1 text-xs text-slate-500 ml-6">{task.description}</p>
                )}
                {showResponsible && task.responsibleName && (
                  <p className="mt-1 text-xs text-slate-500 ml-6">{t('managerLabel')} {task.responsibleName}</p>
                )}
                <div className="flex items-center gap-3 mt-1.5 ml-6">
                  {task.deadlineAt && (
                    <span className={`text-xs ${isOverdue ? 'text-red-600 font-medium' : 'text-slate-400'}`}>
                      {t('deadline')} {dateTime(task.deadlineAt)}
                    </span>
                  )}
                  {task.entityType && (
                    task.entityType === 'lead' && task.entityId ? (
                      <button
                        type="button"
                        className="text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => openLead(task.entityId!)}
                      >
                        {t('openLead')}
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">{task.entityType} #{task.entityId}</span>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
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
  duplicateHint,
  onOpenDuplicate,
}: {
  t: (key: TranslationKey) => string;
  form: UseFormReturn<CreateLeadFormValues>;
  createLead: any;
  data: any;
  managers: Array<{ id: number; fullName: string }>;
  managerSelectDisabled: boolean;
  duplicateHint: DuplicateClientHint | null;
  onOpenDuplicate: (duplicate: DuplicateClientHint) => void;
}) {
  const selectedCourseId = Number(form.watch('courseId')) || null;
  const selectedGroupId = form.watch('enrolledGroupId');
  const selectedSourceId = form.watch('sourceId');
  const phoneNumbers = form.watch('phoneNumbers') ?? [''];
  const phoneValues = phoneNumbers.length > 0 ? phoneNumbers : [''];
  const activeSources = (data.sources ?? []).filter((source: any) => source.isActive !== false);
  const selectedSource = activeSources.find((source: any) => String(source.id) === String(selectedSourceId));
  const availableGroups = (data.groups ?? []).filter((group: any) => {
    const occupied = Number(group.currentStudents || 0) + Number(group.reservedStudents || 0);
    const matchesCourse = !selectedCourseId || Number(group.courseId) === selectedCourseId;
    const hasSeat = occupied < Number(group.maxStudents || 12) || String(group.id) === selectedGroupId;
    return matchesCourse
      && hasSeat
      && ['open', 'in_progress'].includes(String(group.status));
  });
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
              <FormLabel>{t('contactPersonName')}</FormLabel>
              <FormControl><Input {...field} placeholder={t('parentNamePlaceholder')} /></FormControl>
              <LocalizedFormMessage />
            </FormItem>
          )}
        />
        <div className="flex flex-col gap-3">
          {phoneValues.map((_, index) => (
            <FormField
              key={index}
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
                        onClick={() => {
                          const nextPhones = phoneValues.filter((__, phoneIndex) => phoneIndex !== index);
                          form.setValue('phoneNumbers', nextPhones.length > 0 ? nextPhones : [''], {
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
              form.setValue('phoneNumbers', [...phoneValues, ''], {
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
          control={form.control}
          name="messenger"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{isInstagramLead({
                sourceName: selectedSource?.name,
                sourceChannel: selectedSource?.channel,
              }) ? t('instagramContactChannel') : t('telegramWhatsapp')}</FormLabel>
              <FormControl><Input {...field} placeholder="@username" /></FormControl>
              <LocalizedFormMessage />
            </FormItem>
          )}
        />
        {duplicateHint ? (
          <Alert variant="destructive" className="md:col-span-2">
            <AlertCircle />
            <AlertTitle>{t('clientAlreadyExists')}</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-3">
              <span>
                {[
                  duplicateHint.name,
                  duplicateHint.phoneNumbers?.[0] ?? duplicateHint.phone,
                  duplicateHint.managerName,
                ].filter(Boolean).join(' • ')}
              </span>
              {duplicateHint.entityType === 'lead' || duplicateHint.leadId ? (
                <Button type="button" size="sm" variant="outline" onClick={() => onOpenDuplicate(duplicateHint)}>
                  {t('openLead')}
                  <ExternalLink data-icon="inline-end" />
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
        <FormField
          control={form.control}
          name="studentName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('studentName')}</FormLabel>
              <FormControl><Input {...field} placeholder={t('studentNamePlaceholder')} /></FormControl>
              <LocalizedFormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="studentAge"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('age')}</FormLabel>
              <FormControl><Input {...field} type="number" min="1" /></FormControl>
              <LocalizedFormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="courseId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('course')}</FormLabel>
              <Select
                value={field.value || 'auto'}
                onValueChange={(value) => {
                  field.onChange(value === 'auto' ? '' : value);
                  form.setValue('enrolledGroupId', '');
                }}
              >
                <FormControl><SelectTrigger><SelectValue placeholder={t('autoByAgeOrManual')} /></SelectTrigger></FormControl>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="auto">{t('autoByAgeOrManual')}</SelectItem>
                    {(data.courses ?? []).map((course: any) => (
                      <SelectItem key={course.id} value={String(course.id)}>{course.name}</SelectItem>
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
          name="enrolledGroupId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('group')}</FormLabel>
              <Select
                value={field.value || 'none'}
                onValueChange={(value) => {
                  if (value === 'none') {
                    field.onChange('');
                    return;
                  }
                  field.onChange(value);
                  const group = (data.groups ?? []).find((item: any) => item.id === Number(value));
                  if (group?.courseId) form.setValue('courseId', String(group.courseId));
                }}
              >
                <FormControl><SelectTrigger><SelectValue placeholder={t('selectGroup')} /></SelectTrigger></FormControl>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="none">{t('notAssigned')}</SelectItem>
                    {availableGroups.map((group: any) => {
                      const occupied = Number(group.currentStudents || 0) + Number(group.reservedStudents || 0);
                      return (
                        <SelectItem key={group.id} value={String(group.id)}>
                          {group.name} · {occupied}/{group.maxStudents || 12}
                        </SelectItem>
                      );
                    })}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t('leadGroupAssignmentHint')}</p>
              <LocalizedFormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="sourceId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('source')}</FormLabel>
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
