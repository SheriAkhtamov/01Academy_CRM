import { DashboardCharts } from '@/components/ux/DashboardCharts';
import {
  KanbanBoard,
  type KanbanLead,
  type KanbanStatus,
} from '@/components/ux/KanbanBoard';
import { Button } from '@/components/ui/button';
import { BulkLeadActionsDialog } from '@/features/sales/ui/BulkLeadActionsDialog';
import { useTranslation } from '@/hooks/useTranslation';
import { ListChecks } from 'lucide-react';
import type { ComponentProps } from 'react';

export function SalesOverviewSection(props: ComponentProps<typeof DashboardCharts>) {
  return <DashboardCharts {...props} />;
}

type QuickAction = 'payment' | 'call' | 'message';

export function SalesBulkActionsButton({
  selectedCount,
  onClick,
}: {
  selectedCount: number;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  if (selectedCount === 0) return null;
  return (
    <Button size="sm" variant="secondary" onClick={onClick}>
      <ListChecks data-icon="inline-start" />
      {t('massActions')}
      <span className="ml-1 rounded-full bg-background/80 px-1.5 text-xs tabular-nums">{selectedCount}</span>
    </Button>
  );
}

export function SalesPipelineSection<TLead extends KanbanLead>({
  leadStatusName,
  leads,
  activePipelineStatuses,
  onLeadClick,
  onQuickAction,
  onArchiveLead,
  onStatusChange,
  isPending,
  showManager,
  selectedLeadIds,
  onSelectedLeadIdsChange,
  managers,
  canManageAllLeads,
  bulkActions,
}: {
  leadStatusName: (code: string) => string;
  leads: TLead[];
  activePipelineStatuses: KanbanStatus[];
  onLeadClick: (lead: TLead) => void;
  onQuickAction: (action: QuickAction, lead: TLead) => void;
  onArchiveLead: (lead: TLead) => void;
  onStatusChange: (leadId: number, statusCode: string) => Promise<boolean>;
  isPending: boolean;
  showManager: boolean;
  selectedLeadIds: ReadonlySet<number>;
  onSelectedLeadIdsChange: (leadIds: Set<number>) => void;
  managers: Array<{ id: number; fullName: string }>;
  canManageAllLeads: boolean;
  bulkActions: {
    dialogOpen: boolean;
    setDialogOpen: (open: boolean) => void;
    availableMoveStatuses: KanbanStatus[];
    clearSelection: () => void;
    isPending: boolean;
    moveSelected: (statusCode: string) => Promise<void>;
    assignSelected: (managerId: number) => Promise<void>;
    deleteSelected: () => Promise<void>;
  };
}) {
  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <KanbanBoard
          statuses={activePipelineStatuses.map((status) => ({
            code: status.code,
            name: leadStatusName(status.code),
            color: status.color,
            sortOrder: status.sortOrder,
          }))}
          leads={leads}
          onStatusChange={onStatusChange}
          onQuickAction={(action, lead) => onQuickAction(action, lead as TLead)}
          onArchiveLead={(lead) => onArchiveLead(lead as TLead)}
          onLeadClick={(lead) => onLeadClick(lead as TLead)}
          isPending={isPending}
          showPaymentAction
          showManager={showManager}
          selectedLeadIds={selectedLeadIds}
          onSelectedLeadIdsChange={onSelectedLeadIdsChange}
        />
      </div>
      <BulkLeadActionsDialog
        open={bulkActions.dialogOpen}
        onOpenChange={bulkActions.setDialogOpen}
        selectedCount={selectedLeadIds.size}
        statuses={bulkActions.availableMoveStatuses.map((status) => ({
          code: status.code,
          name: leadStatusName(status.code),
        }))}
        managers={managers}
        canManageAllLeads={canManageAllLeads}
        isPending={bulkActions.isPending}
        onMove={bulkActions.moveSelected}
        onAssign={bulkActions.assignSelected}
        onDelete={bulkActions.deleteSelected}
        onClearSelection={bulkActions.clearSelection}
      />
    </>
  );
}
