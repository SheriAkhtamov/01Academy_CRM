import { useCallback, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { leadsApi } from '@/features/leads/api';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import { invalidateSalesLeadData } from './queries';

interface ClaimAction {
  lead: { id: number; contactName: string };
  proceed: () => void;
}

export function useLeadClaimAction(currentUserId?: number) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<ClaimAction | null>(null);
  const submitting = useRef(false);
  const mutation = useMutation({
    mutationFn: (action: ClaimAction) => leadsApi.assign(action.lead.id, { managerId: currentUserId! }),
    onSuccess: async (_result, action) => {
      await invalidateSalesLeadData(queryClient, action.lead.id);
      setPending(null);
      toast({ title: t('leadAssignedToMe') });
      action.proceed();
    },
    onError: (error: Error) => toast({ title: t('leadClaimFailed'), description: error.message, variant: 'destructive' }),
    onSettled: () => { submitting.current = false; },
  });

  return {
    lead: pending?.lead,
    isPending: mutation.isPending,
    request: useCallback((lead: ClaimAction['lead'], proceed: () => void) => {
      if (!submitting.current) setPending({ lead, proceed });
    }, []),
    close: () => { if (!submitting.current) setPending(null); },
    confirm: () => {
      if (!pending || !currentUserId || submitting.current) return;
      submitting.current = true;
      mutation.mutate(pending);
    },
  };
}
