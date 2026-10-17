import { EmployeeIdentity } from '@/components/ux/EmployeeIdentity';
import { DataTable, type DataTableColumn } from '@/components/ux/DataTable';
import { Button } from '@/components/ui/button';
import { GroupStatusBadge } from '@/components/ux/teacher/TeacherStatusBadge';
import { Archive, ArchiveRestore, Edit3, Loader2, Trash2, UserX } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import type { Group } from './types';
import { GroupSeatMeter } from './GroupSeatMeter';
import {
  formatGroupPeriod,
  groupNameParts,
  groupScheduleSlots,
  groupSeats,
  groupTimeline,
  summarizeSchedule,
} from './presentation';
import { useGroupLabels } from './useGroupLabels';

interface GroupsTableProps {
  groups: Group[];
  isGroupArchive: boolean;
  filterKey: string;
  todayKey: string;
  emptyState: React.ReactNode;
  archivingId: number | null;
  restoringId: number | null;
  deleting: boolean;
  onOpen: (group: Group) => void;
  onEdit: (group: Group) => void;
  onArchive: (group: Group) => void;
  onRestore: (group: Group) => void;
  onDelete: (group: Group) => void;
  onOrderChange?: (groups: Group[]) => void;
}

export function GroupsTable({ groups, isGroupArchive, filterKey, todayKey, emptyState, archivingId,
  restoringId, deleting, onOpen, onEdit, onArchive, onRestore, onDelete, onOrderChange }: GroupsTableProps) {
  const { t, language } = useTranslation();
  const { startLabel, lessonPlanLabel } = useGroupLabels();
  const shortDayNames = [t('mondayShort'), t('tuesdayShort'), t('wednesdayShort'), t('thursdayShort'),
    t('fridayShort'), t('saturdayShort'), t('sundayShort')];
  const groupColumns: DataTableColumn<Group>[] = [
    {
      key: 'name',
      header: t('group'),
      sortable: true,
      mobilePrimary: true,
      accessor: (row) => row.name,
      render: (row) => {
        const { title, code } = groupNameParts(row.name);
        return (
          <div className="min-w-0 max-w-80">
            <p className="break-words font-medium text-foreground">{title}</p>
            {code ? <p className="truncate font-mono text-[11px] text-muted-foreground">{code}</p> : null}
            {row.teacherName ? (
              <EmployeeIdentity userId={row.teacherUserId} name={row.teacherName} className="text-xs text-muted-foreground" avatarClassName="size-6" />
            ) : (
              <p className="flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                <UserX className="size-3.5 shrink-0" aria-hidden="true" />
                {t('notAssigned')}
              </p>
            )}
          </div>
        );
      },
    },
    {
      key: 'courseAndSchool',
      header: t('courseAndSchool'),
      sortable: true,
      accessor: (row) => `${row.courseName ?? ''} ${row.schoolName ?? ''}`,
      render: (row) => (
        <div className="min-w-0">
          <p className="font-medium text-foreground">{row.courseName ?? '—'}</p>
          <p className="text-xs text-muted-foreground">{[row.schoolName, row.roomName].filter(Boolean).join(' · ') || '—'}</p>
        </div>
      ),
    },
    {
      key: 'schedule',
      header: t('schedule'),
      accessor: (row) => row.schedule?.length ?? 0,
      render: (row) => {
        const lines = summarizeSchedule(groupScheduleSlots(row), shortDayNames);
        if (lines.length === 0) return <span className="text-xs text-muted-foreground">{t('groupsWithoutSchedule')}</span>;
        return (
          <ul className="min-w-36 space-y-0.5 text-sm">
            {lines.slice(0, 2).map((line) => (
              <li key={`${line.days}-${line.time}`} className="whitespace-nowrap">
                <span className="font-medium text-foreground">{line.days}</span>{' '}
                <span className="tabular-nums text-muted-foreground">{line.time}</span>
              </li>
            ))}
            {lines.length > 2 ? <li className="text-xs text-muted-foreground">+{lines.length - 2}</li> : null}
          </ul>
        );
      },
    },
    {
      key: 'period',
      header: t('groupDates'),
      sortable: true,
      accessor: (row) => groupTimeline(row, todayKey).startKey || null,
      render: (row) => {
        const period = formatGroupPeriod(groupTimeline(row, todayKey), language, todayKey);
        const start = startLabel(row, todayKey);
        return (
          <div className="min-w-32">
            <p className="whitespace-nowrap text-sm text-foreground">{period || '—'}</p>
            {start ? <p className="text-xs font-medium text-primary">{start}</p> : null}
            <p className="text-xs text-muted-foreground 2xl:hidden">{lessonPlanLabel(row)}</p>
          </div>
        );
      },
    },
    {
      key: 'learningPlan',
      // Header and cells hide together; hiding only the header slid every
      // later value one column to the left of its heading.
      className: 'hidden 2xl:table-cell',
      cellClassName: 'hidden 2xl:table-cell',
      mobileHidden: true,
      header: t('groupLearningPlan'),
      sortable: true,
      accessor: (row) => row.lessonCount,
      render: (row) => <p className="whitespace-nowrap text-sm text-foreground">{lessonPlanLabel(row)}</p>,
    },
    {
      key: 'capacity',
      header: t('groupCapacity'),
      sortable: true,
      accessor: (row) => Number(row.currentStudents || 0) + Number(row.reservedStudents || 0),
      render: (row) => {
        const seats = groupSeats(row);
        return (
          <div className="flex min-w-36 max-w-48 flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-semibold tabular-nums text-foreground">{seats.occupied}/{seats.max}</span>
              {seats.sellable ? (
                <span className={cn('font-medium',
                  seats.tone === 'full' ? 'text-rose-700 dark:text-rose-300'
                    : seats.tone === 'few' ? 'text-amber-700 dark:text-amber-300'
                      : 'text-emerald-700 dark:text-emerald-300')}>
                  {seats.free > 0 ? t('groupsFreeSeats').replace('{count}', String(seats.free)) : t('groupsSeatsFullShort')}
                </span>
              ) : null}
            </div>
            <GroupSeatMeter seats={seats} />
            {seats.reserved > 0
              ? <span className="text-xs text-muted-foreground">{t('reservedSeats')}: {seats.reserved}</span>
              : null}
          </div>
        );
      },
    },
    {
      key: 'status',
      header: t('status'),
      sortable: true,
      accessor: (row) => row.status,
      render: (row) => <GroupStatusBadge status={row.status} />,
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
              title={t('editGroup')}
              onClick={() => onEdit(row)}
            >
              <Edit3 />
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
                  aria-label={t('deleteGroupPermanently')}
                  title={t('deleteGroupPermanently')}
                  onClick={() => onDelete(row)}
                >
                  <Trash2 />
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
    defaultSortKey="name" filterKey={filterKey} onRowClick={onOpen} emptyState={emptyState}
    onSortedDataChange={onOrderChange} />;
}
