import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Trophy } from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { leadQueryKeys, leadsApi } from '@/features/leads/api';
import { invalidateSalesLeadData } from '@/features/sales/queries';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';

interface WinActionLead {
  id: number;
  contactName: string;
  isArchived?: boolean;
  isWon?: boolean;
}

/** A won deal leaves the board for the won tab of the archive and can return in one click. */
export function LeadWinAction({ lead, hasStudents, disabled, onChanged }: {
  lead: WinActionLead;
  hasStudents: boolean;
  disabled?: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const won = Boolean(lead.isWon);
  const mutation = useMutation({
    mutationFn: () => (won ? leadsApi.reopen<WinActionLead>(lead.id) : leadsApi.win<WinActionLead>(lead.id)),
    onSuccess: async (updated) => {
      setOpen(false);
      await queryClient.cancelQueries({ queryKey: leadQueryKeys.detail(updated.id) });
      queryClient.setQueryData(leadQueryKeys.detail(updated.id), updated);
      toast({ title: won ? t('leadReopenedToast') : t('leadWonToast') });
      onChanged();
      await invalidateSalesLeadData(queryClient, updated.id);
    },
    onError: (failure: Error) => setError(failure.message || t('errorOccurred')),
  });
  if (lead.isArchived) return null;

  return (
    <>
      <Button
        data-lead-processing
        type="button"
        size="sm"
        variant="outline"
        className="min-w-0 px-1 text-xs sm:px-3 sm:text-sm [&>svg]:hidden sm:[&>svg]:block"
        disabled={disabled || mutation.isPending || (!won && !hasStudents)}
        onClick={() => {
          setError(undefined);
          setOpen(true);
        }}
      >
        {won ? <RotateCcw data-icon="inline-start" /> : <Trophy data-icon="inline-start" />}
        {won ? t('leadReopen') : t('leadWin')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          if (!mutation.isPending) setOpen(next);
        }}
        title={won ? t('leadReopenTitle') : t('leadWinTitle')}
        description={won ? t('leadReopenDescription') : t('leadWinDescription')}
        target={lead.contactName}
        confirmationKey={lead.id}
        confirmLabel={won ? t('leadReopen') : t('leadWin')}
        keepOpenOnConfirm
        isPending={mutation.isPending}
        error={error}
        onConfirm={async () => {
          setError(undefined);
          await mutation.mutateAsync().catch(() => undefined);
        }}
      />
    </>
  );
}
