import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { academyToday } from '@/lib/localeFormat';

type FutureGroupValues = {
  startDate: string;
  status: 'open' | 'in_progress' | 'completed';
};

interface FutureGroupStartDialogProps<T extends FutureGroupValues> {
  values: T | null;
  isPending: boolean;
  onDismiss: () => void;
  onReturnToStartDate: () => void;
  onStatusChange: (status: FutureGroupValues['status']) => void;
  onSave: (values: T & { allowFutureStart?: boolean }) => void;
}

export const futureGroupStatusNeedsConfirmation = (
  values: Pick<FutureGroupValues, 'startDate' | 'status'>,
  today = academyToday(),
) => values.status === 'in_progress' && Boolean(values.startDate) && values.startDate > today;

export function FutureGroupStartDialog<T extends FutureGroupValues>({
  values,
  isPending,
  onDismiss,
  onReturnToStartDate,
  onStatusChange,
  onSave,
}: FutureGroupStartDialogProps<T>) {
  const { t, language } = useTranslation();
  const formattedStartDate = useMemo(() => {
    if (!values?.startDate) return '';
    return new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${values.startDate}T00:00:00Z`));
  }, [language, values?.startDate]);

  return (
    <Dialog open={Boolean(values)} onOpenChange={(open) => {
      if (!open && !isPending) onDismiss();
    }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('futureGroupStartTitle')}</DialogTitle>
          <DialogDescription>
            {formattedStartDate
              ? t('futureGroupStartDescription').replace('{date}', formattedStartDate)
              : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button type="button" variant="outline" disabled={isPending} onClick={() => {
            onDismiss();
            onReturnToStartDate();
          }}>
            {t('changeStartDate')}
          </Button>
          <Button type="button" variant="secondary" disabled={isPending} onClick={() => {
            if (!values) return;
            onStatusChange('open');
            onDismiss();
            onSave({ ...values, status: 'open' });
          }}>
            {t('keepGroupPlanned')}
          </Button>
          <Button type="button" disabled={isPending} onClick={() => {
            if (!values) return;
            onDismiss();
            onSave({ ...values, allowFutureStart: true });
          }}>
            {isPending ? t('saving') : t('startFutureGroupAnyway')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
