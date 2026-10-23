import type { SalesReportDailyPoint, SalesReportMetric } from '@shared/contracts/sales-report';

export type SalesReportChartPoint = { from: string; to: string; value: number };

/** Preserve totals when long ranges are grouped to fit a small chart. */
export function salesReportChartPoints(
  daily: readonly SalesReportDailyPoint[], metric: SalesReportMetric,
  cumulative = false, maximumPoints = 40,
): SalesReportChartPoint[] {
  const groupSize = Math.max(1, Math.ceil(daily.length / maximumPoints));
  const result: SalesReportChartPoint[] = [];
  let total = 0;
  for (let index = 0; index < daily.length; index += groupSize) {
    const group = daily.slice(index, index + groupSize);
    const value = group.reduce((sum, day) => sum + day[metric], 0);
    total += value;
    result.push({ from: group[0].date, to: group.at(-1)!.date, value: cumulative ? total : value });
  }
  return result;
}

export function smoothReportPath(points: readonly { x: number; y: number }[]) {
  return points.map((point, index) => {
    if (!index) return `M${point.x},${point.y}`;
    const previous = points[index - 1];
    const middle = (previous.x + point.x) / 2;
    // Horizontal tangents keep the curve within adjacent measured values.
    return `C${middle},${previous.y} ${middle},${point.y} ${point.x},${point.y}`;
  }).join(' ');
}
