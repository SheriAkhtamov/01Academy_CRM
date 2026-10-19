import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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

interface PendingBulkMove {
  leadIds: number[];
  statusCode: string;
  unassignedCount: number;
}

export function useSalesPipelineBulkActions<TStatus extends SelectablePipelineStatus>({
  leads,
  statuses,
  canManageAllLeads = false,
}: {
  leads: SelectablePipelineLead[];
  statuses: TStatus[];
  canManageAllLeads?: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<number>>(() => new Set());
  const [dialogOpen, updateDialogOpen] = useState(false);
  const [pendingMove, setPendingMove] = useState<PendingBulkMove | null>(null);
  const moveInFlight = useRef(false);

  const selectedLeads = useMemo(
    () => leads.filter((lead) => selectedLeadIds.has(lead.id)),
    [leads, selectedLeadIds],
  );
  const availableMoveStatuses = useMemo(
    () => statuses.filter((status) => (
      selectedLeads.some((lead) => lead.statusCode !== status.code)
    )),
    [selectedLeads, statuses],
  );
  const archiveNeedsManagerAssignment = selectedLeads.some((lead) => !lead.managerId);
  const canArchiveSelected = selectedLeads.length > 0;

  useEffect(() => {
    const visibleLeadIds = new Set(leads.map((lead) => lead.id));
    setSelectedLeadIds((current) => {
      const next = new Set([...current].filter((leadId) => visibleLeadIds.has(leadId)));
      return next.size === current.size ? current : next;
    });
  }, [leads]);

  useEffect(() => {
    if (selectedLeadIds.size === 0) {
      updateDialogOpen(false);
      setPendingMove(null);
    }
  }, [selectedLeadIds.size]);

  const setDialogOpen = (open: boolean) => {
    if (moveInFlight.current) return;
    updateDialogOpen(open);
    if (!open) setPendingMove(null);
  };
  const clearSelection = () => setSelectedLeadIds(new Set());
  const finishAction = () => {
    clearSelection();
    updateDialogOpen(false);
    setPendingMove(null);
    return invalidateSalesLeadData(queryClient);
  };

  const bulkMove = useMutation({
    mutationFn: (input: { leadIds: number[]; statusCode: string; assignToSelf?: boolean }) =>
      leadsApi.bulkUpdateStatus<{ updatedCount: number; statusCode: string }>(input),
    onSuccess: (result) => {
      toast({
        title: t('bulkMoveSuccess'),
        description: t('bulkMoveSuccessDescription').replace('{count}', String(result.updatedCount)),
      });
      return finishAction();
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

  const performMove = async (input: { leadIds: number[]; statusCode: string; assignToSelf?: boolean }) => {
    if (moveInFlight.current) return;
    moveInFlight.current = true;
    try {
      await bulkMove.mutateAsync(input);
    } finally {
      moveInFlight.current = false;
    }
  };

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
    moveClaimCount: pendingMove?.unassignedCount ?? 0,
    cancelMoveClaim: () => {
      if (!moveInFlight.current) setPendingMove(null);
    },
    confirmMoveClaim: async () => {
      if (!pendingMove) return;
      await performMove({ leadIds: pendingMove.leadIds, statusCode: pendingMove.statusCode, assignToSelf: true });
    },
    moveSelected: async (statusCode: string) => {
      if (moveInFlight.current || pendingMove || selectedLeadIds.size === 0) return;
      const unassignedCount = selectedLeads.filter(lead => !lead.managerId).length;
      if (!canManageAllLeads && unassignedCount > 0) {
        setPendingMove({ leadIds: [...selectedLeadIds], statusCode, unassignedCount });
        return;
      }
      await performMove({ leadIds: [...selectedLeadIds], statusCode });
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
