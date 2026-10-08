import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { MetaIntegrationState } from '@/features/marketing/meta-api';
import { useTranslation } from '@/hooks/useTranslation';

export function MetaIntegrationDialog({ open, onOpenChange, integration }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  integration?: MetaIntegrationState | null;
}) {
  const { t } = useTranslation();
  const statuses = [
    { label: t('metaAttribution'), ready: Boolean(integration?.attributionConfigured) },
    { label: t('metaEventManager'), ready: Boolean(integration?.capiConfigured) },
  ];
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-2xl" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{t('metaConnection')}</DialogTitle></DialogHeader>
      <dl className="space-y-3">
        {statuses.map(({ label, ready }) => <div key={label} className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <dt className="text-sm">{label}</dt><dd><Badge variant={ready ? 'success' : 'outline'}>{ready ? t('metaConfigured') : t('metaNotConfigured')}</Badge></dd>
        </div>)}
      </dl>
    </DialogContent>
  </Dialog>;
}
