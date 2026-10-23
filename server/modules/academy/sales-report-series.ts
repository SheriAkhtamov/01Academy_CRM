import { SALES_REPORT_METRICS, type SalesReportDailyPoint } from '@shared/contracts/sales-report';

/** Empty days are real zero buckets; each metric's series sums to its headline. */
export function fillSalesReportDays(
  rows: SalesReportDailyPoint[] | undefined,
  range: { from: string; to: string },
): SalesReportDailyPoint[] {
  const values = new Map((Array.isArray(rows) ? rows : []).map(row => [row.date, row]));
  const first = Date.parse(`${range.from}T00:00:00Z`);
  const last = Date.parse(`${range.to}T00:00:00Z`);
  const result: SalesReportDailyPoint[] = [];
  for (let time = first; time <= last; time += 86_400_000) {
    const date = new Date(time).toISOString().slice(0, 10);
    const source = values.get(date);
    const point = { date } as SalesReportDailyPoint;
    for (const metric of SALES_REPORT_METRICS) point[metric] = Math.max(0, Number(source?.[metric]) || 0);
    result.push(point);
  }
  return result;
}
