import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { canAccessAnalytics } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable } from '@/components/ux/DataTable';
import type { DataTableColumn } from '@/components/ux/DataTable';
import { DashboardCharts } from '@/components/ux/DashboardCharts';
import { PageHeader } from '@/components/ux/PageHeader';
import { ceoCopy } from '@/components/ui/ceo-copy';
import { LEAD_STATUSES } from '@shared/academy';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import {
  ArrowRight,
  BarChart3,
  Banknote,
  CreditCard,
  Download,
  GraduationCap,
  Megaphone,
  ShieldAlert,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
  UserRoundCheck,
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

const churnColors = ['#2563eb', '#16a34a', '#f59e0b', '#8b5cf6', '#0891b2'];
const churnLabels: Record<string, string> = {
  relocation: ceoCopy.student.relocation,
  price: ceoCopy.student.price,
  quality: ceoCopy.student.quality,
  schedule_conflict: ceoCopy.student.scheduleConflict,
  lost_interest: ceoCopy.student.lostInterest,
};

const translateEnumValue = (value: string | null | undefined, labels: Record<string, TranslationKey>, t: (key: TranslationKey) => string) => {
  if (!value) return t('noData');
  const key = labels[value];
  return key ? t(key) : value;
};

type AnalyticsSection = 'overview' | 'funnel' | 'courses' | 'sources' | 'teachers' | 'groups' | 'risks' | 'cohorts';

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
    <Card className="border-border/70 hover-lift group">
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

export default function AnalyticsWorkspace({ section = 'overview' }: { section?: AnalyticsSection }) {
  const { t } = useTranslation();
  const { user } = useAuth();

  const money = (value: number | string | null | undefined) =>
    `${Number(value || 0).toLocaleString('ru-RU')}${t('uzs')}`;

  const leadStatusName = (code: string) => translateEnumValue(code, leadStatusTranslationKeys, t);

  const { data, isLoading } = useQuery<any>({
    queryKey: ['/api/academy/workspaces/analytics'],
  });

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
  const cplTone = targets.cpl > 0 ? getTone(analytics.summary.cpl || 0, targets.cpl, 'lt') : 'slate';
  const roasTone = getTone(analytics.summary.roas || 0, targets.roas || 5, 'gt');
  const ltvCacTone = getTone(analytics.summary.ltvCac || 0, targets.ltvCac || 10, 'gt');
  const npsTone = getTone(analytics.summary.nps || 0, targets.nps || 50, 'gt');
  const attendanceTone = getTone(analytics.summary.avgAttendance || 0, targets.attendance || 70, 'gt');
  const revenueTone = targets.revenue > 0 ? getTone(analytics.summary.revenueMonth || 0, targets.revenue, 'gt') : 'slate';
  const leadsTone = targets.newLeads > 0 ? getTone(analytics.summary.newLeadsMonth || 0, targets.newLeads, 'gt') : 'slate';
  const sectionTitle: Record<AnalyticsSection, string> = {
    overview: t('navAnalytics'),
    funnel: t('salesPipeline'),
    courses: t('byCourses'),
    sources: t('bySources'),
    teachers: t('navTeachers'),
    groups: t('navGroups'),
    risks: t('navRisks'),
    cohorts: t('cohortsTab'),
  };

  /* ── derived data ── */
  const funnelData = (analytics.funnel || []) as any[];
  const byCourse = (analytics.byCourse || []) as any[];
  const bySource = (analytics.bySource || []) as any[];
  const byTeacher = (analytics.byTeacher || []) as any[];
  const byGroupProgress = (analytics.byGroupProgress || []) as any[];
  const risks = analytics.risks || {};
  const retentionByCourse = (analytics.retentionByCourse || []) as any[];
  const churnData = Object.entries(analytics.churnByReason || {}).map(([reason, value], index) => ({
    name: churnLabels[reason] ?? reason,
    value: Number(value),
    color: churnColors[index % churnColors.length],
  }));
  /* ── funnel conversion ── */
  const newRequestCount = funnelData.find((f) => f.code === 'new_request')?.count || 0;
  const demoAttendedCount = funnelData.find((f) => f.code === 'demo_attended')?.count || 0;
  const paidCount = funnelData.find((f) => f.code === 'paid')?.count || 0;
  const leadToDemoPct = newRequestCount > 0 ? Math.round((demoAttendedCount / newRequestCount) * 100) : 0;
  const demoToPaidPct = demoAttendedCount > 0 ? Math.round((paidCount / demoAttendedCount) * 100) : 0;

  /* ── export handlers ── */
  const exportCourses = () => {
    const headers = [t('course'), t('navLeads'), t('students'), t('revenueLabel'), t('ltvLabel'), t('cacLabel'), t('occupancyColumn')];
    const rows = byCourse.map((c: any) => [c.courseName, c.leads, c.students, money(c.revenue), money(c.avgLtv), money(c.cac), `${c.occupancyPercent ?? 0}%`]);
    exportToCSV('analytics-by-course.csv', headers, rows);
    toast({ title: t('exportLabel'), description: t('csvExported') });
  };

  const exportSources = () => {
    const headers = [t('source'), t('navLeads'), t('navPayments'), t('revenueLabel'), t('expense'), t('cplColumn'), t('cacLabel'), t('roasLabel'), t('ltvCacLabel')];
    const rows = bySource.map((s: any) => [s.sourceName, s.leads, s.paidStudents, money(s.revenue), money(s.expenses), money(s.cpl), money(s.cac), `${s.roas}x`, `${s.ltvCac}:1`]);
    exportToCSV('analytics-by-source.csv', headers, rows);
    toast({ title: t('exportLabel'), description: t('csvExported') });
  };

  const exportTeachers = () => {
    const headers = [t('teacher'), t('hoursSuffix'), t('attendanceLabel'), t('groupsLabel'), t('trendColumn')];
    const rows = byTeacher.map((tr: any) => [tr.teacherName, `${Math.round(tr.hours)}${t('hoursSuffix')}`, `${tr.attendance}%`, tr.groupCount ?? '-', tr.trend === 'up' ? t('trendUp') : tr.trend === 'down' ? t('trendDown') : t('trendStable')]);
    exportToCSV('analytics-by-teacher.csv', headers, rows);
    toast({ title: t('exportLabel'), description: t('csvExported') });
  };

  const exportGroups = () => {
    const headers = [t('group'), t('course'), t('occupancyColumn'), t('attendanceLabel'), t('progressLabel')];
    const rows = byGroupProgress.map((g: any) => [g.groupName, g.courseName || '-', `${g.capacity}/${g.maxCapacity}`, `${g.attendanceAvg ?? 0}%`, `${g.progressAvg ?? 0}%`]);
    exportToCSV('analytics-by-group.csv', headers, rows);
    toast({ title: t('exportLabel'), description: t('csvExported') });
  };

  const exportRetention = () => {
    const headers = [
      t('course'),
      t('cohortColumn'),
      t('month1'),
      `${t('month2')} / ${t('retentionLabel')}`,
      t('month3'),
      `${t('month3')} / ${t('retentionLabel')}`,
      t('month4'),
      `${t('month4')} / ${t('retentionLabel')}`,
    ];
    const rows = retentionByCourse.map((r: any) => [r.courseName, r.cohort, r.month1Students, `${r.retentionMonth2 ?? 0}%`, r.month3Students, `${r.retentionMonth3 ?? 0}%`, r.month4Students, `${r.retentionMonth4 ?? 0}%`]);
    exportToCSV('analytics-retention.csv', headers, rows);
    toast({ title: t('exportLabel'), description: t('csvExported') });
  };

  /* ── table columns ── */

  const courseColumns: DataTableColumn<any>[] = [
    { key: 'courseName', header: t('course'), sortable: true, accessor: (c: any) => c.courseName, render: (c: any) => <span className="font-medium text-slate-900">{c.courseName}</span> },
    { key: 'leads', header: t('navLeads'), sortable: true, accessor: (c: any) => c.leads, render: (c: any) => <span className="tabular-nums">{c.leads}</span>, cellClassName: 'text-right' },
    { key: 'students', header: t('students'), sortable: true, accessor: (c: any) => c.students, render: (c: any) => <span className="tabular-nums">{c.students}</span>, cellClassName: 'text-right' },
    { key: 'revenue', header: t('revenueLabel'), sortable: true, accessor: (c: any) => c.revenue, render: (c: any) => <span className="tabular-nums font-medium">{money(c.revenue)}</span>, cellClassName: 'text-right' },
    { key: 'avgLtv', header: t('ltvLabel'), sortable: true, accessor: (c: any) => c.avgLtv, render: (c: any) => <span className="tabular-nums">{money(c.avgLtv)}</span>, cellClassName: 'text-right' },
    { key: 'cac', header: t('cacLabel'), sortable: true, accessor: (c: any) => c.cac, render: (c: any) => <span className="tabular-nums">{money(c.cac)}</span>, cellClassName: 'text-right' },
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
    { key: 'leads', header: t('navLeads'), sortable: true, accessor: (s: any) => s.leads, render: (s: any) => <span className="tabular-nums">{s.leads}</span>, cellClassName: 'text-right' },
    { key: 'paidStudents', header: t('navPayments'), sortable: true, accessor: (s: any) => s.paidStudents, render: (s: any) => <span className="tabular-nums">{s.paidStudents}</span>, cellClassName: 'text-right' },
    { key: 'revenue', header: t('revenueLabel'), sortable: true, accessor: (s: any) => s.revenue, render: (s: any) => <span className="tabular-nums font-medium">{money(s.revenue)}</span>, cellClassName: 'text-right' },
    { key: 'expenses', header: t('expense'), sortable: true, accessor: (s: any) => s.expenses, render: (s: any) => <span className="tabular-nums text-slate-600">{money(s.expenses)}</span>, cellClassName: 'text-right' },
    { key: 'cpl', header: t('cplColumn'), sortable: true, accessor: (s: any) => s.cpl, render: (s: any) => <span className="tabular-nums">{money(s.cpl)}</span>, cellClassName: 'text-right' },
    { key: 'cac', header: t('cacLabel'), sortable: true, accessor: (s: any) => s.cac, render: (s: any) => <span className="tabular-nums">{money(s.cac)}</span>, cellClassName: 'text-right' },
    {
      key: 'roas',
      header: t('roasLabel'),
      sortable: true,
      accessor: (s: any) => s.roas || 0,
      render: (s: any) => (
        <Badge variant={s.roas >= 5 ? 'default' : 'secondary'} className={s.roas >= 5 ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' : ''}>
          {s.roas}x
        </Badge>
      ),
      cellClassName: 'text-right',
    },
    { key: 'ltvCac', header: t('ltvCacLabel'), sortable: true, accessor: (s: any) => s.ltvCac || 0, render: (s: any) => <span className="tabular-nums">{s.ltvCac}:1</span>, cellClassName: 'text-right' },
  ];

  const teacherColumns: DataTableColumn<any>[] = [
    { key: 'teacherName', header: t('teacher'), sortable: true, accessor: (tr: any) => tr.teacherName, render: (tr: any) => <span className="font-medium text-slate-900">{tr.teacherName}</span> },
    { key: 'hours', header: t('hoursSuffix'), sortable: true, accessor: (tr: any) => tr.hours, render: (tr: any) => <span className="tabular-nums">{Math.round(tr.hours)}{t('hoursSuffix')}</span>, cellClassName: 'text-right' },
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
  ];

  const retentionColumns: DataTableColumn<any>[] = [
    { key: 'courseName', header: t('course'), sortable: true, accessor: (r: any) => r.courseName, render: (r: any) => <span className="font-medium text-slate-900">{r.courseName}</span> },
    { key: 'cohort', header: t('cohortColumn'), sortable: true, accessor: (r: any) => r.cohort, render: (r: any) => <span className="tabular-nums">{r.cohort}</span> },
    { key: 'month1Students', header: t('month1'), sortable: true, accessor: (r: any) => r.month1Students, render: (r: any) => <span className="tabular-nums font-medium">{r.month1Students}</span>, cellClassName: 'text-right' },
    {
      key: 'retentionMonth2',
      header: `${t('month2')} / ${t('retentionLabel')}`,
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
      header: `${t('month3')} / ${t('retentionLabel')}`,
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
      header: `${t('month4')} / ${t('retentionLabel')}`,
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
        title={sectionTitle[section]}
        subtitle={`${t('lastUpdated')}: ${lastUpdated}`}
        breadcrumbs={[
          { label: t('navDashboard'), href: '/analytics-workspace' },
          ...(section === 'overview' ? [] : [{ label: sectionTitle[section] }]),
        ]}
      />

      {/* ── KPI Grid ── */}
      {section === 'overview' ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 mb-6">
            <KpiCard
              title={t('weeklyLeads')}
              value={analytics.summary.newLeadsWeek ?? 0}
              detail={targets.newLeads > 0 ? `${ceoCopy.analytics.month} ${analytics.summary.newLeadsMonth ?? 0} / ${targets.newLeads}` : `${t('marketingAndSales')} • ${t('newLeadsMonth')}: ${analytics.summary.newLeadsMonth ?? 0}`}
              icon={Megaphone}
              tone={leadsTone}
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
              detail={targets.revenue > 0 ? `${ceoCopy.analytics.plan} ${money(targets.revenue)}` : `${t('averageCheck')}: ${money(analytics.summary.avgCheck)}`}
              icon={Banknote}
              tone={revenueTone}
            />
            <KpiCard
              title={t('averageCheck')}
              value={money(analytics.summary.avgCheck)}
              detail={t('averageCheck')}
              icon={CreditCard}
              tone="slate"
            />
            <KpiCard
              title={t('cacLabel')}
              value={money(analytics.summary.cac)}
              detail={`${ceoCopy.analytics.goalNoHigher} ${money(targets.cac)}`}
              icon={Target}
              tone={cacTone}
            />
            <KpiCard
              title={t('ltvCacLabel')}
              value={`${analytics.summary.ltvCac}:1`}
              detail={`${t('ltvCacTarget')}`}
              icon={Sparkles}
              tone={ltvCacTone}
            />
            <KpiCard
              title={t('roasLabel')}
              value={`${analytics.summary.roas}x`}
              detail={`${ceoCopy.analytics.goal} ${targets.roas}x`}
              icon={BarChart3}
              tone={roasTone}
            />
            <KpiCard
              title={t('averageAttendance')}
              value={`${analytics.summary.avgAttendance ?? 0}%`}
              detail={`${t('targetGreaterThan')}${targets.attendance ?? 70}%`}
              icon={UserRoundCheck}
              tone={attendanceTone}
            />
            <KpiCard
              title={ceoCopy.analytics.nps}
              value={analytics.summary.nps ?? 0}
              detail={`${ceoCopy.analytics.goal} ${targets.nps ?? 50}`}
              icon={Star}
              tone={npsTone}
            />
          </div>

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
          <Card className="mb-6 max-w-2xl">
            <CardHeader className="pb-3">
              <CardTitle>{ceoCopy.dashboard.churnReasons}</CardTitle>
            </CardHeader>
            <CardContent>
              {churnData.length > 0 ? (
                <div className="grid grid-cols-[160px_1fr] items-center gap-5">
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie data={churnData} dataKey="value" nameKey="name" innerRadius={38} outerRadius={66} paddingAngle={2}>
                        {churnData.map((item) => <Cell key={item.name} fill={item.color} />)}
                      </Pie>
                      <Tooltip formatter={(value: number) => [value, ceoCopy.dashboard.students]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-2">
                    {churnData.map((item) => (
                      <div key={item.name} className="flex items-center justify-between gap-3 text-sm">
                        <span className="flex min-w-0 items-center gap-2"><span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} /> <span className="truncate">{item.name}</span></span>
                        <span className="font-semibold tabular-nums">{item.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <p className="py-6 text-sm text-muted-foreground">{ceoCopy.dashboard.noChurn}</p>}
            </CardContent>
          </Card>
        </>
      ) : null}

      {section !== 'overview' ? (
      <Tabs value={section} className="space-y-5">
        {/* ── Funnel Tab ── */}
        <TabsContent value="funnel" className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <KpiCard title={t('conversionApplicationToDemo')} value={`${leadToDemoPct}%`} detail={`${demoAttendedCount} / ${newRequestCount}`} icon={ArrowRight} tone="blue" />
            <KpiCard title={t('conversionDemoToPayment')} value={`${demoToPaidPct}%`} detail={`${paidCount} / ${demoAttendedCount}`} icon={ArrowRight} tone="green" />
            <KpiCard
              title={t('cplLabel')}
              value={money(analytics.summary.cpl ?? 0)}
              detail={targets.cpl > 0 ? `${ceoCopy.analytics.goalNoHigher} ${money(targets.cpl)}` : t('cplLabel')}
              icon={Megaphone}
              tone={cplTone}
            />
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
              {t('exportCsv')}
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
              {t('exportCsv')}
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
              {t('exportCsv')}
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
              {t('exportCsv')}
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
              title={t('riskAttendanceBelow70')}
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
              {t('exportCsv')}
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
      ) : null}
    </div>
  );
}
