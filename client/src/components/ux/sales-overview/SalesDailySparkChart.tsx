import { useId, useState, type PointerEvent } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { formatAcademyDate } from '@/lib/localeFormat';
import type { SalesSeriesPoint } from '@/lib/salesMetricCharts';

const WIDTH = 280;
const HEIGHT = 90;
const PADDING = 5;

/** One keyboard stop per chart, with the same point inspection on touch and mouse. */
export function SalesDailySparkChart({ points, title, formatValue, kind = 'area', compact = false, expanded = false, className = '' }: {
  points: SalesSeriesPoint[] | undefined; title: string; formatValue: (value: number) => string;
  kind?: 'bars' | 'area' | 'stems'; compact?: boolean; expanded?: boolean; className?: string;
}) {
  const { t, language } = useTranslation();
  const gradientId = useId().replace(/:/g, '');
  const helpId = useId();
  const [selected, setSelected] = useState<number | null>(null);
  if (!points?.length) return <div className="mt-5 h-32 rounded-lg bg-muted/30" aria-busy={!points} />;
  const max = Math.max(1, ...points.map((point) => point.value));
  const min = Math.min(0, ...points.map((point) => point.value));
  const step = (WIDTH - 2 * PADDING) / points.length;
  const y = (value: number) => HEIGHT - PADDING - (value - min) / (max - min) * (HEIGHT - 2 * PADDING);
  const plotted = points.map((point, index) => ({ ...point, x: PADDING + step * (index + 0.5), y: y(point.value) }));
  const index = Math.min(points.length - 1, selected ?? points.length - 1);
  const active = plotted[index];
  const spansYears = points[0].date.slice(0, 4) !== points.at(-1)!.date.slice(0, 4);
  const day = (date: string) => formatAcademyDate(date, language, { day: 'numeric', month: 'short', ...(spansYears ? { year: 'numeric' as const } : {}) });
  const line = plotted.map((point, i) => `${i ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
  const pick = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;
    const x = (event.clientX - bounds.left) / bounds.width * WIDTH;
    setSelected(Math.max(0, Math.min(points.length - 1, Math.floor((x - PADDING) / step))));
  };
  return <div className={`${compact ? 'mt-0' : 'mt-4'} ${className}`}>
    <div className="mb-2 flex min-h-4 items-center justify-between gap-2 text-[10px] font-medium tabular-nums sm:text-[11px]">
      <span className="text-muted-foreground">{selected === null ? t('salesDailyTrend') : day(active.date)}</span>
      {selected !== null ? <span>{formatValue(active.value)}</span> : null}
    </div>
    <span id={helpId} className="sr-only">{t('salesChartKeyboard')}</span>
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className={`${expanded ? 'h-52' : compact ? 'h-16' : 'h-[90px]'} w-full overflow-visible rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      role="slider" tabIndex={0} aria-label={t('salesDailyChart').replace('{metric}', title)} aria-describedby={helpId}
      aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={points.length - 1} aria-valuenow={index} aria-valuetext={`${day(active.date)}: ${formatValue(active.value)}`}
      onPointerDown={pick} onPointerMove={pick} onPointerLeave={(event) => { if (event.currentTarget.ownerDocument.activeElement !== event.currentTarget) setSelected(null); }} onFocus={() => setSelected(index)} onBlur={() => setSelected(null)}
      onKeyDown={(event) => {
        const next = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? index + 1
          : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? index - 1
            : event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : null;
        if (next !== null) { event.preventDefault(); setSelected(Math.max(0, Math.min(points.length - 1, next))); }
      }}>
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity={0.22} /><stop offset="100%" stopColor="currentColor" stopOpacity={0.015} /></linearGradient></defs>
      {[0.5, 1].map((position) => <line key={position} x1={0} y1={y(max * position)} x2={WIDTH} y2={y(max * position)} stroke="currentColor" strokeOpacity={0.09} strokeDasharray="2 5" />)}
      <line x1={0} y1={y(0)} x2={WIDTH} y2={y(0)} stroke="currentColor" strokeOpacity={0.15} />
      {kind === 'area' ? <>
        <path d={`${line} L${plotted.at(-1)!.x},${y(0)} L${plotted[0].x},${y(0)} Z`} fill={`url(#${gradientId})`} />
        <path d={line} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {points.length === 1 ? <circle cx={active.x} cy={active.y} r={3} fill="currentColor" /> : null}
      </> : plotted.map((point, i) => kind === 'bars'
        ? <rect key={point.date} x={point.x - step * 0.34} y={Math.min(y(0), point.y)} width={step * 0.68} height={Math.abs(y(0) - point.y)} rx={Math.min(2, step * 0.2)} fill="currentColor" opacity={selected === null ? 0.35 + Math.abs(point.value) / Math.max(max, Math.abs(min)) * 0.6 : i === index ? 1 : 0.25} />
        : <g key={point.date}><line x1={point.x} y1={y(0)} x2={point.x} y2={point.y} stroke="currentColor" strokeWidth={Math.min(6, step * 0.5)} strokeOpacity={0.22} />{point.value !== 0 ? <circle cx={point.x} cy={point.y} r={Math.min(3, step * 0.3)} fill="currentColor" /> : null}</g>)}
      {selected !== null ? <g><line x1={active.x} y1={0} x2={active.x} y2={HEIGHT} stroke="currentColor" strokeOpacity={0.45} strokeDasharray="3 3" /><circle cx={active.x} cy={active.y} r={4} fill="currentColor" stroke="var(--card)" strokeWidth={2} /></g> : null}
    </svg>
    <div className="mt-2 flex justify-between text-[10px] tabular-nums text-muted-foreground"><span>{day(points[0].date)}</span><span>{points.length > 1 ? day(points.at(-1)!.date) : null}</span></div>
  </div>;
}
