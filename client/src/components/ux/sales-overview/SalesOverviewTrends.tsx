import { useState, type ComponentProps } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { SalesRevenueChart } from './SalesRevenueChart';
import { SalesOverviewDynamics } from './SalesOverviewDynamics';
import type { SalesDashboardMetrics } from './types';

export function SalesOverviewTrends({ metrics, isLoading, ...revenue }: Omit<ComponentProps<typeof SalesRevenueChart>, 'action'> & {
  metrics: SalesDashboardMetrics | undefined; isLoading: boolean;
}) {
  const { t } = useTranslation();
  const [activity, setActivity] = useState(false);
  const buttonClass = 'rounded-md px-3 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring';
  const action = <div className="flex rounded-lg bg-muted/60 p-1" role="group" aria-label={t('metricsDynamicsTitle')}>
    <button type="button" aria-pressed={!activity} className={cn(buttonClass, !activity ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground')} onClick={() => setActivity(false)}>{t('revenue')}</button>
    <button type="button" aria-pressed={activity} className={cn(buttonClass, activity ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground')} onClick={() => setActivity(true)}>{t('activityTab')}</button>
  </div>;
  return activity ? <SalesOverviewDynamics metrics={metrics} isLoading={isLoading} action={action} /> : <SalesRevenueChart {...revenue} action={action} />;
}
