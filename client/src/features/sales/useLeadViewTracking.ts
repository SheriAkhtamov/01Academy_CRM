import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { leadQueryKeys, leadsApi, type LeadViewState } from '../leads/api';
import { salesQueryKeys } from './queries';

type TrackedLead = { id: number; firstViewedAt?: string | null };

type LeadViewTrackingInput = {
  leadId: number | null;
  open: boolean;
  leads: readonly TrackedLead[];
};

const patchViewedLead = (dataset: unknown, viewState: LeadViewState) => {
  const module = dataset as { leads?: TrackedLead[] } | undefined;
  if (!module?.leads) return dataset;
  const index = module.leads.findIndex((lead) => lead.id === viewState.leadId);
  if (index < 0 || module.leads[index].firstViewedAt) return dataset;

  const leads = [...module.leads];
  leads[index] = { ...leads[index], firstViewedAt: viewState.firstViewedAt };
  return { ...module, leads };
};

/**
 * Opening the lead card is what clears its "new" marker, so the board is
 * patched in place instead of refetching the whole sales dataset: the only
 * value that changed is the marker itself.
 */
export const useLeadViewTracking = ({ leadId, open, leads }: LeadViewTrackingInput) => {
  const queryClient = useQueryClient();
  const markedLeadIdsRef = useRef(new Set<number>());

  const markViewed = useMutation({
    mutationFn: (id: number) => leadsApi.markViewed(id),
    onSuccess: (viewState) => {
      queryClient.setQueryData(
        salesQueryKeys.module,
        (dataset: unknown) => patchViewedLead(dataset, viewState),
      );
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.unviewedCount });
    },
    onError: (_error, id) => {
      // Let the next open retry instead of leaving the lead silently unmarked.
      markedLeadIdsRef.current.delete(id);
    },
  });
  const { mutate } = markViewed;

  useEffect(() => {
    if (!open || !leadId || markedLeadIdsRef.current.has(leadId)) return;
    const lead = leads.find((item) => item.id === leadId);
    if (!lead || lead.firstViewedAt) return;

    markedLeadIdsRef.current.add(leadId);
    mutate(leadId);
  }, [leadId, leads, mutate, open]);
};
