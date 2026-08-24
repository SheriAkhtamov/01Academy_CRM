import { useMemo, useState } from 'react';
import { Archive, RotateCcw, Search, X } from 'lucide-react';
import { LEAD_ARCHIVE_REASONS } from '@shared/academy';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable } from '@/components/ux/DataTable';
import { EmptyState } from '@/components/ux/EmptyState';
import { leadContactSummary } from '@/lib/leadContact';
import type { TranslationKey } from '@/lib/i18n';

/**
 * Only the fields the archive itself reads. Declaring the shape here rather
 * than importing the page's Lead keeps the dependency pointing one way: the
 * page hands its leads to the feature, and the feature never reaches back.
 */
export interface ArchivedLead {
  id: number;
  contactName: string;
  studentName?: string | null;
  phone?: string | null;
  phoneNumbers?: string[];
  messenger?: string | null;
  statusCode: string;
  managerName?: string | null;
  archiveReason?: string | null;
  archivedAt?: string | null;
  archivedByName?: string | null;
}

export interface ArchiveRestoreStatus {
  code: string;
}

export function ArchiveTab({
  t,
  leads,
  activePipelineStatuses,
  leadStatusName,
  archiveReasonName,
  dateTime,
  onLeadClick,
  onRestore,
  isPending,
}: {
  t: (key: TranslationKey) => string;
  leads: ArchivedLead[];
  activePipelineStatuses: ArchiveRestoreStatus[];
  leadStatusName: (code: string) => string;
  archiveReasonName: (code: string | null | undefined) => string;
  dateTime: (v: string | null | undefined) => string;
  onLeadClick: (lead: ArchivedLead) => void;
  onRestore: (leadId: number, statusCode: string) => void;
  isPending: boolean;
}) {
  const [search, setSearch] = useState('');
  const [reasonFilter, setReasonFilter] = useState('all');
  const [managerFilter, setManagerFilter] = useState('all');
  // Restoring moves a lead back into the live pipeline: like every other
  // archive action it asks for confirmation instead of firing from a menu item.
  const [restoreTarget, setRestoreTarget] = useState<{ lead: ArchivedLead; statusCode: string } | null>(null);

  const managerOptions = useMemo(() => (
    [...new Set(leads.map((lead) => lead.managerName).filter((name): name is string => Boolean(name)))]
      .sort((a, b) => a.localeCompare(b))
  ), [leads]);

  /*
    Filtering happens here rather than on the server: the archive already
    arrives whole with the rest of the sales dataset, and DataTable pages it
    client-side, so narrowing the array is enough — and it resets to page 1 by
    itself whenever the visible row set changes.
  */
  const visibleLeads = useMemo(() => {
    const query = search.trim().toLowerCase();
    return leads.filter((lead) => {
      if (reasonFilter !== 'all' && (lead.archiveReason ?? '') !== reasonFilter) return false;
      if (managerFilter !== 'all' && (lead.managerName ?? '') !== managerFilter) return false;
      if (!query) return true;
      return [
        lead.contactName,
        lead.studentName,
        lead.managerName,
        lead.messenger,
        lead.phone,
        ...(lead.phoneNumbers ?? []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [leads, search, reasonFilter, managerFilter]);

  const filtersActive = search.trim() !== '' || reasonFilter !== 'all' || managerFilter !== 'all';
  const resetFilters = () => {
    setSearch('');
    setReasonFilter('all');
    setManagerFilter('all');
  };

  const columns = [
    {
      key: 'contactName',
      header: t('lead'),
      sortable: true,
      accessor: (lead: ArchivedLead) => lead.contactName,
      cellClassName: 'max-w-[15rem]',
      render: (lead: ArchivedLead) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-foreground" title={lead.contactName}>{lead.contactName}</div>
          <div className="truncate text-xs text-muted-foreground">{leadContactSummary(lead, t('noData'))}</div>
        </div>
      ),
    },
    {
      key: 'statusCode',
      header: t('status'),
      sortable: true,
      accessor: (lead: ArchivedLead) => leadStatusName(lead.statusCode),
      render: (lead: ArchivedLead) => (
        <Badge variant="outline">{leadStatusName(lead.statusCode)}</Badge>
      ),
    },
    {
      key: 'managerName',
      header: t('manager'),
      sortable: true,
      accessor: (lead: ArchivedLead) => lead.managerName || t('noData'),
      cellClassName: 'max-w-[11rem]',
      render: (lead: ArchivedLead) => (
        <span className="block truncate text-muted-foreground" title={lead.managerName || undefined}>
          {lead.managerName || t('noData')}
        </span>
      ),
    },
    {
      /*
        Every cell below stays on one line. A free-text "other" reason and a
        three-word archiver name used to wrap to three and four lines, which is
        what pushed rows to 93px — five of twenty-five visible at a time. The
        full text is still available on hover.
      */
      key: 'archiveReason',
      header: t('archiveReason'),
      sortable: true,
      accessor: (lead: ArchivedLead) => archiveReasonName(lead.archiveReason),
      cellClassName: 'max-w-[13rem]',
      render: (lead: ArchivedLead) => (
        <span className="block truncate text-muted-foreground" title={archiveReasonName(lead.archiveReason)}>
          {archiveReasonName(lead.archiveReason)}
        </span>
      ),
    },
    {
      key: 'archivedAt',
      header: t('archivedAt'),
      sortable: true,
      accessor: (lead: ArchivedLead) => lead.archivedAt,
      cellClassName: 'max-w-[13rem]',
      render: (lead: ArchivedLead) => (
        <div className="min-w-0">
          <div className="whitespace-nowrap text-muted-foreground">{dateTime(lead.archivedAt)}</div>
          {lead.archivedByName ? (
            <div className="truncate text-xs text-muted-foreground" title={`${t('archivedBy')} ${lead.archivedByName}`}>
              {t('archivedBy')} {lead.archivedByName}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'restore',
      header: t('actions'),
      render: (lead: ArchivedLead) => (
        <div
          className="flex justify-end"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" disabled={isPending || activePipelineStatuses.length === 0}>
                <RotateCcw data-icon="inline-start" />
                {t('restoreLead')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                {activePipelineStatuses.map((status) => (
                  <DropdownMenuItem
                    key={status.code}
                    onClick={(event) => {
                      event.stopPropagation();
                      setRestoreTarget({ lead, statusCode: status.code });
                    }}
                    disabled={isPending}
                  >
                    {t('restoreToStage')} {leadStatusName(status.code)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  return (
    // No card header: the page header above already reads "Архив лидов", and
    // repeating it cost 64px of a table that only had 371px to show 25 rows.
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <div
        role="search"
        aria-label={t('archiveFiltersLabel')}
        className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/70 px-4 py-2.5"
      >
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

        <Select value={reasonFilter} onValueChange={setReasonFilter}>
          <SelectTrigger className="h-8 w-[13rem] text-xs" aria-label={t('archiveReason')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('archiveAllReasons')}</SelectItem>
            {LEAD_ARCHIVE_REASONS.map((reason) => (
              <SelectItem key={reason.code} value={reason.code}>
                {t(reason.translationKey as TranslationKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={managerFilter} onValueChange={setManagerFilter}>
          <SelectTrigger className="h-8 w-[13rem] text-xs" aria-label={t('manager')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('archiveAllManagers')}</SelectItem>
            {managerOptions.map((name) => (
              <SelectItem key={name} value={name}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {filtersActive ? (
          <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={resetFilters}>
            <X data-icon="inline-start" />
            {t('resetFilters')}
          </Button>
        ) : null}
      </div>

      <CardContent className="min-h-0 flex-1 p-0">
        <DataTable
          rootClassName="flex h-full min-h-0 flex-col"
          className="min-h-0 flex-1 overflow-auto overscroll-contain"
          columns={columns}
          data={visibleLeads}
          keyExtractor={(lead: ArchivedLead) => `archived-lead-${lead.id}`}
          emptyState={
            <div className="p-8">
              {filtersActive ? (
                <EmptyState title={t('archiveNoMatches')} description={t('archiveNoMatchesDesc')} icon={Search} />
              ) : (
                <EmptyState title={t('noArchivedLeads')} description={t('noArchivedLeadsDesc')} icon={Archive} />
              )}
            </div>
          }
          onRowClick={onLeadClick}
        />
      </CardContent>

      <AlertDialog open={restoreTarget !== null} onOpenChange={(open) => {
        if (!open) setRestoreTarget(null);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmRestoreLeadTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('confirmRestoreLeadDescription')
                .replace('{lead}', restoreTarget?.lead.contactName ?? '')
                .replace('{stage}', restoreTarget ? leadStatusName(restoreTarget.statusCode) : '')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(event) => {
                event.preventDefault();
                if (restoreTarget) onRestore(restoreTarget.lead.id, restoreTarget.statusCode);
                setRestoreTarget(null);
              }}
            >
              {t('restoreLead')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
