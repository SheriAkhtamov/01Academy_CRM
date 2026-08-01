import { z } from 'zod';
import type { UseFormReturn } from 'react-hook-form';
import { CheckCircle2, CreditCard, GraduationCap, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { CurrencyInput } from '@/components/ux/FormattedInputs';
import { LocalizedFormMessage } from '@/components/ux/lead/LocalizedFormMessage';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { PAYMENT_DISCOUNTS, PAYMENT_METHODS, PAYMENT_TYPES } from '@shared/academy';

export const paymentSchema = z.object({
  studentId: z.string().min(1, 'studentSelectionRequired'),
  amountUzs: z.string().refine((value) => Number(value) > 0, 'fillRequiredFields'),
  method: z.string().min(1, 'fillRequiredFields'),
  type: z.string().min(1, 'fillRequiredFields'),
  discount: z.string().min(1, 'fillRequiredFields'),
  paidUntil: z.string(),
  comment: z.string(),
});

export type PaymentFormValues = z.infer<typeof paymentSchema>;

const paymentDiscountTranslationKeys = {
  promo_20: 'paymentDiscountPromo20',
  family_15: 'paymentDiscountFamily15',
  referral_15: 'paymentDiscountReferral15',
  none: 'paymentDiscountNone',
} as const satisfies Record<(typeof PAYMENT_DISCOUNTS)[number], TranslationKey>;

const paymentMethodTranslationKeys = {
  cash: 'paymentMethodCash',
  transfer: 'paymentMethodTransfer',
  card: 'paymentMethodCard',
} as const satisfies Record<(typeof PAYMENT_METHODS)[number], TranslationKey>;

const paymentTypeTranslationKeys = {
  full: 'paymentTypeFull',
  installment_1_2: 'paymentTypeInstallmentOne',
  installment_2_2: 'paymentTypeInstallmentTwo',
} as const satisfies Record<(typeof PAYMENT_TYPES)[number], TranslationKey>;

type Translate = (key: TranslationKey) => string;

const labelFor = <Code extends string>(
  map: Record<string, TranslationKey>,
  code: Code | null | undefined,
  t: Translate,
) => {
  if (!code) return null;
  const key = map[code];
  return key ? t(key) : code;
};

/** Human-readable "cash · full payment · no discount" line for a saved payment. */
export const paymentSummaryLine = (
  payment: Pick<LeadPaymentRecord, 'method' | 'type' | 'discount'>,
  t: Translate,
) => [
  labelFor(paymentMethodTranslationKeys, payment.method, t),
  labelFor(paymentTypeTranslationKeys, payment.type, t),
  labelFor(paymentDiscountTranslationKeys, payment.discount, t),
].filter(Boolean).join(' · ');

export interface LeadPaymentRecord {
  id: number;
  amountUzs: number;
  method: string;
  type?: string | null;
  discount?: string | null;
  paidUntil?: string | null;
  comment?: string | null;
  status: string;
  paidAt?: string | null;
  createdAt?: string | null;
  studentId?: number | null;
  studentName?: string | null;
}

interface LeadPaymentTabProps {
  form: UseFormReturn<PaymentFormValues>;
  students: Array<{ id: number; studentName?: string | null }>;
  payments: LeadPaymentRecord[];
  isPaidLead: boolean;
  isPending: boolean;
  onSubmit: (values: PaymentFormValues) => void;
  onCreateStudent: () => void;
  dateTime: (value: string | null | undefined) => string;
  money: (value: number | string | null | undefined) => string;
}

export function LeadPaymentTab({
  form,
  students,
  payments,
  isPaidLead,
  isPending,
  onSubmit,
  onCreateStudent,
  dateTime,
  money,
}: LeadPaymentTabProps) {
  const { t } = useTranslation();
  const paidTotal = payments
    .filter((payment) => payment.status === 'paid')
    .reduce((total, payment) => total + Number(payment.amountUzs || 0), 0);
  const paidUntil = payments.reduce<string | null>((latest, payment) => {
    if (!payment.paidUntil) return latest;
    if (!latest) return payment.paidUntil;
    return new Date(payment.paidUntil) > new Date(latest) ? payment.paidUntil : latest;
  }, null);

  return (
    <div className="flex flex-col gap-5">
      {payments.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
            <p className="text-xs text-muted-foreground">{t('paymentsReceived')}</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums">{money(paidTotal)}</p>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
            <p className="text-xs text-muted-foreground">{t('paymentCount')}</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums">{payments.length}</p>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
            <p className="text-xs text-muted-foreground">{t('paidUntil')}</p>
            <p className="mt-0.5 text-lg font-semibold">{paidUntil ? dateTime(paidUntil) : t('noData')}</p>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            {isPaidLead ? t('recordAnotherPayment') : t('recordPayment')}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {isPaidLead ? t('recurringPaymentHint') : t('leadSheetPaymentFormHint')}
          </p>
        </CardHeader>
        <CardContent>
          {students.length === 0 ? (
            <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-8 text-center">
              <GraduationCap className="mb-3 size-8 text-muted-foreground" />
              <p className="font-medium">{t('studentRequiredForPayment')}</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">{t('studentRequiredForPaymentHint')}</p>
              <Button type="button" className="mt-4" onClick={onCreateStudent}>
                <Plus data-icon="inline-start" />
                {t('createStudent')}
              </Button>
            </div>
          ) : (
            <Form {...form}>
              <form className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={form.handleSubmit(onSubmit)}>
                <FormField
                  control={form.control}
                  name="studentId"
                  render={({ field, fieldState }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>{t('paymentStudent')}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger aria-invalid={fieldState.invalid}>
                            <SelectValue placeholder={t('selectStudent')} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectGroup>
                            {students.map((student) => (
                              <SelectItem key={student.id} value={String(student.id)}>
                                {student.studentName || `${t('student')} #${student.id}`}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <LocalizedFormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="amountUzs"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormLabel>{t('amount')}</FormLabel>
                      <FormControl>
                        <CurrencyInput
                          ref={field.ref}
                          name={field.name}
                          value={field.value}
                          onBlur={field.onBlur}
                          onValueChange={field.onChange}
                          aria-invalid={fieldState.invalid}
                        />
                      </FormControl>
                      <LocalizedFormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="method"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('paymentMethod')}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectGroup>
                            {PAYMENT_METHODS.map((method) => (
                              <SelectItem key={method} value={method}>
                                {t(paymentMethodTranslationKeys[method])}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <LocalizedFormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('paymentType')}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectGroup>
                            {PAYMENT_TYPES.map((type) => (
                              <SelectItem key={type} value={type}>
                                {t(paymentTypeTranslationKeys[type])}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <LocalizedFormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="discount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('discount')}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectGroup>
                            {PAYMENT_DISCOUNTS.map((discount) => (
                              <SelectItem key={discount} value={discount}>
                                {t(paymentDiscountTranslationKeys[discount])}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <LocalizedFormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="paidUntil"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('paidUntil')}</FormLabel>
                      <FormControl><Input {...field} type="date" /></FormControl>
                      <LocalizedFormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="comment"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>{t('comment')}</FormLabel>
                      <FormControl><Textarea {...field} rows={2} /></FormControl>
                      <LocalizedFormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex flex-wrap items-center justify-end gap-3 md:col-span-2">
                  {isPaidLead ? null : (
                    <p className="mr-auto text-xs text-muted-foreground">{t('paymentCreatesClientHint')}</p>
                  )}
                  <Button type="submit" disabled={isPending}>
                    <CreditCard data-icon="inline-start" />
                    {isPending ? t('saving') : t('confirmPayment')}
                  </Button>
                </div>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('paymentHistory')}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-0 divide-y divide-border">
          {payments.length === 0 ? (
            <div className="flex flex-col items-center py-6 text-center">
              <CheckCircle2 className="mb-2 size-6 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">{t('noPayments')}</p>
            </div>
          ) : (
            payments.map((payment) => (
              <div key={payment.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="font-medium tabular-nums">{money(payment.amountUzs)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{paymentSummaryLine(payment, t)}</p>
                  {payment.studentName ? (
                    <p className="mt-1 text-xs text-muted-foreground">{t('student')}: {payment.studentName}</p>
                  ) : null}
                  {payment.comment ? <p className="mt-1 text-xs text-muted-foreground">{payment.comment}</p> : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                  <Badge variant={payment.status === 'paid' ? 'success' : payment.status === 'overdue' ? 'destructive' : 'warning'}>
                    {payment.status === 'paid'
                      ? t('paymentStatusPaid')
                      : payment.status === 'overdue'
                        ? t('paymentStatusOverdue')
                        : t('paymentStatusPending')}
                  </Badge>
                  <p className="text-xs text-muted-foreground">{dateTime(payment.paidAt || payment.createdAt)}</p>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
