import { academyDateInputValue, academyInstant } from '@/lib/localeFormat';

const toInputDate = academyDateInputValue;

export const deadlineInputToInstant = (value: string): string | null => {
  const [dateKey, timePart] = value.split('T');
  if (!dateKey || !timePart || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const instant = academyInstant(dateKey, timePart.slice(0, 5));
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
};

type PaymentWithPaidUntil = { paidUntil?: string | null };

export const nextPaymentDate = (payments?: PaymentWithPaidUntil[]) => {
  const latestPaidUntil = (payments ?? []).reduce((latest, payment) => {
    if (!payment.paidUntil) return latest;
    const timestamp = new Date(payment.paidUntil).getTime();
    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
  }, 0);
  const baseTimestamp = Math.max(Date.now(), latestPaidUntil);
  return toInputDate(new Date(baseTimestamp + 30 * 24 * 60 * 60 * 1000).toISOString());
};
