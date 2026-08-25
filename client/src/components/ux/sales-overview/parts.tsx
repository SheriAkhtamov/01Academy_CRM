import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { motion } from 'framer-motion';
import { AnimatedNumber } from '@/components/ux/motion';
import { useTranslation } from '@/hooks/useTranslation';
import { EASE } from '@/lib/motion';
import { cn } from '@/lib/utils';

const TREND_ICONS = {
  up: ArrowUp,
  down: ArrowDown,
} as const;

/**
 * The signed change against the previous window.
 *
 * `invert` flips which direction is good — refusals going up is not a win. The
 * arrow always follows the arithmetic sign; only the colour follows `invert`,
 * so a reader who ignores colour still gets the direction right.
 */
export function TrendBadge({
  delta,
  invert = false,
  suffix,
  className,
}: {
  delta: number | null;
  invert?: boolean;
  suffix?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  if (delta === null || delta === 0) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground',
          className,
        )}
        title={t('previousPeriodLabel')}
      >
        <Minus className="size-3" aria-hidden="true" />0{suffix}
      </span>
    );
  }
  const positive = invert ? delta < 0 : delta > 0;
  const Icon = delta > 0 ? TREND_ICONS.up : TREND_ICONS.down;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
        positive
          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'bg-red-500/10 text-red-600 dark:text-red-400',
        className,
      )}
      title={t('previousPeriodLabel')}
    >
      <Icon className="size-3" aria-hidden="true" />
      {delta > 0 ? '+' : ''}{delta}{suffix}
    </span>
  );
}

/**
 * The previous-period figure, spelled out.
 *
 * A delta pill alone answers "by how much" but never "from what", and the
 * screen used to hide the answer in a `title` attribute — invisible on a touch
 * device and to anyone reading with the keyboard.
 */
export function PreviousValue({ value, className }: { value: string; className?: string }) {
  const { t } = useTranslation();
  return (
    <span className={cn('text-[11px] leading-4 tabular-nums text-muted-foreground', className)}>
      {t('before')} {value}
    </span>
  );
}

/**
 * A KPI's shape over the period, drawn small enough to sit inside its tile.
 *
 * Hand-rolled rather than a recharts instance: four of these mount at once in
 * a tile row, and a ResponsiveContainer each would cost far more than a
 * polyline is worth. `non-scaling-stroke` keeps the line even after the
 * viewBox is stretched to the tile's width.
 */
export function Sparkline({
  values,
  color,
  className,
}: {
  values: number[];
  color: string;
  className?: string;
}) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const step = 100 / (values.length - 1);
  const points = values.map((value, index) => (
    `${(index * step).toFixed(2)},${(100 - ((value - min) / span) * 100).toFixed(2)}`
  ));
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={cn('h-7 w-full', className)}
      aria-hidden="true"
      focusable="false"
    >
      <polygon points={`0,100 ${points.join(' ')} 100,100`} fill={color} fillOpacity={0.12} />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * The conversion arc — the one number this screen exists for.
 *
 * It draws itself from zero on every value change, and the counter in the
 * middle is timed to finish alongside the arc rather than racing ahead of it.
 */
export function ConversionRing({ percent, showValue }: { percent: number | null; showValue: boolean }) {
  const size = 132;
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          className="stroke-muted"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          className="stroke-[var(--primary-500)]"
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - (clamped / 100) * circumference }}
          transition={{ duration: 1, ease: EASE.out }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {showValue ? (
          <span className="text-[32px] font-bold leading-none tabular-nums tracking-tight text-foreground">
            <AnimatedNumber value={percent ?? 0} suffix="%" />
          </span>
        ) : (
          <span className="text-[32px] font-bold leading-none tabular-nums text-muted-foreground">—</span>
        )}
      </div>
    </div>
  );
}

/**
 * A band heading that gives the overview a spine.
 *
 * Thirteen cards of identical weight are a wall; three named zones are a page.
 */
export function SectionHeading({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 xl:col-span-12">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {title}
      </h2>
      <span className="h-px min-w-0 flex-1 bg-border" aria-hidden="true" />
      {action}
    </div>
  );
}

/** The small uppercase label inside a card header. */
export function CardEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
      {children}
    </p>
  );
}
