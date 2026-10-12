import { useFormContext } from 'react-hook-form';
import { useTranslation } from '@/hooks/useTranslation';
import type { GroupValues } from '@/lib/academyResourceSchemas';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { ProtectedGroupNameInput } from './ProtectedGroupNameInput';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

export function GroupIdentityFields({ code, error, pending, editing, onRetry }: {
  code: string; error: string; pending: boolean; editing: boolean; onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const form = useFormContext<GroupValues>();
  return <>
    <FormField control={form.control} name="deliveryMode" render={({ field }) => <FormItem>
      <FormLabel required>{t('groupDeliveryFormat')}</FormLabel>
      <Select value={field.value} onValueChange={field.onChange} disabled={editing}>
        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
        <SelectContent><SelectItem value="offline">{t('offline')}</SelectItem><SelectItem value="online">{t('online')}</SelectItem></SelectContent>
      </Select><FormMessage />
    </FormItem>} />
    <FormField control={form.control} name="trainingType" render={({ field }) => <FormItem>
      <FormLabel required>{t('groupTrainingType')}</FormLabel>
      <Select value={field.value} onValueChange={(value) => {
        field.onChange(value);
        if (value === 'IND') form.setValue('maxStudents', 1, { shouldDirty: true });
      }} disabled={editing}>
        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
        <SelectContent><SelectItem value="GRP">{t('groupTrainingGroup')}</SelectItem><SelectItem value="IND">{t('groupTrainingIndividual')}</SelectItem></SelectContent>
      </Select><FormMessage />
    </FormItem>} />
    <FormField control={form.control} name="nameSuffix" render={({ field }) => <FormItem className="md:col-span-2">
      <FormLabel>{t('groupName')}</FormLabel>
      <FormControl><ProtectedGroupNameInput ref={field.ref} code={code} addition={field.value}
        onAdditionChange={field.onChange} onBlur={field.onBlur} pending={pending}
        placeholder={t('groupNameAdditionPlaceholder')} /></FormControl>
      {error ? <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-destructive" role="alert">{error}</p>
        {onRetry ? <Button type="button" variant="ghost" size="sm" className="h-7 px-2" disabled={pending} onClick={onRetry}>{t('retry')}</Button> : null}
      </div>
        : form.formState.errors.name ? <p className="text-sm text-destructive" role="alert">{form.formState.errors.name.message}</p>
          : <FormMessage />}
    </FormItem>} />
  </>;
}
