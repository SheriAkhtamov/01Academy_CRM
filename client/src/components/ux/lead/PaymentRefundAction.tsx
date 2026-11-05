import { useState } from 'react';
import { Undo2 } from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { useRefundPayment } from '@/features/payments/useRefundPayment';

/** A refund keeps the payment in history and takes its amount out of revenue. */
export function PaymentRefundAction({ paymentId, amountLabel, disabled, onRefunded }: {
  paymentId: number;
  amountLabel: string;
  disabled?: boolean;
  onRefunded: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const refund = useRefundPayment();
  const reasonId = `payment-refund-reason-${paymentId}`;

  return (
    <>
      <Button
        data-lead-processing
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={disabled}
        onClick={() => {
          setReason('');
          setError(undefined);
          setOpen(true);
        }}
      >
        <Undo2 data-icon="inline-start" />
        {t('financeCenterRefunded')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          if (!refund.isPending) setOpen(next);
        }}
        title={t('paymentRefundTitle')}
        description={t('paymentRefundDescription')}
        target={amountLabel}
        confirmationKey={paymentId}
        confirmLabel={t('financeCenterRefunded')}
        variant="destructive"
        keepOpenOnConfirm
        isPending={refund.isPending}
        confirmDisabled={reason.trim().length < 3}
        error={error}
        onConfirm={async () => {
          setError(undefined);
          try {
            await refund.mutateAsync({ paymentId, reason: reason.trim() });
            setOpen(false);
            toast({ title: t('paymentRefunded') });
            onRefunded();
          } catch (refundError) {
            setError(refundError instanceof Error ? refundError.message : t('errorOccurred'));
          }
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor={reasonId} className="text-xs">{t('paymentRefundReason')}</Label>
          <Textarea
            id={reasonId}
            value={reason}
            maxLength={1000}
            disabled={refund.isPending}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      </ConfirmDialog>
    </>
  );
}
