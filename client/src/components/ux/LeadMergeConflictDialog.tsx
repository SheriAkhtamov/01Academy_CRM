import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, ArrowRightLeft, ExternalLink } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

export interface LeadMergeDialogLead {
  id?: number | null;
  name?: string | null;
  contactName?: string | null;
  phone?: string | null;
  phoneNumbers?: string[];
  managerName?: string | null;
  statusName?: string | null;
  canMerge?: boolean;
}

interface LeadMergeConflictDialogProps {
  open: boolean;
  mode: 'draft' | 'persisted';
  currentLead: LeadMergeDialogLead;
  existingLead: LeadMergeDialogLead | null;
  isPending: boolean;
  onCancel: () => void;
  onOpenExisting: () => void;
  onMergeIntoExisting: () => void;
  onKeepCurrent?: () => void;
}

const leadName = (lead: LeadMergeDialogLead, fallback: string) => (
  lead.contactName || lead.name || fallback
);

const leadPhone = (lead: LeadMergeDialogLead) => (
  lead.phoneNumbers?.[0] || lead.phone || null
);

function LeadSummaryCard({ lead, label }: { lead: LeadMergeDialogLead; label: string }) {
  const { t } = useTranslation();
  return (
    <Card className="border-border/70">
      <CardHeader className="gap-1 p-4 pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-base">{leadName(lead, t('lead'))}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2 p-4 pt-0 text-sm text-muted-foreground">
        {leadPhone(lead) ? <span>{leadPhone(lead)}</span> : null}
        {lead.managerName ? <Badge variant="secondary">{lead.managerName}</Badge> : null}
        {lead.statusName ? <Badge variant="outline">{lead.statusName}</Badge> : null}
      </CardContent>
    </Card>
  );
}

export function LeadMergeConflictDialog({
  open,
  mode,
  currentLead,
  existingLead,
  isPending,
  onCancel,
  onOpenExisting,
  onMergeIntoExisting,
  onKeepCurrent,
}: LeadMergeConflictDialogProps) {
  const { t } = useTranslation();
  const existingName = existingLead ? leadName(existingLead, t('lead')) : t('lead');
  const currentName = leadName(currentLead, t('newApplication'));
  const canMerge = existingLead?.canMerge !== false;

  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen && !isPending) onCancel();
    }}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="text-amber-600" />
            <AlertDialogTitle>{t('leadDuplicateFoundTitle')}</AlertDialogTitle>
          </div>
          <AlertDialogDescription>
            {mode === 'draft'
              ? t('leadDuplicateFoundDescriptionDraft')
              : t('leadDuplicateFoundDescriptionMerge')}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <LeadSummaryCard
            lead={currentLead}
            label={mode === 'draft' ? t('leadNewDataLabel') : t('leadCurrentCardLabel')}
          />
          {existingLead ? (
            <LeadSummaryCard lead={existingLead} label={t('leadExistingCardLabel')} />
          ) : null}
        </div>

        <p className="text-sm text-muted-foreground">{t('leadMergePreservesRelations')}</p>
        {!canMerge ? (
          <p className="text-sm font-medium text-destructive">{t('leadMergeUnavailableForManager')}</p>
        ) : null}

        <AlertDialogFooter className="gap-2 sm:flex-wrap">
          <AlertDialogCancel disabled={isPending}>{t('cancel')}</AlertDialogCancel>
          <Button type="button" variant="outline" disabled={isPending} onClick={onOpenExisting}>
            <ExternalLink data-icon="inline-start" />
            {t('openExistingLead')}
          </Button>
          {mode === 'persisted' && onKeepCurrent ? (
            <Button type="button" variant="outline" disabled={isPending || !canMerge} onClick={onKeepCurrent}>
              <ArrowRightLeft data-icon="inline-start" />
              {t('keepLeadNamed').replace('{name}', currentName)}
            </Button>
          ) : null}
          <Button type="button" disabled={isPending || !canMerge} onClick={onMergeIntoExisting}>
            <ArrowRightLeft data-icon="inline-start" />
            {mode === 'draft'
              ? t('mergeWithExistingLead')
              : t('keepLeadNamed').replace('{name}', existingName)}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
