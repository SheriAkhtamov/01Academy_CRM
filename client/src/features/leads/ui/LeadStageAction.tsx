import { useEffect, useMemo, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { salesFunnelStages } from '@shared/sales-funnel-workflow';
import type { UpdateAcademyLeadRequest } from '@shared/contracts/academy-leads';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { invalidateSalesLeadData } from '@/features/sales/queries';
import { leadQueryKeys, leadsApi } from '../api';
import type { LeadInvalidationOptions } from '../queries';

interface StageActionLead {
  id: number;
  funnelId: number;
  statusCode: string;
  isArchived?: boolean;
  updatedAt?: string | null;
}

interface LeadStageActionProps {
  lead: StageActionLead;
  statuses: Array<{
    code: string;
    name: string;
    funnelId?: number | null;
    sortOrder?: number;
    isActive?: boolean;
    isPipeline?: boolean;
  }>;
  disabled?: boolean;
  onChanged: (options?: LeadInvalidationOptions) => void;
}

export function LeadStageAction({ lead, statuses, disabled = false, onChanged }: LeadStageActionProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const mounted = useRef(true);
  const submitting = useRef(false);
  const stages = useMemo(
    () => salesFunnelStages(statuses, undefined, lead.funnelId),
    [statuses, lead.funnelId],
  );

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const mutation = useMutation({
    mutationFn: ({ leadId, input }: { leadId: number; input: UpdateAcademyLeadRequest }) => (
      leadsApi.update<StageActionLead>(leadId, input)
    ),
    onSuccess: async (updatedLead) => {
      const queryKey = leadQueryKeys.detail(updatedLead.id);
      await queryClient.cancelQueries({ queryKey });
      // Publish the saved stage without resetting drafts in the lead's tabs.
      // A newer snapshot may already have arrived through a background refresh.
      queryClient.setQueryData<StageActionLead>(queryKey, (current) => (
        current?.updatedAt && updatedLead.updatedAt
          && new Date(current.updatedAt).getTime() > new Date(updatedLead.updatedAt).getTime()
          ? current : updatedLead
      ));
      if (mounted.current) {
        toast({ title: t('statusUpdated') });
        onChanged({ excludeLeadDetailId: updatedLead.id });
      }
      await invalidateSalesLeadData(queryClient, updatedLead.id);
    },
    onError: (error: Error & { status?: number }, { leadId }) => {
      if (mounted.current) {
        toast({ title: t('statusNotUpdated'), description: error.message, variant: 'destructive' });
      }
      if ([403, 404, 409].includes(error.status ?? 0)) {
        void invalidateSalesLeadData(queryClient, leadId);
      }
    },
    onSettled: () => { submitting.current = false; },
  });

  const changeStage = (statusCode: string) => {
    if (
      disabled || lead.isArchived || submitting.current || statusCode === lead.statusCode
      || !stages.some((stage) => stage.code === statusCode)
    ) return;
    submitting.current = true;
    mutation.mutate({
      leadId: lead.id,
      input: { statusCode, expectedUpdatedAt: lead.updatedAt },
    });
  };

  if (lead.isArchived) return null;
  const unavailable = disabled || mutation.isPending;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="max-w-full whitespace-normal"
          loading={mutation.isPending}
          disabled={unavailable || !stages.some((stage) => stage.code !== lead.statusCode)}
        >
          {t('moveLeadToStage')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-[calc(100vw-2rem)]">
        <DropdownMenuRadioGroup value={lead.statusCode} onValueChange={changeStage}>
          {stages.map((stage) => (
            <DropdownMenuRadioItem
              key={stage.code}
              value={stage.code}
              className="whitespace-normal break-words"
              disabled={unavailable || stage.code === lead.statusCode}
            >
              {stage.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
