import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { canAccessAnalytics } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable } from '@/components/ux/DataTable';
import type { DataTableColumn } from '@/components/ux/DataTable';
import { DashboardCharts } from '@/components/ux/DashboardCharts';
import { PageHeader } from '@/components/ux/PageHeader';
import { LEAD_STATUSES } from '@shared/academy';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Banknote,
  ClipboardCheck,
  CreditCard,
  Download,
  GraduationCap,
  Megaphone,
  Send,
  ShieldAlert,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
  UserRoundCheck,
  Users,
  AlertTriangle,
  Minus,
  CalendarDays,
  Target,
} from 'lucide-react';

/* ── helpers ─────────────────────────────────────────────── */

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

const translateEnumValue = (value: string | null | undefined, labels: Record<string, TranslationKey>, t: (key: TranslationKey) => string) => {
  if (!value) return t('noData');
  const key = labels[value];
  return key ? t(key) : value;
};

/* ── sub-components ────────────────────────────────────────── */

function KpiCard({
  title,
  value,
  detail,
  icon: Icon,
  tone = 'blue',
}: {
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
            <div className="mt-1.5 text-[26px] font-bold text-slate-900 leading-tight tracking-tight tabular-nums">
              {value}
            </div>
            {detail && <p className="mt-1 text-xs text-slate-400 truncate">{detail}</p>}
          </div>
          <div
            className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110 ${toneClass}`}
          >
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RiskCard({
  title,
  items,
  render,
  emptyText,
}: {
  title: string;
  items: any[];
  render: (item: any) => React.ReactNode;
  emptyText: string;
}) {
  return (
    <Card className="hover-lift">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-5 w-5 text-red-500" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 max-h-80 overflow-y-auto">
        {items.length > 0 ? (
          items.map((item) => (
            <div
              key={item.id || `${title}-${Math.random()}`}
              className="rounded-lg border border-red-100 bg-red-50/40 p-3 text-sm text-red-900"
            >
              {render(item)}
            </div>
          ))
        ) : (
          <p className="text-sm text-slate-500">{emptyText}</p>
        )}
      </CardContent>
    </Card>
  );
}

/* ── CSV export helper ────────────────────────────────────── */

function exportToCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const csv = [headers.join(','), ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

/* ── main component ────────────────────────────────────────── */

export default function AnalyticsWorkspace() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const money = (value: number | string | null | undefined) =>
    `${Number(value || 0).toLocaleString('ru-RU')}${t('uzs')}`;

  const leadStatusName = (code: string) => translateEnumValue(code, leadStatusTranslationKeys, t);

  const { data, isLoading } = useQuery<any>({
    queryKey: ['/api/academy/workspaces/analytics'],
  });

  const handleSendTelegram = async () => {
    try {
      await apiRequest('POST', '/api/academy/reports/weekly/test', { recipient: 'leadership' });
      toast({ title: t('testReportCreated') });
    } catch (e: any) {
      toast({ title: t('error'), description: e.message, variant: 'destructive' });
    }
  };

  /* ── access check ── */
  if (!user || !canAccessAnalytics(user)) {
    return (
      <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
        <Card>
          <CardContent className="p-12 text-center">
            <ShieldAlert className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-900 mb-2">{t('accessDenied')}</h3>
            <p className="text-slate-500">{t('reportAccessRequired')}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ── loading skeleton ── */
  if (isLoading || !data) {
    return (
      <div className="p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  const analytics = data.analytics;
  const targets = analytics.targets || {};
  const lastUpdated = new Date().toLocaleString('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  });

  /* ── KPI target helpers ── */
  const getTone = (value: number, target: number, mode: 'lt' | 'gt' = 'gt') => {
    if (mode === 'lt') return value <= target ? 'green' : 'red';
    return value >= target ? 'green' : 'red';
  };

  const cacTone = getTone(analytics.summary.cac || 0, targets.cac || 300000, 'lt');
  const roasTone = getTone(analytics.summary.roas || 0, targets.roas || 5, 'gt');
  const ltvCacTone = getTone(analytics.summary.ltvCac || 0, targets.ltvCac || 10, 'gt');
  const npsTone = getTone(analytics.summary.nps || 0, targets.nps || 50, 'gt');
  const attendanceTone = getTone(analytics.summary.avgAttendance || 0, targets.attendance || 70, 'gt');

  /* ── derived data ── */
  const funnelData = (analytics.funnel || []) as any[];
  const byCourse = (analytics.byCourse || []) as any[];
  const bySource = (analytics.bySource || []) as any[];
  const byTeacher = (analytics.byTeacher || []) as any[];
  const byGroupProgress = (analytics.byGroupProgress || []) as any[];
  const risks = analytics.risks || {};
  const retentionByCourse = (analytics.retentionByCourse || []) as any[];
  const groups = (analytics.groups || []) as any[];

  /* ── funnel conversion ── */
  const newRequestCount = funnelData.find((f) => f.code === 'new_request')?.count || 0;
  const demoAttendedCount = funnelData.find((f) => f.code === 'demo_attended')?.count || 0;
  const paidCount = funnelData.find((f) => f.code === 'paid')?.count || 0;
  const leadToDemoPct = newRequestCount > 0 ? Math.round((demoAttendedCount / newRequestCount) * 100) : 0;
  const demoToPaidPct = demoAttendedCount > 0 ? Math.round((paidCount / demoAttendedCount) * 100) : 0;

  /* ── export handlers ── */
  const exportCourses = () => {
    const headers = [t('course'), t('leadsColumn'), t('students'), t('revenueLabel'), 'LTV', 'CAC', t('occupancyColumn')];
    const rows = byCourse.map((c: any) => [c.courseName, c.leads, c.students, money(c.revenue), money(c.avgLtv), money(c.cac), `${c.occupancyPercent ?? 0}%`]);
    exportToCSV('analytics-by-course.csv', headers, rows);
    toast({ title: t('exportLabel'), description: 'CSV exported' });
  };

  const exportSources = () => {
    const headers = [t('source'), t('leadsColumn'), t('paymentsTab'), t('revenueLabel'), t('expense'), 'CPL', 'CAC', 'ROAS', 'LTV:CAC'];
    const rows = bySource.map((s: any) => [s.sourceName, s.leads, s.paidStudents, money(s.revenue), money(s.expenses), money(s.cpl), money(s.cac), `${s.roas}x`, `${s.ltvCac}:1`]);
    exportToCSV('analytics-by-source.csv', headers, rows);
    toast({ title: t('exportLabel'), description: 'CSV exported' });
  };

  const exportTeachers = () => {
    const headers = [t('teacher'), t('hoursSuffix'), t('averageRatingLabel'), t('attendanceLabel'), t('groupsLabel'), t('trendColumn')];
    const rows = byTeacher.map((tr: any) => [tr.teacherName, `${Math.round(tr.hours)}${t('hoursSuffix')}`, (tr.avgScore ?? 0).toFixed(1), `${tr.attendance}%`, tr.groupCount ?? '-', tr.trend === 'up' ? t('trendUp') : tr.trend === 'down' ? t('trendDown') : t('trendStable')]);
    exportToCSV('analytics-by-teacher.csv', headers, rows);
    toast({ title: t('exportLabel'), description: 'CSV exported' });
  };

  const exportGroups = () => {
    const headers = [t('group'), t('course'), t('occupancyColumn'), t('attendanceLabel'), t('progressLabel'), t('averageRatingLabel')];
    const rows = byGroupProgress.map((g: any) => [g.groupName, g.courseName || '-', `${g.capacity}/${g.maxCapacity}`, `${g.attendanceAvg ?? 0}%`, `${g.progressAvg ?? 0}%`, (g.avgScore ?? 0).toFixed(1)]);
    exportToCSV('analytics-by-group.csv', headers, rows);
    toast({ title: t('exportLabel'), description: 'CSV exported' });
  };

  const exportRetention = () => {
    const headers = [t('course'), t('cohortColumn'), t('month1'), t('retention2'), t('month3'), t('retention3'), t('month4'), t('retention4')];
    const rows = retentionByCourse.map((r: any) => [r.courseName, r.cohort, r.month1Students, `${r.retentionMonth2 ?? 0}%`, r.month3Students, `${r.retentionMonth3 ?? 0}%`, r.month4Students, `${r.retentionMonth4 ?? 0}%`]);
    exportToCSV('analytics-retention.csv', headers, rows);
    toast({ title: t('exportLabel'), description: 'CSV exported' });
  };

  /* ── table columns ── */

  const courseColumns: DataTableColumn<any>[] = [
    { key: 'courseName', header: t('course'), sortable: true, accessor: (c: any) => c.courseName, render: (c: any) => <span className="font-medium text-slate-900">{c.courseName}</span> },
    { key: 'leads', header: t('leadsColumn'), sortable: true, accessor: (c: any) => c.leads, render: (c: any) => <span className="tabular-nums">{c.leads}</span>, cellClassName: 'text-right' },
    { key: 'students', header: t('students'), sortable: true, accessor: (c: any) => c.students, render: (c: any) => <span className="tabular-nums">{c.students}</span>, cellClassName: 'text-right' },
    { key: 'revenue', header: t('revenueLabel'), sortable: true, accessor: (c: any) => c.revenue, render: (c: any) => <span className="tabular-nums font-medium">{money(c.revenue)}</span>, cellClassName: 'text-right' },
    { key: 'avgLtv', header: 'LTV', sortable: true, accessor: (c: any) => c.avgLtv, render: (c: any) => <span className="tabular-nums">{money(c.avgLtv)}</span>, cellClassName: 'text-right' },
    { key: 'cac', header: 'CAC', sortable: true, accessor: (c: any) => c.cac, render: (c: any) => <span className="tabular-nums">{money(c.cac)}</span>, cellClassName: 'text-right' },
    {
      key: 'occupancy',
      header: t('occupancyColumn'),
      sortable: true,
      accessor: (c: any) => c.occupancyPercent || 0,
      render: (c: any) => (
        <div className="flex items-center gap-2">
          <Progress value={c.occupancyPercent || 0} className="w-20" />
          <span className="text-xs text-slate-500 tabular-nums">{c.occupancyPercent ?? 0}%</span>
        </div>
      ),
    },
  ];

  const sourceColumns: DataTableColumn<any>[] = [
    { key: 'sourceName', header: t('source'), sortable: true, accessor: (s: any) => s.sourceName, render: (s: any) => <span className="font-medium text-slate-900">{s.sourceName}</span> },
    { key: 'leads', header: t('leadsColumn'), sortable: true, accessor: (s: any) => s.leads, render: (s: any) => <span className="tabular-nums">{s.leads}</span>, cellClassName: 'text-right' },
    { key: 'paidStudents', header: t('paymentsTab'), sortable: true, accessor: (s: any) => s.paidStudents, render: (s: any) => <span className="tabular-nums">{s.paidStudents}</span>, cellClassName: 'text-right' },
    { key: 'revenue', header: t('revenueLabel'), sortable: true, accessor: (s: any) => s.revenue, render: (s: any) => <span className="tabular-nums font-medium">{money(s.revenue)}</span>, cellClassName: 'text-right' },
    { key: 'expenses', header: t('expense'), sortable: true, accessor: (s: any) => s.expenses, render: (s: any) => <span className="tabular-nums text-slate-600">{money(s.expenses)}</span>, cellClassName: 'text-right' },
    { key: 'cpl', header: 'CPL', sortable: true, accessor: (s: any) => s.cpl, render: (s: any) => <span className="tabular-nums">{money(s.cpl)}</span>, cellClassName: 'text-right' },
    { key: 'cac', header: 'CAC', sortable: true, accessor: (s: any) => s.cac, render: (s: any) => <span className="tabular-nums">{money(s.cac)}</span>, cellClassName: 'text-right' },
    {
      key: 'roas',
      header: 'ROAS',
      sortable: true,
      accessor: (s: any) => s.roas || 0,
      render: (s: any) => (
        <Badge variant={s.roas >= 5 ? 'default' : 'secondary'} className={s.roas >= 5 ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' : ''}>
          {s.roas}x
        </Badge>
      ),
      cellClassName: 'text-right',
    },
    { key: 'ltvCac', header: 'LTV:CAC', sortable: true, accessor: (s: any) => s.ltvCac || 0, render: (s: any) => <span className="tabular-nums">{s.ltvCac}:1</span>, cellClassName: 'text-right' },
  ];

  const teacherColumns: DataTableColumn<any>[] = [
    { key: 'teacherName', header: t('teacher'), sortable: true, accessor: (tr: any) => tr.teacherName, render: (tr: any) => <span className="font-medium text-slate-900">{tr.teacherName}</span> },
    { key: 'hours', header: t('hoursSuffix'), sortable: true, accessor: (tr: any) => tr.hours, render: (tr: any) => <span className="tabular-nums">{Math.round(tr.hours)}{t('hoursSuffix')}</span>, cellClassName: 'text-right' },
    { key: 'avgScore', header: t('averageRatingLabel'), sortable: true, accessor: (tr: any) => tr.avgScore || 0, render: (tr: any) => <span className="tabular-nums text-amber-600 font-medium">{(tr.avgScore ?? 0).toFixed(1)}</span>, cellClassName: 'text-right' },
    { key: 'attendance', header: t('attendanceLabel'), sortable: true, accessor: (tr: any) => tr.attendance, render: (tr: any) => <span className="tabular-nums">{tr.attendance}%</span>, cellClassName: 'text-right' },
    { key: 'groupCount', header: t('groupsLabel'), sortable: true, accessor: (tr: any) => tr.groupCount || 0, render: (tr: any) => <span className="tabular-nums">{tr.groupCount ?? '-'}</span>, cellClassName: 'text-right' },
    {
      key: 'trend',
      header: t('trendColumn'),
      sortable: true,
      accessor: (tr: any) => tr.trend,
      render: (tr: any) => (
        <div className="flex items-center gap-1">
          {tr.trend === 'up' ? (
            <>
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              <span className="text-emerald-600">{t('trendUp')}</span>
            </>
          ) : tr.trend === 'down' ? (
            <>
              <TrendingDown className="h-4 w-4 text-red-500" />
              <span className="text-red-600">{t('trendDown')}</span>
            </>
          ) : (
            <>
              <Minus className="h-4 w-4 text-slate-400" />
              <span className="text-slate-500">{t('trendStable')}</span>
            </>
          )}
        </div>
      ),
    },
  ];

  const groupColumns: DataTableColumn<any>[] = [
    { key: 'groupName', header: t('group'), sortable: true, accessor: (g: any) => g.groupName, render: (g: any) => <span className="font-medium text-slate-900">{g.groupName}</span> },
    { key: 'courseName', header: t('course'), sortable: true, accessor: (g: any) => g.courseName, render: (g: any) => <span className="text-slate-600">{g.courseName || '-'}</span> },
    {
      key: 'capacity',
      header: t('occupancyColumn'),
      sortable: true,
      accessor: (g: any) => g.capacity,
      render: (g: any) => (
        <div className="flex items-center gap-2">
          <span className="text-sm tabular-nums">{g.capacity}/{g.maxCapacity}</span>
          <Progress value={(g.capacity / (g.maxCapacity || 12)) * 100} className="w-16" />
        </div>
      ),
    },
    {
      key: 'attendanceAvg',
      header: t('attendanceLabel'),
      sortable: true,
      accessor: (g: any) => g.attendanceAvg || 0,
      render: (g: any) => <span className="tabular-nums">{g.attendanceAvg ?? 0}%</span>,
      cellClassName: 'text-right',
    },
    {
      key: 'progressAvg',
      header: t('progressLabel'),
      sortable: true,
      accessor: (g: any) => g.progressAvg || 0,
      render: (g: any) => (
        <div className="flex items-center gap-2">
          <Progress value={g.progressAvg || 0} className="w-20" />
          <span className="text-xs text-slate-500 tabular-nums">{g.progressAvg ?? 0}%</span>
        </div>
      ),
    },
    {
      key: 'avgScore',
      header: t('averageRatingLabel'),
      sortable: true,
      accessor: (g: any) => g.avgScore || 0,
      render: (g: any) => <span className="tabular-nums text-amber-600 font-medium">{(g.avgScore ?? 0).toFixed(1)}</span>,
      cellClassName: 'text-right',
    },
  ];

  const retentionColumns: DataTableColumn<any>[] = [
    { key: 'courseName', header: t('course'), sortable: true, accessor: (r: any) => r.courseName, render: (r: any) => <span className="font-medium text-slate-900">{r.courseName}</span> },
    { key: 'cohort', header: t('cohortColumn'), sortable: true, accessor: (r: any) => r.cohort, render: (r: any) => <span className="tabular-nums">{r.cohort}</span> },
    { key: 'month1Students', header: t('month1'), sortable: true, accessor: (r: any) => r.month1Students, render: (r: any) => <span className="tabular-nums font-medium">{r.month1Students}</span>, cellClassName: 'text-right' },
    {
      key: 'retentionMonth2',
      header: `${t('month2')} / Retention`,
      sortable: true,
      accessor: (r: any) => r.retentionMonth2 || 0,
      render: (r: any) => (
        <div className="flex items-center gap-2">
          <span className="tabular-nums">{r.month2Students ?? 0}</span>
          <Badge variant="outline" className="text-xs tabular-nums">{r.retentionMonth2 ?? 0}%</Badge>
        </div>
      ),
    },
    {
      key: 'retentionMonth3',
      header: `${t('month3')} / Retention`,
      sortable: true,
      accessor: (r: any) => r.retentionMonth3 || 0,
      render: (r: any) => (
        <div className="flex items-center gap-2">
          <span className="tabular-nums">{r.month3Students ?? 0}</span>
          <Badge variant="outline" className="text-xs tabular-nums">{r.retentionMonth3 ?? 0}%</Badge>
        </div>
      ),
    },
    {
      key: 'retentionMonth4',
      header: `${t('month4')} / Retention`,
      sortable: true,
      accessor: (r: any) => r.retentionMonth4 || 0,
      render: (r: any) => (
        <div className="flex items-center gap-2">
          <span className="tabular-nums">{r.month4Students ?? 0}</span>
          <Badge variant="outline" className="text-xs tabular-nums">{r.retentionMonth4 ?? 0}%</Badge>
        </div>
      ),
    },
  ];

  /* ── render ── */
  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader
        title={t('sectionTitleAnalytics')}
        subtitle={`${t('lastUpdated')}: ${lastUpdated}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleSendTelegram}>
              <Send className="h-4 w-4 mr-2" />
              {t('sendReport')}
            </Button>
          </div>
        }
      />

      {/* ── KPI Grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 mb-6">
        <KpiCard
          title={t('weeklyLeads')}
          value={analytics.summary.newLeadsWeek ?? 0}
          detail={`${t('marketingAndSales')} • ${t('monthlyRevenue')}: ${money(analytics.summary.newLeadsMonth ?? 0)}`}
          icon={Megaphone}
          tone="blue"
        />
        <KpiCard
          title={t('activeStudents')}
          value={analytics.summary.activeStudents ?? 0}
          detail={t('statusLearning')}
          icon={GraduationCap}
          tone="green"
        />
        <KpiCard
          title={t('monthlyRevenue')}
          value={money(analytics.summary.revenueMonth)}
          detail={`${t('averageCheck')}: ${money(analytics.summary.avgCheck)}`}
          icon={Banknote}
          tone="green"
        />
        <KpiCard
          title={t('averageCheck')}
          value={money(analytics.summary.avgCheck)}
          detail={t('averageCheck')}
          icon={CreditCard}
          tone="slate"
        />
        <KpiCard
          title="CAC"
          value={money(analytics.summary.cac)}
          detail={`${t('cacTarget')}`}
          icon={Target}
          tone={cacTone}
        />
        <KpiCard
          title="LTV:CAC"
          value={`${analytics.summary.ltvCac}:1`}
          detail={`${t('ltvCacTarget')}`}
          icon={Sparkles}
          tone={ltvCacTone}
        />
        <KpiCard
          title="ROAS"
          value={`${analytics.summary.roas}x`}
          detail={`${t('roasTarget')}`}
          icon={BarChart3}
          tone={roasTone}
        />
        <KpiCard
          title="NPS"
          value={analytics.summary.nps ?? 0}
          detail={`${t('targetGreaterThan')}${targets.nps ?? 50}`}
          icon={Star}
          tone={npsTone}
        />
        <KpiCard
          title={t('averageAttendance')}
          value={`${analytics.summary.avgAttendance ?? 0}%`}
          detail={`${t('targetGreaterThan')}${targets.attendance ?? 70}%`}
          icon={UserRoundCheck}
          tone={attendanceTone}
        />
        <KpiCard
          title={t('avgLessonRating')}
          value={`${(analytics.summary.avgLessonScore ?? 0).toFixed(1)} / 5`}
          icon={Star}
          tone="blue"
        />
      </div>

      {/* ── Dashboard Charts ── */}
      <div className="mb-6">
        <DashboardCharts
          payments={data.payments}
          funnel={analytics.funnel}
          analytics={analytics}
          leadStatusName={leadStatusName}
          statusColor={statusColor}
          money={money}
        />
      </div>

      {/* ── Tabs ── */}
      <Tabs defaultValue="funnel" className="space-y-5">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="funnel">{t('salesPipeline')}</TabsTrigger>
          <TabsTrigger value="courses">{t('navCourses')}</TabsTrigger>
          <TabsTrigger value="sources">{t('leadSources')}</TabsTrigger>
          <TabsTrigger value="teachers">{t('navTeachers')}</TabsTrigger>
          <TabsTrigger value="groups">{t('navGroups')}</TabsTrigger>
          <TabsTrigger value="risks">{t('navRisks')}</TabsTrigger>
          <TabsTrigger value="cohorts">{t('cohortsTab')}</TabsTrigger>
        </TabsList>

        {/* ── Funnel Tab ── */}
        <TabsContent value="funnel" className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <KpiCard title={t('conversionApplicationToDemo')} value={`${leadToDemoPct}%`} detail={`${demoAttendedCount} / ${newRequestCount}`} icon={ArrowRight} tone="blue" />
            <KpiCard title={t('conversionDemoToPayment')} value={`${demoToPaidPct}%`} detail={`${paidCount} / ${demoAttendedCount}`} icon={ArrowRight} tone="green" />
            <KpiCard title={t('cplLabel')} value={money(analytics.summary.cpl ?? 0)} detail={t('cplLabel')} icon={Megaphone} tone="amber" />
            <KpiCard title={t('avgDealCycle')} value={`${analytics.summary.avgDealCycleDays ?? 0}${t('days')}`} detail={t('avgDealCycle')} icon={CalendarDays} tone="slate" />
          </div>

          <Card className="hover-lift">
            <CardHeader className="pb-4">
              <CardTitle>{t('conversionFunnel')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {funnelData.map((item: any, index: number) => {
                const prevCount = index > 0 ? funnelData[index - 1]?.count || 1 : item.count || 1;
                const conversion = index > 0 ? Math.round((item.count / prevCount) * 100) : 100;
                return (
                  <div key={item.code} className="flex items-center gap-4">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-slate-900">{leadStatusName(item.code)}</span>
                        <span className="text-sm font-bold text-slate-900 tabular-nums">{item.count}</span>
                      </div>
                      <div className="mt-1">
                        <Progress value={(item.count / (newRequestCount || 1)) * 100} className="h-2" />
                      </div>
                    </div>
                    {index > 0 && (
                      <Badge variant="outline" className="shrink-0 tabular-nums">
                        {conversion}%
                      </Badge>
                    )}
                  </div>
                );
              })}
              {funnelData.length === 0 && <p className="text-sm text-slate-500 text-center py-8">{t('noFunnelData')}</p>}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Courses Tab ── */}
        <TabsContent value="courses" className="space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={exportCourses}>
              <Download className="h-4 w-4 mr-2" />
              {t('exportLabel')} CSV
            </Button>
          </div>
          <Card className="hover-lift">
            <CardContent className="p-0">
              <DataTable
                columns={courseColumns}
                data={byCourse}
                keyExtractor={(c: any) => `course-${c.courseId}`}
                emptyState={<div className="py-12 text-center text-sm text-slate-500">{t('noData')}</div>}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Sources Tab ── */}
        <TabsContent value="sources" className="space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={exportSources}>
              <Download className="h-4 w-4 mr-2" />
              {t('exportLabel')} CSV
            </Button>
          </div>
          <Card className="hover-lift">
            <CardContent className="p-0">
              <DataTable
                columns={sourceColumns}
                data={bySource}
                keyExtractor={(s: any) => `source-${s.sourceId}`}
                defaultSortKey="roas"
                defaultSortDirection="desc"
                emptyState={<div className="py-12 text-center text-sm text-slate-500">{t('noData')}</div>}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Teachers Tab ── */}
        <TabsContent value="teachers" className="space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={exportTeachers}>
              <Download className="h-4 w-4 mr-2" />
              {t('exportLabel')} CSV
            </Button>
          </div>
          <Card className="hover-lift">
            <CardContent className="p-0">
              <DataTable
                columns={teacherColumns}
                data={byTeacher}
                keyExtractor={(tr: any) => `teacher-${tr.teacherId}`}
                emptyState={<div className="py-12 text-center text-sm text-slate-500">{t('noData')}</div>}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Groups Tab ── */}
        <TabsContent value="groups" className="space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={exportGroups}>
              <Download className="h-4 w-4 mr-2" />
              {t('exportLabel')} CSV
            </Button>
          </div>
          <Card className="hover-lift">
            <CardContent className="p-0">
              <DataTable
                columns={groupColumns}
                data={byGroupProgress}
                keyExtractor={(g: any) => `group-${g.groupId}`}
                emptyState={<div className="py-12 text-center text-sm text-slate-500">{t('noData')}</div>}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Risks Tab ── */}
        <TabsContent value="risks" className="space-y-5">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <RiskCard
              title={t('attendanceBelow70')}
              items={risks.lowAttendanceStudents || []}
              render={(student: any) => (
                <div className="flex items-center justify-between">
                  <span>{student.studentName}</span>
                  <Badge variant="destructive" className="text-xs">{student.attendancePercent}%</Badge>
                </div>
              )}
              emptyText={t('noData')}
            />
            <RiskCard
              title={t('ratingsBelow3')}
              items={risks.lowScores || []}
              render={(survey: any) => (
                <div className="flex items-center justify-between">
                  <span>{t('student')} #{survey.studentId}</span>
                  <Badge variant="destructive" className="text-xs">{survey.score}</Badge>
                </div>
              )}
              emptyText={t('noData')}
            />
            <RiskCard
              title={t('overduePayments')}
              items={risks.overduePayments || []}
              render={(payment: any) => (
                <div className="flex items-center justify-between">
                  <span>{payment.studentName || payment.leadName || t('clientColumn')}</span>
                  <span className="font-medium">{money(payment.amountUzs)}</span>
                </div>
              )}
              emptyText={t('noData')}
            />
            <RiskCard
              title={t('leadsThinkingOver7')}
              items={risks.longThinkingLeads || []}
              render={(lead: any) => (
                <div className="flex items-center justify-between">
                  <span>{lead.contactName}</span>
                  <span className="text-xs text-slate-500">{new Date(lead.updatedAt).toLocaleDateString('ru-RU')}</span>
                </div>
              )}
              emptyText={t('noData')}
            />
            <RiskCard
              title={t('overdueTasks')}
              items={risks.overdueTasks || []}
              render={(task: any) => (
                <div>
                  <div className="font-medium">{task.title}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{task.responsibleName || t('noResponsible')} • {new Date(task.deadlineAt).toLocaleDateString('ru-RU')}</div>
                </div>
              )}
              emptyText={t('noData')}
            />
          </div>
        </TabsContent>

        {/* ── Cohorts Tab ── */}
        <TabsContent value="cohorts" className="space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={exportRetention}>
              <Download className="h-4 w-4 mr-2" />
              {t('exportLabel')} CSV
            </Button>
          </div>
          <Card className="hover-lift">
            <CardHeader className="pb-4">
              <CardTitle>{t('cohortAnalysis')}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <DataTable
                columns={retentionColumns}
                data={retentionByCourse}
                keyExtractor={(r: any) => `retention-${r.courseId}-${r.cohort}`}
                emptyState={<div className="py-12 text-center text-sm text-slate-500">{t('noCohortData')}</div>}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
