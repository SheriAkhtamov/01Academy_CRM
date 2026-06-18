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
import {
  UnsavedChangesDialog,
  useUnsavedChangesGuard,
} from '@/components/ux/UnsavedChangesGuard';
import {
  ACTIVE_PIPELINE_STATUSES,
  LEAD_STATUSES,
} from '@shared/academy';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  GraduationCap,
  Megaphone,
  Percent,
  Plus,
  TrendingUp,
  UserCheck,
} from 'lucide-react';

type SalesSection = 'overview' | 'leads' | 'pipeline' | 'students' | 'tasks';
type LeadSheetTab = 'deal' | 'activity' | 'payment' | 'tasks';
type QuickAction = 'qualify' | 'warm' | 'payment' | 'call' | 'message';

interface Lead {
  id: number;
  contactName: string;
  phone: string;
  messenger?: string;
  studentName?: string;
  studentAge?: number;
  courseId?: number;
  courseName?: string;
  sourceId?: number;
  sourceName?: string;
  statusCode: string;
  managerId?: number;
  managerName?: string;
  comment?: string;
  createdAt: string;
  expectedPaymentUzs?: number;
  offerPriceUzs?: number;
  firstContactAt?: string;
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

const paymentStatusTranslationKeys: Record<string, TranslationKey> = {
  paid: 'paymentStatusPaid',
  pending: 'paymentStatusPending',
  overdue: 'paymentStatusOverdue',
};

const SALES_SECTION_PATHS: Record<SalesSection, string> = {
  overview: '/sales',
  leads: '/sales/leads',
  pipeline: '/sales/pipeline',
  students: '/sales/clients',
  tasks: '/sales/tasks',
};

const createLeadSchema = z.object({
  contactName: z.string().trim().min(1, 'fillRequiredFields'),
  phone: z.string().trim().min(7, 'invalidData'),
  messenger: z.string(),
  studentName: z.string(),
  studentAge: z.string().refine(
    (value) => value === '' || (Number.isFinite(Number(value)) && Number(value) > 0),
    'invalidData',
  ),
  courseId: z.string(),
  sourceId: z.string().min(1, 'fillRequiredFields'),
  comment: z.string(),
  language: z.string().min(1, 'fillRequiredFields'),
});

type CreateLeadFormValues = z.infer<typeof createLeadSchema>;

const EMPTY_LEAD_FORM: CreateLeadFormValues = {
  contactName: '',
  phone: '',
  messenger: '',
  studentName: '',
  studentAge: '',
  courseId: '',
  sourceId: '',
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
    <Card className="border-slate-200/70 hover-lift group">
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

export default function SalesDashboard({ section = 'overview' }: { section?: SalesSection }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const routeSearch = useSearch();
  const pagePath = SALES_SECTION_PATHS[section];

  const money = (value: number | string | null | undefined) =>
    `${Number(value || 0).toLocaleString('ru-RU')} ${t('uzs')}`;

  const dateTime = (value: string | null | undefined) => {
    if (!value) return t('noData');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t('noData');
    return date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
  };

  const dateOnly = (value: string | null | undefined) => {
    if (!value) return t('noData');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t('noData');
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  };

  const leadStatusName = (code: string) => {
    const key = leadStatusTranslationKeys[code];
    return key ? t(key) : code;
  };

  const paymentStatusName = (code: string | null | undefined) => {
    if (!code) return t('noData');
    const key = paymentStatusTranslationKeys[code];
    return key ? t(key) : code;
  };

  const [leadDialogOpen, setLeadDialogOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [leadSheetOpen, setLeadSheetOpen] = useState(false);
  const [leadSheetTab, setLeadSheetTab] = useState<LeadSheetTab>('deal');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [studentSheetOpen, setStudentSheetOpen] = useState(false);

  const { data, error, isError, isLoading, refetch } = useQuery<any>({
    queryKey: ['/api/academy/workspaces/sales'],
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['/api/academy/workspaces/sales'] });

  const leadForm = useForm<CreateLeadFormValues>({
    resolver: zodResolver(createLeadSchema),
    defaultValues: EMPTY_LEAD_FORM,
  });

  const myLeads = useMemo<Lead[]>(() => {
    if (!data?.leads) return [];
    return data.leads;
  }, [data?.leads]);

  const myStudents = useMemo<Student[]>(() => {
    if (!data?.students) return [];
    return data.students;
  }, [data?.students]);

  const myTasks = useMemo<Task[]>(() => {
    if (!data?.tasks) return [];
    return data.tasks;
  }, [data?.tasks]);

  const myPayments = useMemo<any[]>(() => {
    if (!data?.payments) return [];
    return data.payments;
  }, [data?.payments]);

  const filteredLeads = useMemo(() => {
    return myLeads.filter((lead) => {
      const matchesStatus = statusFilter === 'all' || lead.statusCode === statusFilter;
      const matchesSource = sourceFilter === 'all' || String(lead.sourceId) === sourceFilter;
      return matchesStatus && matchesSource;
    });
  }, [myLeads, sourceFilter, statusFilter]);

  const pipelineLeads = useMemo(
    () => myLeads.filter((lead) => ACTIVE_PIPELINE_STATUSES.includes(lead.statusCode as any)),
    [myLeads],
  );

  const managerStats = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const newLeadsWeek = myLeads.filter((lead) => new Date(lead.createdAt) >= weekAgo).length;
    const activeLeads = myLeads.filter(
      (lead) => lead.statusCode !== 'paid' && ACTIVE_PIPELINE_STATUSES.includes(lead.statusCode as any),
    ).length;
    const totalStudents = myStudents.length;

    const paidLeads = myLeads.filter((lead) => lead.statusCode === 'paid').length;
    const totalManagedLeads = myLeads.length;
    const conversionRate = totalManagedLeads > 0 ? Math.round((paidLeads / totalManagedLeads) * 100) : 0;

    const overdueTasks = myTasks.filter(
      (task) => task.status !== 'done' && task.deadlineAt && new Date(task.deadlineAt) < now
    ).length;

    return { newLeadsWeek, activeLeads, totalStudents, conversionRate, overdueTasks };
  }, [myLeads, myStudents, myTasks]);

  const activePipelineStatuses = LEAD_STATUSES.filter(
    (status) => ACTIVE_PIPELINE_STATUSES.includes(status.code as any)
  );

  const createLead = useMutation({
    mutationFn: (values: CreateLeadFormValues) => apiRequest('POST', '/api/academy/leads', {
      ...values,
      studentAge: values.studentAge ? Number(values.studentAge) : undefined,
      courseId: values.courseId ? Number(values.courseId) : undefined,
      sourceId: Number(values.sourceId),
      managerId: user?.id,
    }),
    onSuccess: () => {
      toast({ title: t('leadCreated'), description: t('leadCreatedDesc') });
      leadForm.reset(EMPTY_LEAD_FORM);
      setLeadDialogOpen(false);
      invalidate();
    },
    onError: (error: any) => toast({ title: t('leadCreateFailed'), description: error.message, variant: 'destructive' }),
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

  const updateTask = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      apiRequest('PATCH', `/api/academy/tasks/${id}`, payload),
    onSuccess: () => {
      toast({ title: t('taskUpdated') });
      invalidate();
    },
    onError: (error: any) => toast({ title: t('taskUpdateFailed'), description: error.message, variant: 'destructive' }),
  });

  const replaceSalesParams = useCallback((changes: Record<string, string | null>) => {
    const params = new URLSearchParams(routeSearch);
    Object.entries(changes).forEach(([key, value]) => {
      if (value === null) params.delete(key);
      else params.set(key, value);
    });
    const query = params.toString();
    setLocation(query ? `${pagePath}?${query}` : pagePath, { replace: true });
  }, [pagePath, routeSearch, setLocation]);

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
      window.location.href = `tel:${lead.phone.replace(/[^\d+]/g, '')}`;
      return;
    }
    if (action === 'message') {
      const href = lead.messenger?.startsWith('@')
        ? `https://t.me/${lead.messenger.slice(1)}`
        : `https://wa.me/${lead.phone.replace(/\D/g, '')}`;
      window.open(href, '_blank', 'noopener,noreferrer');
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
    if (action === 'warm') {
      updateLead.mutate({ id: lead.id, payload: { statusCode: 'not_now', warmReason: t('warmReasonDefault') } });
    }
  }, [openLead, t, updateLead]);

  const handleLeadDialogState = useCallback((open: boolean) => {
    setLeadDialogOpen(open);
    if (!open) leadForm.reset(EMPTY_LEAD_FORM);
  }, [leadForm]);
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
    overview: `${t('welcome')}, ${user?.fullName || t('manager')}!`,
    leads: t('myLeads'),
    pipeline: t('pipeline'),
    students: t('myStudents'),
    tasks: t('myTasks'),
  };

  return (
    <div className="mx-auto min-w-0 max-w-[1600px] overflow-x-clip p-6 lg:p-8">
      <PageHeader
        title={sectionTitle[section]}
        subtitle={t('salesManagerWorkspace')}
        breadcrumbs={[
          { label: t('navDashboard'), href: '/sales' },
          ...(section === 'overview' ? [] : [{ label: sectionTitle[section] }]),
        ]}
        actions={
          section === 'overview' || section === 'leads' || section === 'pipeline' ? (
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
            <KpiCard title={t('myNewLeadsWeek')} value={managerStats.newLeadsWeek} detail={t('last7Days')} icon={Megaphone} tone="blue" />
            <KpiCard title={t('activeMyLeads')} value={managerStats.activeLeads} detail={t('inSalesPipeline')} icon={UserCheck} tone="amber" />
            <KpiCard title={t('myStudents')} value={managerStats.totalStudents} detail={t('assignedToMe')} icon={GraduationCap} tone="green" />
            <KpiCard title={t('myConversion')} value={`${managerStats.conversionRate}%`} detail={t('paidOverAllLeads')} icon={Percent} tone={managerStats.conversionRate >= 30 ? 'green' : managerStats.conversionRate >= 15 ? 'amber' : 'red'} />
            <KpiCard title={t('overdueTasks')} value={managerStats.overdueTasks} detail={managerStats.overdueTasks > 0 ? t('needsAttention') : t('allOnTime')} icon={AlertCircle} tone={managerStats.overdueTasks > 0 ? 'red' : 'green'} />
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
          />
        </div>
      ) : null}

      {section === 'leads' ? (
        <LeadsTab
          t={t}
          leadStatusName={leadStatusName}
          statusColor={statusColor}
          dateOnly={dateOnly}
          filteredLeads={filteredLeads}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          sourceFilter={sourceFilter}
          setSourceFilter={setSourceFilter}
          sources={data.sources ?? []}
          openLead={openLead}
          onQuickAction={handleQuickAction}
        />
      ) : null}

      {section === 'pipeline' ? (
        <PipelineTab
          t={t}
          leadStatusName={leadStatusName}
          leads={pipelineLeads}
          activePipelineStatuses={activePipelineStatuses}
          onLeadClick={(lead) => openLead(lead.id)}
          onQuickAction={handleQuickAction}
          onStatusChange={async (leadId, statusCode) => {
            if (statusCode === 'paid') {
              openLead(leadId, 'payment');
              return false;
            }
            await updateLead.mutateAsync({ id: leadId, payload: { statusCode } });
            return true;
          }}
          isPending={updateLead.isPending}
        />
      ) : null}

      {section === 'students' ? (
        <StudentsTab
          t={t}
          myStudents={myStudents}
          paymentStatusName={paymentStatusName}
          dateTime={dateTime}
          data={data}
          selectedStudent={selectedStudent}
          studentSheetOpen={studentSheetOpen}
          openStudent={openStudent}
          openLead={openLead}
          onStudentSheetOpenChange={handleStudentSheetState}
        />
      ) : null}

      {section === 'tasks' ? (
        <TasksTab
          t={t}
          myTasks={myTasks}
          updateTask={updateTask}
          dateTime={dateTime}
          openLead={(leadId) => openLead(leadId, 'tasks')}
        />
      ) : null}

      <Dialog open={leadDialogOpen} onOpenChange={leadDialogGuard.handleOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('newApplication')}</DialogTitle>
            <DialogDescription className="sr-only">{t('formCreation')} {t('newApplication')}</DialogDescription>
          </DialogHeader>
          <LeadForm
            t={t}
            form={leadForm}
            createLead={createLead}
            data={data}
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
            <EmptyState title={t('noTasks')} text={t('noTasksAssigned')} icon={ClipboardList} />
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

function LeadsTab({
  t,
  leadStatusName,
  statusColor,
  dateOnly,
  filteredLeads,
  statusFilter,
  setStatusFilter,
  sourceFilter,
  setSourceFilter,
  sources,
  openLead,
  onQuickAction,
}: {
  t: (key: TranslationKey) => string;
  leadStatusName: (code: string) => string;
  statusColor: (code: string) => string;
  dateOnly: (v: string | null | undefined) => string;
  filteredLeads: Lead[];
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  sourceFilter: string;
  setSourceFilter: (v: string) => void;
  sources: Array<{ id: number; name: string }>;
  openLead: (leadId: number, tab?: LeadSheetTab) => void;
  onQuickAction: (action: QuickAction, lead: Lead) => void;
}) {
  const columns = [
    {
      key: 'contact',
      header: t('contact'),
      sortable: true,
      accessor: (lead: Lead) => lead.contactName,
      render: (lead: Lead) => {
        const firstContactOverdue = !lead.firstContactAt && lead.statusCode === 'new_request' &&
          Date.now() - new Date(lead.createdAt).getTime() > 15 * 60 * 1000;
        return (
          <div>
            <div className="font-medium text-slate-900">{lead.contactName}</div>
            <div className="text-xs text-slate-500">{lead.phone} {lead.messenger ? `• ${lead.messenger}` : ''}</div>
            {firstContactOverdue && (
              <div className="text-xs text-red-600 font-medium mt-0.5">{t('contactTime')} {t('waiting')}</div>
            )}
          </div>
        );
      },
    },
    {
      key: 'phone',
      header: t('phone'),
      sortable: true,
      accessor: (lead: Lead) => lead.phone,
      render: (lead: Lead) => <span className="text-slate-600 text-sm">{lead.phone}</span>,
      cellClassName: 'whitespace-nowrap',
    },
    {
      key: 'statusCode',
      header: t('status'),
      sortable: true,
      accessor: (lead: Lead) => leadStatusName(lead.statusCode),
      render: (lead: Lead) => (
        <Badge style={{ backgroundColor: statusColor(lead.statusCode), color: 'white' }}>
          {leadStatusName(lead.statusCode)}
        </Badge>
      ),
    },
    {
      key: 'courseId',
      header: t('course'),
      sortable: true,
      accessor: (lead: Lead) => lead.courseName,
      render: (lead: Lead) => <span className="text-slate-600">{lead.courseName || t('noData')}</span>,
    },
    {
      key: 'sourceId',
      header: t('source'),
      sortable: true,
      accessor: (lead: Lead) => lead.sourceName,
      render: (lead: Lead) => <span className="text-slate-600">{lead.sourceName || t('noData')}</span>,
    },
    {
      key: 'createdAt',
      header: t('created'),
      sortable: true,
      accessor: (lead: Lead) => lead.createdAt,
      render: (lead: Lead) => <span className="text-slate-500 text-sm">{dateOnly(lead.createdAt)}</span>,
      cellClassName: 'whitespace-nowrap',
    },
    {
      key: 'actions',
      header: t('actions'),
      render: (lead: Lead) => {
        const canQualify = lead.statusCode === 'new_request' || lead.statusCode === 'first_contact';
        const canMoveToWarmBase = lead.statusCode !== 'paid' && lead.statusCode !== 'not_now';
        return (
          <div className="flex flex-wrap gap-1.5">
            {canQualify ? (
              <Button size="sm" variant="outline" className="h-7 text-xs"
                onClick={(event) => {
                  event.stopPropagation();
                  onQuickAction('qualify', lead);
                }}>
                {t('qualify')}
              </Button>
            ) : null}
            <Button size="sm" variant="outline" className="h-7 text-xs"
              onClick={(event) => {
                event.stopPropagation();
                openLead(lead.id, 'payment');
              }}>
              <CreditCard data-icon="inline-start" />
              {t('payment')}
            </Button>
            {canMoveToWarmBase ? (
              <Button size="sm" variant="ghost" className="h-7 text-xs"
                onClick={(event) => {
                  event.stopPropagation();
                  onQuickAction('warm', lead);
                }}>
                {t('warmBase')}
              </Button>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-5">
      <Card className="hover-lift">
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 pb-4">
          <CardTitle>{t('myLeads')}</CardTitle>
          <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48"><SelectValue placeholder={t('status')} /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">{t('allStatuses')}</SelectItem>
                  {LEAD_STATUSES.map((status) => (
                    <SelectItem key={status.code} value={status.code}>{leadStatusName(status.code)}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="w-48"><SelectValue placeholder={t('source')} /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">{t('allSources')}</SelectItem>
                  {sources.map((source) => (
                    <SelectItem key={source.id} value={String(source.id)}>{source.name}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={filteredLeads}
            keyExtractor={(lead: Lead) => `lead-${lead.id}`}
            emptyState={
              <div className="p-8">
                <EmptyState title={t('noLeadsFound')} text={t('noLeadsFoundDesc')} />
              </div>
            }
            rowClassName={(lead: Lead) => {
              const firstContactOverdue = !lead.firstContactAt && lead.statusCode === 'new_request' &&
                Date.now() - new Date(lead.createdAt).getTime() > 15 * 60 * 1000;
              return firstContactOverdue ? 'bg-red-50/60' : '';
            }}
            onRowClick={(lead: Lead) => openLead(lead.id)}
          />
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
  onStatusChange,
  isPending,
}: {
  t: (key: TranslationKey) => string;
  leadStatusName: (code: string) => string;
  leads: Lead[];
  activePipelineStatuses: readonly (typeof LEAD_STATUSES)[number][];
  onLeadClick: (lead: Lead) => void;
  onQuickAction: (action: QuickAction, lead: Lead) => void;
  onStatusChange: (leadId: number, statusCode: string) => Promise<boolean>;
  isPending: boolean;
}) {
  return (
    <div className="space-y-5">
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
        onLeadClick={(lead) => onLeadClick(lead as Lead)}
        isPending={isPending}
        showPaymentAction
      />
    </div>
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
          <CardTitle>{t('myStudents')}</CardTitle>
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
}: {
  t: (key: TranslationKey) => string;
  myTasks: Task[];
  updateTask: any;
  dateTime: (v: string | null | undefined) => string;
  openLead: (leadId: number) => void;
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
          <CardTitle>{t('myTasks')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {sortedTasks.length === 0 && (
            <EmptyState title={t('noTasks')} text={t('noTasksAssigned')} icon={ClipboardList} />
          )}
          {sortedTasks.map((task) => {
            const isOverdue = task.deadlineAt && new Date(task.deadlineAt) < now && task.status !== 'done';
            return (
              <div
                key={task.id}
                className={`rounded-lg border p-3 transition-colors hover:border-slate-300 hover:bg-slate-50/50 ${
                  isOverdue ? 'border-red-200 bg-red-50/40' : 'border-slate-200/70'
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
}: {
  t: (key: TranslationKey) => string;
  form: UseFormReturn<CreateLeadFormValues>;
  createLead: any;
  data: any;
}) {
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
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('phone')}</FormLabel>
              <FormControl>
                <PhoneInput
                  ref={field.ref}
                  name={field.name}
                  value={field.value}
                  onBlur={field.onBlur}
                  onValueChange={field.onChange}
                />
              </FormControl>
              <LocalizedFormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="messenger"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('telegramWhatsapp')}</FormLabel>
              <FormControl><Input {...field} placeholder="@username" /></FormControl>
              <LocalizedFormMessage />
            </FormItem>
          )}
        />
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
              <Select value={field.value || 'auto'} onValueChange={(value) => field.onChange(value === 'auto' ? '' : value)}>
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
          name="sourceId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('source')}</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl><SelectTrigger><SelectValue placeholder={t('selectSource')} /></SelectTrigger></FormControl>
                <SelectContent>
                  <SelectGroup>
                    {(data.sources ?? []).map((source: any) => (
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
