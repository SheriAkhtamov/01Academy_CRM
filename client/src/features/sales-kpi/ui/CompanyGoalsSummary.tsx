import { Target } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { overviewButton, overviewPanel } from '@/components/ux/sales-overview/OverviewDialog';
import { useCompanyTargets } from '../hooks';
import { kpiMoney } from '../copy';

export function CompanyGoalsSummary({ onEdit }: { onEdit: () => void }) {
  const { t, language } = useTranslation();
  const query = useCompanyTargets();
  return <section className={`${overviewPanel} p-5 sm:p-6`} aria-label={t('kpiCompanyGoals')}>
    <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-base font-semibold"><Target className="size-5 text-primary" aria-hidden="true" />{t('kpiCompanyGoals')}</h2>
      <button type="button" className={`${overviewButton} border`} onClick={onEdit}>{t('kpiEditCompanyGoals')}</button>
    </header>
    {query.isPending ? <div className="h-20 animate-pulse rounded bg-muted" aria-busy="true" /> : query.isError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 text-sm"><p>{t('failedToLoadData')}</p><button type="button" className={overviewButton} onClick={() => query.refetch()}>{t('retry')}</button></div>
      : <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div><dt className="text-sm text-muted-foreground">{t('targetMonthlyRevenue')}</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{query.data?.targetRevenueMonthlyUzs ? kpiMoney(query.data.targetRevenueMonthlyUzs, language) : t('planNotSet')}</dd></div>
        <div><dt className="text-sm text-muted-foreground">{t('targetMonthlyNewLeads')}</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{query.data?.targetNewLeadsMonthly ? new Intl.NumberFormat(language).format(query.data.targetNewLeadsMonthly) : t('planNotSet')}</dd></div>
      </dl>}
  </section>;
}
