import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable } from '@/components/ux/DataTable';
import { PageHeader } from '@/components/ux/PageHeader';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TARGET_ROAS } from '@shared/academy';
import {
  Megaphone,
  TrendingUp,
  TrendingDown,
  Users,
  DollarSign,
  Target,
  BarChart3,
  Flame,
  HeartHandshake,
  Wallet,
  FileText,
  Plus,
  ArrowRight,
  RotateCcw,
  Send,
  Calculator,
} from 'lucide-react';

function KpiCard({ title, value, detail, icon: Icon, tone = 'blue' }: {
  title: string;
  value: string | number;
  detail?: string;
  icon: any;
  tone?: 'blue' | 'green' | 'amber' | 'red' | 'slate' | 'purple';
}) {
  const toneClass = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    slate: 'bg-slate-100 text-slate-600',
    purple: 'bg-purple-50 text-purple-600',
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

function EmptyState({ title, text, icon: Icon = BarChart3 }: { title: string; text: string; icon?: any }) {
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

function RoasBadge({ value }: { value: number }) {
  if (value >= TARGET_ROAS) {
    return <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50 border-emerald-200">{value}x</Badge>;
  }
  if (value >= 1) {
    return <Badge className="bg-amber-50 text-amber-700 hover:bg-amber-50 border-amber-200">{value}x</Badge>;
  }
  return <Badge className="bg-red-50 text-red-700 hover:bg-red-50 border-red-200">{value}x</Badge>;
}

function ConversionBar({ label, value, total, color = '#2563eb' }: {
  label: string; value: number; total: number; color?: string;
}) {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span className="text-slate-600">{label}</span>
        <span className="font-medium text-slate-900">{value} <span className="text-slate-400">({percent}%)</span></span>
      </div>
      <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${percent}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

/* ─── main component ─── */
export default function MarketingWorkspace() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('sources');
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    sourceId: '',
    channel: '',
    campaignName: '',
    amountUzs: '',
    periodStart: '',
    periodEnd: '',
  });
  const [funnelSourceFilter, setFunnelSourceFilter] = useState('all');
  const [warmDateFilter, setWarmDateFilter] = useState('');
  const [expensePeriodFilter, setExpensePeriodFilter] = useState('');
  const [reportPreview, setReportPreview] = useState<string | null>(null);

  const money = (value: number | string | null | undefined) =>
    `${Number(value || 0).toLocaleString('ru-RU')}${t('uzs')}`;

  const dateOnly = (value: string | null | undefined) => {
    if (!value) return t('noData');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t('noData');
    return date.toLocaleDateString('ru-RU');
  };

  const { data, isLoading } = useQuery<any>({
    queryKey: ['/api/academy/workspaces/marketing'],
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['/api/academy/workspaces/marketing'] });

  const createExpense = useMutation({
    mutationFn: () => apiRequest('POST', '/api/academy/expenses', {
      ...expenseForm,
      sourceId: expenseForm.sourceId ? Number(expenseForm.sourceId) : undefined,
      amountUzs: Number(expenseForm.amountUzs),
    }),
    onSuccess: () => {
      toast({ title: t('expenseSaved') });
      setExpenseForm({ sourceId: '', channel: '', campaignName: '', amountUzs: '', periodStart: '', periodEnd: '' });
      setExpenseDialogOpen(false);
      invalidate();
    },
    onError: (error: any) => toast({ title: t('error'), description: error.message, variant: 'destructive' }),
  });

  const updateLead = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      apiRequest('PATCH', `/api/academy/leads/${id}`, payload),
    onSuccess: () => {
      toast({ title: t('success') });
      invalidate();
    },
    onError: (error: any) => toast({ title: t('error'), description: error.message, variant: 'destructive' }),
  });

  const sendWeeklyReport = useMutation({
    mutationFn: () => apiRequest('POST', '/api/academy/reports/weekly/test', { recipient: 'leadership' }),
    onSuccess: (result) => {
      toast({ title: t('testReportCreated'), description: result.preview?.split('\n')[0] });
      setReportPreview(result.preview || null);
    },
  });

  /* ─── derived data ─── */
  const analytics = data?.analytics;
  const bySource = analytics?.bySource ?? [];
  const funnel = analytics?.funnel ?? [];
  const sources = data?.sources ?? [];
  const leads = data?.leads ?? [];
  const expenses = data?.expenses ?? [];
  const referrals = data?.referrals ?? [];
  const students = data?.students ?? [];

  const warmLeads = useMemo(() => {
    return leads.filter((lead: any) => lead.statusCode === 'not_now');
  }, [leads]);

  const filteredWarmLeads = useMemo(() => {
    if (!warmDateFilter) return warmLeads;
    return warmLeads.filter((lead: any) =>
      String(lead.movedToWarmAt || lead.updatedAt || lead.createdAt).startsWith(warmDateFilter)
    );
  }, [warmLeads, warmDateFilter]);

  const filteredExpenses = useMemo(() => {
    if (!expensePeriodFilter) return expenses;
    return expenses.filter((exp: any) =>
      String(exp.periodStart || exp.createdAt).startsWith(expensePeriodFilter)
    );
  }, [expenses, expensePeriodFilter]);

  const referralStats = useMemo(() => {
    const totalReferrals = referrals.length;
    const paidReferrals = referrals.filter((r: any) => r.status === 'paid').length;
    const conversion = totalReferrals > 0 ? Math.round((paidReferrals / totalReferrals) * 100) : 0;
    return { totalReferrals, paidReferrals, conversion };
  }, [referrals]);

  const topReferrers = useMemo(() => {
    const map = new Map<number, any>();
    referrals.forEach((ref: any) => {
      const studentId = ref.referrerStudentId;
      if (!map.has(studentId)) {
        const student = students.find((s: any) => s.id === studentId);
        map.set(studentId, {
          studentId,
          studentName: student?.studentName || t('unknown'),
          code: ref.referralCode || '-',
          referred: 0,
          paid: 0,
        });
      }
      const entry = map.get(studentId);
      entry.referred += 1;
      if (ref.status === 'paid') entry.paid += 1;
    });
    return Array.from(map.values())
      .map((r: any) => ({
        ...r,
        level: r.paid >= 5 ? 'AI Ambassador' : r.paid >= 3 ? t('freeMonth') : r.paid >= 1 ? '15%' : '-',
      }))
      .sort((a: any, b: any) => b.referred - a.referred);
  }, [referrals, students, t]);

  /* ─── loading state ─── */
  if (isLoading || !data) {
    return (
      <div className="p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  const summary = analytics?.summary ?? {};

  /* ─── tab: sources ─── */
  const sourceColumns = [
    { key: 'sourceName', header: t('source'), accessor: (row: any) => row.sourceName, sortable: true },
    { key: 'leads', header: t('leadsColumn'), accessor: (row: any) => row.leads, sortable: true, cellClassName: 'tabular-nums' },
    { key: 'paidStudents', header: t('paidReferrals'), accessor: (row: any) => row.paidStudents, sortable: true, cellClassName: 'tabular-nums' },
    { key: 'revenue', header: t('revenueLabel'), accessor: (row: any) => money(row.revenue), sortable: true, cellClassName: 'tabular-nums' },
    { key: 'expenses', header: t('expenses'), accessor: (row: any) => money(row.expenses), sortable: true, cellClassName: 'tabular-nums' },
    { key: 'cpl', header: t('cplColumn'), accessor: (row: any) => money(row.cpl), sortable: true, cellClassName: 'tabular-nums' },
    { key: 'cac', header: t('cacLabel'), accessor: (row: any) => money(row.cac), sortable: true, cellClassName: 'tabular-nums' },
    {
      key: 'roas',
      header: 'ROAS',
      accessor: (row: any) => row.roas,
      render: (row: any) => <RoasBadge value={row.roas} />,
      sortable: true,
      cellClassName: 'tabular-nums',
    },
    { key: 'ltvCac', header: 'LTV:CAC', accessor: (row: any) => `${row.ltvCac}:1`, sortable: true, cellClassName: 'tabular-nums' },
  ];

  /* ─── tab: warm base ─── */
  const warmColumns = [
    { key: 'contactName', header: t('contactPersonName'), accessor: (row: any) => row.contactName, sortable: true },
    { key: 'phone', header: t('phone'), accessor: (row: any) => row.phone || '-', sortable: true },
    { key: 'courseName', header: t('course'), accessor: (row: any) => row.courseName || t('noCourse'), sortable: true },
    { key: 'movedAt', header: t('dateColumn'), accessor: (row: any) => dateOnly(row.movedToWarmAt || row.updatedAt), sortable: true },
    {
      key: 'reason',
      header: t('comment'),
      accessor: (row: any) => row.warmReason || row.comment || '-',
      sortable: true,
    },
    {
      key: 'actions',
      header: t('actions'),
      render: (row: any) => (
        <Button
          variant="outline"
          size="sm"
          onClick={() => updateLead.mutate({ id: row.id, payload: { statusCode: 'new_request' } })}
          disabled={updateLead.isPending}
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
          {t('returnTo')}
        </Button>
      ),
    },
  ];

  /* ─── tab: referrals ─── */
  const referralColumns = [
    { key: 'studentName', header: t('student'), accessor: (row: any) => row.studentName, sortable: true },
    { key: 'code', header: t('referralCodeLabel'), accessor: (row: any) => row.code, sortable: true },
    { key: 'referred', header: t('referralsTab'), accessor: (row: any) => row.referred, sortable: true, cellClassName: 'tabular-nums' },
    { key: 'paid', header: t('paidReferrals'), accessor: (row: any) => row.paid, sortable: true, cellClassName: 'tabular-nums' },
    {
      key: 'level',
      header: t('status'),
      accessor: (row: any) => row.level,
      render: (row: any) => (
        <Badge variant={row.level === 'AI Ambassador' ? 'default' : 'outline'}>{row.level}</Badge>
      ),
      sortable: true,
    },
  ];

  /* ─── tab: expenses ─── */
  const expenseColumns = [
    { key: 'channel', header: t('channel'), accessor: (row: any) => row.channel || '-', sortable: true },
    { key: 'campaignName', header: t('campaign'), accessor: (row: any) => row.campaignName || '-', sortable: true },
    {
      key: 'period',
      header: t('period'),
      accessor: (row: any) => `${dateOnly(row.periodStart)} – ${dateOnly(row.periodEnd)}`,
      sortable: true,
    },
    { key: 'amount', header: t('amount'), accessor: (row: any) => money(row.amountUzs), sortable: true, cellClassName: 'tabular-nums font-medium' },
  ];

  /* ─── funnel data ─── */
  const funnelData = useMemo(() => {
    if (funnelSourceFilter === 'all') return funnel;
    const sourceFunnel = analytics?.funnelBySource?.[funnelSourceFilter];
    return sourceFunnel || funnel;
  }, [funnel, funnelSourceFilter, analytics]);

  const funnelStages = [
    { code: 'new_request', label: t('leadStatusNewRequest'), color: '#2563eb' },
    { code: 'first_contact', label: t('leadStatusFirstContact'), color: '#0ea5e9' },
    { code: 'qualified', label: t('leadStatusQualified'), color: '#14b8a6' },
    { code: 'demo_invited', label: t('leadStatusDemoInvited'), color: '#8b5cf6' },
    { code: 'demo_attended', label: t('leadStatusDemoAttended'), color: '#a855f7' },
    { code: 'offer', label: t('leadStatusOffer'), color: '#f59e0b' },
    { code: 'thinking', label: t('leadStatusThinking'), color: '#f97316' },
    { code: 'paid', label: t('leadStatusPaid'), color: '#16a34a' },
  ];

  const avgDealCycle = summary.avgDealCycleDays ?? t('noData');

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
      <PageHeader
        title={t('marketingTab')}
        subtitle={t('channelsAndEfficiency')}
        actions={
          <Button onClick={() => setExpenseDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t('addExpense')}
          </Button>
        }
      />

      {/* ─── KPI cards ─── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        <div className="stagger-item">
          <KpiCard title={t('newLeadsMonth')} value={summary.newLeadsMonth ?? 0} icon={Users} tone="blue" />
        </div>
        <div className="stagger-item">
          <KpiCard title={t('weeklyLeads')} value={summary.newLeadsWeek ?? 0} icon={Megaphone} tone="blue" />
        </div>
        <div className="stagger-item">
          <KpiCard
            title={t('conversionApplicationToDemo')}
            value={`${summary.leadToDemoConversion ?? 0}%`}
            icon={TrendingUp}
            tone="green"
          />
        </div>
        <div className="stagger-item">
          <KpiCard
            title={t('conversionDemoToPayment')}
            value={`${summary.demoToPaidConversion ?? 0}%`}
            icon={TrendingDown}
            tone="green"
          />
        </div>
        <div className="stagger-item">
          <KpiCard title={t('cplLabel')} value={money(summary.cpl)} detail={t('cplTarget')} icon={Calculator} tone="amber" />
        </div>
        <div className="stagger-item">
          <KpiCard title={t('cacLabel')} value={money(summary.cac)} detail={t('cacTarget')} icon={DollarSign} tone="amber" />
        </div>
        <div className="stagger-item">
          <KpiCard title={t('roasLabel')} value={`${summary.roas ?? 0}x`} detail={t('roasTarget')} icon={Target} tone="purple" />
        </div>
        <div className="stagger-item">
          <KpiCard title={t('warmBaseSize')} value={summary.warmBaseSize ?? warmLeads.length} icon={Flame} tone="slate" />
        </div>
        <div className="stagger-item">
          <KpiCard
            title={t('warmReactivated')}
            value={summary.warmReactivated ?? 0}
            detail={t('reactivated')}
            icon={RotateCcw}
            tone="green"
          />
        </div>
      </div>

      {/* ─── Tabs ─── */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="w-full flex-wrap h-auto gap-1">
          <TabsTrigger value="sources">{t('leadSources')}</TabsTrigger>
          <TabsTrigger value="funnel">{t('conversionFunnel')}</TabsTrigger>
          <TabsTrigger value="warm">{t('warmBase')}</TabsTrigger>
          <TabsTrigger value="referrals">{t('referralsTab')}</TabsTrigger>
          <TabsTrigger value="expenses">{t('expenses')}</TabsTrigger>
          <TabsTrigger value="reports">{t('reports')}</TabsTrigger>
        </TabsList>

        {/* ─── Tab: Sources ─── */}
        <TabsContent value="sources" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <CardTitle>{t('marketingBySources')}</CardTitle>
              <Button size="sm" onClick={() => setExpenseDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                {t('addExpense')}
              </Button>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={sourceColumns}
                data={bySource}
                keyExtractor={(row) => String(row.sourceId)}
                emptyState={<EmptyState title={t('noData')} text={t('adjustSearchCriteria')} />}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Tab: Funnel ─── */}
        <TabsContent value="funnel" className="space-y-4">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            <Card className="xl:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between pb-4">
                <CardTitle>{t('conversionFunnel')}</CardTitle>
                <Select value={funnelSourceFilter} onValueChange={setFunnelSourceFilter}>
                  <SelectTrigger className="w-52">
                    <SelectValue placeholder={t('allSources')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('allSources')}</SelectItem>
                    {sources.map((source: any) => (
                      <SelectItem key={source.id} value={String(source.id)}>{source.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent className="space-y-4">
                {funnelStages.map((stage, index) => {
                  const item = funnelData.find((f: any) => f.code === stage.code);
                  const count = item?.count ?? 0;
                  const prevCount = index > 0
                    ? (funnelData.find((f: any) => f.code === funnelStages[index - 1].code)?.count ?? 1)
                    : count;
                  const conversion = index > 0 && prevCount > 0
                    ? Math.round((count / prevCount) * 100)
                    : 100;
                  const maxCount = Math.max(...funnelData.map((f: any) => f.count || 1), 1);

                  return (
                    <div key={stage.code} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="h-3 w-3 rounded-full" style={{ backgroundColor: stage.color }} />
                          <span className="text-sm font-medium text-slate-700">{stage.label}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-bold text-slate-900 tabular-nums">{count}</span>
                          {index > 0 && (
                            <Badge variant="outline" className="text-xs">
                              <ArrowRight className="h-3 w-3 mr-1" />
                              {conversion}%
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="h-4 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.max((count / maxCount) * 100, 3)}%`,
                            backgroundColor: stage.color,
                            opacity: 0.85,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-4">
                <CardTitle>{t('funnelMetrics')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="rounded-xl border border-slate-200/70 bg-slate-50/40 p-4 text-center">
                  <p className="text-sm text-slate-500">{t('avgDealCycle')}</p>
                  <p className="text-3xl font-bold text-slate-900 mt-1 tabular-nums">
                    {typeof avgDealCycle === 'number' ? `${avgDealCycle} ${t('days')}` : avgDealCycle}
                  </p>
                </div>

                <ConversionBar
                  label={t('conversionApplicationToDemo')}
                  value={summary.leadToDemoConversion ?? 0}
                  total={100}
                  color="#8b5cf6"
                />
                <ConversionBar
                  label={t('conversionDemoToPayment')}
                  value={summary.demoToPaidConversion ?? 0}
                  total={100}
                  color="#16a34a"
                />
                <ConversionBar
                  label={t('leadToPaidConversion')}
                  value={summary.leadToPaidConversion ?? 0}
                  total={100}
                  color="#2563eb"
                />

                <div className="pt-3 border-t border-slate-100 space-y-2.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t('cplLabel')}</span>
                    <strong className="text-slate-900 tabular-nums">{money(summary.cpl)}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t('cacLabel')}</span>
                    <strong className="text-slate-900 tabular-nums">{money(summary.cac)}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t('roasLabel')}</span>
                    <strong className="text-emerald-600 tabular-nums">{summary.roas}x</strong>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ─── Tab: Warm Base ─── */}
        <TabsContent value="warm" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <CardTitle>{t('warmBase')}</CardTitle>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={warmDateFilter}
                  onChange={(e) => setWarmDateFilter(e.target.value)}
                  className="w-40"
                />
                <Button variant="outline" size="sm" onClick={() => setWarmDateFilter('')}>
                  {t('reset')}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={warmColumns}
                data={filteredWarmLeads}
                keyExtractor={(row) => String(row.id)}
                emptyState={<EmptyState title={t('noData')} text={t('noLeadsFoundDesc')} icon={Flame} />}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Tab: Referrals ─── */}
        <TabsContent value="referrals" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-500">{t('totalReferrals')}</p>
                    <p className="text-2xl font-bold text-slate-900 tabular-nums">{referralStats.totalReferrals}</p>
                  </div>
                  <div className="h-11 w-11 rounded-xl bg-blue-50 flex items-center justify-center">
                    <Users className="h-5 w-5 text-blue-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-500">{t('paidReferrals')}</p>
                    <p className="text-2xl font-bold text-slate-900 tabular-nums">{referralStats.paidReferrals}</p>
                  </div>
                  <div className="h-11 w-11 rounded-xl bg-emerald-50 flex items-center justify-center">
                    <HeartHandshake className="h-5 w-5 text-emerald-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-500">{t('conversionRate')}</p>
                    <p className="text-2xl font-bold text-slate-900 tabular-nums">{referralStats.conversion}%</p>
                  </div>
                  <div className="h-11 w-11 rounded-xl bg-purple-50 flex items-center justify-center">
                    <TrendingUp className="h-5 w-5 text-purple-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle>{t('topReferrers')}</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={referralColumns}
                data={topReferrers}
                keyExtractor={(row) => String(row.studentId)}
                emptyState={<EmptyState title={t('noData')} text={t('noStudentsYetDesc')} icon={HeartHandshake} />}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Tab: Expenses ─── */}
        <TabsContent value="expenses" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <CardTitle>{t('expenses')}</CardTitle>
              <div className="flex items-center gap-2">
                <Input
                  type="month"
                  value={expensePeriodFilter}
                  onChange={(e) => setExpensePeriodFilter(e.target.value)}
                  className="w-40"
                  placeholder={t('period')}
                />
                <Button variant="outline" size="sm" onClick={() => setExpensePeriodFilter('')}>
                  {t('reset')}
                </Button>
                <Button size="sm" onClick={() => setExpenseDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  {t('addExpense')}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={expenseColumns}
                data={filteredExpenses}
                keyExtractor={(row, index) => String(row.id ?? index)}
                emptyState={<EmptyState title={t('noData')} text={t('adjustSearchCriteria')} icon={Wallet} />}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Tab: Reports ─── */}
        <TabsContent value="reports" className="space-y-4">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>{t('weeklyReport')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={() => sendWeeklyReport.mutate()}
                  disabled={sendWeeklyReport.isPending}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  {t('generateWeeklyReport')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (reportPreview) {
                      const text = encodeURIComponent(reportPreview);
                      window.open(`https://t.me/share/url?url=&text=${text}`, '_blank');
                    }
                  }}
                  disabled={!reportPreview}
                >
                  <Send className="h-4 w-4 mr-2" />
                  {t('sendToTelegram')}
                </Button>
              </div>

              {sendWeeklyReport.isPending && (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  {t('generating')}...
                </div>
              )}

              {reportPreview && (
                <div className="mt-4 rounded-xl border border-slate-200/70 bg-slate-50/50 p-4">
                  <h4 className="text-sm font-semibold text-slate-700 mb-2">{t('reportPreview')}</h4>
                  <pre className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">{reportPreview}</pre>
                </div>
              )}

              {!reportPreview && !sendWeeklyReport.isPending && (
                <EmptyState
                  title={t('noReportsYet')}
                  text={t('generateReportToSeePreview')}
                  icon={FileText}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ─── Expense Dialog ─── */}
      <Dialog open={expenseDialogOpen} onOpenChange={setExpenseDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('marketingExpenseTitle')}</DialogTitle>
            <DialogDescription>{t('addExpense')}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-4">
            <Field label={t('source')}>
              <Select value={expenseForm.sourceId} onValueChange={(sourceId) => setExpenseForm({ ...expenseForm, sourceId })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {sources.map((source: any) => (
                    <SelectItem key={source.id} value={String(source.id)}>{source.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('channel')}>
              <Input value={expenseForm.channel} onChange={(e) => setExpenseForm({ ...expenseForm, channel: e.target.value })} />
            </Field>
            <Field label={t('campaign')}>
              <Input value={expenseForm.campaignName} onChange={(e) => setExpenseForm({ ...expenseForm, campaignName: e.target.value })} />
            </Field>
            <Field label={t('amount')}>
              <Input value={expenseForm.amountUzs} onChange={(e) => setExpenseForm({ ...expenseForm, amountUzs: e.target.value })} />
            </Field>
            <Field label={t('start')}>
              <Input type="date" value={expenseForm.periodStart} onChange={(e) => setExpenseForm({ ...expenseForm, periodStart: e.target.value })} />
            </Field>
            <Field label={t('end')}>
              <Input type="date" value={expenseForm.periodEnd} onChange={(e) => setExpenseForm({ ...expenseForm, periodEnd: e.target.value })} />
            </Field>
            <div className="md:col-span-2 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setExpenseDialogOpen(false)}>{t('cancel')}</Button>
              <Button onClick={() => createExpense.mutate()} disabled={createExpense.isPending}>
                {createExpense.isPending ? t('saving') : t('saveExpense')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
