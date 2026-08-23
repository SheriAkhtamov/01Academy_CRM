import { useTranslation } from '@/hooks/useTranslation';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function GroupStatusField() {
  const { t } = useTranslation();
  return (
    <FormField name="status" render={({ field }) => (
      <FormItem>
        <FormLabel>{t('status')}</FormLabel>
        <Select value={field.value} onValueChange={field.onChange}>
          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="open">{t('groupStatusOpen')}</SelectItem>
              <SelectItem value="in_progress">{t('groupStatusInProgress')}</SelectItem>
              <SelectItem value="completed">{t('groupStatusCompleted')}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <FormMessage />
      </FormItem>
    )} />
  );
}
