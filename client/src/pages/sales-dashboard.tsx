import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { apiRequest } from '@/lib/queryClient';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { StudentDetailSheet } from '@/components/ux/StudentDetailSheet';
import { PageHeader } from '@/components/ux/PageHeader';
import { DashboardCharts } from '@/components/ux/DashboardCharts';
import {
  ACTIVE_PIPELINE_STATUSES,
  LEAD_STATUSES,
} from '@shared/academy';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  GraduationCap,
  Megaphone,
  Percent,
  Plus,
  Search,
  TrendingUp,
  UserCheck,
} from 'lucide-react';

type SalesTab = 'leads' | 'pipeline' | 'students' | 'tasks';

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-slate-500">{label}</Label>
      {children}
    </div>
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

export default function SalesDashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const urlParams = new URLSearchParams(window.location.search);
  const urlTab = urlParams.get('tab') as SalesTab | null;
  const [activeTab, setActiveTab] = useState<SalesTab>(urlTab || 'leads');

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
  const [leadForm, setLeadForm] = useState({
    contactName: '',
    phone: '',
    messenger: '',
    studentName: '',
    studentAge: '',
    courseId: '',
    sourceId: '',
    comment: '',
    language: 'ru',
  });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [studentSheetOpen, setStudentSheetOpen] = useState(false);

  const { data, isLoading } = useQuery<any>({
    queryKey: ['/api/academy/workspaces/sales'],
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['/api/academy/workspaces/sales'] });

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

  const filteredLeads = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return myLeads.filter((lead) => {
      const matchesSearch = !normalized ||
        [lead.contactName, lead.studentName, lead.phone, lead.messenger]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalized));
      const matchesStatus = statusFilter === 'all' || lead.statusCode === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [myLeads, search, statusFilter]);

  const managerStats = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const newLeadsWeek = myLeads.filter((lead) => new Date(lead.createdAt) >= weekAgo).length;
    const activeLeads = myLeads.filter((lead) => ACTIVE_PIPELINE_STATUSES.includes(lead.statusCode as any)).length;
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
    mutationFn: () => apiRequest('POST', '/api/academy/leads', {
      ...leadForm,
      studentAge: leadForm.studentAge ? Number(leadForm.studentAge) : undefined,
      courseId: leadForm.courseId ? Number(leadForm.courseId) : undefined,
      sourceId: leadForm.sourceId ? Number(leadForm.sourceId) : undefined,
      managerId: user?.id,
    }),
    onSuccess: () => {
      toast({ title: t('leadCreated'), description: t('leadCreatedDesc') });
      setLeadForm({ contactName: '', phone: '', messenger: '', studentName: '', studentAge: '', courseId: '', sourceId: '', comment: '', language: 'ru' });
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

  const handleTabChange = (tab: string) => {
    setActiveTab(tab as SalesTab);
    const params = new URLSearchParams(window.location.search);
    params.set('tab', tab);
    setLocation(`/sales?${params.toString()}`, { replace: true });
  };

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

  if (isLoading || !data) {
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

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader
        title={`${t('welcome')}, ${user?.fullName || t('manager')}!`}
        subtitle={t('salesManagerWorkspace')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setLeadDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />{t('lead')}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard title={t('myNewLeadsWeek')} value={managerStats.newLeadsWeek} detail={t('last7Days')} icon={Megaphone} tone="blue" />
        <KpiCard title={t('activeMyLeads')} value={managerStats.activeLeads} detail={t('inSalesPipeline')} icon={UserCheck} tone="amber" />
        <KpiCard title={t('myStudents')} value={managerStats.totalStudents} detail={t('assignedToMe')} icon={GraduationCap} tone="green" />
        <KpiCard title={t('myConversion')} value={`${managerStats.conversionRate}%`} detail={t('paidOverAllLeads')} icon={Percent} tone={managerStats.conversionRate >= 30 ? 'green' : managerStats.conversionRate >= 15 ? 'amber' : 'red'} />
        <KpiCard title={t('overdueTasks')} value={managerStats.overdueTasks} detail={managerStats.overdueTasks > 0 ? t('needsAttention') : t('allOnTime')} icon={AlertCircle} tone={managerStats.overdueTasks > 0 ? 'red' : 'green'} />
      </div>

      <div className="mt-6">
        <DashboardCharts
          payments={[]}
          funnel={managerFunnel}
          analytics={{
            summary: {
              newLeadsWeek: managerStats.newLeadsWeek,
            },
          }}
          leadStatusName={leadStatusName}
          statusColor={statusColor}
          money={money}
        />
      </div>

      <div className="mt-6">
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="mb-4">
            <TabsTrigger value="leads">{t('myLeads')}</TabsTrigger>
            <TabsTrigger value="pipeline">{t('pipeline')}</TabsTrigger>
            <TabsTrigger value="students">{t('myStudents')}</TabsTrigger>
            <TabsTrigger value="tasks">{t('myTasks')}</TabsTrigger>
          </TabsList>
          <TabsContent value="leads" className="mt-0">
            <LeadsTab
              t={t}
              leadStatusName={leadStatusName}
              statusColor={statusColor}
              dateOnly={dateOnly}
              filteredLeads={filteredLeads}
              search={search}
              setSearch={setSearch}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              setLeadDialogOpen={setLeadDialogOpen}
              updateLead={updateLead}
            />
          </TabsContent>
          <TabsContent value="pipeline" className="mt-0">
            <PipelineTab
              t={t}
              leadStatusName={leadStatusName}
              filteredLeads={filteredLeads}
              activePipelineStatuses={activePipelineStatuses}
              updateLead={updateLead}
              setLeadDialogOpen={setLeadDialogOpen}
            />
          </TabsContent>
          <TabsContent value="students" className="mt-0">
            <StudentsTab
              t={t}
              myStudents={myStudents}
              paymentStatusName={paymentStatusName}
              dateTime={dateTime}
              setSelectedStudent={setSelectedStudent}
              setStudentSheetOpen={setStudentSheetOpen}
              data={data}
              selectedStudent={selectedStudent}
              studentSheetOpen={studentSheetOpen}
            />
          </TabsContent>
          <TabsContent value="tasks" className="mt-0">
            <TasksTab
              t={t}
              myTasks={myTasks}
              updateTask={updateTask}
              dateTime={dateTime}
            />
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={leadDialogOpen} onOpenChange={setLeadDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('newApplication')}</DialogTitle>
            <DialogDescription className="sr-only">{t('formCreation')} {t('newApplication')}</DialogDescription>
          </DialogHeader>
          <LeadForm
            t={t}
            leadForm={leadForm}
            setLeadForm={setLeadForm}
            createLead={createLead}
            data={data}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
// ---- Sub-components for tabs ----

function LeadsTab({
  t,
  leadStatusName,
  statusColor,
  dateOnly,
  filteredLeads,
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  setLeadDialogOpen,
  updateLead,
}: {
  t: (key: TranslationKey) => string;
  leadStatusName: (code: string) => string;
  statusColor: (code: string) => string;
  dateOnly: (v: string | null | undefined) => string;
  filteredLeads: Lead[];
  search: string;
  setSearch: (v: string) => void;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  setLeadDialogOpen: (v: boolean) => void;
  updateLead: any;
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
      render: (lead: Lead) => (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" className="h-7 text-xs"
            onClick={() => updateLead.mutate({ id: lead.id, payload: { statusCode: 'qualified' } })}>
            {t('qualify')}
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs"
            onClick={() => updateLead.mutate({ id: lead.id, payload: { statusCode: 'not_now', warmReason: t('notNow') } })}>
            {t('toWarm')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <Card className="hover-lift">
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 pb-4">
          <CardTitle>{t('myLeads')}</CardTitle>
          <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center">
            <div className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <Input className="pl-9" placeholder={t('searchByNamePhone')} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48"><SelectValue placeholder={t('status')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allStatuses')}</SelectItem>
                {LEAD_STATUSES.map((status) => (
                  <SelectItem key={status.code} value={status.code}>{leadStatusName(status.code)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => setLeadDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />{t('newApplication')}
            </Button>
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
          />
        </CardContent>
      </Card>
    </div>
  );
}

function PipelineTab({
  t,
  leadStatusName,
  filteredLeads,
  activePipelineStatuses,
  updateLead,
  setLeadDialogOpen,
}: {
  t: (key: TranslationKey) => string;
  leadStatusName: (code: string) => string;
  filteredLeads: Lead[];
  activePipelineStatuses: readonly (typeof LEAD_STATUSES)[number][];
  updateLead: any;
  setLeadDialogOpen: (v: boolean) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-slate-900">{t('salesPipeline')}</h2>
        <Button onClick={() => setLeadDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />{t('newApplication')}
        </Button>
      </div>
      <KanbanBoard
        statuses={activePipelineStatuses.map((status) => ({
          code: status.code,
          name: leadStatusName(status.code),
          color: status.color,
          sortOrder: status.sortOrder,
        }))}
        leads={filteredLeads.map((lead) => ({
          ...lead,
          statusCode: lead.statusCode,
        }))}
        onStatusChange={(leadId: number, statusCode: string) => updateLead.mutate({ id: leadId, payload: { statusCode } })}
        onQuickAction={(action: string, lead: any) => {
          if (action === 'qualify') updateLead.mutate({ id: lead.id, payload: { statusCode: 'qualified' } });
          if (action === 'warm') updateLead.mutate({ id: lead.id, payload: { statusCode: 'not_now', warmReason: t('notNow') } });
        }}
        isPending={updateLead.isPending}
        showPaymentAction={false}
      />
    </div>
  );
}

function StudentsTab({
  t,
  myStudents,
  paymentStatusName,
  dateTime,
  setSelectedStudent,
  setStudentSheetOpen,
  data,
  selectedStudent,
  studentSheetOpen,
}: {
  t: (key: TranslationKey) => string;
  myStudents: Student[];
  paymentStatusName: (code: string | null | undefined) => string;
  dateTime: (v: string | null | undefined) => string;
  setSelectedStudent: (s: Student | null) => void;
  setStudentSheetOpen: (v: boolean) => void;
  data: any;
  selectedStudent: Student | null;
  studentSheetOpen: boolean;
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
        return (
          <Badge variant={isOverdue ? 'destructive' : student.status === 'studying' ? 'default' : 'outline'}>
            {isOverdue ? t('paymentStatusOverdue') : paymentStatusName(student.status)}
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
                <EmptyState title={t('noStudentsYet')} text={t('noStudentsYetDesc')} icon={GraduationCap} />
              </div>
            }
            onRowClick={(student: Student) => {
              setSelectedStudent(student);
              setStudentSheetOpen(true);
            }}
          />
        </CardContent>
      </Card>
      <StudentDetailSheet
        student={selectedStudent}
        open={studentSheetOpen}
        onOpenChange={setStudentSheetOpen}
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
}: {
  t: (key: TranslationKey) => string;
  myTasks: Task[];
  updateTask: any;
  dateTime: (v: string | null | undefined) => string;
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
                      {task.status === 'done' ? t('taskDone') : isOverdue ? t('taskOverdue') : t('taskInProgress')}
                    </Badge>
                    {task.status !== 'done' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => updateTask.mutate({ id: task.id, payload: { status: 'done' } })}
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
                    <span className="text-xs text-slate-400">{task.entityType} #{task.entityId}</span>
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
  leadForm,
  setLeadForm,
  createLead,
  data,
}: {
  t: (key: TranslationKey) => string;
  leadForm: any;
  setLeadForm: any;
  createLead: any;
  data: any;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <Field label={t('contactPersonName')}>
        <Input
          value={leadForm.contactName}
          onChange={(e) => setLeadForm({ ...leadForm, contactName: e.target.value })}
          placeholder={t('parentNamePlaceholder')}
        />
      </Field>
      <Field label={t('phone')}>
        <Input
          value={leadForm.phone}
          onChange={(e) => setLeadForm({ ...leadForm, phone: e.target.value })}
          placeholder="+998..."
        />
      </Field>
      <Field label={t('telegramWhatsapp')}>
        <Input
          value={leadForm.messenger}
          onChange={(e) => setLeadForm({ ...leadForm, messenger: e.target.value })}
          placeholder="@username"
        />
      </Field>
      <Field label={t('studentName')}>
        <Input
          value={leadForm.studentName}
          onChange={(e) => setLeadForm({ ...leadForm, studentName: e.target.value })}
          placeholder={t('studentNamePlaceholder')}
        />
      </Field>
      <Field label={t('age')}>
        <Input
          type="number"
          value={leadForm.studentAge}
          onChange={(e) => setLeadForm({ ...leadForm, studentAge: e.target.value })}
        />
      </Field>
      <Field label={t('course')}>
        <Select value={leadForm.courseId} onValueChange={(courseId: string) => setLeadForm({ ...leadForm, courseId })}>
          <SelectTrigger><SelectValue placeholder={t('autoByAgeOrManual')} /></SelectTrigger>
          <SelectContent>
            {(data.courses ?? []).map((course: any) => (
              <SelectItem key={course.id} value={String(course.id)}>{course.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label={t('source')}>
        <Select value={leadForm.sourceId} onValueChange={(sourceId: string) => setLeadForm({ ...leadForm, sourceId })}>
          <SelectTrigger><SelectValue placeholder={t('selectSource')} /></SelectTrigger>
          <SelectContent>
            {(data.sources ?? []).map((source: any) => (
              <SelectItem key={source.id} value={String(source.id)}>{source.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label={t('communicationLanguage')}>
        <Select value={leadForm.language} onValueChange={(language: string) => setLeadForm({ ...leadForm, language })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ru">{t('russianLang')}</SelectItem>
            <SelectItem value="uz">{t('uzbekLang')}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <div className="md:col-span-2">
        <Field label={t('comment')}>
          <Input
            value={leadForm.comment}
            onChange={(e) => setLeadForm({ ...leadForm, comment: e.target.value })}
            placeholder={t('commentPlaceholder')}
          />
        </Field>
      </div>
      <div className="md:col-span-2 flex justify-end">
        <Button
          onClick={() => createLead.mutate()}
          disabled={createLead.isPending || !leadForm.contactName || !leadForm.phone}
        >
          <Plus className="h-4 w-4 mr-2" />{t('createLead')}
        </Button>
      </div>
    </div>
  );
}
