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
    <dl className="grid grid-cols-1 divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      <div className="min-w-0 p-5">
        <dt className="flex items-center gap-2 text-xs text-muted-foreground">
          <Banknote className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {t('expectedPayment')}
        </dt>
        <dd className="mt-3 break-words text-xl font-semibold tracking-tight tabular-nums">{expected == null ? '—' : money(expected)}</dd>
      </div>
      <div className="min-w-0 p-5">
        <dt className="flex items-center gap-2 text-xs text-muted-foreground">
          <Wallet className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {t('totalPaidLabel')}
        </dt>
        <dd className="mt-3 break-words text-xl font-semibold tracking-tight tabular-nums">{money(paid)}</dd>
      </div>
      <div className="min-w-0 p-5">
        <dt className="flex items-center gap-2 text-xs text-muted-foreground">
          <CreditCard className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {t('studentPaymentRemaining')}
        </dt>
        <dd className="mt-3 break-words text-xl font-semibold tracking-tight tabular-nums">{remaining == null ? '—' : money(remaining)}</dd>
      </div>
    </dl>
  );
}
