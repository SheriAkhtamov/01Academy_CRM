import { DashboardCharts } from '@/components/ux/DashboardCharts';
import { EmptyState } from '@/components/ux/EmptyState';
import {
  KanbanBoard,
  type KanbanLead,
  type KanbanStatus,
} from '@/components/ux/KanbanBoard';
import { PipelineToolbar } from '@/components/ux/PipelineToolbar';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import {
  applyPipelineFilters,
  EMPTY_PIPELINE_FILTERS,
  hasActivePipelineFilters,
  type PipelineFilterState,
} from '@/lib/pipelineFilters';
import { Plus, RotateCcw, Users } from 'lucide-react';
import { useMemo, useState, type ComponentProps } from 'react';

export function SalesOverviewSection(props: ComponentProps<typeof DashboardCharts>) {
  return <DashboardCharts {...props} />;
}

type QuickAction = 'qualify' | 'payment' | 'call' | 'message';

export function SalesPipelineSection<TLead extends KanbanLead>({
  leadStatusName,
  leads,
  activePipelineStatuses,
  managers,
  sources,
  money,
  onLeadClick,
  onQuickAction,
  onArchiveLead,
  onStatusChange,
  onCreateLead,
  isPending,
  showManager,
}: {
  leadStatusName: (code: string) => string;
  leads: TLead[];
  activePipelineStatuses: KanbanStatus[];
  managers: Array<{ id: number; fullName: string }>;
  sources: Array<{ id: number; name: string }>;
  money: (value: number | string | null | undefined) => string;
  onLeadClick: (lead: TLead) => void;
  onQuickAction: (action: QuickAction, lead: TLead) => void;
  onArchiveLead: (lead: TLead) => void;
  onStatusChange: (leadId: number, statusCode: string) => Promise<boolean>;
  onCreateLead: () => void;
  isPending: boolean;
  showManager: boolean;
}) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<PipelineFilterState>(EMPTY_PIPELINE_FILTERS);
  const isFiltered = hasActivePipelineFilters(filters);
  const visibleLeads = useMemo(() => applyPipelineFilters(leads, filters), [filters, leads]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {leads.length > 0 || isFiltered ? (
        <PipelineToolbar
          filters={filters}
          onChange={setFilters}
          managers={managers}
          sources={sources}
          showManagerFilter={showManager}
          visibleCount={visibleLeads.length}
          totalCount={leads.length}
        />
      ) : null}
      <KanbanBoard
        statuses={activePipelineStatuses.map((status) => ({
          code: status.code,
          name: leadStatusName(status.code),
          color: status.color,
          sortOrder: status.sortOrder,
        }))}
        leads={visibleLeads}
        money={money}
        onStatusChange={onStatusChange}
        onQuickAction={(action, lead) => onQuickAction(action, lead as TLead)}
        onArchiveLead={(lead) => onArchiveLead(lead as TLead)}
        onLeadClick={(lead) => onLeadClick(lead as TLead)}
        isPending={isPending}
        showPaymentAction
        showManager={showManager}
        emptyState={
          <div className="min-h-0 flex-1 overflow-y-auto">
            <EmptyState
              icon={Users}
              title={t('noLeadsFound')}
              description={isFiltered ? t('adjustFilters') : t('noLeadsFoundDesc')}
              action={isFiltered ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setFilters(EMPTY_PIPELINE_FILTERS)}>
                  <RotateCcw data-icon="inline-start" />
                  {t('resetFilters')}
                </Button>
              ) : (
                <Button type="button" size="sm" onClick={onCreateLead}>
                  <Plus data-icon="inline-start" />
                  {t('newApplication')}
                </Button>
              )}
            />
          </div>
        }
      />
    </div>
  );
}
