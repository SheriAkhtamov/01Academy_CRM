import { Link2, RadioTower } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CompactModalSection } from '@/components/ux/CompactModalSection';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
    <DialogContent className="compact-modal flex max-h-[90dvh] max-w-xl flex-col overflow-hidden p-0" aria-describedby={undefined}>
      <DialogHeader className="compact-modal-header"><DialogTitle>{t('metaConnection')}</DialogTitle></DialogHeader>
      <div className="compact-modal-body space-y-3 overflow-y-auto">
        {statuses.map(({ label, ready }, index) => (
          <CompactModalSection key={label} title={label} icon={index ? RadioTower : Link2} tone={index ? 'teal' : 'sky'} collapsible={false}>
            <Badge variant={ready ? 'success' : 'outline'}>{ready ? t('metaConfigured') : t('metaNotConfigured')}</Badge>
          </CompactModalSection>
        ))}
      </div>
      <DialogFooter className="compact-modal-footer"><Button variant="outline" onClick={() => onOpenChange(false)}>{t('close')}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
