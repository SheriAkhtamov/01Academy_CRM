import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { MetaIntegrationState } from '@/features/marketing/meta-api';
import { useTranslation } from '@/hooks/useTranslation';

function ConfigRow({ label, value, ready }: { label: string; value: string; ready?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-3 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center gap-2 text-right">
        <span className="break-all font-mono text-xs text-foreground">{value}</span>
        {ready !== undefined ? (
          <Badge variant={ready ? 'success' : 'outline'}>
            {ready ? t('metaConfigured') : t('metaNotConfigured')}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

export function MetaIntegrationDialog({
  open,
  onOpenChange,
  integration,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  integration?: MetaIntegrationState | null;
}) {
  const { t } = useTranslation();
  const missing = t('metaNotConfigured');
  const stages = integration?.conversionStages ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('metaConnection')}</DialogTitle>
          <DialogDescription>{t('metaConnectionDescription')}</DialogDescription>
        </DialogHeader>
        <div className="mt-2 rounded-xl border border-border/70 bg-muted/20 px-4">
          <ConfigRow
            label={t('metaAttribution')}
            value={integration?.adAccountId || missing}
            ready={Boolean(integration?.attributionConfigured)}
          />
          <ConfigRow
            label={t('metaEventManager')}
            value={integration?.datasetId || missing}
            ready={Boolean(integration?.capiConfigured)}
          />
          <ConfigRow label={t('metaApiVersion')} value={integration?.apiVersion || missing} />
          <ConfigRow label={t('metaAdAccountId')} value={integration?.adAccountId || missing} />
          <ConfigRow label={t('metaBusinessId')} value={integration?.businessId || missing} />
          <ConfigRow label={t('metaDatasetId')} value={integration?.datasetId || missing} />
          <ConfigRow label={t('metaPageId')} value={integration?.pageId || missing} />
          <ConfigRow
            label={t('metaConversionMapping')}
            value={stages.length ? String(stages.length) : missing}
          />
          <ConfigRow
            label={t('metaTestMode')}
            value={integration?.testMode ? t('metaTestModeOn') : t('metaTestModeOff')}
          />
          <ConfigRow label={t('metaRequiredPermissions')} value={t('metaRequiredPermissionsValue')} />
        </div>
        {stages.length ? (
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <p className="text-sm font-medium text-foreground">{t('metaStageEventsTitle')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('metaStageEventsHint')}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {stages.map((stage) => (
                <Badge key={stage.code} variant="outline" className="font-normal" title={stage.code}>
                  {stage.name}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
