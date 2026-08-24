import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  Check,
  CircleDollarSign,
  Clock3,
  Info,
  Landmark,
  Loader2,
  Plus,
  ReceiptText,
  RotateCcw,
  Settings2,
  TrendingUp,
  UserRound,
  WalletCards,
  XCircle,
} from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { submitOnEnter } from '@/lib/submitOnEnter';
import {
  currentFinancePeriod,
  financeCopy,
  financeRoutes,
  type FinanceSection,
} from '@/lib/financeCenter';
import { FinanceError, FinanceLoading, FinanceMetric } from '@/components/finance/FinanceMetrics';
import { IncomeRegistryTable } from '@/components/finance/IncomeRegistryTable';
import { StatusBadge } from '@/components/finance/StatusBadge';
import { TransactionTable } from '@/components/finance/TransactionTable';
import { PageHeader } from '@/components/ux/PageHeader';
import { ReportingDateRangeFilter } from '@/components/ux/ReportingDateRangeFilter';
import { FinanceAnalyticsCharts } from '@/components/ux/analytics/FinanceAnalyticsCharts';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import { ModulePage, ModulePageBody } from '@/components/ux/ModulePage';
import { StaggerGroup, useChartEntrance } from '@/components/ux/motion';
import { CurrencyInput } from '@/components/ux/FormattedInputs';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { DataTable } from '@/components/ux/DataTable';
import type { DataTableColumn } from '@/components/ux/DataTable';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  isReportingPresetKey,
  reportingRangeForPreset,
  reportingRangeQuery,
} from '@/lib/reportingDateRange';
import { useStickyState } from '@/hooks/useStickyState';
import { ACADEMY_TIME_ZONE, academyToday } from '@/lib/localeFormat';
import type { ExpenseRegistryRow, Row } from '@/lib/financeRows';

interface DashboardData {
  period: string;
  from: string;
  to: string;
  summary: {
    revenue: number;
    operatingExpenses: number;
    payrollExpenses: number;
    marketingExpenses: number;
    totalExpenses: number;
    netProfit: number;
    marginPercent: number;
    payrollDueUzs: number;
    profitChangePercent: number;
  };
  trend: Array<{
    periodStart: string;
    revenue: number;
    operatingExpenses: number;
    payrollExpenses: number;
    marketingExpenses: number;
    totalExpenses: number;
    netProfit: number;
  }>;
  expenseBreakdown: Array<{ category: string; amount: number }>;
  recentTransactions: Row[];
}

interface IncomeData {
  period: string;
  rows: Row[];
  summary: { revenueUzs: number; paidCount: number; averagePaymentUzs: number; refundedUzs: number };
}

interface ExpenseData {
  period: string;
  operating: Row[];
  marketing: Row[];
  summary: { paidOperatingUzs: number; plannedOperatingUzs: number; marketingUzs: number; totalRecognizedUzs: number };
}

interface PayrollData {
  period: string;
  entries: Row[];
  salaryHistory: Row[];
  summary: { payrollFundUzs: number; paidAmountUzs: number; pendingAmountUzs: number; pendingCount: number; unconfiguredCount: number };
}

interface TransactionData { period: string; rows: Row[] }

const EXPENSE_CATEGORIES = ['rent', 'equipment', 'supplies', 'utilities', 'software', 'taxes', 'marketing', 'transport', 'maintenance', 'other'] as const;
const PAYMENT_METHODS = ['transfer', 'cash', 'card'] as const;
const PIE_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];

const currentDateOnly = academyToday;

const initials = (name: string) => name
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0])
  .join('')
  .toUpperCase();

export default function FinanceCenter({ section = 'overview' }: { section?: FinanceSection }) {
  // Draws once on mount; later refetches update the geometry silently.
  const chartEntrance = useChartEntrance();
  const { language, t } = useTranslation();
  const copy = financeCopy(t);
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState(currentFinancePeriod);
  // The reporting preset sticks across section switches (see useStickyState).
  const [storedReportingPreset, setStoredReportingPreset] = useStickyState<string>('finance-range', 'today');
  const [reportingRange, setReportingRange] = useState(() => (
    isReportingPresetKey(storedReportingPreset)
      ? reportingRangeForPreset(storedReportingPreset)
      : reportingRangeForPreset('today')
  ));
  const handleReportingRangeChange = useCallback((next: typeof reportingRange) => {
    setReportingRange(next);
    setStoredReportingPreset(next.preset);
  }, [setStoredReportingPreset]);
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  const [salaryDialogOpen, setSalaryDialogOpen] = useState(false);
  const [payoutTarget, setPayoutTarget] = useState<Row | null>(null);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Row | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [payTarget, setPayTarget] = useState<Row | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [transactionFilter, setTransactionFilter] = useState('all');
  
  const defaultExpenseForm = useMemo(() => ({
    category: 'other', title: '', vendor: '', description: '', amountUzs: '',
    expenseDate: currentDateOnly(), status: 'paid', method: 'transfer',
  }), []);
  const [expenseForm, setExpenseForm] = useState(defaultExpenseForm);
  const [initialExpenseForm, setInitialExpenseForm] = useState(defaultExpenseForm);

  const [salaryForm, setSalaryForm] = useState({ employeeUserId: '', amountUzs: '', effectiveMonth: period, note: '' });
  const [initialSalaryForm, setInitialSalaryForm] = useState({ employeeUserId: '', amountUzs: '', effectiveMonth: period, note: '' });

  const [payoutForm, setPayoutForm] = useState({ bonusUzs: '', deductionUzs: '', method: 'transfer', note: '' });
  const [initialPayoutForm, setInitialPayoutForm] = useState({ bonusUzs: '', deductionUzs: '', method: 'transfer', note: '' });

  const locale = language === 'ru' ? 'ru-RU' : 'en-US';
  const money = (value: number) => `${Number(value || 0).toLocaleString(locale)}${t('uzs')}`;
  const compactMoney = (value: number) => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value || 0));
  const compactCurrency = (value: number) => `${compactMoney(value)}${t('uzs')}`;
  const date = (value: unknown) => value ? new Date(String(value)).toLocaleDateString(locale, { timeZone: ACADEMY_TIME_ZONE }) : '—';
  const dateTime = (value: unknown) => value ? new Date(String(value)).toLocaleString(locale, { timeZone: ACADEMY_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const monthLabel = (value: string) => new Date(`${value}-15T12:00:00+05:00`).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: ACADEMY_TIME_ZONE });
  const categoryLabel = (value: string) => {
    const labels: Record<string, string> = {
      student_payments: copy.studentPayments, income: copy.studentPayments, payroll: copy.payrollCategory,
      operating_expense: copy.operatingSource, marketing_expense: copy.marketing, ...Object.fromEntries(EXPENSE_CATEGORIES.map((category) => [category, copy[category]])),
    };
    return labels[value] ?? copy.other;
  };
  const methodLabel = (value: string) => ({ cash: copy.cash, transfer: copy.transfer, card: copy.card }[value] ?? value);
  const reportingQuery = reportingRangeQuery(reportingRange);
  const reportingDateLabel = (value: string) => new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));

  const dashboard = useQuery<DashboardData>({
    queryKey: ['finance', 'dashboard', reportingQuery],
    queryFn: () => apiRequest('GET', `/api/finance/dashboard?${reportingQuery}`),
    enabled: section === 'overview',
    placeholderData: (previousData) => previousData,
  });
  const income = useQuery<IncomeData>({
    queryKey: ['finance', 'income', period],
    queryFn: () => apiRequest('GET', `/api/finance/income?period=${period}`),
    enabled: section === 'income',
  });
  const expenses = useQuery<ExpenseData>({
    queryKey: ['finance', 'expenses', period],
    queryFn: () => apiRequest('GET', `/api/finance/expenses?period=${period}`),
    enabled: section === 'expenses',
  });
  const payroll = useQuery<PayrollData>({
    queryKey: ['finance', 'payroll', period],
    queryFn: () => apiRequest('GET', `/api/finance/payroll?period=${period}`),
    enabled: section === 'payroll',
  });
  const transactions = useQuery<TransactionData>({
    queryKey: ['finance', 'transactions', period],
    queryFn: () => apiRequest('GET', `/api/finance/transactions?period=${period}`),
    enabled: section === 'transactions',
  });

  const invalidateFinance = () => queryClient.invalidateQueries({ queryKey: ['finance'] });
  const createExpense = useMutation({
    mutationFn: () => apiRequest('POST', '/api/finance/expenses', { ...expenseForm, amountUzs: Number(expenseForm.amountUzs) }),
    onSuccess: () => {
      toast({ title: copy.saved });
      setExpenseDialogOpen(false);
      setExpenseForm(defaultExpenseForm);
      setInitialExpenseForm(defaultExpenseForm);
      invalidateFinance();
    },
    onError: (error: Error) => toast({ title: copy.error, description: error.message, variant: 'destructive' }),
  });
  const saveSalary = useMutation({
    mutationFn: () => apiRequest('POST', '/api/finance/salary-rates', {
      employeeUserId: Number(salaryForm.employeeUserId), amountUzs: Number(salaryForm.amountUzs),
      effectiveFrom: `${salaryForm.effectiveMonth}-01`, note: salaryForm.note,
    }),
    onSuccess: () => { toast({ title: copy.saved }); setSalaryDialogOpen(false); setInitialSalaryForm(salaryForm); invalidateFinance(); },
    onError: (error: Error) => toast({ title: copy.error, description: error.message, variant: 'destructive' }),
  });
  const savePayout = useMutation({
    mutationFn: () => apiRequest('POST', '/api/finance/payroll/payout', {
      period, employeeUserId: payoutTarget!.employeeUserId, bonusUzs: Number(payoutForm.bonusUzs || 0),
      deductionUzs: Number(payoutForm.deductionUzs || 0), method: payoutForm.method, note: payoutForm.note,
    }),
    onSuccess: () => { toast({ title: copy.payoutSaved }); setPayoutTarget(null); setInitialPayoutForm(payoutForm); invalidateFinance(); },
    onError: (error: Error) => toast({ title: copy.error, description: error.message, variant: 'destructive' }),
  });
  const payAll = useMutation({
    mutationFn: () => apiRequest('POST', '/api/finance/payroll/payout-all', { period, method: 'transfer' }),
    onSuccess: () => { toast({ title: copy.batchSaved }); setBatchDialogOpen(false); invalidateFinance(); },
    onError: (error: Error) => toast({ title: copy.error, description: error.message, variant: 'destructive' }),
  });
  const payExpense = useMutation({
    mutationFn: (id: number) => apiRequest('POST', `/api/finance/expenses/${id}/pay`, { method: 'transfer' }),
    onSuccess: () => { toast({ title: copy.expensePaid }); invalidateFinance(); },
    onError: (error: Error) => toast({ title: copy.error, description: error.message, variant: 'destructive' }),
  });
  const cancelExpense = useMutation({
    mutationFn: () => apiRequest('POST', `/api/finance/expenses/${cancelTarget!.id}/cancel`, { reason: cancelReason }),
    onSuccess: () => { toast({ title: copy.expenseCancelled }); setCancelTarget(null); setCancelReason(''); invalidateFinance(); },
    onError: (error: Error) => toast({ title: copy.error, description: error.message, variant: 'destructive' }),
  });

  const selectedPayrollEntry = payroll.data?.entries.find((entry) => entry.employeeUserId === selectedEmployeeId)
    ?? payroll.data?.entries[0]
    ?? null;
  const selectedSalaryHistory = useMemo(
    () => payroll.data?.salaryHistory.filter((rate) => rate.employeeUserId === selectedPayrollEntry?.employeeUserId) ?? [],
    [payroll.data?.salaryHistory, selectedPayrollEntry?.employeeUserId],
  );
  const filteredTransactions = useMemo(() => {
    const rows = transactions.data?.rows ?? [];
    if (transactionFilter === 'income') return rows.filter((row) => row.direction === 'in');
    if (transactionFilter === 'expense') return rows.filter((row) => row.direction === 'out');
    return rows;
  }, [transactionFilter, transactions.data?.rows]);

  const sectionTitle = {
    overview: copy.module, income: copy.income, expenses: copy.expenses, payroll: copy.payroll, transactions: copy.transactions,
  }[section];
  const sectionSubtitle = {
    overview: copy.subtitle, income: copy.incomeSubtitle, expenses: copy.expensesSubtitle, payroll: copy.payrollSubtitle, transactions: copy.transactionsSubtitle,
  }[section];

  const openSalaryDialog = (entry?: Row | null) => {
    const target = entry ?? selectedPayrollEntry ?? payroll.data?.entries[0];
    const form = {
      employeeUserId: target ? String(target.employeeUserId) : '',
      amountUzs: target?.baseSalaryUzs ? String(target.baseSalaryUzs) : '',
      effectiveMonth: period,
      note: '',
    };
    setSalaryForm(form);
    setInitialSalaryForm(form);
    setSalaryDialogOpen(true);
  };
  const openPayoutDialog = (entry: Row) => {
    setPayoutTarget(entry);
    const form = { bonusUzs: '', deductionUzs: '', method: 'transfer', note: '' };
    setPayoutForm(form);
    setInitialPayoutForm(form);
  };
  const payoutTotal = payoutTarget
    ? Math.max(0, Number(payoutTarget.baseSalaryUzs || 0) + Number(payoutForm.bonusUzs || 0) - Number(payoutForm.deductionUzs || 0))
    : 0;

  const canSaveExpense = Boolean(expenseForm.title.trim())
    && Number(expenseForm.amountUzs) > 0
    && !createExpense.isPending;

  const expenseGuard = useUnsavedChangesGuard({
    open: expenseDialogOpen,
    isDirty: JSON.stringify(expenseForm) !== JSON.stringify(initialExpenseForm),
    onOpenChange: setExpenseDialogOpen,
  });

  const salaryGuard = useUnsavedChangesGuard({
    open: salaryDialogOpen,
    isDirty: JSON.stringify(salaryForm) !== JSON.stringify(initialSalaryForm),
    onOpenChange: setSalaryDialogOpen,
  });

  const payoutGuard = useUnsavedChangesGuard({
    open: Boolean(payoutTarget),
    isDirty: JSON.stringify(payoutForm) !== JSON.stringify(initialPayoutForm),
    onOpenChange: (open) => !open && setPayoutTarget(null),
  });

  const activeQuery = section === 'overview' ? dashboard : section === 'income' ? income : section === 'expenses' ? expenses : section === 'payroll' ? payroll : transactions;
  const contained = section !== 'overview';

  return (
    <ModulePage contained={contained} className="flex flex-col gap-4">
      <PageHeader
        title={sectionTitle}
        subtitle={sectionSubtitle}
        breadcrumbs={[{ label: copy.module, href: financeRoutes.overview }, ...(section === 'overview' ? [] : [{ label: sectionTitle }])]}
        actions={(
          <>
            {section !== 'overview' ? (
              <Input aria-label={copy.calculationMonth} type="month" value={period} onChange={(event) => setPeriod(event.target.value || currentFinancePeriod())} className="w-[165px]" />
            ) : null}
            {section === 'expenses' ? (
              <Button onClick={() => {
                setExpenseForm(defaultExpenseForm);
                setInitialExpenseForm(defaultExpenseForm);
                setExpenseDialogOpen(true);
              }}><Plus data-icon="inline-start" />{copy.addExpense}</Button>
            ) : null}
            {section === 'payroll' ? (
              <Button onClick={() => openSalaryDialog()}><Settings2 data-icon="inline-start" />{copy.configureSalary}</Button>
            ) : null}
          </>
        )}
      />

      <ModulePageBody contained={contained} ariaLabel={sectionTitle} className="flex flex-col gap-4">

      {section === 'overview' ? (
        <ReportingDateRangeFilter
          value={reportingRange}
          onChange={handleReportingRangeChange}
          isFetching={dashboard.isFetching}
        />
      ) : null}

      {activeQuery.isLoading ? (
        <FinanceLoading
          showAnalytics={section === 'overview'}
          metricCards={section === 'overview' ? 5 : 4}
        />
      ) : null}
      {activeQuery.isError ? <FinanceError copy={copy} onRetry={() => activeQuery.refetch()} /> : null}

      {section === 'overview' && dashboard.data ? (
        <div className="flex flex-col gap-4">
          <StaggerGroup count={5} className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[1.6fr_repeat(4,minmax(0,1fr))]">
            <FinanceMetric
              label={copy.netProfit}
              value={compactCurrency(dashboard.data.summary.netProfit)}
              fullValue={money(dashboard.data.summary.netProfit)}
              icon={TrendingUp}
              tone={dashboard.data.summary.netProfit >= 0 ? 'success' : 'danger'}
              large
              detail={(
                <div className="flex flex-col gap-2">
                  <span className={cn('flex items-center gap-1 font-medium', dashboard.data.summary.profitChangePercent >= 0 ? 'text-emerald-700' : 'text-destructive')}>
                    {dashboard.data.summary.profitChangePercent >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                    {dashboard.data.summary.profitChangePercent > 0 ? '+' : ''}{Math.round(dashboard.data.summary.profitChangePercent)}% {copy.vsPreviousPeriod}
                  </span>
                  <span>{copy.profitFormula}</span>
                </div>
              )}
            />
            <FinanceMetric label={copy.revenue} value={compactCurrency(dashboard.data.summary.revenue)} fullValue={money(dashboard.data.summary.revenue)} icon={ArrowUpRight} tone="success" />
            <FinanceMetric label={copy.allExpenses} value={compactCurrency(dashboard.data.summary.totalExpenses)} fullValue={money(dashboard.data.summary.totalExpenses)} icon={ArrowDownRight} tone="danger" />
            <FinanceMetric
              label={copy.margin}
              value={dashboard.data.summary.revenue > 0 ? `${dashboard.data.summary.marginPercent}%` : t('noData')}
              icon={TrendingUp}
              tone={dashboard.data.summary.revenue > 0 ? 'success' : 'neutral'}
            />
            <FinanceMetric label={copy.duePayroll} value={compactCurrency(dashboard.data.summary.payrollDueUzs)} fullValue={money(dashboard.data.summary.payrollDueUzs)} icon={WalletCards} tone="warning" />
          </StaggerGroup>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.55fr_1fr]">
            <Card className="border-border/60 shadow-sm">
              <CardHeader className="flex-row items-start justify-between gap-3 px-4 pb-2 pt-3.5">
                <div>
                  <CardTitle className="text-[15px]">{copy.profitTrend}</CardTitle>
                  <CardDescription className="mt-0.5 text-xs">{reportingDateLabel(dashboard.data.from)} — {reportingDateLabel(dashboard.data.to)}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="h-[258px] px-4 pb-4 pt-0">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={dashboard.data.trend} margin={{ top: 8, right: 4, left: -4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="periodStart" tickFormatter={reportingDateLabel} axisLine={false} tickLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }} />
                    <YAxis tickFormatter={compactMoney} axisLine={false} tickLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }} width={58} />
                    <RechartsTooltip formatter={(value: number, name: string) => [money(value), name === 'revenue' ? copy.revenue : name === 'totalExpenses' ? copy.allExpenses : copy.netProfit]} labelFormatter={(value) => reportingDateLabel(String(value))} contentStyle={{ borderRadius: 10, borderColor: 'var(--border)', boxShadow: 'var(--shadow-md)' }} />
                    <Legend formatter={(value) => value === 'revenue' ? copy.revenue : value === 'totalExpenses' ? copy.allExpenses : copy.netProfit} />
                    <Bar dataKey="revenue" fill="var(--chart-2)" radius={[5, 5, 0, 0]} maxBarSize={30} isAnimationActive={chartEntrance} />
                    <Bar dataKey="totalExpenses" fill="var(--chart-5)" radius={[5, 5, 0, 0]} maxBarSize={30} isAnimationActive={chartEntrance} />
                    <Line type="monotone" dataKey="netProfit" stroke="var(--chart-1)" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} isAnimationActive={chartEntrance} />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="border-border/60 shadow-sm">
              <CardHeader className="px-4 pb-2 pt-3.5">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-[15px]">{copy.expenseStructure}</CardTitle>
                  <Tooltip><TooltipTrigger asChild><button type="button" aria-label={copy.methodology}><Info className="size-4 text-muted-foreground" /></button></TooltipTrigger><TooltipContent className="max-w-xs">{copy.methodology}</TooltipContent></Tooltip>
                </div>
                <CardDescription className="mt-0.5 text-xs">{money(dashboard.data.summary.totalExpenses)}</CardDescription>
              </CardHeader>
              <CardContent className="grid min-h-[220px] gap-3 px-4 pb-4 pt-0 sm:grid-cols-[145px_1fr] sm:items-center">
                {dashboard.data.expenseBreakdown.length ? (
                  <ResponsiveContainer width="100%" height={150}>
                    <PieChart><Pie data={dashboard.data.expenseBreakdown} dataKey="amount" nameKey="category" innerRadius={40} outerRadius={66} paddingAngle={2} isAnimationActive={chartEntrance}>{dashboard.data.expenseBreakdown.map((item, index) => <Cell key={item.category} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}</Pie><RechartsTooltip formatter={(value: number) => money(value)} /></PieChart>
                  </ResponsiveContainer>
                ) : <div className="flex h-[150px] items-center justify-center text-sm text-muted-foreground">{copy.noData}</div>}
                <div className="flex flex-col gap-2">
                  {dashboard.data.expenseBreakdown.map((item, index) => (
                    <div key={item.category} className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2"><span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }} /><span className="truncate text-muted-foreground">{categoryLabel(item.category)}</span></span>
                      <span className="whitespace-nowrap font-medium tabular-nums">{money(item.amount)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>

          <FinanceAnalyticsCharts
            trend={dashboard.data.trend}
            summary={dashboard.data.summary}
            dateLabel={reportingDateLabel}
            money={money}
            compactMoney={compactMoney}
          />

          <Card className="overflow-hidden">
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-4 border-b border-border/70">
              <CardTitle>{copy.recentTransactions}</CardTitle>
              <Button asChild variant="ghost" size="sm"><Link href={financeRoutes.transactions}>{copy.seeAllTransactions}<ArrowUpRight data-icon="inline-end" /></Link></Button>
            </CardHeader>
            <CardContent className="p-0"><TransactionTable rows={dashboard.data.recentTransactions} copy={copy} money={money} dateTime={dateTime} categoryLabel={categoryLabel} /></CardContent>
          </Card>
        </div>
      ) : null}

      {section === 'income' && income.data ? (
        <div className="flex flex-col gap-5">
          <StaggerGroup count={4} className="grid grid-cols-tile gap-4">
            <FinanceMetric label={copy.revenue} value={money(income.data.summary.revenueUzs)} icon={CircleDollarSign} tone="success" />
            <FinanceMetric label={copy.paymentCount} value={String(income.data.summary.paidCount)} icon={ReceiptText} />
            <FinanceMetric label={copy.averagePayment} value={money(income.data.summary.averagePaymentUzs)} icon={TrendingUp} />
            <FinanceMetric label={copy.refunds} value={money(income.data.summary.refundedUzs)} icon={RotateCcw} tone={income.data.summary.refundedUzs > 0 ? 'danger' : 'neutral'} />
          </StaggerGroup>
          <Card className="overflow-hidden">
            <CardHeader className="border-b border-border/70"><CardTitle>{copy.incomeRegistry}</CardTitle><CardDescription>{monthLabel(period)}</CardDescription></CardHeader>
            <CardContent className="p-0">
              <IncomeRegistryTable rows={income.data.rows} copy={copy} money={money} dateTime={dateTime} methodLabel={methodLabel} />
            </CardContent>
          </Card>
        </div>
      ) : null}

      {section === 'expenses' && expenses.data ? (
        <div className="flex flex-col gap-5">
          <StaggerGroup count={4} className="grid grid-cols-tile gap-4">
            <FinanceMetric label={copy.totalRecognized} value={money(expenses.data.summary.totalRecognizedUzs)} icon={Banknote} tone="danger" />
            <FinanceMetric label={copy.operatingPaid} value={money(expenses.data.summary.paidOperatingUzs)} icon={ReceiptText} />
            <FinanceMetric label={copy.marketing} value={money(expenses.data.summary.marketingUzs)} icon={TrendingUp} />
            <FinanceMetric label={copy.planned} value={money(expenses.data.summary.plannedOperatingUzs)} icon={Clock3} tone="warning" />
          </StaggerGroup>
          <Card className="overflow-hidden">
            <CardHeader className="border-b border-border/70"><CardTitle>{copy.expenseRegistry}</CardTitle><CardDescription>{copy.methodology}</CardDescription></CardHeader>
            <CardContent className="p-0">
              <DataTable
                className="overflow-auto overscroll-contain max-h-[min(70dvh,48rem)] [scrollbar-gutter:stable]"
                columns={[
                  {
                    key: 'expenseDate',
                    header: copy.date,
                    accessor: (row: ExpenseRegistryRow) => new Date(String(row.entryKind === 'operating' ? row.expenseDate : row.periodStart || 0)).getTime() || 0,
                    render: (row: ExpenseRegistryRow) => date(row.entryKind === 'operating' ? row.expenseDate : row.periodStart),
                    sortable: true,
                    cellClassName: 'whitespace-nowrap text-muted-foreground',
                  },
                  {
                    key: 'title',
                    header: copy.title,
                    accessor: (row: ExpenseRegistryRow) => (row.entryKind === 'operating' ? row.title : row.campaignName || row.channel || ''),
                    render: (row: ExpenseRegistryRow) => (
                      <span className="block max-w-[280px] truncate font-medium" title={row.entryKind === 'operating' ? row.title : row.campaignName || row.channel}>
                        {row.entryKind === 'operating' ? row.title : row.campaignName || row.channel}
                      </span>
                    ),
                    sortable: true,
                    mobilePrimary: true,
                  },
                  {
                    key: 'source',
                    header: copy.source,
                    accessor: (row: ExpenseRegistryRow) => row.entryKind,
                    render: (row: ExpenseRegistryRow) => (
                      <Badge variant={row.entryKind === 'marketing' ? 'purple' : 'outline'}>
                        {row.entryKind === 'marketing' ? copy.marketingSource : copy.operatingSource}
                      </Badge>
                    ),
                    sortable: true,
                  },
                  {
                    key: 'category',
                    header: copy.category,
                    accessor: (row: ExpenseRegistryRow) => (row.entryKind === 'operating' ? categoryLabel(row.category) : copy.marketing),
                    sortable: true,
                  },
                  {
                    key: 'vendor',
                    header: copy.vendor,
                    accessor: (row: ExpenseRegistryRow) => (row.entryKind === 'operating' ? row.vendor || '' : row.sourceName || row.channel || ''),
                    render: (row: ExpenseRegistryRow) => (row.entryKind === 'operating' ? row.vendor || '—' : row.sourceName || row.channel || '—'),
                    sortable: true,
                  },
                  {
                    key: 'status',
                    header: copy.status,
                    accessor: (row: ExpenseRegistryRow) => row.status || '',
                    render: (row: ExpenseRegistryRow) => <StatusBadge status={row.status} copy={copy} />,
                    sortable: true,
                  },
                  {
                    key: 'amountUzs',
                    header: copy.amount,
                    accessor: (row: ExpenseRegistryRow) => Number((row.entryKind === 'marketing' ? row.recognizedAmountUzs || row.amountUzs : row.amountUzs) || 0),
                    render: (row: ExpenseRegistryRow) => money(row.entryKind === 'marketing' ? row.recognizedAmountUzs || row.amountUzs : row.amountUzs),
                    sortable: true,
                    cellClassName: 'whitespace-nowrap text-right font-semibold tabular-nums',
                  },
                  {
                    key: 'actions',
                    header: copy.actions,
                    cellClassName: 'text-right',
                    mobileLabel: '',
                    render: (row: ExpenseRegistryRow) => (
                      <div className="flex justify-end gap-1">
                        {row.entryKind === 'operating' && row.status === 'planned' ? (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setPayTarget(row)} disabled={payExpense.isPending}><Check data-icon="inline-start" />{copy.pay}</Button>
                            <Button size="icon" variant="ghost" aria-label={copy.cancel} onClick={() => setCancelTarget(row)}><XCircle /></Button>
                          </>
                        ) : null}
                      </div>
                    ),
                  },
                ] satisfies DataTableColumn<ExpenseRegistryRow>[]}
                data={[
                  ...expenses.data.operating.map((row): ExpenseRegistryRow => ({ ...row, entryKind: 'operating' })),
                  ...expenses.data.marketing.map((row): ExpenseRegistryRow => ({ ...row, entryKind: 'marketing' })),
                ]}
                keyExtractor={(row) => `${row.entryKind}-${row.id}`}
                emptyState={<div className="py-12 text-center text-sm text-muted-foreground">{copy.noData}</div>}
              />
            </CardContent>
          </Card>
        </div>
      ) : null}

      {section === 'payroll' && payroll.data ? (
        <div className="flex flex-col gap-5">
          <StaggerGroup count={3} className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <FinanceMetric label={copy.salaryFund} value={money(payroll.data.summary.payrollFundUzs)} icon={WalletCards} />
            <FinanceMetric label={copy.paidPayroll} value={money(payroll.data.summary.paidAmountUzs)} icon={Check} tone="success" />
            <FinanceMetric label={copy.remainingPayroll} value={money(payroll.data.summary.pendingAmountUzs)} icon={Clock3} tone="warning" />
          </StaggerGroup>
          <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Card className="overflow-hidden">
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-4 border-b border-border/70"><div><CardTitle>{copy.payrollStatement}</CardTitle><CardDescription>{monthLabel(period)}</CardDescription></div><Button variant="outline" onClick={() => setBatchDialogOpen(true)} disabled={!payroll.data.summary.pendingCount}><UserRound data-icon="inline-start" />{copy.payAll}</Button></CardHeader>
              <CardContent className="p-0">
                <DataTable
                  className="overflow-auto overscroll-contain max-h-[min(70dvh,48rem)] [scrollbar-gutter:stable]"
                  columns={[
                    {
                      key: 'employeeName',
                      header: copy.employee,
                      accessor: (row: Row) => row.employeeName || '',
                      render: (row: Row) => (
                        <div className="flex items-center gap-3">
                          <Avatar className="hidden size-9 sm:flex"><AvatarFallback>{initials(row.employeeName)}</AvatarFallback></Avatar>
                          <span className="min-w-0 truncate font-medium">{row.employeeName}</span>
                        </div>
                      ),
                      sortable: true,
                      mobilePrimary: true,
                    },
                    { key: 'position', header: copy.position, accessor: (row: Row) => row.position || '', render: (row: Row) => <span className="text-muted-foreground">{row.position || '—'}</span>, sortable: true },
                    {
                      key: 'baseSalaryUzs',
                      header: copy.salary,
                      accessor: (row: Row) => Number(row.baseSalaryUzs || 0),
                      render: (row: Row) => money(row.baseSalaryUzs),
                      sortable: true,
                      cellClassName: 'whitespace-nowrap text-right tabular-nums',
                    },
                    {
                      key: 'bonusUzs',
                      header: copy.bonus,
                      accessor: (row: Row) => (row.status === 'paid' ? Number(row.bonusUzs || 0) : -1),
                      render: (row: Row) => (row.status === 'paid' ? money(row.bonusUzs) : '—'),
                      sortable: true,
                      cellClassName: 'whitespace-nowrap text-right tabular-nums',
                    },
                    {
                      key: 'deductionUzs',
                      header: copy.deduction,
                      accessor: (row: Row) => (row.status === 'paid' ? Number(row.deductionUzs || 0) : -1),
                      render: (row: Row) => (row.status === 'paid' ? money(row.deductionUzs) : '—'),
                      sortable: true,
                      cellClassName: 'whitespace-nowrap text-right tabular-nums',
                    },
                    {
                      key: 'amountUzs',
                      header: copy.payoutAmount,
                      accessor: (row: Row) => Number(row.amountUzs ?? row.baseSalaryUzs ?? 0),
                      render: (row: Row) => money(row.amountUzs ?? row.baseSalaryUzs),
                      sortable: true,
                      cellClassName: 'whitespace-nowrap text-right font-semibold tabular-nums',
                    },
                    {
                      key: 'status',
                      header: copy.status,
                      accessor: (row: Row) => row.status || '',
                      render: (row: Row) => (
                        <div className="flex flex-col items-start gap-1">
                          <StatusBadge status={row.status} copy={copy} />
                          {row.paidAt ? <span className="text-xs text-muted-foreground">{date(row.paidAt)}</span> : null}
                        </div>
                      ),
                      sortable: true,
                    },
                    {
                      key: 'actions',
                      header: copy.actions,
                      cellClassName: 'text-right',
                      mobileLabel: '',
                      render: (row: Row) => (
                        <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
                          {row.status === 'pending' ? (
                            <Button size="sm" onClick={() => openPayoutDialog(row)}>{copy.pay}</Button>
                          ) : row.status === 'unconfigured' ? (
                            <Button size="sm" variant="outline" onClick={() => openSalaryDialog(row)}>{copy.configureSalary}</Button>
                          ) : null}
                        </div>
                      ),
                    },
                  ] satisfies DataTableColumn<Row>[]}
                  data={payroll.data.entries}
                  keyExtractor={(row) => String(row.employeeUserId)}
                  onRowClick={(row) => setSelectedEmployeeId(row.employeeUserId)}
                  rowClassName={(row) => (selectedPayrollEntry?.employeeUserId === row.employeeUserId ? 'bg-accent/40' : '')}
                  emptyState={<div className="py-12 text-center text-sm text-muted-foreground">{copy.noData}</div>}
                />
              </CardContent>
            </Card>
            <div className="flex flex-col gap-5">
              <Card>
                <CardHeader><CardTitle>{copy.employee}</CardTitle></CardHeader>
                <CardContent>
                  {selectedPayrollEntry ? <div className="flex flex-col gap-5"><div className="flex items-center gap-3"><Avatar className="size-12"><AvatarFallback>{initials(selectedPayrollEntry.employeeName)}</AvatarFallback></Avatar><div><p className="font-semibold">{selectedPayrollEntry.employeeName}</p><p className="text-sm text-muted-foreground">{selectedPayrollEntry.position || '—'}</p></div></div><div className="grid grid-cols-1 gap-4 border-t border-border/70 pt-4"><div><p className="text-xs text-muted-foreground">{copy.currentSalary}</p><p className="mt-1 text-2xl font-bold text-emerald-700 tabular-nums">{money(selectedPayrollEntry.baseSalaryUzs)}</p></div><div><p className="text-xs text-muted-foreground">{copy.effectiveFrom}</p><p className="mt-1 text-sm font-medium">{date(selectedPayrollEntry.effectiveFrom)}</p></div></div></div> : <p className="text-sm text-muted-foreground">{copy.selectEmployee}</p>}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>{copy.salaryHistory}</CardTitle></CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-5">
                    {selectedSalaryHistory.map((rate, index) => <div key={rate.id} className="relative flex gap-3"><div className="flex flex-col items-center"><span className={cn('mt-1 size-2.5 rounded-full', index === 0 ? 'bg-emerald-500' : 'bg-primary')} />{index < selectedSalaryHistory.length - 1 ? <span className="mt-1 h-full w-px bg-border" /> : null}</div><div className="min-w-0 pb-2"><p className="font-semibold tabular-nums">{money(rate.amountUzs)}</p><p className="mt-1 text-xs text-muted-foreground">{date(rate.effectiveFrom)}{rate.effectiveTo ? ` — ${date(rate.effectiveTo)}` : ''}</p>{rate.note ? <p className="mt-1 text-xs text-muted-foreground">{rate.note}</p> : null}</div></div>)}
                    {!selectedSalaryHistory.length ? <p className="text-sm text-muted-foreground">{copy.noSalaryHistory}</p> : null}
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>
        </div>
      ) : null}

      {section === 'transactions' && transactions.data ? (
        <Card className="overflow-hidden">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-4 border-b border-border/70"><div><CardTitle>{copy.transactions}</CardTitle><CardDescription>{monthLabel(period)}</CardDescription></div><Select value={transactionFilter} onValueChange={setTransactionFilter}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">{copy.all}</SelectItem><SelectItem value="income">{copy.incoming}</SelectItem><SelectItem value="expense">{copy.outgoing}</SelectItem></SelectGroup></SelectContent></Select></CardHeader>
          <CardContent className="p-0"><TransactionTable rows={filteredTransactions} copy={copy} money={money} dateTime={dateTime} categoryLabel={categoryLabel} /></CardContent>
        </Card>
      ) : null}

      <Dialog open={expenseDialogOpen} onOpenChange={expenseGuard.handleOpenChange}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[620px]">
          <DialogHeader className="shrink-0 border-b border-border/60 px-6 py-4 text-left"><DialogTitle>{copy.expenseDialogTitle}</DialogTitle><DialogDescription>{copy.expenseDialogDescription}</DialogDescription></DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
            <FieldGroup className="gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field><FieldLabel htmlFor="expense-title">{copy.title}</FieldLabel><Input id="expense-title" value={expenseForm.title} onChange={(event) => setExpenseForm((form) => ({ ...form, title: event.target.value }))} onKeyDown={submitOnEnter(() => createExpense.mutate(), { disabled: !canSaveExpense })} /></Field>
              <Field><FieldLabel>{copy.category}</FieldLabel><Select value={expenseForm.category} onValueChange={(category) => setExpenseForm((form) => ({ ...form, category }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{EXPENSE_CATEGORIES.map((category) => <SelectItem key={category} value={category}>{categoryLabel(category)}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
              <Field><FieldLabel htmlFor="expense-vendor">{copy.vendor}</FieldLabel><Input id="expense-vendor" value={expenseForm.vendor} onChange={(event) => setExpenseForm((form) => ({ ...form, vendor: event.target.value }))} onKeyDown={submitOnEnter(() => createExpense.mutate(), { disabled: !canSaveExpense })} /></Field>
              <Field><FieldLabel htmlFor="expense-amount">{copy.amount}</FieldLabel><CurrencyInput id="expense-amount" value={expenseForm.amountUzs} onValueChange={(amountUzs) => setExpenseForm((form) => ({ ...form, amountUzs }))} /></Field>
              <Field><FieldLabel htmlFor="expense-date">{copy.expenseDate}</FieldLabel><Input id="expense-date" type="date" value={expenseForm.expenseDate} onChange={(event) => setExpenseForm((form) => ({ ...form, expenseDate: event.target.value }))} /></Field>
              <Field><FieldLabel>{copy.paymentStatus}</FieldLabel><Select value={expenseForm.status} onValueChange={(status) => setExpenseForm((form) => ({ ...form, status }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="paid">{copy.paid}</SelectItem><SelectItem value="planned">{copy.planned}</SelectItem></SelectGroup></SelectContent></Select></Field>
              <Field><FieldLabel>{copy.paymentMethod}</FieldLabel><Select value={expenseForm.method} onValueChange={(method) => setExpenseForm((form) => ({ ...form, method }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{PAYMENT_METHODS.map((method) => <SelectItem key={method} value={method}>{methodLabel(method)}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
            </div>
            <Field><FieldLabel htmlFor="expense-description">{copy.description}</FieldLabel><Textarea id="expense-description" value={expenseForm.description} onChange={(event) => setExpenseForm((form) => ({ ...form, description: event.target.value }))} /></Field>
            </FieldGroup>
          </div>
          <DialogFooter className="shrink-0 border-t bg-background/95 px-6 py-4"><Button variant="outline" onClick={() => expenseGuard.handleOpenChange(false)}>{copy.formCancel}</Button><Button disabled={!canSaveExpense} onClick={() => createExpense.mutate()}>{createExpense.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}{copy.saveExpense}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={salaryDialogOpen} onOpenChange={salaryGuard.handleOpenChange}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b border-border/60 px-6 py-4 text-left"><DialogTitle>{copy.salaryDialogTitle}</DialogTitle><DialogDescription>{copy.salaryDialogDescription}</DialogDescription></DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
            <FieldGroup className="gap-4">
            <Field><FieldLabel>{copy.employee}</FieldLabel><Select value={salaryForm.employeeUserId} onValueChange={(employeeUserId) => { const entry = payroll.data?.entries.find((item) => String(item.employeeUserId) === employeeUserId); setSalaryForm((form) => ({ ...form, employeeUserId, amountUzs: entry?.baseSalaryUzs ? String(entry.baseSalaryUzs) : '' })); }}><SelectTrigger><SelectValue placeholder={copy.employee} /></SelectTrigger><SelectContent><SelectGroup>{payroll.data?.entries.map((entry) => <SelectItem key={entry.employeeUserId} value={String(entry.employeeUserId)}>{entry.employeeName}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
            <Field><FieldLabel htmlFor="salary-amount">{copy.salary}</FieldLabel><CurrencyInput id="salary-amount" value={salaryForm.amountUzs} onValueChange={(amountUzs) => setSalaryForm((form) => ({ ...form, amountUzs }))} /></Field>
            <Field><FieldLabel htmlFor="salary-month">{copy.effectiveMonth}</FieldLabel><Input id="salary-month" type="month" value={salaryForm.effectiveMonth} onChange={(event) => setSalaryForm((form) => ({ ...form, effectiveMonth: event.target.value }))} /><FieldDescription>{copy.salaryDialogDescription}</FieldDescription></Field>
            <Field><FieldLabel htmlFor="salary-note">{copy.note}</FieldLabel><Textarea id="salary-note" value={salaryForm.note} onChange={(event) => setSalaryForm((form) => ({ ...form, note: event.target.value }))} /></Field>
            </FieldGroup>
          </div>
          <DialogFooter className="shrink-0 border-t bg-background/95 px-6 py-4"><Button variant="outline" onClick={() => salaryGuard.handleOpenChange(false)}>{copy.formCancel}</Button><Button disabled={!salaryForm.employeeUserId || !salaryForm.amountUzs || !salaryForm.effectiveMonth || saveSalary.isPending} onClick={() => saveSalary.mutate()}>{saveSalary.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}{copy.saveSalary}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(payoutTarget)} onOpenChange={payoutGuard.handleOpenChange}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b border-border/60 px-6 py-4 text-left"><DialogTitle>{copy.payoutDialogTitle}</DialogTitle><DialogDescription>{payoutTarget ? `${payoutTarget.employeeName} · ${payoutTarget.position || ''}` : ''}</DialogDescription></DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
            <FieldGroup className="gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field><FieldLabel htmlFor="payout-period">{copy.calculationMonth}</FieldLabel><Input id="payout-period" type="month" value={period} disabled /></Field>
              <Field><FieldLabel htmlFor="payout-salary">{copy.salary}</FieldLabel><CurrencyInput id="payout-salary" value={payoutTarget?.baseSalaryUzs || 0} onValueChange={() => undefined} disabled /></Field>
              <Field><FieldLabel htmlFor="payout-bonus">{copy.bonus}</FieldLabel><CurrencyInput id="payout-bonus" value={payoutForm.bonusUzs} onValueChange={(bonusUzs) => setPayoutForm((form) => ({ ...form, bonusUzs }))} /></Field>
              <Field><FieldLabel htmlFor="payout-deduction">{copy.deduction}</FieldLabel><CurrencyInput id="payout-deduction" value={payoutForm.deductionUzs} onValueChange={(deductionUzs) => setPayoutForm((form) => ({ ...form, deductionUzs }))} /></Field>
            </div>
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4"><p className="text-sm text-muted-foreground">{copy.payoutTotal}</p><p className="mt-1 text-2xl font-bold text-primary tabular-nums">{money(payoutTotal)}</p></div>
            <Field><FieldLabel>{copy.paymentMethod}</FieldLabel><Select value={payoutForm.method} onValueChange={(method) => setPayoutForm((form) => ({ ...form, method }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{PAYMENT_METHODS.map((method) => <SelectItem key={method} value={method}>{methodLabel(method)}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
            <Field><FieldLabel htmlFor="payout-note">{copy.note}</FieldLabel><Textarea id="payout-note" value={payoutForm.note} onChange={(event) => setPayoutForm((form) => ({ ...form, note: event.target.value }))} /></Field>
            </FieldGroup>
          </div>
          <DialogFooter className="shrink-0 border-t bg-background/95 px-6 py-4"><Button variant="outline" onClick={() => payoutGuard.handleOpenChange(false)}>{copy.formCancel}</Button><Button disabled={payoutTotal <= 0 || savePayout.isPending} onClick={() => savePayout.mutate()}>{savePayout.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}{copy.confirmPayout}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={batchDialogOpen} onOpenChange={setBatchDialogOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{copy.batchTitle}</AlertDialogTitle><AlertDialogDescription>{copy.batchDescription} {t('payAllConfirmCount').replace('{count}', String(payroll.data?.summary.pendingCount ?? 0))} {t('payAllConfirmTotal').replace('{amount}', money(payroll.data?.summary.pendingAmountUzs ?? 0))}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{copy.formCancel}</AlertDialogCancel><AlertDialogAction onClick={() => payAll.mutate()} disabled={payAll.isPending}>{copy.confirmBatch}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      <AlertDialog open={Boolean(payTarget)} onOpenChange={(open) => !open && setPayTarget(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{copy.confirmPayTitle}</AlertDialogTitle><AlertDialogDescription>{payTarget ? `${payTarget.title} · ${money(payTarget.amountUzs)}` : ''}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={payExpense.isPending}>{copy.formCancel}</AlertDialogCancel><AlertDialogAction disabled={payExpense.isPending} onClick={(event) => { event.preventDefault(); if (payTarget) payExpense.mutate(payTarget.id); setPayTarget(null); }}>{payExpense.isPending ? `${copy.pay}…` : copy.confirmPay}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      <AlertDialog open={Boolean(cancelTarget)} onOpenChange={(open) => !open && setCancelTarget(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{copy.confirmCancel}</AlertDialogTitle><AlertDialogDescription>{cancelTarget?.title}</AlertDialogDescription></AlertDialogHeader><Field><FieldLabel htmlFor="cancel-reason">{copy.cancellationReason}</FieldLabel><Input id="cancel-reason" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} onKeyDown={submitOnEnter(() => cancelExpense.mutate(), { disabled: !cancelReason.trim() || cancelExpense.isPending })} /></Field><AlertDialogFooter><AlertDialogCancel>{copy.formCancel}</AlertDialogCancel><AlertDialogAction disabled={!cancelReason.trim() || cancelExpense.isPending} onClick={() => cancelExpense.mutate()}>{copy.confirmCancel}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      
      <UnsavedChangesDialog
        open={expenseGuard.confirmationOpen}
        onOpenChange={expenseGuard.setConfirmationOpen}
        onDiscard={expenseGuard.discardChanges}
      />
      
      <UnsavedChangesDialog
        open={salaryGuard.confirmationOpen}
        onOpenChange={salaryGuard.setConfirmationOpen}
        onDiscard={salaryGuard.discardChanges}
      />

      <UnsavedChangesDialog
        open={payoutGuard.confirmationOpen}
        onOpenChange={payoutGuard.setConfirmationOpen}
        onDiscard={payoutGuard.discardChanges}
      />
      </ModulePageBody>
    </ModulePage>
  );
}
