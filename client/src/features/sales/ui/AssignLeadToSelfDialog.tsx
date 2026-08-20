import { AlertCircle, UserCheck } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type AssignLeadToSelfDialogProps = {
  open: boolean;
  leadName?: string | null;
  description: string;
  confirmLabel: string;
  isPending: boolean;
  confirmDisabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

export function AssignLeadToSelfDialog({
  open,
  leadName,
  description,
  confirmLabel,
  isPending,
  confirmDisabled = false,
  onOpenChange,
  onConfirm,
}: AssignLeadToSelfDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isPending) onOpenChange(false);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('leadAssignmentRequired')}</DialogTitle>
          <DialogDescription>
            {leadName ? `${leadName}. ` : null}
            {description}
          </DialogDescription>
        </DialogHeader>

        <Alert>
          <AlertCircle />
          <AlertTitle>{t('leadRequiresResponsibleManager')}</AlertTitle>
          <AlertDescription>{description}</AlertDescription>
        </Alert>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            {t('cancel')}
          </Button>
          <Button type="button" disabled={isPending || confirmDisabled} onClick={onConfirm}>
            <UserCheck data-icon="inline-start" />
            {isPending ? t('saving') : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
