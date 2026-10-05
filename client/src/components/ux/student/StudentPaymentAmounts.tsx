import { useTranslation } from '@/hooks/useTranslation';
import { formatAcademyNumber } from '@/lib/localeFormat';
import { cn } from '@/lib/utils';

type StudentPaymentAmountsProps = {
  paidAmountUzs?: number | null;
  expectedPaymentUzs?: number | null;
};

export function StudentPaymentAmounts({ paidAmountUzs, expectedPaymentUzs }: StudentPaymentAmountsProps) {
  const { t, language } = useTranslation();
  const paid = paidAmountUzs ?? 0;
  const covered = expectedPaymentUzs != null && expectedPaymentUzs > 0 && paid >= expectedPaymentUzs;
  const label = t('studentPaymentAmounts')
    .replace('{paid}', formatAcademyNumber(paid, language))
    .replace('{expected}', expectedPaymentUzs == null ? '—' : formatAcademyNumber(expectedPaymentUzs, language));

  return (
    <span className={cn('whitespace-nowrap text-sm font-medium tabular-nums',
      covered ? 'text-emerald-700 dark:text-emerald-300' : 'text-foreground')}>
      {label}
    </span>
  );
}
