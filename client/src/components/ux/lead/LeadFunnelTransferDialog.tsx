import { useEffect, useId, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { SalesFunnelTransferOption } from '@shared/contracts/sales-funnels';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { OrbitSpinner } from '@/components/ui/orbit-spinner';
import { LoadingRegion } from '@/components/ui/loading-region';

interface LeadFunnelTransferDialogProps {
  open: boolean;
  currentFunnelId: number;
  funnels: SalesFunnelTransferOption[];
  isLoading: boolean;
  isError: boolean;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
  onConfirm: (funnel: SalesFunnelTransferOption, stageCode: string) => void;
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
  const stageFieldId = useId();
  const [selectedFunnelId, setSelectedFunnelId] = useState<number | null>(null);
  const [selectedStageCode, setSelectedStageCode] = useState('');
  const availableFunnels = funnels.filter((funnel) => (
    Number(funnel.id) !== Number(currentFunnelId)
  ));
  const selectedFunnel = availableFunnels.find((funnel) => funnel.id === selectedFunnelId) ?? null;
  const selectedStage = selectedFunnel?.stages.find((stage) => stage.code === selectedStageCode);

  useEffect(() => {
    setSelectedFunnelId(null);
    setSelectedStageCode('');
  }, [open, currentFunnelId, isLoading, isError]);

  useEffect(() => {
    if (selectedFunnelId !== null && !selectedFunnel) {
      setSelectedFunnelId(null);
      setSelectedStageCode('');
    }
  }, [selectedFunnelId, selectedFunnel]);

  useEffect(() => {
    if (selectedStageCode && !selectedStage) setSelectedStageCode('');
  }, [selectedStageCode, selectedStage]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (isPending) return;
    if (!nextOpen) {
      setSelectedFunnelId(null);
      setSelectedStageCode('');
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('sendLeadToFunnelTitle')}</DialogTitle>
        </DialogHeader>
        {isError ? (
          <div className="space-y-3">
            <p role="status" className="text-sm text-destructive">{t('failedToLoadData')}</p>
            <Button type="button" size="sm" variant="outline" onClick={onRetry}>
              {t('retry')}
            </Button>
          </div>
        ) : isLoading ? (
          <LoadingRegion className="space-y-2" aria-label={t('loading')}>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </LoadingRegion>
        ) : availableFunnels.length > 0 ? (
          <div className="grid gap-2" role="radiogroup" aria-label={t('availableSalesFunnels')}>
            {availableFunnels.map((funnel) => {
              const selected = selectedFunnelId === funnel.id;
              return (
                <label
                  key={funnel.id}
                  className={cn(
                    'flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-lg border px-4 py-3 transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
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
                    onChange={() => {
                      setSelectedFunnelId(funnel.id);
                      const initialStage = funnel.stages.find((stage) => stage.code === funnel.initialStageCode)
                        ?? funnel.stages[0];
                      setSelectedStageCode(initialStage?.code ?? '');
                    }}
                    disabled={isPending}
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
        {selectedFunnel && !isLoading && !isError ? (
          <div className="space-y-2">
            <Label htmlFor={stageFieldId}>{t('targetLeadStage')}</Label>
            <Select value={selectedStageCode} onValueChange={setSelectedStageCode} disabled={isPending}>
              <SelectTrigger id={stageFieldId}>
                <SelectValue placeholder={t('selectPipelineStage')} />
              </SelectTrigger>
              <SelectContent>
                {selectedFunnel.stages.map((stage) => (
                  <SelectItem key={stage.code} value={stage.code}>{stage.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={isPending} onClick={() => handleOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            disabled={!selectedFunnel || !selectedStage || isLoading || isError || isPending}
            onClick={() => {
              if (selectedFunnel && selectedStage && !isLoading && !isError && !isPending) {
                onConfirm(selectedFunnel, selectedStage.code);
              }
            }}
          >
            {isPending ? <OrbitSpinner className="" data-icon="inline-start" /> : null}
            {isPending ? t('saving') : t('send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
