import ConfirmDialog from '@/components/ConfirmDialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from '@/hooks/useTranslation';
import type { financeCopy } from '@/lib/financeCenter';
import { submitOnEnter } from '@/lib/submitOnEnter';
import type { Row } from '@/lib/financeRows';

interface ActionState {
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}
interface Props {
  copy: ReturnType<typeof financeCopy>;
  error: string;
  money: (value: number) => string;
  methods: readonly string[];
  methodLabel: (value: string) => string;
  pay: ActionState & { target: Row | null; method: string; onMethodChange: (method: string) => void };
  batch: ActionState & { open: boolean; count: number; amount: number; method: string; onMethodChange: (method: string) => void };
  cancel: ActionState & { target: Row | null; reason: string; onReasonChange: (reason: string) => void };
}

export function FinanceActionDialogs({ copy, error, money, methods, methodLabel, pay, batch, cancel }: Props) {
  const { t } = useTranslation();
  const methodPicker = (value: string, onChange: (value: string) => void, disabled: boolean) => (
    <Field>
      <FieldLabel>{copy.paymentMethod}</FieldLabel>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger aria-label={copy.paymentMethod}><SelectValue /></SelectTrigger>
        <SelectContent>{methods.map((method) => <SelectItem key={method} value={method}>{methodLabel(method)}</SelectItem>)}</SelectContent>
      </Select>
    </Field>
  );
  return <>
    <ConfirmDialog open={batch.open} onOpenChange={(open) => { if (!open) batch.onClose(); }}
      title={copy.batchTitle} description={`${t('payAllConfirmCount').replace('{count}', String(batch.count))} ${t('payAllConfirmTotal').replace('{amount}', money(batch.amount))}`}
      confirmLabel={copy.confirmBatch} cancelLabel={copy.formCancel} onConfirm={batch.onConfirm} isPending={batch.pending} keepOpenOnConfirm error={error}>
      {methodPicker(batch.method, batch.onMethodChange, batch.pending)}
    </ConfirmDialog>
    <ConfirmDialog open={Boolean(pay.target)} onOpenChange={(open) => { if (!open) pay.onClose(); }}
      title={copy.confirmPayTitle} description={pay.target ? `${pay.target.title} · ${money(pay.target.amountUzs)}` : ''}
      confirmLabel={copy.confirmPay} cancelLabel={copy.formCancel} onConfirm={pay.onConfirm} isPending={pay.pending} keepOpenOnConfirm error={error}>
      {methodPicker(pay.method, pay.onMethodChange, pay.pending)}
    </ConfirmDialog>
    <ConfirmDialog open={Boolean(cancel.target)} onOpenChange={(open) => { if (!open) cancel.onClose(); }}
      title={copy.confirmCancel} description={cancel.target?.title || ''} variant="destructive"
      confirmLabel={copy.confirmCancel} cancelLabel={copy.formCancel} onConfirm={() => { if (cancel.reason.trim()) cancel.onConfirm(); }}
      isPending={cancel.pending} confirmDisabled={!cancel.reason.trim()} keepOpenOnConfirm error={error}>
      <Field>
        <FieldLabel htmlFor="cancel-reason">{copy.cancellationReason}</FieldLabel>
        <Input id="cancel-reason" value={cancel.reason} disabled={cancel.pending} required aria-required
          onChange={(event) => cancel.onReasonChange(event.target.value)}
          onKeyDown={submitOnEnter(cancel.onConfirm, { disabled: !cancel.reason.trim() || cancel.pending })} />
      </Field>
    </ConfirmDialog>
  </>;
}
