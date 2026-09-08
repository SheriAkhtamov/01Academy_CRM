import type { ReactNode } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { salesGaugePosition } from '@/lib/salesMetricCharts';

export function SalesMetricGauge({ value, target = null, min = 0, max = 100, semicircle = false, label, children, className = '' }: {
  value: number | null; target?: number | null; min?: number; max?: number; semicircle?: boolean;
  label: string; children: ReactNode; className?: string;
}) {
  const { t } = useTranslation();
  const position = salesGaugePosition(value, min, max);
  const goal = salesGaugePosition(target, min, max);
  const angle = (fraction: number) => (semicircle ? Math.PI + fraction * Math.PI : -Math.PI / 2 + fraction * 2 * Math.PI);
  const point = (fraction: number, radius: number) => ({ x: 60 + radius * Math.cos(angle(fraction)), y: 60 + radius * Math.sin(angle(fraction)) });
  const start = goal === null ? null : point(goal, 42);
  const end = goal === null ? null : point(goal, 57);
  const arc = semicircle ? 'M 10,60 A 50,50 0 0 1 110,60' : 'M 60,10 A 50,50 0 1 1 60,110 A 50,50 0 1 1 60,10';
  return <div className={`relative ${className}`}>
    <svg viewBox={`0 0 120 ${semicircle ? 70 : 120}`} className="block w-full overflow-visible" role="img" aria-label={label}>
      <path d={arc} fill="none" stroke="currentColor" strokeOpacity={0.1} strokeWidth={9} strokeLinecap="round" />
      {Array.from({ length: semicircle ? 21 : 36 }, (_, i) => {
        const fraction = i / (semicircle ? 20 : 36);
        const from = point(fraction, 59);
        const to = point(fraction, 61);
        return <line key={i} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="currentColor" strokeOpacity={0.22} strokeWidth={0.7} />;
      })}
      {position !== null && position > 0 ? <path d={arc} pathLength={100} fill="none" stroke="currentColor" strokeWidth={9} strokeDasharray={`${position * 100} 100`} strokeLinecap="round" /> : null}
      {start && end ? <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="var(--foreground)" strokeWidth={2} strokeLinecap="round"><title>{t('salesTargetMarker')}: {target}</title></line> : null}
    </svg>
    <div className={`absolute inset-x-0 flex flex-col items-center justify-center text-foreground ${semicircle ? 'bottom-0 top-7' : 'inset-y-0'}`}>{children}</div>
  </div>;
}

export function SalesTargetBullet({ value, target, label, className = '' }: { value: number | null; target: number; label: string; className?: string }) {
  const upper = Math.max(target, value ?? 0, 1) * 1.2;
  const position = salesGaugePosition(value, 0, upper);
  const goal = salesGaugePosition(target, 0, upper) ?? 0;
  return <svg viewBox="0 0 280 32" preserveAspectRatio="none" className={`h-8 w-full ${className}`} role="img" aria-label={label}>
    {Array.from({ length: 32 }, (_, i) => <rect key={i} x={i * 8.7 + 1} y={8} width={5.7} height={16} rx={1.5} fill="currentColor" opacity={0.1} />)}
    {position !== null ? Array.from({ length: 32 }, (_, i) => {
      const fill = Math.max(0, Math.min(1, position * 32 - i));
      return fill > 0 ? <rect key={i} x={i * 8.7 + 1} y={8} width={5.7 * fill} height={16} rx={1.5} fill="currentColor" /> : null;
    }) : null}
    <path d={`M${goal * 278},2 v28`} stroke="var(--foreground)" strokeWidth={2} strokeLinecap="round" />
  </svg>;
}
