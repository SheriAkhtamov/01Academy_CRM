import { useFormContext } from 'react-hook-form';
import { FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { LocalizedFormMessage } from '@/components/ux/lead/LeadSheetControls';
import { useTranslation } from '@/hooks/useTranslation';
import { academyToday } from '@/lib/localeFormat';

export function LeadPaymentDateField() {
  const { t } = useTranslation();
  const form = useFormContext<{ paidAt: string }>();
  return <FormField control={form.control} name="paidAt" render={({ field, fieldState }) => (
    <FormItem>
      <FormLabel>{t('paymentDate')}</FormLabel>
      <FormControl><Input {...field} type="date" max={academyToday()} aria-invalid={fieldState.invalid} /></FormControl>
      <LocalizedFormMessage />
    </FormItem>
  )} />;
}
