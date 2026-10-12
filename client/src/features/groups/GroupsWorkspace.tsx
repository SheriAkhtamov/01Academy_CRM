import { useMemo, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Plus, RotateCcw, UsersRound } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ConfirmDialog from '@/components/ConfirmDialog';
import { ArchiveSelect } from '@/features/academy-resources/ResourceSettingsTables';
import { useGroupArchive } from './useGroupArchive';
import { GroupEditorDialog } from './GroupEditorDialog';
import { GroupsTable } from './GroupsTable';
import { GROUP_FILTER_KEYS, filterGroups } from './filters';
import { invalidateGroupData } from './queries';
import type { Group, GroupConfiguration } from './types';

interface GroupsWorkspaceProps {
  configuration: GroupConfiguration;
  basePath: string;
  showTitle?: boolean;
}

function GroupFilter({ label, value, onChange, options }: {
  label: string; value: string; onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return <div className="min-w-0 space-y-1.5">
    <Label>{label}</Label>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>{options.map((option) => (
        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
      ))}</SelectContent>
    </Select>
  </div>;
}

export function GroupsWorkspace({ configuration, basePath, showTitle = true }: GroupsWorkspaceProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const isGroupArchive = params.get('filter') === 'archive';
  const [editor, setEditor] = useState<{ group: Group | null } | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Group | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<Group | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Group | null>(null);
  const { archiveGroup, restoreGroup } = useGroupArchive<Group>((_group, archived) => {
    if (archived) setArchiveTarget(null);
    else setRestoreTarget(null);
    void invalidateGroupData(queryClient);
  });
  const deleteGroup = useMutation({
    mutationFn: (group: Group) => apiRequest('DELETE', `/api/academy/groups/${group.id}`),
    onSuccess: () => {
      setDeleteTarget(null);
      toast({ title: t('groupDeletedPermanently') });
      void invalidateGroupData(queryClient);
    },
    onError: (error: Error) => toast({ title: t('resourceNotDeleted'), description: error.message, variant: 'destructive' }),
  });
  const updateFilters = (patch: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (!value || value === 'all') next.delete(key);
      else next.set(key, value);
    }
    const [path, baseSearch] = basePath.split('?');
    new URLSearchParams(baseSearch).forEach((value, key) => next.set(key, value));
    navigate(`${path}${next.size ? `?${next}` : ''}`, { replace });
  };
  const hasFilters = GROUP_FILTER_KEYS.some((key) => params.has(key)) || params.get('filter') === 'without-teacher';
  const displayedGroups = useMemo(() => filterGroups(configuration.groups, params), [configuration.groups, params]);
  const teacherValue = params.get('teacher') ?? (params.get('filter') === 'without-teacher' ? 'unassigned' : 'all');
  const statusOptions = [
    { value: 'all', label: t('groupsAllStatuses') },
    { value: 'open', label: t('groupStatusOpen') },
    { value: 'in_progress', label: t('groupStatusInProgress') },
    { value: 'frozen', label: t('groupStatusFrozen') },
    { value: 'completed', label: t('groupStatusCompleted') },
  ];
  const emptyTitle = hasFilters ? t('groupsNoMatches') : isGroupArchive ? t('noArchivedGroups') : t('noGroups');

  return <>
    <Card className="min-w-0">
      <CardHeader className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {showTitle ? <CardTitle>{t('navGroups')}</CardTitle> : null}
            <ArchiveSelect archived={isGroupArchive} label={t('groupListView')}
              onChange={(archived) => updateFilters({ filter: archived ? 'archive' : null })} />
          </div>
          <Button onClick={() => setEditor({ group: null })}><Plus data-icon="inline-start" />{t('addGroup')}</Button>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="groups-search">{t('groupsSearchLabel')}</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="groups-search" type="search" className="pl-10" value={params.get('q') ?? ''}
              placeholder={t('groupsSearchPlaceholder')}
              onChange={(event) => updateFilters({ q: event.target.value }, true)} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          <GroupFilter label={t('course')} value={params.get('course') ?? 'all'}
            onChange={(value) => updateFilters({ course: value })}
            options={[{ value: 'all', label: t('portalAllCourses') }, ...configuration.courses.map((course) => ({ value: String(course.id), label: course.name }))]} />
          <GroupFilter label={t('school')} value={params.get('school') ?? 'all'}
            onChange={(value) => updateFilters({ school: value })}
            options={[{ value: 'all', label: t('allSchools') }, ...configuration.schools.map((school) => ({ value: String(school.id), label: school.name }))]} />
          <GroupFilter label={t('teacher')} value={teacherValue}
            onChange={(value) => updateFilters({ teacher: value, filter: isGroupArchive ? 'archive' : null })}
            options={[{ value: 'all', label: t('allTeachers') }, { value: 'unassigned', label: t('notAssigned') }, ...configuration.teachers.map((teacher) => ({ value: String(teacher.id), label: teacher.fullName }))]} />
          <GroupFilter label={t('status')} value={params.get('status') ?? 'all'}
            onChange={(value) => updateFilters({ status: value })} options={statusOptions} />
          <GroupFilter label={t('groupsSeatsFilter')} value={params.get('seats') ?? 'all'}
            onChange={(value) => updateFilters({ seats: value })}
            options={[{ value: 'all', label: t('groupsAllSeats') }, { value: 'available', label: t('groupsWithSeats') }, { value: 'full', label: t('groupsFull') }]} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground" aria-live="polite">{t('groupsFound').replace('{count}', String(displayedGroups.length))}</p>
          {hasFilters ? <Button variant="ghost" size="sm" onClick={() => updateFilters({
            ...Object.fromEntries(GROUP_FILTER_KEYS.map((key) => [key, null])),
            filter: isGroupArchive ? 'archive' : null,
          })}><RotateCcw data-icon="inline-start" />{t('resetFilters')}</Button> : null}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <GroupsTable groups={displayedGroups} isGroupArchive={isGroupArchive} filterKey={search}
          archivingId={archiveGroup.isPending ? archiveGroup.variables.id : null}
          restoringId={restoreGroup.isPending ? restoreGroup.variables.id : null}
          deleting={deleteGroup.isPending} onEdit={(group) => setEditor({ group })}
          onArchive={setArchiveTarget} onRestore={setRestoreTarget} onDelete={setDeleteTarget}
          emptyState={<div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <UsersRound className="size-8 text-muted-foreground" /><p className="font-medium">{emptyTitle}</p>
          </div>} />
      </CardContent>
    </Card>
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
