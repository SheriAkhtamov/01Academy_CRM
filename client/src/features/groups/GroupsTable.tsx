import { DataTable, type DataTableColumn } from '@/components/ux/DataTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Archive, ArchiveRestore, Edit3, Loader2, Trash2 } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import type { Group } from './types';
import { normalizeSchedule } from './schedule';
import { availableGroupSeats } from './filters';

interface GroupsTableProps {
  groups: Group[];
  isGroupArchive: boolean;
  filterKey: string;
  emptyState: React.ReactNode;
  archivingId: number | null;
  restoringId: number | null;
  deleting: boolean;
  onEdit: (group: Group) => void;
  onArchive: (group: Group) => void;
  onRestore: (group: Group) => void;
  onDelete: (group: Group) => void;
}

export function GroupsTable({ groups, isGroupArchive, filterKey, emptyState, archivingId,
  restoringId, deleting, onEdit, onArchive, onRestore, onDelete }: GroupsTableProps) {
  const { t } = useTranslation();
  const dayNames = [t('monday'), t('tuesday'), t('wednesday'), t('thursday'), t('friday'), t('saturday'), t('sunday')];
  const groupColumns: DataTableColumn<Group>[] = [
    {
      key: 'name',
      header: t('group'),
      sortable: true,
      accessor: (row) => row.name,
      render: (row) => (
        <div className="min-w-0 max-w-80">
          <p className="break-words font-medium text-foreground">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.teacherName ?? t('notAssigned')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground xl:hidden">{row.lessonCount} {t('lessonsCount')} · {row.lessonDurationMinutes} {t('minuteShort')}</p>
        </div>
      ),
    },
    {
      key: 'courseAndSchool',
      header: t('courseAndSchool'),
      sortable: true,
      accessor: (row) => `${row.courseName ?? ''} ${row.schoolName ?? ''}`,
      render: (row) => (
        <div>
          <p className="font-medium text-foreground">{row.courseName ?? '—'}</p>
          <p className="text-xs text-muted-foreground">{row.schoolName ?? '—'} · {row.roomName ?? t('roomNotFound')}</p>
        </div>
      ),
    },
    {
      key: 'schedule',
      header: t('schedule'),
      accessor: (row) => row.schedule?.length ?? 0,
      render: (row) => (
        <div className="flex max-w-md flex-wrap gap-1">
          {normalizeSchedule(row.schedule, row.lessonDurationMinutes).slice(0, 3).map((item, index) => (
            <Badge key={`${row.id}-${item.dayOfWeek}-${item.startTime}-${index}`} variant="outline">
              {dayNames[item.dayOfWeek - 1]} {item.startTime}–{item.endTime}
            </Badge>
          ))}
          {(row.schedule?.length ?? 0) > 3
            ? <Badge variant="secondary">+{row.schedule.length - 3}</Badge>
            : null}
        </div>
      ),
    },
    {
      key: 'learningPlan',
      className: 'hidden xl:table-cell',
      mobileHidden: true,
      header: t('groupLearningPlan'),
      sortable: true,
      accessor: (row) => row.lessonCount,
      render: (row) => (
        <div className="md:min-w-44">
          <p className="font-medium text-foreground">
            {row.lessonCount} {t('lessonsCount')} · {row.lessonDurationMinutes} {t('minuteShort')}
          </p>
        </div>
      ),
    },
    {
      key: 'capacity',
      header: t('groupCapacity'),
      sortable: true,
      accessor: (row) => Number(row.currentStudents || 0) + Number(row.reservedStudents || 0),
      render: (row) => {
        const occupied = Number(row.currentStudents || 0) + Number(row.reservedStudents || 0);
        return (
          <div className="flex min-w-36 flex-col gap-1">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-medium text-foreground">{occupied}/{row.maxStudents || 12}</span>
              {Number(row.reservedStudents || 0) > 0
                ? <span className="text-muted-foreground">{t('reservedSeats')}: {row.reservedStudents}</span>
                : null}
            </div>
            {['open', 'in_progress'].includes(row.status) && !row.isArchived ? (
              <span className="text-xs text-muted-foreground">{t('groupsFreeSeats').replace('{count}', String(availableGroupSeats(row)))}</span>
            ) : null}
          </div>
        );
      },
    },
    {
      key: 'status',
      header: t('status'),
      sortable: true,
      accessor: (row) => row.status,
      render: (row) => (
        <Badge variant={row.status === 'completed' ? 'secondary' : 'outline'}>
          {row.status === 'open'
            ? t('groupStatusOpen')
            : row.status === 'in_progress'
              ? t('groupStatusInProgress')
              : row.status === 'frozen' ? t('groupStatusFrozen') : t('groupStatusCompleted')}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: t('actions'),
      render: (row) => {
        const isArchiving = archivingId === row.id;
        return (
          <div className="flex flex-wrap justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11"
              aria-label={t('editGroup')}
              onClick={() => onEdit(row)}
            >
              <Edit3 />
              <span className="sr-only">{t('edit')}</span>
            </Button>
            {isGroupArchive ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  disabled={restoringId !== null}
                  onClick={() => onRestore(row)}
                >
                  {restoringId === row.id ? (
                    <Loader2 className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <ArchiveRestore data-icon="inline-start" />
                  )}
                  {t('restoreGroupFromArchive')}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="min-h-11 min-w-11 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={deleting}
                  onClick={() => onDelete(row)}
                >
                  <Trash2 />
                  <span className="sr-only">{t('deleteGroupPermanently')}</span>
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="min-h-11 min-w-11"
                title={t('archiveGroup')}
                aria-label={isArchiving ? t('saving') : t('archiveGroup')}
                disabled={archivingId !== null}
                onClick={() => onArchive(row)}
              >
                {isArchiving ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Archive />
                )}
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return <DataTable columns={groupColumns} data={groups} keyExtractor={(group) => `group-${group.id}`}
    defaultSortKey="name" filterKey={filterKey} onRowClick={onEdit} emptyState={emptyState} />;
}
