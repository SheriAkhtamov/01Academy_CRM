import { useState } from 'react';
import { ArrowUpRight, History, Settings2, Target, UsersRound } from 'lucide-react';
import { KPI_ROLES, type KpiPlanVersion, type KpiRole } from '@shared/sales-kpi';
import { useTranslation } from '@/hooks/useTranslation';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useKpiPlans } from '../hooks';
import { kpiMoney, metricKeys, roleKeys } from '../copy';
import { KpiRulesDialog } from './KpiRulesDialog';
import { KpiSimulation } from './KpiSimulation';

export function KpiSettingsPanel() {
  const { t, language } = useTranslation();
  const query = useKpiPlans();
  const [role, setRole] = useState<KpiRole>('hunter');
  const [editing, setEditing] = useState<KpiPlanVersion | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyVersion, setHistoryVersion] = useState<number | null>(null);
  if (query.isPending) return <div className="space-y-4"><Skeleton className="h-12 w-72 max-w-full" /><Skeleton className="h-80 w-full" /></div>;
  if (query.isError) return <Alert variant="destructive"><AlertTitle>{t('failedToLoadData')}</AlertTitle><AlertDescription>
    <p className="mb-3">{query.error.message || t('kpiRequestFailed')}</p>
    <Button variant="outline" onClick={() => query.refetch()}>{t('retry')}</Button>
  </AlertDescription></Alert>;
  const data = query.data;
  const versions = data.versions.filter((version) => version.role === role);
  const current = versions.find((version) => version.effectiveMonth <= data.currentMonth) ?? versions[0];
  const latest = [...versions].sort((a, b) => b.id - a.id)[0];
  const scheduled = versions.find((version) => version.effectiveMonth > data.currentMonth);
  const selectedHistory = versions.find((version) => version.id === historyVersion);
  if (!current || !latest) return <Alert><AlertDescription>{t('kpiNoData')}</AlertDescription></Alert>;
  const config = current.config;
  return <div className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div><h2 className="text-xl font-semibold tracking-tight">{t('kpiTitle')}</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{t('kpiSettingsDescription')}</p></div>
      <Badge variant="outline" className="w-fit shrink-0">{t('kpiTimezone')}</Badge>
    </div>
    <Tabs value={role} onValueChange={(value) => setRole(value as KpiRole)}>
      <TabsList className="mb-4 grid h-auto w-full grid-cols-2 gap-1 p-1 sm:max-w-md">
        {KPI_ROLES.map((value) => <TabsTrigger key={value} value={value} className="gap-2 py-2.5"><UsersRound className="size-4" />{t(roleKeys[value])}</TabsTrigger>)}
      </TabsList>
      <TabsContent value={role} className="mt-0 space-y-4">
        <Card className="overflow-hidden border-border/80 shadow-sm">
          <CardHeader className="gap-4 border-b bg-muted/20 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3"><div className="rounded-xl border bg-background p-3 text-primary"><Target className="size-5" /></div>
              <div><CardTitle>{t(roleKeys[role])}</CardTitle><CardDescription className="mt-1">{(role === 'hunter' ? t('kpiHunterDescription') : t('kpiCloserDescription'))}</CardDescription>
                <p className="mt-2 text-xs text-muted-foreground">{t('kpiVersion').replace('{version}', String(current.id)).replace('{month}', current.effectiveMonth)}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => { setHistoryVersion(null); setHistoryOpen(true); }}><History className="mr-2 size-4" />{t('kpiHistory')}</Button>
              <Button size="sm" onClick={() => setEditing(latest)}><Settings2 className="mr-2 size-4" />{t('kpiEditRules')}</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 p-5">
            {scheduled ? <Alert><AlertDescription>{t('kpiVersion').replace('{version}', String(scheduled.id)).replace('{month}', scheduled.effectiveMonth)}</AlertDescription></Alert> : null}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                { label: t('kpiPayBase'), value: kpiMoney(config.baseSalaryUzs, language) },
                { label: t('kpiPayVariable'), value: kpiMoney(config.variableSalaryUzs, language) },
                { label: (role === 'hunter' ? t('kpiBookingsMetric') : t('kpiNewStudentsMetric')), value: `${config.volumeTarget}` },
              ].map((item) => <div key={item.label} className="rounded-xl border p-4"><p className="text-xs text-muted-foreground">{item.label}</p><p className="mt-2 text-xl font-semibold tabular-nums">{item.value}</p></div>)}
            </div>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <div><h3 className="mb-3 text-sm font-semibold">{t('kpiTiers')}</h3>
                <div className="space-y-2">{config.tiers.map((tier, index) => <div key={tier.from} className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2.5 text-sm">
                  <span className="text-muted-foreground">{(config.tiers[index + 1] ? t('kpiPersonRange') : t('kpiFromPerson'))
                    .replace('{from}', String(tier.from)).replace('{to}', String((config.tiers[index + 1]?.from ?? 1) - 1))}</span>
                  <span className="font-medium tabular-nums">{kpiMoney(tier.rateUzs, language)}</span>
                </div>)}</div>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t('kpiTiersHint')}</p>
              </div>
              <div><h3 className="mb-3 text-sm font-semibold">{t('kpiMetricsSettings')}</h3><div className="flex flex-wrap gap-2">{config.enabledMetrics.map((metric) => <Badge key={metric} variant="secondary" className="font-normal">{t(metricKeys[metric])}</Badge>)}</div>
                <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{t('kpiTrackingHint')}</p>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{(config.baseSalaryMode === 'guaranteed' ? t('kpiGuaranteed') : t('kpiConditional'))}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <KpiSimulation key={`${role}-${current.id}`} role={role} config={config} />
      </TabsContent>
    </Tabs>
    {editing ? <KpiRulesDialog version={editing} minimumMonth={data.minimumEffectiveMonth[editing.role]}
      expectedVersionId={editing.id} onClose={() => setEditing(null)} /> : null}
    <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
      <DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>{t('kpiHistory')} · {t(roleKeys[role])}</DialogTitle><DialogDescription>{t('kpiEditRulesDescription')}</DialogDescription></DialogHeader>
        <div className="space-y-2">{versions.map((version) => <Button key={version.id} variant={historyVersion === version.id ? 'secondary' : 'outline'}
          className="h-auto w-full justify-between gap-3 py-3 text-left" onClick={() => setHistoryVersion(version.id)}>
          <span>{t('kpiVersion').replace('{version}', String(version.id)).replace('{month}', version.effectiveMonth)}</span><ArrowUpRight className="size-4 shrink-0" />
        </Button>)}</div>
        {selectedHistory ? <KpiSimulation key={selectedHistory.id} role={role} config={selectedHistory.config} /> : null}
      </DialogContent>
    </Dialog>
  </div>;
}
