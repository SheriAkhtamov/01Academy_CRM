import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, CheckCircle2, CircleDollarSign, GraduationCap, Percent, Users } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ux/PageHeader';
import { toast } from '@/hooks/use-toast';
import { ceoCopy } from '@/components/ui/ceo-copy';

interface PayrollEntry {
  id: number | null;
  entryType: 'teacher' | 'manager';
  teacherId: number | null;
  employeeUserId: number | null;
  employeeName: string;
  conductedLessons: number;
  ratePerLessonUzs: number;
  baseSalaryUzs: number;
  commissionPercent: number;
  commissionBaseUzs: number;
  amountUzs: number;
  status: 'pending' | 'paid';
  paidAt?: string | null;
}

interface PayrollData {
  period: string;
  entries: PayrollEntry[];
  summary: {
    pendingAmountUzs: number;
    paidAmountUzs: number;
    totalAmountUzs: number;
    teacherCount: number;
    managerCount: number;
    commissionPercent: number;
  };
}

const currentPeriod = () => new Date().toISOString().slice(0, 7);
const money = (value: number) => `${Number(value || 0).toLocaleString('ru-RU')} ${ceoCopy.settings.sum}`;

export default function PayrollPage() {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState(currentPeriod);
  const [rateDrafts, setRateDrafts] = useState<Record<number, number>>({});
  const { data, isLoading, isError, refetch } = useQuery<PayrollData>({
    queryKey: ['/api/academy/payroll', period],
    queryFn: async () => apiRequest('GET', `/api/academy/payroll?period=${period}`),
  });

  useEffect(() => {
    setRateDrafts((current) => {
      const next = { ...current };
      for (const entry of data?.entries ?? []) {
        if (entry.entryType === 'teacher' && entry.teacherId && next[entry.teacherId] === undefined) {
          next[entry.teacherId] = entry.ratePerLessonUzs;
        }
      }
      return next;
    });
  }, [data?.entries]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/academy/payroll'] });
    queryClient.invalidateQueries({ queryKey: ['/api/academy/finance'] });
    queryClient.invalidateQueries({ queryKey: ['/api/academy/groups/profitability'] });
    queryClient.invalidateQueries({ queryKey: ['/api/academy/workspaces/administration'] });
  };

  const payout = useMutation({
    mutationFn: (entry: PayrollEntry) => apiRequest('POST', '/api/academy/payroll/payout', {
      period,
      entryType: entry.entryType,
      employeeUserId: entry.employeeUserId,
      teacherId: entry.teacherId,
    }),
    onSuccess: () => {
      toast({ title: ceoCopy.payroll.payoutDone });
      refresh();
    },
    onError: (error: Error) => toast({ title: ceoCopy.payroll.payoutFailed, description: error.message, variant: 'destructive' }),
  });

  const saveRate = useMutation({
    mutationFn: ({ teacherId, ratePerLessonUzs }: { teacherId: number; ratePerLessonUzs: number }) =>
      apiRequest('PATCH', `/api/academy/teachers/${teacherId}`, { ratePerLessonUzs }),
    onSuccess: () => {
      toast({ title: ceoCopy.payroll.rateSaved });
      refresh();
    },
    onError: (error: Error) => toast({ title: ceoCopy.payroll.payoutFailed, description: error.message, variant: 'destructive' }),
  });

  const teachers = useMemo(
    () => (data?.entries ?? []).filter((entry) => entry.entryType === 'teacher'),
    [data?.entries],
  );

  if (isError) {
    return <div className="mx-auto max-w-[1600px] p-6 lg:p-8"><Card><CardContent className="p-8"><Button onClick={() => refetch()}>{ceoCopy.settings.save}</Button></CardContent></Card></div>;
  }

  return <div className="mx-auto flex max-w-[1600px] flex-col gap-6 p-6 lg:p-8">
    <PageHeader title={ceoCopy.payroll.title} subtitle={ceoCopy.payroll.subtitle} breadcrumbs={[{ label: ceoCopy.payroll.title }]} />
    <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-border/70 bg-card p-4">
      <div className="space-y-2"><Label htmlFor="payroll-period">{ceoCopy.payroll.period}</Label><Input id="payroll-period" type="month" value={period} onChange={(event) => setPeriod(event.target.value || currentPeriod())} className="w-52" /></div>
      <Badge variant="outline"><Percent data-icon="inline-start" />{data?.summary.commissionPercent ?? 0}%</Badge>
    </div>
    <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {([
        [ceoCopy.payroll.pending, data?.summary.pendingAmountUzs ?? 0, CircleDollarSign, 'text-amber-600 bg-amber-50'],
        [ceoCopy.payroll.paid, data?.summary.paidAmountUzs ?? 0, CheckCircle2, 'text-emerald-600 bg-emerald-50'],
        [ceoCopy.payroll.total, data?.summary.totalAmountUzs ?? 0, Banknote, 'text-primary bg-primary/10'],
      ] as const).map(([title, value, Icon, tone]) => <Card key={title}><CardContent className="flex items-start justify-between gap-3 p-5"><div><p className="text-sm text-muted-foreground">{title}</p><p className="mt-2 text-2xl font-bold tabular-nums">{money(value)}</p></div><div className={`flex size-11 items-center justify-center rounded-xl ${tone}`}><Icon className="size-5" /></div></CardContent></Card>)}
    </section>
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border/70"><CardTitle>{ceoCopy.payroll.title}</CardTitle><CardDescription>{ceoCopy.payroll.subtitle}</CardDescription></CardHeader>
      <CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="border-b border-border/70 bg-muted/30 text-xs text-muted-foreground"><tr><th className="px-5 py-3">{ceoCopy.payroll.employee}</th><th className="px-5 py-3">{ceoCopy.payroll.type}</th><th className="px-5 py-3 text-right">{ceoCopy.payroll.lessons}</th><th className="px-5 py-3 text-right">{ceoCopy.payroll.salary} / {ceoCopy.payroll.rate}</th><th className="px-5 py-3 text-right">{ceoCopy.payroll.commission}</th><th className="px-5 py-3 text-right">{ceoCopy.payroll.total}</th><th className="px-5 py-3" /></tr></thead><tbody>{(data?.entries ?? []).map((entry) => <tr key={`${entry.entryType}-${entry.teacherId ?? entry.employeeUserId}`} className="border-b border-border/60 last:border-0"><td className="px-5 py-4 font-medium">{entry.employeeName}</td><td className="px-5 py-4"><Badge variant={entry.entryType === 'teacher' ? 'secondary' : 'outline'}>{entry.entryType === 'teacher' ? <GraduationCap data-icon="inline-start" /> : <Users data-icon="inline-start" />}{entry.entryType === 'teacher' ? ceoCopy.payroll.teacher : ceoCopy.payroll.manager}</Badge></td><td className="px-5 py-4 text-right tabular-nums">{entry.entryType === 'teacher' ? entry.conductedLessons : '—'}</td><td className="px-5 py-4 text-right tabular-nums">{entry.entryType === 'teacher' ? money(entry.ratePerLessonUzs) : money(entry.baseSalaryUzs)}</td><td className="px-5 py-4 text-right tabular-nums">{entry.entryType === 'manager' ? <span>{entry.commissionPercent}% · {money(entry.commissionBaseUzs)}</span> : '—'}</td><td className="px-5 py-4 text-right font-semibold tabular-nums">{money(entry.amountUzs)}</td><td className="px-5 py-4 text-right">{entry.status === 'paid' ? <Badge variant="success">{ceoCopy.payroll.paid}</Badge> : <Button size="sm" disabled={entry.amountUzs <= 0 || payout.isPending} onClick={() => payout.mutate(entry)}><Banknote data-icon="inline-start" />{ceoCopy.payroll.payout}</Button>}</td></tr>)}{!isLoading && (data?.entries.length ?? 0) === 0 ? <tr><td colSpan={7} className="px-5 py-12 text-center text-muted-foreground">{ceoCopy.payroll.noEntries}</td></tr> : null}</tbody></table></div></CardContent>
    </Card>
    <Card className="overflow-hidden"><CardHeader className="border-b border-border/70"><CardTitle>{ceoCopy.payroll.rateTitle}</CardTitle><CardDescription>{ceoCopy.payroll.rateDescription}</CardDescription></CardHeader><CardContent className="grid grid-cols-1 gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">{teachers.map((entry) => <div key={entry.teacherId} className="flex items-end gap-2 rounded-xl border border-border/70 p-4"><div className="min-w-0 flex-1 space-y-2"><Label htmlFor={`teacher-rate-${entry.teacherId}`}>{entry.employeeName}</Label><Input id={`teacher-rate-${entry.teacherId}`} type="number" min="0" step="1000" value={rateDrafts[entry.teacherId!] ?? entry.ratePerLessonUzs} onChange={(event) => setRateDrafts((current) => ({ ...current, [entry.teacherId!]: Number(event.target.value) || 0 }))} /></div><Button variant="outline" size="sm" disabled={saveRate.isPending} onClick={() => saveRate.mutate({ teacherId: entry.teacherId!, ratePerLessonUzs: rateDrafts[entry.teacherId!] ?? entry.ratePerLessonUzs })}>{ceoCopy.payroll.saveRate}</Button></div>)}</CardContent></Card>
  </div>;
}
