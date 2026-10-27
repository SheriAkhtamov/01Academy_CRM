import { Building2, Globe, RotateCw, User, Users } from 'lucide-react';
import { useFormContext } from 'react-hook-form';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import type { GroupValues } from '@/lib/academyResourceSchemas';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { ProtectedGroupNameInput } from './ProtectedGroupNameInput';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Input } from '@/components/ui/input';

export function GroupIdentityFields({ code, error, pending, editing, coded, onRetry }: {
  code: string; error: string; pending: boolean; editing: boolean; coded: boolean; onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const form = useFormContext<GroupValues>();
  const handleCopyCode = async () => {
    if (!code) return false;
    try {
      await navigator.clipboard.writeText(code);
      toast({ title: t('groupCodeCopied'), description: code });
    } catch {
      toast({ title: t('copyFailed'), variant: 'destructive' });
      return false;
    }
  };

  return <>
    <FormField control={form.control} name="deliveryMode" render={({ field }) => <FormItem>
      <FormLabel required={coded}>{t('groupDeliveryFormat')}</FormLabel>
      <Select value={coded ? field.value : ''} onValueChange={field.onChange} disabled={editing}>
        <FormControl><SelectTrigger ref={field.ref} onBlur={field.onBlur}><SelectValue placeholder={t('groupIdentityUnspecified')} /></SelectTrigger></FormControl>
        <SelectContent>
          <SelectItem value="offline">
            <span className="inline-flex items-center gap-2">
              <Building2 className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span>{t('offline')}</span>
            </span>
          </SelectItem>
          <SelectItem value="online">
            <span className="inline-flex items-center gap-2">
              <Globe className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span>{t('online')}</span>
            </span>
          </SelectItem>
        </SelectContent>
      </Select><FormMessage />
    </FormItem>} />
    <FormField control={form.control} name="trainingType" render={({ field }) => <FormItem>
      <FormLabel required={coded}>{t('groupTrainingType')}</FormLabel>
      <Select value={coded ? field.value : ''} onValueChange={(value) => {
        field.onChange(value);
        if (value === 'IND') form.setValue('maxStudents', 1, { shouldDirty: true });
      }} disabled={editing}>
        <FormControl><SelectTrigger ref={field.ref} onBlur={field.onBlur}><SelectValue placeholder={t('groupIdentityUnspecified')} /></SelectTrigger></FormControl>
        <SelectContent>
          <SelectItem value="GRP">
            <span className="inline-flex items-center gap-2">
              <Users className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span>{t('groupTrainingGroup')}</span>
            </span>
          </SelectItem>
          <SelectItem value="IND">
            <span className="inline-flex items-center gap-2">
              <User className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span>{t('groupTrainingIndividual')}</span>
            </span>
          </SelectItem>
        </SelectContent>
      </Select><FormMessage />
    </FormItem>} />
    {coded ? <FormField control={form.control} name="nameSuffix" render={({ field }) => <FormItem className="sm:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FormLabel>{t('groupName')}</FormLabel>
        {code ? (
          <CopyButton
            type="button"
            unstyled
            onCopy={handleCopyCode}
            resetKey={code}
            iconPosition="end"
            iconClassName="size-3 opacity-75"
            aria-label={t('copyGroupCode')}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/25 bg-primary/8 px-2 py-0.5 font-mono text-xs font-semibold text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {code}
          </CopyButton>
        ) : null}
      </div>
      <FormControl><ProtectedGroupNameInput ref={field.ref} code={code} addition={field.value}
        onAdditionChange={field.onChange} onBlur={field.onBlur} pending={pending} /></FormControl>
      {error ? <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-1.5">
        <p className="text-sm font-medium text-destructive" role="alert">{error}</p>
        {onRetry ? (
          <Button type="button" variant="outline" size="sm" className="ml-auto h-7 gap-1.5 px-2.5 text-xs" disabled={pending} onClick={onRetry}>
            <RotateCw className="size-3" aria-hidden="true" />
            {t('retry')}
          </Button>
        ) : null}
      </div>
        : form.formState.errors.name ? <p className="text-sm text-destructive" role="alert">{form.formState.errors.name.message}</p>
          : <FormMessage />}
    </FormItem>} /> : <FormField control={form.control} name="name" render={({ field }) => <FormItem className="sm:col-span-2">
      <FormLabel required>{t('groupName')}</FormLabel>
      <FormControl><Input {...field} /></FormControl>
      <FormMessage />
    </FormItem>} />}
  </>;
}
