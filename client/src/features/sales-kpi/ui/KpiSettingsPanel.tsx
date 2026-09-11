import { useState } from 'react';
import { History, Settings2 } from 'lucide-react';
import { KPI_ROLES, type KpiPlanVersion, type KpiRole } from '@shared/sales-kpi';
import { useTranslation } from '@/hooks/useTranslation';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { overviewButton, overviewPanel } from '@/components/ux/sales-overview/OverviewDialog';
import { useKpiPlans } from '../hooks';
import { roleKeys } from '../copy';
import { KpiRulesDialog } from './KpiRulesDialog';
import { KpiPlanSummary, kpiMonthLabel } from './KpiPlanSummary';

export function KpiSettingsPanel() {
  const { t, language } = useTranslation();
  const query = useKpiPlans();
  const [editing, setEditing] = useState<KpiPlanVersion | null>(null);
  const [historyRole, setHistoryRole] = useState<KpiRole | null>(null);
  const [historyVersion, setHistoryVersion] = useState<number | null>(null);
  const versions = [...(query.data?.versions ?? [])].sort((a, b) => b.effectiveMonth.localeCompare(a.effectiveMonth) || b.id - a.id);
  const currentMonth = query.data?.currentMonth ?? '';
  const selectedHistory = versions.find((version) => version.id === historyVersion);
  const period = (version: KpiPlanVersion) => (version.effectiveMonth > currentMonth ? t('kpiScheduledFrom') : t('kpiEffectiveSince')).replace('{month}', kpiMonthLabel(version.effectiveMonth, language));
  return <div className="space-y-7">
    <section aria-label={t('kpiEmployeePlans')} className="space-y-4">
      <h2 className="text-base font-semibold">{t('kpiEmployeePlans')}</h2>
      {query.isPending ? <div className="grid gap-4 lg:grid-cols-2">{KPI_ROLES.map((role) => <div key={role} className={`h-80 animate-pulse rounded-xl bg-muted ${role === 'full_cycle' ? 'lg:col-span-2' : ''}`} aria-busy="true" />)}</div>
        : query.isError ? <div role="alert" className={`${overviewPanel} flex flex-wrap items-center justify-between gap-3 p-5 text-sm`}><p>{t('failedToLoadData')}</p><button type="button" className={overviewButton} onClick={() => query.refetch()}>{t('retry')}</button></div>
          : <div className="grid gap-5 lg:grid-cols-2">{KPI_ROLES.map((role) => {
            const roleVersions = versions.filter((version) => version.role === role);
            const current = roleVersions.find((version) => version.effectiveMonth <= currentMonth) ?? roleVersions[0];
            const latest = [...roleVersions].sort((a, b) => b.id - a.id)[0];
            const scheduled = roleVersions.find((version) => version.effectiveMonth > currentMonth);
            return <article key={role} className={`${overviewPanel} flex flex-col ${role === 'full_cycle' ? 'lg:col-span-2' : ''}`} aria-label={t(roleKeys[role])}>
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 p-5">
                <h3 className="text-lg font-semibold">{t(roleKeys[role])}</h3>
                {latest ? <button type="button" className={`${overviewButton} bg-primary text-primary-foreground hover:bg-primary/90`} onClick={() => setEditing(latest)}><Settings2 className="size-4" aria-hidden="true" />{t('kpiEditPlan')}</button> : null}
              </header>
              {current ? <><div className="flex-1 space-y-4 p-5"><KpiPlanSummary config={current.config} role={role} />
                <p className="text-xs text-muted-foreground">{period(current)}</p>
                {scheduled && scheduled.id !== current.id ? <button type="button" className={`${overviewButton} w-full justify-start bg-primary/5 text-primary`} onClick={() => { setHistoryRole(role); setHistoryVersion(scheduled.id); }}>{period(scheduled)}</button> : null}
              </div><footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 px-3 py-3">
                <button type="button" className={`${overviewButton} text-muted-foreground`} onClick={() => { setHistoryRole(role); setHistoryVersion(current.id); }}><History className="size-4" aria-hidden="true" />{t('kpiHistory')}</button>
              </footer></> : <p className="p-5 text-sm text-muted-foreground">{t('kpiNoData')}</p>}
            </article>;
          })}</div>}
    </section>
    {editing && query.data ? <KpiRulesDialog version={editing} minimumMonth={query.data.minimumEffectiveMonth[editing.role]} expectedVersionId={editing.id} onClose={() => setEditing(null)} /> : null}
    <Dialog open={Boolean(historyRole)} onOpenChange={(open) => { if (!open) setHistoryRole(null); }}><DialogContent className="max-w-3xl" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{t('kpiHistory')} · {historyRole ? t(roleKeys[historyRole]) : null}</DialogTitle></DialogHeader>
      <label className="space-y-2 text-sm font-medium">{t('kpiEffectiveMonth')}
        <select className="mt-2 block h-11 w-full rounded-lg border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={historyVersion ?? ''} onChange={(event) => setHistoryVersion(Number(event.target.value))}>
          {versions.filter((version) => version.role === historyRole).map((version) => <option key={version.id} value={version.id}>{period(version)}</option>)}
        </select>
      </label>
      {selectedHistory ? <KpiPlanSummary config={selectedHistory.config} role={selectedHistory.role} full /> : null}
    </DialogContent></Dialog>
  </div>;
}
