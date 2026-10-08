import { useTranslation } from '@/hooks/useTranslation';

export function SalesRepeatCallsChart({ distribution }: { distribution: Array<{ attempts: number; count: number }> | undefined }) {
  const { t, language } = useTranslation();
  const number = new Intl.NumberFormat(language);
  const buckets = [2, 3, 4, 5].map((attempts) => ({ attempts, count: distribution?.find((item) => item.attempts === attempts)?.count ?? 0 }));
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const label = (attempts: number) => t('salesCallAttempts').replace('{count}', number.format(attempts));
  if (!distribution) return <div className="h-28 rounded-lg bg-muted/30" aria-busy="true" />;
  return <div className="text-amber-600 dark:text-amber-400">
    <div className="space-y-3" role="img" aria-label={`${t('salesAttemptDistribution')}: ${buckets.map((bucket) => `${label(bucket.attempts)}: ${bucket.count}`).join('; ')}`}>
      {buckets.map((bucket) => <div key={bucket.attempts} className="grid grid-cols-[12px_minmax(0,1fr)_20px] items-center gap-3" title={`${label(bucket.attempts)}: ${number.format(bucket.count)}`}>
        <span className="text-[11px] tabular-nums text-muted-foreground">{number.format(bucket.attempts)}</span>
        <div className="h-2.5 rounded-full bg-muted/70"><div className="h-full rounded-full bg-current opacity-80" style={{ width: `${bucket.count / max * 100}%` }} /></div>
        <span className="text-right text-[11px] font-medium tabular-nums text-muted-foreground">{number.format(bucket.count)}</span>
      </div>)}
    </div>
    <p className="mt-3 text-[10px] text-muted-foreground">{t('salesAttemptsAxis')}</p>
  </div>;
}
