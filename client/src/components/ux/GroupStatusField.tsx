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

const STATUS_DOT_CLASSES: Record<'open' | 'in_progress' | 'frozen' | 'completed', string> = {
  open: 'bg-emerald-500',
  in_progress: 'bg-sky-500',
  frozen: 'bg-amber-500',
  completed: 'bg-slate-400',
};

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
              {([
                ['open', 'groupStatusOpen'],
                ['in_progress', 'groupStatusInProgress'],
                ['frozen', 'groupStatusFrozen'],
                ['completed', 'groupStatusCompleted'],
              ] as const).map(([value, labelKey]) => (
                <SelectItem key={value} value={value}>
                  <span className="inline-flex items-center gap-2">
                    <span className={`size-2 shrink-0 rounded-full ${STATUS_DOT_CLASSES[value]}`} aria-hidden="true" />
                    <span>{t(labelKey)}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <FormMessage />
      </FormItem>
    )} />
  );
}
