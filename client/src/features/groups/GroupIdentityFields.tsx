import { useFormContext } from 'react-hook-form';
import { useTranslation } from '@/hooks/useTranslation';
import type { GroupValues } from '@/lib/academyResourceSchemas';
import { FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { ProtectedGroupNameInput } from './ProtectedGroupNameInput';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LocalizedFormMessage } from '@/components/ux/lead/LeadSheetControls';

export function GroupIdentityFields({ code, error, pending, editing }: {
  code: string; error: string; pending: boolean; editing: boolean;
}) {
  const { t } = useTranslation();
  const form = useFormContext<GroupValues>();
  return <>
    <FormField control={form.control} name="deliveryMode" render={({ field }) => <FormItem>
      <FormLabel required>{t('groupDeliveryFormat')}</FormLabel>
      <Select value={field.value} onValueChange={field.onChange} disabled={editing}>
        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
        <SelectContent><SelectItem value="offline">{t('offline')}</SelectItem><SelectItem value="online">{t('online')}</SelectItem></SelectContent>
      </Select><LocalizedFormMessage />
    </FormItem>} />
    <FormField control={form.control} name="trainingType" render={({ field }) => <FormItem>
      <FormLabel required>{t('groupTrainingType')}</FormLabel>
      <Select value={field.value} onValueChange={(value) => {
        field.onChange(value);
        if (value === 'IND') form.setValue('maxStudents', 1, { shouldDirty: true });
      }} disabled={editing}>
        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
        <SelectContent><SelectItem value="GRP">{t('groupTrainingGroup')}</SelectItem><SelectItem value="IND">{t('groupTrainingIndividual')}</SelectItem></SelectContent>
      </Select><LocalizedFormMessage />
    </FormItem>} />
    <FormField control={form.control} name="nameSuffix" render={({ field }) => <FormItem className="md:col-span-2">
      <FormLabel>{t('groupName')}</FormLabel>
      <FormControl><ProtectedGroupNameInput ref={field.ref} code={code} addition={field.value}
        onAdditionChange={field.onChange} onBlur={field.onBlur} pending={pending}
        placeholder={t('groupNameAdditionPlaceholder')} /></FormControl>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p>
        : form.formState.errors.name ? <p className="text-sm text-destructive" role="alert">{form.formState.errors.name.message}</p>
          : <LocalizedFormMessage />}
    </FormItem>} />
  </>;
}
