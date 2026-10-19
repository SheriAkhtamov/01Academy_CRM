import { Banknote, CreditCard, Wallet } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

interface LeadPaymentSummaryProps {
  expectedPaymentTotalUzs?: number | null;
  expectedPaymentUzs?: number | null;
  payments?: ReadonlyArray<{ status: string; amountUzs: number }>;
  money: (value: number) => string;
}

export function LeadPaymentSummary({
  expectedPaymentTotalUzs,
  expectedPaymentUzs,
  payments = [],
  money,
}: LeadPaymentSummaryProps) {
  const { t } = useTranslation();
  const expected = expectedPaymentTotalUzs !== undefined ? expectedPaymentTotalUzs : expectedPaymentUzs;
  const paid = payments.filter(payment => payment.status === 'paid')
    .reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0);
  const remaining = expected == null ? null : Math.max(0, expected - paid);

  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="min-w-0 rounded-xl border border-sky-200/80 bg-sky-50/70 p-3 dark:border-sky-900/70 dark:bg-sky-950/30">
        <dt className="flex items-center gap-2 text-xs text-muted-foreground">
          <Banknote className="size-4 shrink-0 text-sky-700 dark:text-sky-300" aria-hidden="true" />
          {t('expectedPayment')}
        </dt>
        <dd className="mt-1 break-words text-sm font-semibold tabular-nums">{expected == null ? '—' : money(expected)}</dd>
      </div>
      <div className="min-w-0 rounded-xl border border-emerald-200/80 bg-emerald-50/70 p-3 dark:border-emerald-900/70 dark:bg-emerald-950/30">
        <dt className="flex items-center gap-2 text-xs text-muted-foreground">
          <Wallet className="size-4 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
          {t('totalPaidLabel')}
        </dt>
        <dd className="mt-1 break-words text-sm font-semibold tabular-nums">{money(paid)}</dd>
      </div>
      <div className="min-w-0 rounded-xl border border-amber-200/80 bg-amber-50/70 p-3 dark:border-amber-900/70 dark:bg-amber-950/30">
        <dt className="flex items-center gap-2 text-xs text-muted-foreground">
          <CreditCard className="size-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
          {t('studentPaymentRemaining')}
        </dt>
        <dd className="mt-1 break-words text-sm font-semibold tabular-nums">{remaining == null ? '—' : money(remaining)}</dd>
      </div>
    </dl>
  );
}
