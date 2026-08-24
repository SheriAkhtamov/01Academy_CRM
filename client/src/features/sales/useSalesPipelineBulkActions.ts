import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { validateLeadStatusTransition } from '@shared/academy';
import { leadsApi } from '@/features/leads/api';
import { invalidateSalesLeadData } from '@/features/sales/queries';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import { localizeApiErrorMessage } from '@/lib/queryClient';

const localizedError = (error: Error) => (
  localizeApiErrorMessage(error.message, (error as { status?: number }).status ?? 0)
);

interface SelectablePipelineLead {
  id: number;
  statusCode: string;
  managerId?: number | null;
}

interface SelectablePipelineStatus {
  code: string;
}

export function useSalesPipelineBulkActions<TStatus extends SelectablePipelineStatus>({
  leads,
  statuses,
}: {
  leads: SelectablePipelineLead[];
  statuses: TStatus[];
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<number>>(() => new Set());
  const [dialogOpen, setDialogOpen] = useState(false);

  const selectedLeads = useMemo(
    () => leads.filter((lead) => selectedLeadIds.has(lead.id)),
    [leads, selectedLeadIds],
  );
  const availableMoveStatuses = useMemo(
    () => statuses.filter((status) => (
      status.code !== 'paid'
      && selectedLeads.some((lead) => lead.statusCode !== status.code)
      && selectedLeads.every(
        (lead) => !validateLeadStatusTransition(lead.statusCode, status.code),
      )
    )),
    [selectedLeads, statuses],
  );
  const archiveNeedsManagerAssignment = selectedLeads.some((lead) => !lead.managerId);
  const canArchiveSelected = selectedLeads.length > 0
    && selectedLeads.every((lead) => lead.statusCode !== 'paid');

  useEffect(() => {
    const visibleLeadIds = new Set(leads.map((lead) => lead.id));
    setSelectedLeadIds((current) => {
      const next = new Set([...current].filter((leadId) => visibleLeadIds.has(leadId)));
      return next.size === current.size ? current : next;
    });
  }, [leads]);

  useEffect(() => {
    if (selectedLeadIds.size === 0) setDialogOpen(false);
  }, [selectedLeadIds.size]);

  const clearSelection = () => setSelectedLeadIds(new Set());
  const finishAction = () => {
    clearSelection();
    setDialogOpen(false);
    return invalidateSalesLeadData(queryClient);
  };

  const bulkMove = useMutation({
    mutationFn: ({ leadIds, statusCode }: { leadIds: number[]; statusCode: string }) =>
      leadsApi.bulkUpdateStatus<{ updatedCount: number; statusCode: string }>({ leadIds, statusCode }),
    onSuccess: (result) => {
      toast({
        title: t('bulkMoveSuccess'),
        description: t('bulkMoveSuccessDescription').replace('{count}', String(result.updatedCount)),
      });
      finishAction();
    },
    onError: (error: Error) => toast({
      title: t('bulkMoveFailed'),
      description: localizedError(error),
      variant: 'destructive',
    }),
  });

  const bulkAssign = useMutation({
    mutationFn: ({ leadIds, managerId }: { leadIds: number[]; managerId: number }) =>
      leadsApi.bulkAssign<{ updatedCount: number }>({ leadIds, managerId }),
    onSuccess: (result) => {
      toast({
        title: t('leadsTransferred'),
        description: t('leadsTransferredCount').replace('{count}', String(result.updatedCount)),
      });
      finishAction();
    },
    onError: (error: Error) => toast({
      title: t('leadTransferFailed'),
      description: localizedError(error),
      variant: 'destructive',
    }),
  });

  const bulkDelete = useMutation({
    mutationFn: (leadIds: number[]) => leadsApi.bulkDelete<{ deletedCount: number }>({ leadIds }),
    onSuccess: (result) => {
      toast({
        title: t('bulkDeleteSuccess'),
        description: t('bulkDeleteSuccessDescription').replace('{count}', String(result.deletedCount)),
      });
      finishAction();
    },
    onError: (error: Error) => toast({
      title: t('bulkDeleteFailed'),
      description: localizedError(error),
      variant: 'destructive',
    }),
  });

  const bulkArchive = useMutation({
    mutationFn: ({
      leadIds,
      reason,
      customReason,
      assignToSelf,
    }: {
      leadIds: number[];
      reason: string;
      customReason?: string;
      assignToSelf?: boolean;
    }) => leadsApi.bulkArchive<{ archivedCount: number }>({
      leadIds,
      reason,
      customReason,
      assignToSelf,
    }),
    onSuccess: (result) => {
      toast({
        title: t('bulkArchiveSuccess'),
        description: t('bulkArchiveSuccessDescription').replace('{count}', String(result.archivedCount)),
      });
      finishAction();
    },
    onError: (error: Error) => toast({
      title: t('bulkArchiveFailed'),
      description: localizedError(error),
      variant: 'destructive',
    }),
  });

  return {
    selectedLeadIds,
    setSelectedLeadIds,
    dialogOpen,
    setDialogOpen,
    availableMoveStatuses,
    archiveNeedsManagerAssignment,
    canArchiveSelected,
    clearSelection,
    isPending: bulkMove.isPending || bulkAssign.isPending || bulkArchive.isPending || bulkDelete.isPending,
    moveSelected: async (statusCode: string) => {
      await bulkMove.mutateAsync({ leadIds: [...selectedLeadIds], statusCode });
    },
    assignSelected: async (managerId: number) => {
      await bulkAssign.mutateAsync({ leadIds: [...selectedLeadIds], managerId });
    },
    archiveSelected: async (reason: string, customReason?: string, assignToSelf?: boolean) => {
      await bulkArchive.mutateAsync({
        leadIds: [...selectedLeadIds],
        reason,
        customReason,
        assignToSelf,
      });
    },
    deleteSelected: async () => {
      await bulkDelete.mutateAsync([...selectedLeadIds]);
    },
  };
}
