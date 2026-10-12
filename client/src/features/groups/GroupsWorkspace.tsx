import { useCallback, useMemo, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, Plus, RotateCcw, UsersRound } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { academyToday } from '@/lib/localeFormat';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import ConfirmDialog from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/ux/EmptyState';
import { useGroupArchive } from './useGroupArchive';
import { GroupEditorDialog } from './GroupEditorDialog';
import { GroupQuickView } from './GroupQuickView';
import { GroupsTable } from './GroupsTable';
import { GroupsToolbar, type GroupScopeControl, type GroupsView } from './GroupsToolbar';
import { GroupWeekView } from './GroupWeekView';
import { GROUP_FILTER_KEYS, filterGroups } from './filters';
import { invalidateGroupData } from './queries';
import { useGroupFacets } from './useGroupFacets';
import { useGroupQuickView } from './useGroupQuickView';
import { useGroupsShortcuts } from './useGroupsShortcuts';
import type { Group, GroupConfiguration } from './types';

interface GroupsWorkspaceProps {
  configuration: GroupConfiguration;
  basePath: string;
  showTitle?: boolean;
  scopeControl?: GroupScopeControl;
}

export function GroupsWorkspace({ configuration, basePath, showTitle = true, scopeControl }: GroupsWorkspaceProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const isGroupArchive = params.get('filter') === 'archive';
  const view: GroupsView = params.get('view') === 'week' ? 'week' : 'list';
  const todayKey = academyToday();
  const searchRef = useRef<HTMLInputElement>(null);
  const [editor, setEditor] = useState<{ group: Group | null } | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Group | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<Group | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Group | null>(null);

  const updateParams = useCallback((patch: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (!value || value === 'all') next.delete(key);
      else next.set(key, value);
    }
    const [path, baseSearch] = basePath.split('?');
    new URLSearchParams(baseSearch).forEach((value, key) => next.set(key, value));
    navigate(`${path}${next.size ? `?${next}` : ''}`, { replace });
  }, [basePath, navigate, params]);

  const displayedGroups = useMemo(() => filterGroups(configuration.groups, params), [configuration.groups, params]);
  const { facets, seatCounts, scopeCounts } = useGroupFacets(configuration, params);
  const quickView = useGroupQuickView({ params, groups: configuration.groups, displayedGroups, view, updateParams });

  const { archiveGroup, restoreGroup } = useGroupArchive<Group>((group, archived) => {
    if (archived) setArchiveTarget(null);
    else setRestoreTarget(null);
    quickView.closeIfShowing(group);
    void invalidateGroupData(queryClient);
  });
  const deleteGroup = useMutation({
    mutationFn: (group: Group) => apiRequest('DELETE', `/api/academy/groups/${group.id}`),
    onSuccess: (_result, group) => {
      setDeleteTarget(null);
      quickView.closeIfShowing(group);
      toast({ title: t('groupDeletedPermanently') });
      void invalidateGroupData(queryClient);
    },
    onError: (error: Error) => toast({ title: t('resourceNotDeleted'), description: error.message, variant: 'destructive' }),
  });

  const openCreate = useCallback(() => setEditor({ group: null }), []);
  useGroupsShortcuts({
    onFocusSearch: () => {
      searchRef.current?.focus();
      searchRef.current?.select();
    },
    onCreate: openCreate,
  });

  const hasFilters = GROUP_FILTER_KEYS.some((key) => params.has(key)) || params.get('filter') === 'without-teacher';
  const resetFilters = () => updateParams({
    ...Object.fromEntries(GROUP_FILTER_KEYS.map((key) => [key, null])),
    filter: isGroupArchive ? 'archive' : null,
  });
  // Only the filters send the table back to its first page — not opening a group or switching the view.
  const filterKey = [...GROUP_FILTER_KEYS.map((key) => params.get(key) ?? ''), params.get('filter') ?? ''].join('|');

  const emptyTitle = hasFilters ? t('groupsNoMatches') : isGroupArchive ? t('noArchivedGroups') : t('noGroups');
  const emptyAction = hasFilters ? (
    <Button type="button" variant="outline" onClick={resetFilters}>
      <RotateCcw data-icon="inline-start" />
      {t('resetFilters')}
    </Button>
  ) : isGroupArchive ? undefined : (
    <Button type="button" onClick={openCreate}>
      <Plus data-icon="inline-start" />
      {t('addGroup')}
    </Button>
  );
  const emptyState = <EmptyState icon={isGroupArchive ? Archive : UsersRound} title={emptyTitle} action={emptyAction} />;

  return <>
    <Card className="min-w-0">
      <CardHeader className="pb-4">
        <GroupsToolbar
          title={showTitle ? t('navGroups') : undefined}
          scopeControl={scopeControl}
          isArchive={isGroupArchive}
          scopeCounts={scopeCounts}
          onScopeChange={(archived) => updateParams({ filter: archived ? 'archive' : null })}
          view={view}
          onViewChange={(nextView) => updateParams({ view: nextView === 'week' ? 'week' : null })}
          search={params.get('q') ?? ''}
          onSearchChange={(value) => updateParams({ q: value }, true)}
          searchRef={searchRef}
          facets={facets}
          onFacetChange={(key, value) => updateParams(key === 'teacher'
            ? { teacher: value, filter: isGroupArchive ? 'archive' : null }
            : { [key]: value })}
          seats={{ value: params.get('seats'), ...seatCounts }}
          onSeatsChange={(value) => updateParams({ seats: value })}
          foundCount={displayedGroups.length}
          hasFilters={hasFilters}
          onReset={resetFilters}
          onCreate={openCreate}
        />
      </CardHeader>
      <CardContent className="p-0">
        {view === 'week' ? (
          <GroupWeekView groups={displayedGroups} todayKey={todayKey} emptyState={emptyState} onOpen={quickView.open} />
        ) : (
          <GroupsTable groups={displayedGroups} isGroupArchive={isGroupArchive} filterKey={filterKey} todayKey={todayKey}
            archivingId={archiveGroup.isPending ? archiveGroup.variables.id : null}
            restoringId={restoreGroup.isPending ? restoreGroup.variables.id : null}
            deleting={deleteGroup.isPending} onOpen={quickView.open} onEdit={(group) => setEditor({ group })}
            onArchive={setArchiveTarget} onRestore={setRestoreTarget} onDelete={setDeleteTarget}
            onOrderChange={quickView.handleOrderChange} emptyState={emptyState} />
        )}
      </CardContent>
    </Card>
    <GroupQuickView
      group={quickView.openGroup}
      rooms={configuration.rooms}
      todayKey={todayKey}
      position={quickView.position}
      onPrevious={quickView.onPrevious}
      onNext={quickView.onNext}
      onClose={quickView.close}
      onEdit={(group) => setEditor({ group })}
      onArchive={setArchiveTarget}
      onRestore={setRestoreTarget}
      onDelete={setDeleteTarget}
      busy={archiveGroup.isPending || restoreGroup.isPending || deleteGroup.isPending}
    />
    <GroupEditorDialog open={Boolean(editor)} group={editor?.group ?? null} configuration={configuration} onClose={() => setEditor(null)} />
    <ConfirmDialog open={Boolean(archiveTarget)}
      onOpenChange={(open) => { if (!open && !archiveGroup.isPending) setArchiveTarget(null); }}
      title={t('archiveGroupTitle')} description={archiveTarget ? `${t('archiveGroupConfirm')} “${archiveTarget.name}”` : ''}
      confirmLabel={t('archiveGroup')} variant="destructive" isPending={archiveGroup.isPending} keepOpenOnConfirm
      onConfirm={() => { if (archiveTarget) archiveGroup.mutate(archiveTarget); }} />
    <ConfirmDialog open={Boolean(restoreTarget)}
      onOpenChange={(open) => { if (!open && !restoreGroup.isPending) setRestoreTarget(null); }}
      title={t('restoreGroupTitle')} description={restoreTarget ? `${t('restoreGroupConfirm')} “${restoreTarget.name}”` : ''}
      confirmLabel={t('restoreGroupFromArchive')} isPending={restoreGroup.isPending} keepOpenOnConfirm
      onConfirm={() => { if (restoreTarget) restoreGroup.mutate(restoreTarget); }} />
    <ConfirmDialog open={Boolean(deleteTarget)}
      onOpenChange={(open) => { if (!open && !deleteGroup.isPending) setDeleteTarget(null); }}
      title={t('deleteArchivedGroupTitle')} description={deleteTarget ? t('deleteArchivedGroupDescription').replace('{name}', deleteTarget.name) : ''}
      confirmLabel={t('deleteGroupPermanently')} variant="destructive" isPending={deleteGroup.isPending} keepOpenOnConfirm
      onConfirm={() => { if (deleteTarget) deleteGroup.mutate(deleteTarget); }} />
  </>;
}
