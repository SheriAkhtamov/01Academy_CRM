import { useMemo, useState } from 'react';
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
import {
  currentFinancePeriod,
  financeCopy,
  financeRoutes,
  type FinanceSection,
} from '@/lib/financeCenter';
import { PageHeader } from '@/components/ux/PageHeader';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type Row = Record<string, any>;

interface DashboardData {
  period: string;
  summary: {
    revenue: number;
    totalExpenses: number;
    netProfit: number;
    marginPercent: number;
    payrollDueUzs: number;
    profitChangePercent: number;
  };
  trend: Array<{ period: string; revenue: number; totalExpenses: number; netProfit: number }>;
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

const currentDateOnly = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

const initials = (name: string) => name
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0])
  .join('')
  .toUpperCase();

function FinanceMetric({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
  large = false,
  detail,
  fullValue,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'neutral' | 'success' | 'danger' | 'warning';
  large?: boolean;
  detail?: React.ReactNode;
  fullValue?: string;
}) {
  return (
    <Card className={cn(
      'overflow-hidden',
      large && 'border-emerald-500/40 bg-emerald-50/50 dark:bg-emerald-950/20',
    )}>
      <CardContent className={cn('flex h-full items-start justify-between gap-4 p-5', large && 'p-6')}>
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p title={fullValue} className={cn(
            'mt-2 whitespace-nowrap font-bold tabular-nums tracking-tight text-slate-900',
            large ? 'text-3xl text-emerald-700 lg:text-4xl' : 'text-2xl',
            tone === 'success' && !large && 'text-emerald-700',
            tone === 'danger' && 'text-destructive',
            tone === 'warning' && 'text-amber-700',
          )}>
            {value}
          </p>
          {detail ? <div className="mt-2 text-xs text-muted-foreground">{detail}</div> : null}
        </div>
        <div className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground',
          tone === 'success' && 'bg-emerald-100 text-emerald-700',
          tone === 'danger' && 'bg-destructive/10 text-destructive',
          tone === 'warning' && 'bg-amber-100 text-amber-700',
          large && 'bg-emerald-100 text-emerald-700',
        )}>
          <Icon className="size-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function FinanceLoading() {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-32 rounded-xl" />)}
      </div>
      <Skeleton className="h-[360px] rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

function FinanceError({ copy, onRetry }: { copy: ReturnType<typeof financeCopy>; onRetry: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
        <XCircle className="size-9 text-destructive" />
        <p className="text-sm text-muted-foreground">{copy.error}</p>
        <Button variant="outline" onClick={onRetry}><RotateCcw data-icon="inline-start" />{copy.retry}</Button>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status, copy }: { status: string; copy: ReturnType<typeof financeCopy> }) {
  const statusMap: Record<string, { label: string; variant: 'success' | 'warning' | 'secondary' | 'destructive' | 'outline' }> = {
    paid: { label: copy.paid, variant: 'success' },
    pending: { label: copy.pending, variant: 'warning' },
    planned: { label: copy.planned, variant: 'warning' },
    approved: { label: copy.approved, variant: 'success' },
    cancelled: { label: copy.cancelled, variant: 'secondary' },
    refunded: { label: copy.refunded, variant: 'secondary' },
    unconfigured: { label: copy.unconfigured, variant: 'outline' },
  };
  const item = statusMap[status] ?? { label: status || copy.recorded, variant: 'outline' as const };
  return <Badge variant={item.variant}>{item.label}</Badge>;
}

function TransactionTable({
  rows,
  copy,
  money,
  dateTime,
  categoryLabel,
  compact = false,
}: {
  rows: Row[];
  copy: ReturnType<typeof financeCopy>;
  money: (value: number) => string;
  dateTime: (value: unknown) => string;
  categoryLabel: (value: string) => string;
  compact?: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{copy.date}</TableHead>
          <TableHead>{copy.operation}</TableHead>
          <TableHead>{copy.category}</TableHead>
          {!compact ? <TableHead>{copy.counterparty}</TableHead> : null}
          <TableHead>{copy.status}</TableHead>
          <TableHead className="text-right">{copy.amount}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="whitespace-nowrap text-muted-foreground">{dateTime(row.occurredAt)}</TableCell>
            <TableCell className="max-w-[280px] font-medium"><span className="block truncate">{row.title || '—'}</span></TableCell>
            <TableCell>{categoryLabel(row.category || row.kind)}</TableCell>
            {!compact ? <TableCell className="max-w-[240px] text-muted-foreground"><span className="block truncate">{row.counterparty || '—'}</span></TableCell> : null}
            <TableCell><StatusBadge status={row.status} copy={copy} /></TableCell>
            <TableCell className={cn(
              'whitespace-nowrap text-right font-semibold tabular-nums',
              row.direction === 'in' ? 'text-emerald-700' : 'text-destructive',
            )}>
              {row.direction === 'in' ? '+' : '−'}{money(row.amountUzs)}
            </TableCell>
          </TableRow>
        ))}
        {rows.length === 0 ? (
          <TableRow><TableCell colSpan={compact ? 5 : 6} className="h-36 text-center text-muted-foreground">{copy.noData}</TableCell></TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}

export default function FinanceCenter({ section = 'overview' }: { section?: FinanceSection }) {
  const { language, t } = useTranslation();
  const copy = financeCopy(t);
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState(currentFinancePeriod);
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  const [salaryDialogOpen, setSalaryDialogOpen] = useState(false);
  const [payoutTarget, setPayoutTarget] = useState<Row | null>(null);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Row | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [transactionFilter, setTransactionFilter] = useState('all');
  const [expenseForm, setExpenseForm] = useState({
    category: 'other', title: '', vendor: '', description: '', amountUzs: '',
    expenseDate: currentDateOnly(), status: 'paid', method: 'transfer',
  });
  const [salaryForm, setSalaryForm] = useState({ employeeUserId: '', amountUzs: '', effectiveMonth: period, note: '' });
  const [payoutForm, setPayoutForm] = useState({ bonusUzs: '', deductionUzs: '', method: 'transfer', note: '' });

  const locale = language === 'ru' ? 'ru-RU' : 'en-US';
  const money = (value: number) => `${Number(value || 0).toLocaleString(locale)}${t('uzs')}`;
  const compactMoney = (value: number) => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value || 0));
  const compactCurrency = (value: number) => `${compactMoney(value)}${t('uzs')}`;
  const date = (value: unknown) => value ? new Date(String(value)).toLocaleDateString(locale, { timeZone: 'Asia/Tashkent' }) : '—';
  const dateTime = (value: unknown) => value ? new Date(String(value)).toLocaleString(locale, { timeZone: 'Asia/Tashkent', dateStyle: 'short', timeStyle: 'short' }) : '—';
  const monthLabel = (value: string) => new Date(`${value}-15T12:00:00+05:00`).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'Asia/Tashkent' });
  const categoryLabel = (value: string) => {
    const labels: Record<string, string> = {
      student_payments: copy.studentPayments, income: copy.studentPayments, payroll: copy.payrollCategory,
      operating_expense: copy.operatingSource, marketing_expense: copy.marketing, ...Object.fromEntries(EXPENSE_CATEGORIES.map((category) => [category, copy[category]])),
    };
    return labels[value] ?? copy.other;
  };
  const methodLabel = (value: string) => ({ cash: copy.cash, transfer: copy.transfer, card: copy.card }[value] ?? value);

  const dashboard = useQuery<DashboardData>({
    queryKey: ['finance', 'dashboard', period],
    queryFn: () => apiRequest('GET', `/api/finance/dashboard?period=${period}`),
    enabled: section === 'overview',
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
      setExpenseForm({ category: 'other', title: '', vendor: '', description: '', amountUzs: '', expenseDate: currentDateOnly(), status: 'paid', method: 'transfer' });
      invalidateFinance();
    },
    onError: (error: Error) => toast({ title: copy.error, description: error.message, variant: 'destructive' }),
  });
  const saveSalary = useMutation({
    mutationFn: () => apiRequest('POST', '/api/finance/salary-rates', {
      employeeUserId: Number(salaryForm.employeeUserId), amountUzs: Number(salaryForm.amountUzs),
      effectiveFrom: `${salaryForm.effectiveMonth}-01`, note: salaryForm.note,
    }),
    onSuccess: () => { toast({ title: copy.saved }); setSalaryDialogOpen(false); invalidateFinance(); },
    onError: (error: Error) => toast({ title: copy.error, description: error.message, variant: 'destructive' }),
  });
  const savePayout = useMutation({
    mutationFn: () => apiRequest('POST', '/api/finance/payroll/payout', {
      period, employeeUserId: payoutTarget!.employeeUserId, bonusUzs: Number(payoutForm.bonusUzs || 0),
      deductionUzs: Number(payoutForm.deductionUzs || 0), method: payoutForm.method, note: payoutForm.note,
    }),
    onSuccess: () => { toast({ title: copy.payoutSaved }); setPayoutTarget(null); invalidateFinance(); },
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
    setSalaryForm({
      employeeUserId: target ? String(target.employeeUserId) : '',
      amountUzs: target?.baseSalaryUzs ? String(target.baseSalaryUzs) : '',
      effectiveMonth: period,
      note: '',
    });
    setSalaryDialogOpen(true);
  };
  const openPayoutDialog = (entry: Row) => {
    setPayoutTarget(entry);
    setPayoutForm({ bonusUzs: '', deductionUzs: '', method: 'transfer', note: '' });
  };
  const payoutTotal = payoutTarget
    ? Math.max(0, Number(payoutTarget.baseSalaryUzs || 0) + Number(payoutForm.bonusUzs || 0) - Number(payoutForm.deductionUzs || 0))
    : 0;

  const activeQuery = section === 'overview' ? dashboard : section === 'income' ? income : section === 'expenses' ? expenses : section === 'payroll' ? payroll : transactions;

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-5 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title={sectionTitle}
        subtitle={sectionSubtitle}
        breadcrumbs={[{ label: copy.module, href: financeRoutes.overview }, ...(section === 'overview' ? [] : [{ label: sectionTitle }])]}
        actions={(
          <>
            <Input aria-label={copy.calculationMonth} type="month" value={period} onChange={(event) => setPeriod(event.target.value || currentFinancePeriod())} className="w-[165px]" />
            {(section === 'overview' || section === 'expenses') ? (
              <Button onClick={() => setExpenseDialogOpen(true)}><Plus data-icon="inline-start" />{copy.addExpense}</Button>
            ) : null}
            {section === 'payroll' ? (
              <Button onClick={() => openSalaryDialog()}><Settings2 data-icon="inline-start" />{copy.configureSalary}</Button>
            ) : null}
          </>
        )}
      />

      {activeQuery.isLoading ? <FinanceLoading /> : null}
      {activeQuery.isError ? <FinanceError copy={copy} onRetry={() => activeQuery.refetch()} /> : null}

      {section === 'overview' && dashboard.data ? (
        <div className="flex flex-col gap-5">
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1.75fr_repeat(4,minmax(0,1fr))]">
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
                    {dashboard.data.summary.profitChangePercent > 0 ? '+' : ''}{dashboard.data.summary.profitChangePercent}% {copy.vsPreviousMonth}
                  </span>
                  <span>{copy.profitFormula}</span>
                </div>
              )}
            />
            <FinanceMetric label={copy.revenue} value={compactCurrency(dashboard.data.summary.revenue)} fullValue={money(dashboard.data.summary.revenue)} icon={ArrowUpRight} tone="success" />
            <FinanceMetric label={copy.allExpenses} value={compactCurrency(dashboard.data.summary.totalExpenses)} fullValue={money(dashboard.data.summary.totalExpenses)} icon={ArrowDownRight} tone="danger" />
            <FinanceMetric label={copy.margin} value={`${dashboard.data.summary.marginPercent}%`} icon={TrendingUp} tone="success" />
            <FinanceMetric label={copy.duePayroll} value={compactCurrency(dashboard.data.summary.payrollDueUzs)} fullValue={money(dashboard.data.summary.payrollDueUzs)} icon={WalletCards} tone="warning" />
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div><CardTitle>{copy.profitTrend}</CardTitle><CardDescription>{monthLabel(period)}</CardDescription></div>
              </CardHeader>
              <CardContent className="h-[330px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={dashboard.data.trend} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="period" tickFormatter={(value) => monthLabel(value).split(' ')[0]} axisLine={false} tickLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }} />
                    <YAxis tickFormatter={compactMoney} axisLine={false} tickLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }} width={58} />
                    <RechartsTooltip formatter={(value: number, name: string) => [money(value), name === 'revenue' ? copy.revenue : name === 'totalExpenses' ? copy.allExpenses : copy.netProfit]} labelFormatter={(value) => monthLabel(String(value))} contentStyle={{ borderRadius: 10, borderColor: 'var(--border)', boxShadow: 'var(--shadow-md)' }} />
                    <Legend formatter={(value) => value === 'revenue' ? copy.revenue : value === 'totalExpenses' ? copy.allExpenses : copy.netProfit} />
                    <Bar dataKey="revenue" fill="var(--chart-2)" radius={[5, 5, 0, 0]} maxBarSize={30} />
                    <Bar dataKey="totalExpenses" fill="var(--chart-5)" radius={[5, 5, 0, 0]} maxBarSize={30} />
                    <Line type="monotone" dataKey="netProfit" stroke="var(--chart-1)" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CardTitle>{copy.expenseStructure}</CardTitle>
                  <Tooltip><TooltipTrigger asChild><button type="button" aria-label={copy.methodology}><Info className="size-4 text-muted-foreground" /></button></TooltipTrigger><TooltipContent className="max-w-xs">{copy.methodology}</TooltipContent></Tooltip>
                </div>
                <CardDescription>{money(dashboard.data.summary.totalExpenses)}</CardDescription>
              </CardHeader>
              <CardContent className="grid min-h-[270px] gap-4 sm:grid-cols-[170px_1fr] sm:items-center">
                {dashboard.data.expenseBreakdown.length ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart><Pie data={dashboard.data.expenseBreakdown} dataKey="amount" nameKey="category" innerRadius={48} outerRadius={78} paddingAngle={2}>{dashboard.data.expenseBreakdown.map((item, index) => <Cell key={item.category} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}</Pie><RechartsTooltip formatter={(value: number) => money(value)} /></PieChart>
                  </ResponsiveContainer>
                ) : <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">{copy.noData}</div>}
                <div className="flex flex-col gap-3">
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

          <Card className="overflow-hidden">
            <CardHeader className="flex-row items-center justify-between gap-4 border-b border-border/70">
              <CardTitle>{copy.recentTransactions}</CardTitle>
              <Button asChild variant="ghost" size="sm"><Link href={financeRoutes.transactions}>{copy.seeAllTransactions}<ArrowUpRight data-icon="inline-end" /></Link></Button>
            </CardHeader>
            <CardContent className="p-0"><TransactionTable rows={dashboard.data.recentTransactions} copy={copy} money={money} dateTime={dateTime} categoryLabel={categoryLabel} /></CardContent>
          </Card>
        </div>
      ) : null}

      {section === 'income' && income.data ? (
        <div className="flex flex-col gap-5">
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <FinanceMetric label={copy.revenue} value={money(income.data.summary.revenueUzs)} icon={CircleDollarSign} tone="success" />
            <FinanceMetric label={copy.paymentCount} value={String(income.data.summary.paidCount)} icon={ReceiptText} />
            <FinanceMetric label={copy.averagePayment} value={money(income.data.summary.averagePaymentUzs)} icon={TrendingUp} />
            <FinanceMetric label={copy.refunds} value={money(income.data.summary.refundedUzs)} icon={RotateCcw} tone={income.data.summary.refundedUzs > 0 ? 'danger' : 'neutral'} />
          </section>
          <Card className="overflow-hidden">
            <CardHeader className="border-b border-border/70"><CardTitle>{copy.incomeRegistry}</CardTitle><CardDescription>{monthLabel(period)}</CardDescription></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>{copy.date}</TableHead><TableHead>{copy.customer}</TableHead><TableHead>{copy.course}</TableHead><TableHead>{copy.manager}</TableHead><TableHead>{copy.method}</TableHead><TableHead>{copy.status}</TableHead><TableHead className="text-right">{copy.amount}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {income.data.rows.map((row) => <TableRow key={row.id}><TableCell className="whitespace-nowrap text-muted-foreground">{dateTime(row.paidAt || row.createdAt)}</TableCell><TableCell className="font-medium">{row.customerName || '—'}</TableCell><TableCell>{row.courseName || '—'}</TableCell><TableCell>{row.managerName || '—'}</TableCell><TableCell>{methodLabel(row.method)}</TableCell><TableCell><StatusBadge status={row.status} copy={copy} /></TableCell><TableCell className={cn('text-right font-semibold tabular-nums', row.status === 'paid' && 'text-emerald-700')}>{money(row.amountUzs)}</TableCell></TableRow>)}
                  {!income.data.rows.length ? <TableRow><TableCell colSpan={7} className="h-40 text-center text-muted-foreground">{copy.noData}</TableCell></TableRow> : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {section === 'expenses' && expenses.data ? (
        <div className="flex flex-col gap-5">
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <FinanceMetric label={copy.totalRecognized} value={money(expenses.data.summary.totalRecognizedUzs)} icon={Banknote} tone="danger" />
            <FinanceMetric label={copy.operatingPaid} value={money(expenses.data.summary.paidOperatingUzs)} icon={ReceiptText} />
            <FinanceMetric label={copy.marketing} value={money(expenses.data.summary.marketingUzs)} icon={TrendingUp} />
            <FinanceMetric label={copy.planned} value={money(expenses.data.summary.plannedOperatingUzs)} icon={Clock3} tone="warning" />
          </section>
          <Card className="overflow-hidden">
            <CardHeader className="border-b border-border/70"><CardTitle>{copy.expenseRegistry}</CardTitle><CardDescription>{copy.methodology}</CardDescription></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>{copy.date}</TableHead><TableHead>{copy.title}</TableHead><TableHead>{copy.source}</TableHead><TableHead>{copy.category}</TableHead><TableHead>{copy.vendor}</TableHead><TableHead>{copy.status}</TableHead><TableHead className="text-right">{copy.amount}</TableHead><TableHead className="text-right">{copy.actions}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {expenses.data.operating.map((row) => <TableRow key={`operating-${row.id}`}><TableCell className="whitespace-nowrap text-muted-foreground">{date(row.expenseDate)}</TableCell><TableCell className="font-medium">{row.title}</TableCell><TableCell><Badge variant="outline">{copy.operatingSource}</Badge></TableCell><TableCell>{categoryLabel(row.category)}</TableCell><TableCell>{row.vendor || '—'}</TableCell><TableCell><StatusBadge status={row.status} copy={copy} /></TableCell><TableCell className="text-right font-semibold tabular-nums">{money(row.amountUzs)}</TableCell><TableCell><div className="flex justify-end gap-1">{row.status === 'planned' ? <><Button size="sm" variant="outline" onClick={() => payExpense.mutate(row.id)} disabled={payExpense.isPending}><Check data-icon="inline-start" />{copy.pay}</Button><Button size="icon" variant="ghost" aria-label={copy.cancel} onClick={() => setCancelTarget(row)}><XCircle /></Button></> : null}</div></TableCell></TableRow>)}
                  {expenses.data.marketing.map((row) => <TableRow key={`marketing-${row.id}`}><TableCell className="whitespace-nowrap text-muted-foreground">{date(row.periodStart)}</TableCell><TableCell className="font-medium">{row.campaignName || row.channel}</TableCell><TableCell><Badge variant="purple">{copy.marketingSource}</Badge></TableCell><TableCell>{copy.marketing}</TableCell><TableCell>{row.sourceName || row.channel}</TableCell><TableCell><StatusBadge status={row.status} copy={copy} /></TableCell><TableCell className="text-right font-semibold tabular-nums">{money(row.recognizedAmountUzs || row.amountUzs)}</TableCell><TableCell /></TableRow>)}
                  {!expenses.data.operating.length && !expenses.data.marketing.length ? <TableRow><TableCell colSpan={8} className="h-40 text-center text-muted-foreground">{copy.noData}</TableCell></TableRow> : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {section === 'payroll' && payroll.data ? (
        <div className="flex flex-col gap-5">
          <section className="grid gap-4 md:grid-cols-3">
            <FinanceMetric label={copy.salaryFund} value={money(payroll.data.summary.payrollFundUzs)} icon={WalletCards} />
            <FinanceMetric label={copy.paidPayroll} value={money(payroll.data.summary.paidAmountUzs)} icon={Check} tone="success" />
            <FinanceMetric label={copy.remainingPayroll} value={money(payroll.data.summary.pendingAmountUzs)} icon={Clock3} tone="warning" />
          </section>
          <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Card className="overflow-hidden">
              <CardHeader className="flex-row items-center justify-between gap-4 border-b border-border/70"><div><CardTitle>{copy.payrollStatement}</CardTitle><CardDescription>{monthLabel(period)}</CardDescription></div><Button variant="outline" onClick={() => setBatchDialogOpen(true)} disabled={!payroll.data.summary.pendingCount}><UserRound data-icon="inline-start" />{copy.payAll}</Button></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow><TableHead>{copy.employee}</TableHead><TableHead>{copy.position}</TableHead><TableHead className="text-right">{copy.salary}</TableHead><TableHead className="text-right">{copy.bonus}</TableHead><TableHead className="text-right">{copy.deduction}</TableHead><TableHead className="text-right">{copy.payoutAmount}</TableHead><TableHead>{copy.status}</TableHead><TableHead className="text-right">{copy.actions}</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {payroll.data.entries.map((entry) => <TableRow key={entry.employeeUserId} data-state={selectedPayrollEntry?.employeeUserId === entry.employeeUserId ? 'selected' : undefined} onClick={() => setSelectedEmployeeId(entry.employeeUserId)} className="cursor-pointer"><TableCell><div className="flex items-center gap-3"><Avatar className="size-9"><AvatarFallback>{initials(entry.employeeName)}</AvatarFallback></Avatar><span className="font-medium">{entry.employeeName}</span></div></TableCell><TableCell className="text-muted-foreground">{entry.position || '—'}</TableCell><TableCell className="text-right tabular-nums">{money(entry.baseSalaryUzs)}</TableCell><TableCell className="text-right tabular-nums">{entry.status === 'paid' ? money(entry.bonusUzs) : '—'}</TableCell><TableCell className="text-right tabular-nums">{entry.status === 'paid' ? money(entry.deductionUzs) : '—'}</TableCell><TableCell className="text-right font-semibold tabular-nums">{money(entry.amountUzs ?? entry.baseSalaryUzs)}</TableCell><TableCell><div className="flex flex-col items-start gap-1"><StatusBadge status={entry.status} copy={copy} />{entry.paidAt ? <span className="text-[11px] text-muted-foreground">{date(entry.paidAt)}</span> : null}</div></TableCell><TableCell className="text-right" onClick={(event) => event.stopPropagation()}>{entry.status === 'pending' ? <Button size="sm" onClick={() => openPayoutDialog(entry)}>{copy.pay}</Button> : entry.status === 'unconfigured' ? <Button size="sm" variant="outline" onClick={() => openSalaryDialog(entry)}>{copy.configureSalary}</Button> : null}</TableCell></TableRow>)}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <div className="flex flex-col gap-5">
              <Card>
                <CardHeader><CardTitle>{copy.employee}</CardTitle></CardHeader>
                <CardContent>
                  {selectedPayrollEntry ? <div className="flex flex-col gap-5"><div className="flex items-center gap-3"><Avatar className="size-12"><AvatarFallback>{initials(selectedPayrollEntry.employeeName)}</AvatarFallback></Avatar><div><p className="font-semibold">{selectedPayrollEntry.employeeName}</p><p className="text-sm text-muted-foreground">{selectedPayrollEntry.position || '—'}</p></div></div><div className="grid gap-4 border-t border-border/70 pt-4"><div><p className="text-xs text-muted-foreground">{copy.currentSalary}</p><p className="mt-1 text-2xl font-bold text-emerald-700 tabular-nums">{money(selectedPayrollEntry.baseSalaryUzs)}</p></div><div><p className="text-xs text-muted-foreground">{copy.effectiveFrom}</p><p className="mt-1 text-sm font-medium">{date(selectedPayrollEntry.effectiveFrom)}</p></div></div></div> : <p className="text-sm text-muted-foreground">{copy.selectEmployee}</p>}
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
          <CardHeader className="flex-row items-center justify-between gap-4 border-b border-border/70"><div><CardTitle>{copy.transactions}</CardTitle><CardDescription>{monthLabel(period)}</CardDescription></div><Select value={transactionFilter} onValueChange={setTransactionFilter}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">{copy.all}</SelectItem><SelectItem value="income">{copy.incoming}</SelectItem><SelectItem value="expense">{copy.outgoing}</SelectItem></SelectGroup></SelectContent></Select></CardHeader>
          <CardContent className="p-0"><TransactionTable rows={filteredTransactions} copy={copy} money={money} dateTime={dateTime} categoryLabel={categoryLabel} /></CardContent>
        </Card>
      ) : null}

      <Dialog open={expenseDialogOpen} onOpenChange={setExpenseDialogOpen}>
        <DialogContent className="sm:max-w-[620px]">
          <DialogHeader><DialogTitle>{copy.expenseDialogTitle}</DialogTitle><DialogDescription>{copy.expenseDialogDescription}</DialogDescription></DialogHeader>
          <FieldGroup className="gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field><FieldLabel htmlFor="expense-title">{copy.title}</FieldLabel><Input id="expense-title" value={expenseForm.title} onChange={(event) => setExpenseForm((form) => ({ ...form, title: event.target.value }))} /></Field>
              <Field><FieldLabel>{copy.category}</FieldLabel><Select value={expenseForm.category} onValueChange={(category) => setExpenseForm((form) => ({ ...form, category }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{EXPENSE_CATEGORIES.map((category) => <SelectItem key={category} value={category}>{categoryLabel(category)}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
              <Field><FieldLabel htmlFor="expense-vendor">{copy.vendor}</FieldLabel><Input id="expense-vendor" value={expenseForm.vendor} onChange={(event) => setExpenseForm((form) => ({ ...form, vendor: event.target.value }))} /></Field>
              <Field><FieldLabel htmlFor="expense-amount">{copy.amount}</FieldLabel><CurrencyInput id="expense-amount" value={expenseForm.amountUzs} onValueChange={(amountUzs) => setExpenseForm((form) => ({ ...form, amountUzs }))} /></Field>
              <Field><FieldLabel htmlFor="expense-date">{copy.expenseDate}</FieldLabel><Input id="expense-date" type="date" value={expenseForm.expenseDate} onChange={(event) => setExpenseForm((form) => ({ ...form, expenseDate: event.target.value }))} /></Field>
              <Field><FieldLabel>{copy.paymentStatus}</FieldLabel><Select value={expenseForm.status} onValueChange={(status) => setExpenseForm((form) => ({ ...form, status }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="paid">{copy.paid}</SelectItem><SelectItem value="planned">{copy.planned}</SelectItem></SelectGroup></SelectContent></Select></Field>
              <Field><FieldLabel>{copy.paymentMethod}</FieldLabel><Select value={expenseForm.method} onValueChange={(method) => setExpenseForm((form) => ({ ...form, method }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{PAYMENT_METHODS.map((method) => <SelectItem key={method} value={method}>{methodLabel(method)}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
            </div>
            <Field><FieldLabel htmlFor="expense-description">{copy.description}</FieldLabel><Textarea id="expense-description" value={expenseForm.description} onChange={(event) => setExpenseForm((form) => ({ ...form, description: event.target.value }))} /></Field>
          </FieldGroup>
          <DialogFooter><Button variant="outline" onClick={() => setExpenseDialogOpen(false)}>{copy.formCancel}</Button><Button disabled={!expenseForm.title.trim() || !Number(expenseForm.amountUzs) || createExpense.isPending} onClick={() => createExpense.mutate()}>{copy.saveExpense}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={salaryDialogOpen} onOpenChange={setSalaryDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{copy.salaryDialogTitle}</DialogTitle><DialogDescription>{copy.salaryDialogDescription}</DialogDescription></DialogHeader>
          <FieldGroup className="gap-4">
            <Field><FieldLabel>{copy.employee}</FieldLabel><Select value={salaryForm.employeeUserId} onValueChange={(employeeUserId) => { const entry = payroll.data?.entries.find((item) => String(item.employeeUserId) === employeeUserId); setSalaryForm((form) => ({ ...form, employeeUserId, amountUzs: entry?.baseSalaryUzs ? String(entry.baseSalaryUzs) : '' })); }}><SelectTrigger><SelectValue placeholder={copy.employee} /></SelectTrigger><SelectContent><SelectGroup>{payroll.data?.entries.map((entry) => <SelectItem key={entry.employeeUserId} value={String(entry.employeeUserId)}>{entry.employeeName}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
            <Field><FieldLabel htmlFor="salary-amount">{copy.salary}</FieldLabel><CurrencyInput id="salary-amount" value={salaryForm.amountUzs} onValueChange={(amountUzs) => setSalaryForm((form) => ({ ...form, amountUzs }))} /></Field>
            <Field><FieldLabel htmlFor="salary-month">{copy.effectiveMonth}</FieldLabel><Input id="salary-month" type="month" value={salaryForm.effectiveMonth} onChange={(event) => setSalaryForm((form) => ({ ...form, effectiveMonth: event.target.value }))} /><FieldDescription>{copy.salaryDialogDescription}</FieldDescription></Field>
            <Field><FieldLabel htmlFor="salary-note">{copy.note}</FieldLabel><Textarea id="salary-note" value={salaryForm.note} onChange={(event) => setSalaryForm((form) => ({ ...form, note: event.target.value }))} /></Field>
          </FieldGroup>
          <DialogFooter><Button variant="outline" onClick={() => setSalaryDialogOpen(false)}>{copy.formCancel}</Button><Button disabled={!salaryForm.employeeUserId || !salaryForm.amountUzs || !salaryForm.effectiveMonth || saveSalary.isPending} onClick={() => saveSalary.mutate()}>{copy.saveSalary}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(payoutTarget)} onOpenChange={(open) => !open && setPayoutTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{copy.payoutDialogTitle}</DialogTitle><DialogDescription>{payoutTarget ? `${payoutTarget.employeeName} · ${payoutTarget.position || ''}` : ''}</DialogDescription></DialogHeader>
          <FieldGroup className="gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field><FieldLabel htmlFor="payout-period">{copy.calculationMonth}</FieldLabel><Input id="payout-period" type="month" value={period} disabled /></Field>
              <Field><FieldLabel htmlFor="payout-salary">{copy.salary}</FieldLabel><CurrencyInput id="payout-salary" value={payoutTarget?.baseSalaryUzs || 0} onValueChange={() => undefined} disabled /></Field>
              <Field><FieldLabel htmlFor="payout-bonus">{copy.bonus}</FieldLabel><CurrencyInput id="payout-bonus" value={payoutForm.bonusUzs} onValueChange={(bonusUzs) => setPayoutForm((form) => ({ ...form, bonusUzs }))} /></Field>
              <Field><FieldLabel htmlFor="payout-deduction">{copy.deduction}</FieldLabel><CurrencyInput id="payout-deduction" value={payoutForm.deductionUzs} onValueChange={(deductionUzs) => setPayoutForm((form) => ({ ...form, deductionUzs }))} /></Field>
            </div>
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4"><p className="text-sm text-muted-foreground">{copy.payoutTotal}</p><p className="mt-1 text-2xl font-bold text-primary tabular-nums">{money(payoutTotal)}</p></div>
            <Field><FieldLabel>{copy.paymentMethod}</FieldLabel><Select value={payoutForm.method} onValueChange={(method) => setPayoutForm((form) => ({ ...form, method }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{PAYMENT_METHODS.map((method) => <SelectItem key={method} value={method}>{methodLabel(method)}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
            <Field><FieldLabel htmlFor="payout-note">{copy.note}</FieldLabel><Textarea id="payout-note" value={payoutForm.note} onChange={(event) => setPayoutForm((form) => ({ ...form, note: event.target.value }))} /></Field>
          </FieldGroup>
          <DialogFooter><Button variant="outline" onClick={() => setPayoutTarget(null)}>{copy.formCancel}</Button><Button disabled={payoutTotal <= 0 || savePayout.isPending} onClick={() => savePayout.mutate()}>{copy.confirmPayout}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={batchDialogOpen} onOpenChange={setBatchDialogOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{copy.batchTitle}</AlertDialogTitle><AlertDialogDescription>{copy.batchDescription}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{copy.formCancel}</AlertDialogCancel><AlertDialogAction onClick={() => payAll.mutate()} disabled={payAll.isPending}>{copy.confirmBatch}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      <AlertDialog open={Boolean(cancelTarget)} onOpenChange={(open) => !open && setCancelTarget(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{copy.confirmCancel}</AlertDialogTitle><AlertDialogDescription>{cancelTarget?.title}</AlertDialogDescription></AlertDialogHeader><Field><FieldLabel htmlFor="cancel-reason">{copy.cancellationReason}</FieldLabel><Input id="cancel-reason" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></Field><AlertDialogFooter><AlertDialogCancel>{copy.formCancel}</AlertDialogCancel><AlertDialogAction disabled={!cancelReason.trim() || cancelExpense.isPending} onClick={() => cancelExpense.mutate()}>{copy.confirmCancel}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </div>
  );
}
