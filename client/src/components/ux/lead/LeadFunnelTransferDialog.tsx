import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import type { SalesFunnel } from '@/features/sales-funnels/api';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';

interface LeadFunnelTransferDialogProps {
  open: boolean;
  currentFunnelId: number;
  funnels: SalesFunnel[];
  isLoading: boolean;
  isError: boolean;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
  onConfirm: (funnel: SalesFunnel) => void;
}

export function LeadFunnelTransferDialog({
  open,
  currentFunnelId,
  funnels,
  isLoading,
  isError,
  isPending,
  onOpenChange,
  onRetry,
  onConfirm,
}: LeadFunnelTransferDialogProps) {
  const { t } = useTranslation();
  const [selectedFunnelId, setSelectedFunnelId] = useState<number | null>(null);
  const availableFunnels = funnels.filter((funnel) => (
    funnel.isActive && Number(funnel.id) !== Number(currentFunnelId)
  ));
  const selectedFunnel = availableFunnels.find((funnel) => funnel.id === selectedFunnelId) ?? null;

  useEffect(() => {
    if (!open) setSelectedFunnelId(null);
  }, [open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (isPending) return;
    if (!nextOpen) setSelectedFunnelId(null);
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('sendLeadToFunnelTitle')}</DialogTitle>
          <DialogDescription>{t('sendLeadToFunnelDescription')}</DialogDescription>
        </DialogHeader>
        {isError ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>{t('failedToLoadData')}</AlertTitle>
            <AlertDescription>
              <Button type="button" size="sm" variant="outline" onClick={onRetry}>
                {t('retry')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : isLoading ? (
          <div className="space-y-2" aria-label={t('loading')}>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : availableFunnels.length > 0 ? (
          <div className="grid gap-2" role="radiogroup" aria-label={t('availableSalesFunnels')}>
            {availableFunnels.map((funnel) => {
              const selected = selectedFunnelId === funnel.id;
              return (
                <label
                  key={funnel.id}
                  className={cn(
                    'flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-lg border px-4 py-3 transition-colors',
                    selected
                      ? 'border-primary bg-primary/5 text-foreground ring-1 ring-primary'
                      : 'border-border bg-background hover:bg-muted/50',
                  )}
                >
                  <input
                    type="radio"
                    name="target-sales-funnel"
                    value={funnel.id}
                    checked={selected}
                    onChange={() => setSelectedFunnelId(funnel.id)}
                    className="sr-only"
                  />
                  <span className="min-w-0 break-words text-sm font-medium">{funnel.name}</span>
                  <CheckCircle2
                    className={cn('size-5 shrink-0', selected ? 'text-primary' : 'text-muted-foreground/30')}
                    aria-hidden="true"
                  />
                </label>
              );
            })}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {t('noAvailableSalesFunnels')}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={isPending} onClick={() => handleOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            disabled={!selectedFunnel || isPending}
            onClick={() => {
              if (selectedFunnel) onConfirm(selectedFunnel);
            }}
          >
            {isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
            {isPending ? t('saving') : t('send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
