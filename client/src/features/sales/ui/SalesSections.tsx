import { DashboardCharts } from '@/components/ux/DashboardCharts';
import {
  KanbanBoard,
  type KanbanLead,
  type KanbanStatus,
} from '@/components/ux/KanbanBoard';
import type { ComponentProps } from 'react';

export function SalesOverviewSection(props: ComponentProps<typeof DashboardCharts>) {
  return <DashboardCharts {...props} />;
}

type QuickAction = 'payment' | 'call' | 'message';

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
}) {
  return (
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
      />
    </div>
  );
}
