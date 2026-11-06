import { useMemo, useState } from 'react';
import { RotateCcw, Search, Trophy } from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { DataTable } from '@/components/ux/DataTable';
import { EmployeeIdentity } from '@/components/ux/EmployeeIdentity';
import { EmptyState } from '@/components/ux/EmptyState';
import { useStickyState } from '@/hooks/useStickyState';
import { leadContactSummary } from '@/lib/leadContact';
import type { TranslationKey } from '@/lib/i18n';

/** Only the fields the won list reads; the page hands its leads to the feature. */
export interface WonLead {
  id: number;
  contactName: string;
  studentName?: string | null;
  phone?: string | null;
  phoneNumbers?: string[];
  messenger?: string | null;
  managerName?: string | null;
  managerId?: number | null;
  wonAt?: string | null;
}

export const matchesWonLeadSearch = (lead: WonLead, search: string) => {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return [lead.contactName, lead.studentName, lead.managerName, lead.messenger, lead.phone, ...(lead.phoneNumbers ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(query);
};

/** Deals closed as won leave the board; one click returns a lead to work. */
export function WonLeadsTab({
  t,
  leads,
  dateTime,
  onLeadClick,
  onReopen,
  isPending,
}: {
  t: (key: TranslationKey) => string;
  leads: WonLead[];
  dateTime: (value: string | null | undefined) => string;
  onLeadClick: (lead: WonLead) => void;
  onReopen: (leadId: number) => void | Promise<unknown>;
  isPending: boolean;
}) {
  const [search, setSearch] = useStickyState('sales.archive.wonSearch', '');
  const [reopenTarget, setReopenTarget] = useState<WonLead | null>(null);
  const visibleLeads = useMemo(() => leads.filter((lead) => matchesWonLeadSearch(lead, search)), [leads, search]);

  const columns = [
    {
      key: 'contactName',
      header: t('lead'),
      sortable: true,
      accessor: (lead: WonLead) => lead.contactName,
      cellClassName: 'max-w-[15rem]',
      render: (lead: WonLead) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-foreground" title={lead.contactName}>{lead.contactName}</div>
          <div className="truncate text-xs text-muted-foreground">{leadContactSummary(lead, t('noData'))}</div>
        </div>
      ),
    },
    {
      key: 'managerName',
      header: t('manager'),
      sortable: true,
      accessor: (lead: WonLead) => lead.managerName || t('noData'),
      cellClassName: 'max-w-[11rem]',
      render: (lead: WonLead) => (
        <EmployeeIdentity userId={lead.managerId} name={lead.managerName || t('noData')} className="text-muted-foreground" />
      ),
    },
    {
      key: 'wonAt',
      header: t('leadWonAt'),
      sortable: true,
      accessor: (lead: WonLead) => lead.wonAt,
      render: (lead: WonLead) => <span className="whitespace-nowrap text-muted-foreground">{dateTime(lead.wonAt)}</span>,
    },
    {
      key: 'reopen',
      header: t('actions'),
      render: (lead: WonLead) => (
        <div
          className="flex justify-end"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => setReopenTarget(lead)}>
            <RotateCcw data-icon="inline-start" />
            {t('leadReopen')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <div role="search" aria-label={t('search')} className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/70 px-4 py-2.5">
        <div className="relative min-w-[13rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('archiveSearchPlaceholder')}
            aria-label={t('search')}
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>
      <CardContent className="min-h-0 flex-1 p-0">
        <DataTable
          rootClassName="flex h-full min-h-0 flex-col"
          className="min-h-0 flex-1 overflow-auto"
          columns={columns}
          data={visibleLeads}
          filterKey={search}
          keyExtractor={(lead: WonLead) => `won-lead-${lead.id}`}
          emptyState={
            <div className="p-8">
              {search.trim() ? (
                <EmptyState title={t('archiveNoMatches')} icon={Search} />
              ) : (
                <EmptyState title={t('noWonLeads')} icon={Trophy} />
              )}
            </div>
          }
          onRowClick={onLeadClick}
        />
      </CardContent>
      <ConfirmDialog
        open={reopenTarget !== null}
        onOpenChange={(open) => { if (!open) setReopenTarget(null); }}
        title={t('leadReopenTitle')}
        description={t('leadReopenDescription')}
        target={reopenTarget?.contactName}
        confirmationKey={reopenTarget?.id}
        confirmLabel={t('leadReopen')}
        isPending={isPending}
        onConfirm={() => {
          if (reopenTarget) return onReopen(reopenTarget.id);
        }}
      />
    </Card>
  );
}
