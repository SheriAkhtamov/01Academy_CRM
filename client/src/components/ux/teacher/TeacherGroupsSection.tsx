import { useMemo, useState } from 'react';
import { Archive, ArchiveRestore, Loader2, Search, Users, UsersRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import ConfirmDialog from '@/components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '@/components/ux/DataTable';
import { EmptyState } from '@/components/ux/EmptyState';
import { GroupStatusBadge } from '@/components/ux/teacher/TeacherStatusBadge';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import {
  TEACHER_CARD_PADDING,
  TEACHER_CARD_PADDING_DENSE,
  TEACHER_TONE_CLASS,
  canArchiveGroup,
  formatGroupScheduleTime,
  teacherPercent,
  weekdayIndexFromDayOfWeek,
  type TeacherGroup,
  type TeacherGroupSchedule,
  type TeacherGroupView,
  type TeacherLessonProgress,
  type TeacherStudent,
} from '@/lib/teacherModule';
import { cn } from '@/lib/utils';

type GroupSortKey = 'name' | 'progress' | 'students';

const GROUP_SORT_LABEL_KEYS = {
  name: 'sortGroupsByName',
  progress: 'sortGroupsByProgress',
  students: 'sortGroupsByStudents',
} as const satisfies Record<GroupSortKey, TranslationKey>;

const GROUP_SORT_KEYS: GroupSortKey[] = ['name', 'progress', 'students'];

interface TeacherGroupsSectionProps {
  groups: TeacherGroup[];
  view: TeacherGroupView;
  selectedGroup: TeacherGroup | null;
  groupStudents: TeacherStudent[];
  progressById: Map<number, TeacherLessonProgress>;
  attendanceByStudentId: Map<number, { attended: number; missed: number }>;
  dayNames: string[];
  dayNamesFull: string[];
  archivePendingGroupId: number | null;
  onSelectGroup: (groupId: number | null) => void;
  onChangeView: (view: TeacherGroupView) => void;
  onArchiveGroup: (group: TeacherGroup) => void;
  onRestoreGroup: (group: TeacherGroup) => void;
  formatArchivedAt: (value: string) => string;
}

function ScheduleBadges({
  schedule,
  dayNames,
  unknownLabel,
}: {
  schedule: TeacherGroupSchedule[];
  dayNames: string[];
  unknownLabel: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {schedule.map((item, index) => {
        const weekdayIndex = weekdayIndexFromDayOfWeek(Number(item.dayOfWeek));
        return (
          <Badge
            key={`${item.dayOfWeek}-${item.startTime ?? item.time ?? ''}-${item.endTime ?? ''}-${index}`}
            variant="outline"
            className="rounded-lg border-border/70 text-xs font-medium"
          >
            {`${weekdayIndex == null ? unknownLabel : dayNames[weekdayIndex]} ${formatGroupScheduleTime(item)}`.trim()}
          </Badge>
        );
      })}
    </div>
  );
}

function GroupArchiveAction({
  group,
  isPending,
  onArchive,
  onRestore,
  className,
}: {
  group: TeacherGroup;
  isPending: boolean;
  onArchive: (group: TeacherGroup) => void;
  onRestore: (group: TeacherGroup) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!group.isArchived && !canArchiveGroup(group)) return null;
  const restoring = group.isArchived === true;
  const Icon = restoring ? ArchiveRestore : Archive;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn('min-h-11 rounded-lg', className)}
      disabled={isPending}
      onClick={() => (restoring ? onRestore(group) : onArchive(group))}
    >
      {isPending
        ? <Loader2 className="mr-1.5 size-4 animate-spin" />
        : <Icon className="mr-1.5 size-4" />}
      {restoring ? t('restoreGroupFromArchive') : t('archiveGroup')}
    </Button>
  );
}

/**
 * Selecting a group opens a Sheet (like every other detail view in the app)
 * instead of swapping the list for an inline detail card. The parent still
 * owns the selection through a query parameter, so the browser Back button
 * simply closes the sheet.
 */
export function TeacherGroupsSection({
  groups,
  view,
  selectedGroup,
  groupStudents,
  progressById,
  attendanceByStudentId,
  dayNames,
  dayNamesFull,
  archivePendingGroupId,
  onSelectGroup,
  onChangeView,
  onArchiveGroup,
  onRestoreGroup,
  formatArchivedAt,
}: TeacherGroupsSectionProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<GroupSortKey>('name');
  const [archiveTarget, setArchiveTarget] = useState<TeacherGroup | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<TeacherGroup | null>(null);

  const isArchiveView = view === 'archive';
  const activeGroups = useMemo(() => groups.filter((group) => !group.isArchived), [groups]);
  const archivedGroups = useMemo(() => groups.filter((group) => group.isArchived), [groups]);
  const listedGroups = isArchiveView ? archivedGroups : activeGroups;

  const visibleGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? listedGroups.filter((group) => (
        `${group.name} ${group.courseName ?? ''} ${group.schoolName ?? ''}`.toLowerCase().includes(needle)
      ))
      : [...listedGroups];

    return filtered.sort((left, right) => {
      if (sortKey === 'students') {
        return (right.currentStudents || 0) - (left.currentStudents || 0);
      }
      if (sortKey === 'progress') {
        const leftProgress = progressById.get(left.id);
        const rightProgress = progressById.get(right.id);
        return teacherPercent(rightProgress?.conducted ?? 0, rightProgress?.total ?? 0)
          - teacherPercent(leftProgress?.conducted ?? 0, leftProgress?.total ?? 0);
      }
      return left.name.localeCompare(right.name);
    });
  }, [listedGroups, progressById, query, sortKey]);

  /* Rebuilt inline, this array gave `DataTable` a new identity on every parent
     clock tick, re-running the staggered row entrance for the whole roster. */
  const studentColumns = useMemo<DataTableColumn<TeacherStudent>[]>(() => [
    {
      key: 'studentName',
      header: t('studentName'),
      accessor: (row) => row.studentName || row.contactName,
      sortable: true,
    },
    {
      key: 'attendedLessons',
      header: t('attendedLessons'),
      accessor: (row) => attendanceByStudentId.get(row.id)?.attended ?? 0,
      sortable: true,
      className: 'text-center',
      cellClassName: 'text-center',
      render: (row) => (
        <Badge
          variant="outline"
          className={cn('rounded-lg border tabular-nums', TEACHER_TONE_CLASS.success)}
        >
          {attendanceByStudentId.get(row.id)?.attended ?? 0}
        </Badge>
      ),
    },
    {
      key: 'missedLessons',
      header: t('missedLessons'),
      accessor: (row) => attendanceByStudentId.get(row.id)?.missed ?? 0,
      sortable: true,
      className: 'text-center',
      cellClassName: 'text-center',
      render: (row) => (
        <Badge
          variant="outline"
          className={cn('rounded-lg border tabular-nums', TEACHER_TONE_CLASS.danger)}
        >
          {attendanceByStudentId.get(row.id)?.missed ?? 0}
        </Badge>
      ),
    },
  ], [attendanceByStudentId, t]);

  const archiveDialogs = (
    <>
      <ConfirmDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => { if (!open) setArchiveTarget(null); }}
        title={t('archiveGroupTitle')}
        description={archiveTarget
          ? `${archiveTarget.name} — ${t('archiveGroupConfirm')}`
          : t('archiveGroupConfirm')}
        confirmLabel={t('archiveGroup')}
        isPending={archiveTarget !== null && archivePendingGroupId === archiveTarget.id}
        keepOpenOnConfirm
        onConfirm={() => {
          if (archiveTarget) onArchiveGroup(archiveTarget);
          setArchiveTarget(null);
        }}
      />
      <ConfirmDialog
        open={restoreTarget !== null}
        onOpenChange={(open) => { if (!open) setRestoreTarget(null); }}
        title={t('restoreGroupTitle')}
        description={restoreTarget
          ? `${restoreTarget.name} — ${t('restoreGroupConfirm')}`
          : t('restoreGroupConfirm')}
        confirmLabel={t('restoreGroupFromArchive')}
        isPending={restoreTarget !== null && archivePendingGroupId === restoreTarget.id}
        keepOpenOnConfirm
        onConfirm={() => {
          if (restoreTarget) onRestoreGroup(restoreTarget);
          setRestoreTarget(null);
        }}
      />
    </>
  );

  const detailGroup = selectedGroup;
  const progress = detailGroup ? progressById.get(detailGroup.id) : undefined;
  const conducted = progress?.conducted ?? 0;
  const total = progress?.total ?? 0;
  const progressLabel = t('lessonsConductedCount')
    .replace('{conducted}', String(conducted))
    .replace('{total}', String(total));

  return (
    <div className="space-y-4">
      <Card className="border-border/70">
        <CardContent className={cn('flex flex-col gap-2.5', TEACHER_CARD_PADDING_DENSE)}>
          <div
            className="inline-flex w-full items-center gap-1 self-start rounded-lg border border-border bg-muted/50 p-1 sm:w-auto"
            role="group"
            aria-label={t('groupListView')}
          >
            <Button
              type="button"
              size="sm"
              variant={isArchiveView ? 'ghost' : 'secondary'}
              className="min-h-11 flex-1 gap-2 sm:flex-none"
              aria-pressed={!isArchiveView}
              onClick={() => onChangeView('active')}
            >
              <UsersRound />
              {t('adminActiveGroups')}
              <Badge variant="outline" className="min-w-6 justify-center bg-background tabular-nums">
                {activeGroups.length}
              </Badge>
            </Button>
            <Button
              type="button"
              size="sm"
              variant={isArchiveView ? 'secondary' : 'ghost'}
              className="min-h-11 flex-1 gap-2 sm:flex-none"
              aria-pressed={isArchiveView}
              onClick={() => onChangeView('archive')}
            >
              <Archive />
              {t('groupArchiveLabel')}
              <Badge variant="outline" className="min-w-6 justify-center bg-background tabular-nums">
                {archivedGroups.length}
              </Badge>
            </Button>
          </div>

          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('searchGroupsPlaceholder')}
                aria-label={t('searchGroupsPlaceholder')}
                className="h-11 rounded-lg pl-9"
              />
            </div>
            <Select value={sortKey} onValueChange={(value) => setSortKey(value as GroupSortKey)}>
              <SelectTrigger className="h-11 w-full rounded-lg sm:w-[220px]" aria-label={t('sortGroupsLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GROUP_SORT_KEYS.map((key) => (
                  <SelectItem key={key} value={key}>{t(GROUP_SORT_LABEL_KEYS[key])}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-live="polite">
              {t('groupsShownCount')
                .replace('{shown}', String(visibleGroups.length))
                .replace('{total}', String(listedGroups.length))}
            </p>
          </div>
        </CardContent>
      </Card>

      {visibleGroups.length === 0 ? (
        <Card className="border-dashed border-border/70">
          <CardContent className="p-0">
            <EmptyState
              icon={isArchiveView ? Archive : Users}
              title={listedGroups.length === 0
                ? (isArchiveView ? t('noArchivedGroups') : t('noGroups'))
                : t('noScheduleGroupsFound')}
              description={listedGroups.length === 0
                ? (isArchiveView ? t('noArchivedGroupsDescription') : t('noGroupsAssigned'))
                : t('adjustSearchCriteria')}
              action={listedGroups.length === 0 ? undefined : (
                <Button type="button" variant="outline" onClick={() => setQuery('')}>
                  {t('resetFilters')}
                </Button>
              )}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleGroups.map((group) => {
            const progress = progressById.get(group.id);
            const conducted = progress?.conducted ?? 0;
            const total = progress?.total ?? 0;
            const progressLabel = t('lessonsConductedCount')
              .replace('{conducted}', String(conducted))
              .replace('{total}', String(total));

            return (
              <Card key={group.id} className="group min-w-0 border-border/70 transition-shadow hover:shadow-md">
                <CardContent className={cn('space-y-3', TEACHER_CARD_PADDING)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold text-foreground">{group.name}</h3>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {group.courseName || t('noCourse')}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {group.schoolName || t('schoolNotSelected')}
                      </p>
                      {group.isArchived && group.archivedAt ? (
                        <p className="truncate text-xs text-muted-foreground">
                          {t('groupArchivedOn').replace('{date}', formatArchivedAt(group.archivedAt))}
                        </p>
                      ) : null}
                    </div>
                    <GroupStatusBadge status={group.status} />
                  </div>

                  <div>
                    <div className="mb-1.5 flex justify-between text-xs">
                      <span className="text-muted-foreground">{t('lessonProgress')}</span>
                      <span className="font-medium tabular-nums text-foreground">{progressLabel}</span>
                    </div>
                    <Progress
                      value={teacherPercent(conducted, total)}
                      className="h-2"
                      aria-label={`${group.name} — ${progressLabel}`}
                    />
                  </div>

                  {group.schedule && group.schedule.length > 0 ? (
                    <ScheduleBadges
                      schedule={group.schedule}
                      dayNames={dayNames}
                      unknownLabel={t('weekdayNotSpecified')}
                    />
                  ) : null}

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Users className="size-3.5" />
                      <span className="tabular-nums">
                        {t('studentsCountValue').replace('{count}', String(group.currentStudents || 0))}
                      </span>
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <GroupArchiveAction
                        group={group}
                        isPending={archivePendingGroupId === group.id}
                        onArchive={setArchiveTarget}
                        onRestore={setRestoreTarget}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-11 rounded-lg"
                        onClick={() => onSelectGroup(group.id)}
                      >
                        {t('details')}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      {archiveDialogs}

      {/* Group detail as a Sheet: Escape/overlay/X all close it, matching the
          interaction model of every other detail view in the CRM. */}
      <Sheet open={detailGroup !== null} onOpenChange={(open) => {
        if (!open) onSelectGroup(null);
      }}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
          {detailGroup ? (
            <>
              <SheetHeader className="gap-1 border-b border-border/70 px-5 py-4">
                <SheetTitle className="flex flex-wrap items-center gap-2 pr-8 text-lg">
                  <span className="min-w-0 truncate">{detailGroup.name}</span>
                  <GroupStatusBadge status={detailGroup.status} />
                  {detailGroup.isArchived ? (
                    <Badge variant="outline" className={cn('rounded-lg border', TEACHER_TONE_CLASS.neutral)}>
                      {t('groupInArchive')}
                    </Badge>
                  ) : null}
                </SheetTitle>
                <SheetDescription className="flex flex-col gap-0.5">
                  <span>{detailGroup.courseName || t('noCourse')}</span>
                  <span>
                    {t('groupTeacherLine').replace('{name}', detailGroup.teacherName || t('notAssigned'))}
                    {detailGroup.isArchived && detailGroup.archivedAt
                      ? ` · ${t('groupArchivedOn').replace('{date}', formatArchivedAt(detailGroup.archivedAt))}`
                      : ''}
                  </span>
                </SheetDescription>
              </SheetHeader>

              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-40 flex-1">
                    <div className="mb-2 flex justify-between text-sm">
                      <span className="text-muted-foreground">{t('lessonProgress')}</span>
                      <span className="font-medium tabular-nums text-foreground">{progressLabel}</span>
                    </div>
                    <Progress
                      value={teacherPercent(conducted, total)}
                      aria-label={`${t('lessonProgress')} — ${progressLabel}`}
                    />
                  </div>
                  <GroupArchiveAction
                    group={detailGroup}
                    isPending={archivePendingGroupId === detailGroup.id}
                    onArchive={setArchiveTarget}
                    onRestore={setRestoreTarget}
                  />
                </div>

                {detailGroup.schedule && detailGroup.schedule.length > 0 ? (
                  <ScheduleBadges
                    schedule={detailGroup.schedule}
                    dayNames={dayNamesFull}
                    unknownLabel={t('weekdayNotSpecified')}
                  />
                ) : null}

                <div className="border-t border-border/70 pt-4">
                  <h4 className="mb-3 text-sm font-semibold">
                    {t('groupStudentsCount').replace('{count}', String(groupStudents.length))}
                  </h4>
                  <DataTable
                    columns={studentColumns}
                    data={groupStudents}
                    keyExtractor={(row) => String(row.id)}
                    emptyState={(
                      <EmptyState
                        icon={Users}
                        title={t('noStudents')}
                        description={t('noStudentsInGroup')}
                      />
                    )}
                  />
                </div>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
