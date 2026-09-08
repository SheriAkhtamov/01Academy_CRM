const OFFSET_MS = 5 * 60 * 60 * 1_000;
const DAY_MS = 86_400_000;

/** KPI accounting uses the academy's fixed Asia/Tashkent business calendar. */
export function kpiDay(value: Date | string): string {
  return new Date(new Date(value).getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

export const kpiMonth = (value: Date | string = new Date()) => kpiDay(value).slice(0, 7);
export function nextKpiMonth(month: string): string {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7);
}
export function kpiMonthBounds(month: string): { start: Date; end: Date } {
  return {
    start: new Date(`${month}-01T00:00:00+05:00`),
    end: new Date(`${nextKpiMonth(month)}-01T00:00:00+05:00`),
  };
}

export function workingMinutesBetween(
  from: string, to: string,
  config: { workdayStartHour: number; workdayEndHour: number; workdays: number[] },
): number {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return Infinity;
  let result = 0;
  const firstDay = Math.floor((start + OFFSET_MS) / DAY_MS) * DAY_MS - OFFSET_MS;
  for (let day = firstDay; day < end; day += DAY_MS) {
    const weekday = new Date(day + OFFSET_MS).getUTCDay() || 7;
    if (!config.workdays.includes(weekday)) continue;
    const workStart = day + config.workdayStartHour * 3_600_000;
    const workEnd = day + config.workdayEndHour * 3_600_000;
    result += Math.max(0, Math.min(end, workEnd) - Math.max(start, workStart));
  }
  return result / 60_000;
}

export function offerDeadline(trialAt: string, nextDayHour: number): number {
  return new Date(`${kpiDay(trialAt)}T00:00:00+05:00`).getTime()
    + DAY_MS + nextDayHour * 3_600_000;
}
