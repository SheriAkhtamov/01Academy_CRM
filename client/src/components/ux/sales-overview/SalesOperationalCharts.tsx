import { Layers } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

const stageColors = ['var(--chart-2)', 'var(--chart-1)', 'var(--chart-4)', 'var(--chart-3)', 'var(--chart-5)'];

export function SalesActiveLeadsChart({ stages, leadStatusName, statusColor }: {
  stages: Array<{ code: string; count: number }>; leadStatusName: (code: string) => string; statusColor: (code: string) => string;
}) {
  const { t, language } = useTranslation();
  const number = new Intl.NumberFormat(language);
  const ranked = stages.map((stage, index) => ({ code: stage.code, label: leadStatusName(stage.code), count: stage.count, color: statusColor(stage.code) || stageColors[index % stageColors.length] }))
    .filter((stage) => stage.count > 0).sort((a, b) => b.count - a.count);
  const total = ranked.reduce((sum, stage) => sum + stage.count, 0);
  const rows = ranked.length > 4 ? [...ranked.slice(0, 3), { code: '__remainder', label: t('other'), count: ranked.slice(3).reduce((sum, stage) => sum + stage.count, 0), color: 'var(--chart-6)' }] : ranked;
  let offset = 0;
  const segments = rows.map((row) => {
    const share = total ? row.count / total * 100 : 0;
    const segment = { ...row, share, offset };
    offset += share;
    return segment;
  });
  return <div className="mt-5 flex min-h-28 items-center gap-3">
    <div className="relative w-[86px] shrink-0">
      <svg viewBox="0 0 100 100" className="w-full" role="img" aria-label={`${t('salesActiveStageDistribution')}: ${ranked.length ? ranked.map((stage) => `${stage.label}: ${stage.count}`).join('; ') : t('salesNoActiveLeads')}`}>
        <circle cx={50} cy={50} r={38} fill="none" stroke="var(--muted)" strokeWidth={12} />
        <g transform="rotate(-90 50 50)">{segments.map((segment) => <circle key={segment.code} cx={50} cy={50} r={38} fill="none" stroke={segment.color} strokeWidth={12} pathLength={100}
          strokeDasharray={`${segment.share} ${100 - segment.share}`} strokeDashoffset={-segment.offset}><title>{segment.label}: {number.format(segment.count)}</title></circle>)}</g>
      </svg>
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-muted-foreground/60"><Layers className="size-5" aria-hidden="true" /></span>
    </div>
    {rows.length ? <ul className="min-w-0 flex-1 space-y-2.5">{rows.map((row) => <li key={row.code} className="flex items-center gap-1.5 text-[10px] sm:text-[11px]">
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: row.color }} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-muted-foreground" title={row.label}>{row.label}</span><span className="tabular-nums">{number.format(row.count)}</span>
    </li>)}</ul> : <p className="text-xs leading-relaxed text-muted-foreground">{t('salesNoActiveLeads')}</p>}
  </div>;
}

export function SalesRepeatCallsChart({ distribution }: { distribution: Array<{ attempts: number; count: number }> | undefined }) {
  const { t, language } = useTranslation();
  const number = new Intl.NumberFormat(language);
  const buckets = [2, 3, 4, 5].map((attempts) => ({ attempts, count: distribution?.find((item) => item.attempts === attempts)?.count ?? 0 }));
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const label = (attempts: number) => t('salesCallAttempts').replace('{count}', number.format(attempts));
  if (!distribution) return <div className="mt-5 h-28 rounded-lg bg-muted/30" aria-busy="true" />;
  return <div className="mt-5 text-amber-600 dark:text-amber-400">
    <div className="flex h-24 items-end gap-3 border-b border-border/60 px-2" role="img" aria-label={`${t('salesAttemptDistribution')}: ${buckets.map((bucket) => `${label(bucket.attempts)}: ${bucket.count}`).join('; ')}`}>
      {buckets.map((bucket) => <div key={bucket.attempts} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${label(bucket.attempts)}: ${number.format(bucket.count)}`}>
        <span className="mb-1 text-center text-[11px] font-medium tabular-nums text-muted-foreground">{number.format(bucket.count)}</span>
        <div className="min-h-0 w-full rounded-t bg-current opacity-80" style={{ height: `${bucket.count / max * 72}px` }} />
      </div>)}
    </div>
    <div className="mt-1.5 flex gap-3 px-2 text-center text-[10px] tabular-nums text-muted-foreground" aria-hidden="true">{buckets.map((bucket) => <span className="flex-1" key={bucket.attempts}>{number.format(bucket.attempts)}</span>)}</div>
    <p className="mt-2 text-center text-[10px] text-muted-foreground">{t('salesAttemptsAxis')}</p>
  </div>;
}
