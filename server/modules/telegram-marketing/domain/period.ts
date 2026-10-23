import type { MarketingBotState } from '@shared/contracts/telegram-marketing';

const DAY_MS = 86_400_000;
export const marketingToday = (now = new Date()) => new Date(now.getTime() + 5 * 3_600_000).toISOString().slice(0, 10);
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

export function marketingPeriod(preset: string, now = new Date()): Pick<MarketingBotState, 'from' | 'to'> {
  const today = marketingToday(now);
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'yesterday') return { from: shift(today, -1), to: shift(today, -1) };
  if (preset === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  if (preset === 'previous') {
    const to = shift(`${today.slice(0, 7)}-01`, -1);
    return { from: `${to.slice(0, 7)}-01`, to };
  }
  return { from: shift(today, -6), to: today };
}

export function validMarketingPeriod(from: string, to: string, now = new Date()): boolean {
  const valid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(Date.parse(`${date}T00:00:00Z`))
    && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
  return valid(from) && valid(to) && from <= to && to <= marketingToday(now)
    && Date.parse(to) - Date.parse(from) < 366 * DAY_MS;
}

export function parseMarketingDates(text: string, now = new Date()) {
  const match = text.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})\s*[-–—]\s*(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return null;
  const from = `${match[3]}-${match[2]}-${match[1]}`;
  const to = `${match[6]}-${match[5]}-${match[4]}`;
  return validMarketingPeriod(from, to, now) ? { from, to } : null;
}

export const marketingDateBounds = ({ from, to }: Pick<MarketingBotState, 'from' | 'to'>) => ({
  start: new Date(`${from}T00:00:00+05:00`),
  end: new Date(Date.parse(`${to}T00:00:00+05:00`) + DAY_MS),
});
