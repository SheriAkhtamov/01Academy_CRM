import { useId, useMemo, useState, type PointerEvent } from 'react';
import type { SalesReportDailyPoint, SalesReportMetric } from '@shared/contracts/sales-report';
import { useTranslation } from '@/hooks/useTranslation';
import { formatAcademyDate } from '@/lib/localeFormat';
import { salesReportChartPoints, smoothReportPath } from '../../report-charts';

export type SalesReportChartKind = 'area' | 'bars' | 'stems' | 'line' | 'steps';
const WIDTH = 360;
const HEIGHT = 112;
const BASE = 104;
const TOP = 14;
const LEFT = 8;
const RIGHT = 8;

export function SalesReportTrend({ daily, metric, title, kind, cumulative = false, featured = false }: {
  daily: SalesReportDailyPoint[]; metric: SalesReportMetric; title: string;
  kind: SalesReportChartKind; cumulative?: boolean; featured?: boolean;
}) {
  const { t, language } = useTranslation();
  const id = useId().replace(/:/g, '');
  const [selected, setSelected] = useState<number | null>(null);
  const points = useMemo(() => salesReportChartPoints(daily, metric, cumulative), [daily, metric, cumulative]);
  const number = new Intl.NumberFormat(language);
  if (!points.length) return <div className="flex h-36 items-center justify-center text-xs text-muted-foreground">{t('noData')}</div>;
  const max = Math.max(...points.map(point => point.value));
  const step = (WIDTH - LEFT - RIGHT) / points.length;
  const y = (value: number) => BASE - value / Math.max(1, max) * (BASE - TOP);
  const plotted = points.map((point, index) => ({ ...point, x: LEFT + (index + 0.5) * step, y: y(point.value) }));
  const index = Math.min(selected ?? points.length - 1, points.length - 1);
  const active = plotted[index];
  const spansYears = points[0].from.slice(0, 4) !== points.at(-1)!.to.slice(0, 4);
  const date = (value: string) => formatAcademyDate(`${value}T00:00:00+05:00`, language,
    { day: 'numeric', month: 'short', ...(spansYears ? { year: 'numeric' } as const : {}) });
  const interval = (point: typeof active) => point.from === point.to ? date(point.from) : `${date(point.from)} — ${date(point.to)}`;
  const label = cumulative ? t('salesReportCohortCumulative') : t('salesReportCohortDaily');
  const path = kind === 'steps'
    ? plotted.map((point, i) => i ? `H${point.x} V${point.y}` : `M${point.x},${point.y}`).join(' ')
    : smoothReportPath(plotted);
  const pick = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;
    const x = (event.clientX - bounds.left) / bounds.width * WIDTH;
    setSelected(Math.max(0, Math.min(points.length - 1, Math.floor((x - LEFT) / step))));
  };

  return <div className="min-w-0">
    <div className="mb-3 flex min-h-4 items-center justify-between gap-2 text-[11px] font-medium tabular-nums">
      <span className="truncate text-muted-foreground">{selected === null ? label : interval(active)}</span>
      <span className={selected === null ? 'invisible' : 'text-foreground'}>{number.format(active.value)}</span>
    </div>
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none"
      className={`${featured ? 'h-36' : 'h-28'} w-full overflow-visible rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      role="slider" tabIndex={0} aria-label={`${title} · ${label}`}
      aria-valuemin={0} aria-valuemax={points.length - 1} aria-valuenow={index}
      aria-valuetext={`${interval(active)}: ${number.format(active.value)}`} aria-orientation="horizontal"
      onPointerDown={pick} onPointerMove={pick}
      onPointerLeave={event => { if (document.activeElement !== event.currentTarget) setSelected(null); }}
      onFocus={() => setSelected(index)} onBlur={() => setSelected(null)}
      onKeyDown={event => {
        const next = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? index + 1
          : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? index - 1
            : event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : null;
        if (next !== null) { event.preventDefault(); setSelected(Math.max(0, Math.min(points.length - 1, next))); }
      }}>
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.24" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.015" />
        </linearGradient>
        <linearGradient id={`${id}-bars`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.95" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.25" />
        </linearGradient>
      </defs>
      {[TOP, (TOP + BASE) / 2, BASE].map((position, i) => <line key={position}
        x1={0} y1={position} x2={WIDTH} y2={position} stroke="currentColor" strokeOpacity={i === 2 ? 0.16 : 0.08} strokeDasharray={i === 2 ? undefined : '3 6'} />)}
      {plotted.length > 1 && (kind === 'area' || kind === 'line' || kind === 'steps') ? <>
        {kind !== 'line' ? <path d={`${path} L${plotted.at(-1)!.x},${BASE} L${plotted[0].x},${BASE} Z`} fill={`url(#${id}-fill)`} /> : null}
        <path d={path} fill="none" stroke="currentColor" strokeWidth={featured ? 3 : 2.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {max > 0 ? <circle cx={plotted.at(-1)!.x} cy={plotted.at(-1)!.y} r={3.5} fill="currentColor" stroke="var(--card)" strokeWidth={2} /> : null}
      </> : plotted.map((point, pointIndex) => kind === 'bars' || plotted.length === 1 ?
        <rect key={point.from} x={point.x - Math.min(32, step * 0.64) / 2} y={point.y} width={Math.min(32, step * 0.64)} height={BASE - point.y}
          rx={Math.min(3, step * 0.2)} fill={`url(#${id}-bars)`} opacity={selected === null || pointIndex === index ? 1 : 0.3} /> :
        <g key={point.from} opacity={selected === null || pointIndex === index ? 1 : 0.3}>
          <line x1={point.x} y1={BASE} x2={point.x} y2={point.y} stroke="currentColor" strokeWidth={Math.min(7, step * 0.5)} strokeOpacity={0.22} />
          {point.value ? <circle cx={point.x} cy={point.y} r={Math.min(3.5, step * 0.3)} fill="currentColor" /> : null}
        </g>)}
      {selected !== null ? <g>
        <line x1={active.x} y1={TOP} x2={active.x} y2={BASE} stroke="currentColor" strokeDasharray="3 4" strokeOpacity={0.55} />
        <circle cx={active.x} cy={active.y} r={4.5} fill="currentColor" stroke="var(--card)" strokeWidth={2} />
      </g> : null}
    </svg>
    <div className="mt-3 flex justify-between gap-2 text-[10px] font-medium tabular-nums text-muted-foreground">
      <span>{date(points[0].from)}</span>
      <span>{points[0].from !== points.at(-1)!.to ? date(points.at(-1)!.to) : null}</span>
    </div>
  </div>;
}
