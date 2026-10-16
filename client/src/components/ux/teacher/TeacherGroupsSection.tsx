import { useMemo, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  GraduationCap,
  LayoutGrid,
  List,
  Loader2,
  MapPin,
  Search,
  TrendingUp,
  Users,
  UsersRound,
  X,
} from 'lucide-react';
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
import { formatAcademyDate } from '@/lib/localeFormat';
import {
  TEACHER_CARD_PADDING,
  TEACHER_CARD_PADDING_DENSE,
  TEACHER_TONE_CLASS,
  TEACHER_TONE_ICON_CLASS,
  canArchiveGroup,
  formatGroupScheduleTime,
  teacherPercent,
  weekdayIndexFromDayOfWeek,
  type TeacherAttendanceRecord,
  type TeacherGroup,
  type TeacherGroupSchedule,
  type TeacherGroupView,
  type TeacherLesson,
  type TeacherLessonProgress,
  type TeacherStudent,
} from '@/lib/teacherModule';
import { cn } from '@/lib/utils';
import { LearningGroupTabs } from '@/features/lms-staff/group-tabs';

type GroupSortKey = 'name' | 'progress' | 'students';
type GroupLayoutMode = 'cards' | 'table';

const GROUP_SORT_LABEL_KEYS = {
  name: 'sortGroupsByName',
  progress: 'sortGroupsByProgress',
  students: 'sortGroupsByStudents',
} as const satisfies Record<GroupSortKey, TranslationKey>;

const GROUP_SORT_KEYS: GroupSortKey[] = ['name', 'progress', 'students'];

interface TeacherGroupsSectionProps {
  initialQuery?: string;
  groups: TeacherGroup[];
  lessons?: TeacherLesson[];
  attendanceRecords?: TeacherAttendanceRecord[];
  view: TeacherGroupView;
  selectedGroup: TeacherGroup | null;
  groupStudents: TeacherStudent[];
  progressById: Map<number, TeacherLessonProgress>;
  attendanceByStudentId: Map<number, { attended: number; missed: number }>;
  dayNames: string[];
  dayNamesFull: string[];
  archivePendingGroupId: number | null;
  onSelectGroup: (groupId: number | null) => void;
  onOpenStudent: (student: TeacherStudent) => void;
  onOpenLearningGroup?: (groupId: number) => void;
  studentProfileOpen?: boolean;
  learningEnabled?: boolean;
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
            className="rounded-lg border-border/70 bg-muted/30 text-xs font-medium"
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
      className={cn('min-h-10 rounded-lg', className)}
      disabled={isPending}
      onClick={(event) => {
        event.stopPropagation();
        if (restoring) onRestore(group);
        else onArchive(group);
      }}
    >
      {isPending ? (
        <Loader2 className="mr-1.5 size-4 animate-spin" />
      ) : (
        <Icon className="mr-1.5 size-4" />
      )}
      {restoring ? t('restoreGroupFromArchive') : t('archiveGroup')}
    </Button>
  );
}

export function TeacherGroupsSection({
  initialQuery = '',
  groups,
  lessons = [],
  attendanceRecords = [],
  view,
  selectedGroup,
  groupStudents,
  progressById,
  attendanceByStudentId,
  dayNames,
  dayNamesFull,
  archivePendingGroupId,
  onSelectGroup,
  onOpenStudent,
  onOpenLearningGroup,
  studentProfileOpen = false,
  learningEnabled = false,
  onChangeView,
  onArchiveGroup,
  onRestoreGroup,
  formatArchivedAt,
}: TeacherGroupsSectionProps) {
  const { t, language } = useTranslation();
  const [query, setQuery] = useState(initialQuery);
  const [courseFilter, setCourseFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<GroupSortKey>('name');
  const [layoutMode, setLayoutMode] = useState<GroupLayoutMode>('cards');
  const [studentQuery, setStudentQuery] = useState('');
  const [onlyLowAttendance, setOnlyLowAttendance] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<TeacherGroup | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<TeacherGroup | null>(null);

  const isArchiveView = view === 'archive';
  const activeGroups = useMemo(() => groups.filter((group) => !group.isArchived), [groups]);
  const archivedGroups = useMemo(() => groups.filter((group) => group.isArchived), [groups]);
  const listedGroups = isArchiveView ? archivedGroups : activeGroups;

  const courseOptions = useMemo(() => {
    const names = new Set<string>();
    for (const group of listedGroups) {
      if (group.courseName?.trim()) names.add(group.courseName.trim());
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [listedGroups]);

  const groupAttendanceRateById = useMemo(() => {
    const lessonGroupMap = new Map<number, number>();
    for (const lesson of lessons) {
      if (lesson.groupId && lesson.status === 'conducted') {
        lessonGroupMap.set(Number(lesson.id), Number(lesson.groupId));
      }
    }
    const countsByGroup = new Map<number, { present: number; total: number }>();
    for (const record of attendanceRecords) {
      const gId = lessonGroupMap.get(Number(record.lessonId));
      if (!gId) continue;
      const entry = countsByGroup.get(gId) ?? { present: 0, total: 0 };
      entry.total += 1;
      if (record.status === 'present') entry.present += 1;
      countsByGroup.set(gId, entry);
    }
    const rates = new Map<number, number>();
    for (const [gId, { present, total }] of countsByGroup.entries()) {
      if (total > 0) rates.set(gId, Math.round((present / total) * 100));
    }
    return rates;
  }, [lessons, attendanceRecords]);

  const nextLessonByGroupId = useMemo(() => {
    const nowMs = Date.now();
    const map = new Map<number, TeacherLesson>();
    for (const lesson of lessons) {
      if (!lesson.groupId || lesson.status !== 'scheduled') continue;
      const time = new Date(lesson.scheduledAt).getTime();
      if (!Number.isFinite(time) || time < nowMs) continue;
      const existing = map.get(Number(lesson.groupId));
      if (!existing || time < new Date(existing.scheduledAt).getTime()) {
        map.set(Number(lesson.groupId), lesson);
      }
    }
    return map;
  }, [lessons]);

  const summaryKpis = useMemo(() => {
    const totalStudents = activeGroups.reduce((sum, g) => sum + (g.currentStudents || 0), 0);
    const completionRates = activeGroups.map((g) => {
      const p = progressById.get(g.id);
      return teacherPercent(p?.conducted ?? 0, p?.total ?? 0);
    });
    const avgCompletion =
      completionRates.length > 0
        ? Math.round(completionRates.reduce((s, v) => s + v, 0) / completionRates.length)
        : 0;
    const attendanceValues = [...groupAttendanceRateById.values()];
    const avgAttendance =
      attendanceValues.length > 0
        ? Math.round(attendanceValues.reduce((s, v) => s + v, 0) / attendanceValues.length)
        : null;
    return {
      activeCount: activeGroups.length,
      totalStudents,
      avgCompletion,
      avgAttendance,
    };
  }, [activeGroups, progressById, groupAttendanceRateById]);

  const visibleGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = listedGroups.filter((group) => {
      if (courseFilter !== 'all' && (group.courseName?.trim() ?? '') !== courseFilter) {
        return false;
      }
      if (!needle) return true;
      return `${group.name} ${group.courseName ?? ''} ${group.schoolName ?? ''}`
        .toLowerCase()
        .includes(needle);
    });

    return filtered.sort((left, right) => {
      if (sortKey === 'students') {
        return (right.currentStudents || 0) - (left.currentStudents || 0);
      }
      if (sortKey === 'progress') {
        const leftProgress = progressById.get(left.id);
        const rightProgress = progressById.get(right.id);
        return (
          teacherPercent(rightProgress?.conducted ?? 0, rightProgress?.total ?? 0) -
          teacherPercent(leftProgress?.conducted ?? 0, leftProgress?.total ?? 0)
        );
      }
      return left.name.localeCompare(right.name);
    });
  }, [listedGroups, progressById, query, courseFilter, sortKey]);

  const filteredGroupStudents = useMemo(() => {
    const needle = studentQuery.trim().toLowerCase();
    return groupStudents.filter((student) => {
      const counts = attendanceByStudentId.get(student.id) ?? { attended: 0, missed: 0 };
      const totalMarked = counts.attended + counts.missed;
      const rate = totalMarked > 0 ? Math.round((counts.attended / totalMarked) * 100) : 100;
      if (onlyLowAttendance && (totalMarked === 0 || rate >= 75)) {
        return false;
      }
      if (!needle) return true;
      return `${student.studentName ?? ''} ${student.contactName ?? ''}`
        .toLowerCase()
        .includes(needle);
    });
  }, [groupStudents, attendanceByStudentId, studentQuery, onlyLowAttendance]);

  const studentColumns = useMemo<DataTableColumn<TeacherStudent>[]>(
    () => [
      {
        key: 'studentName',
        header: t('studentName'),
        accessor: (row) => row.studentName || row.contactName,
        sortable: true,
        render: (row) => {
          const displayName = row.studentName || row.contactName;
          return (
            <span className="inline-flex items-center gap-2.5 font-medium text-foreground">
              <span
                aria-hidden="true"
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
              >
                {displayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="truncate">{displayName}</span>
            </span>
          );
        },
      },
      {
        key: 'attendanceRate',
        header: t('attendanceLabel'),
        accessor: (row) => {
          const counts = attendanceByStudentId.get(row.id) ?? { attended: 0, missed: 0 };
          const totalMarked = counts.attended + counts.missed;
          return totalMarked > 0 ? Math.round((counts.attended / totalMarked) * 100) : -1;
        },
        sortable: true,
        className: 'text-center',
        cellClassName: 'text-center',
        render: (row) => {
          const counts = attendanceByStudentId.get(row.id) ?? { attended: 0, missed: 0 };
          const totalMarked = counts.attended + counts.missed;
          if (totalMarked === 0) {
            return <span className="text-xs text-muted-foreground">{t('noData')}</span>;
          }
          const rate = Math.round((counts.attended / totalMarked) * 100);
          return (
            <Badge
              variant="outline"
              className={cn(
                'rounded-lg border tabular-nums',
                rate >= 80
                  ? TEACHER_TONE_CLASS.success
                  : rate >= 60
                    ? TEACHER_TONE_CLASS.warning
                    : TEACHER_TONE_CLASS.danger,
              )}
            >
              {rate}%
            </Badge>
          );
        },
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
    ],
    [attendanceByStudentId, t],
  );

  const groupTableColumns = useMemo<DataTableColumn<TeacherGroup>[]>(
    () => [
      {
        key: 'name',
        header: t('groupName'),
        accessor: (row) => row.name,
        sortable: true,
        render: (row) => (
          <div className="min-w-0">
            <p className="truncate font-semibold text-foreground">{row.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {row.courseName || t('noCourse')}
            </p>
          </div>
        ),
      },
      {
        key: 'status',
        header: t('status'),
        accessor: (row) => row.status ?? '',
        render: (row) => <GroupStatusBadge status={row.status} />,
      },
      {
        key: 'progress',
        header: t('lessonProgress'),
        accessor: (row) => {
          const p = progressById.get(row.id);
          return teacherPercent(p?.conducted ?? 0, p?.total ?? 0);
        },
        sortable: true,
        render: (row) => {
          const p = progressById.get(row.id);
          const c = p?.conducted ?? 0;
          const tot = p?.total ?? 0;
          return (
            <div className="w-36 space-y-1">
              <div className="flex justify-between text-xs tabular-nums">
                <span>{teacherPercent(c, tot)}%</span>
                <span className="text-muted-foreground">
                  {c}/{tot}
                </span>
              </div>
              <Progress value={teacherPercent(c, tot)} className="h-1.5" />
            </div>
          );
        },
      },
      {
        key: 'students',
        header: t('students'),
        accessor: (row) => row.currentStudents || 0,
        sortable: true,
        render: (row) => (
          <span className="tabular-nums font-medium">
            {row.currentStudents || 0}
            {row.maxStudents ? ` / ${row.maxStudents}` : ''}
          </span>
        ),
      },
    ],
    [progressById, t],
  );

  const archiveDialogs = (
    <>
      <ConfirmDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
        title={t('archiveGroupTitle')}
        description={
          archiveTarget
            ? `${archiveTarget.name} — ${t('archiveGroupConfirm')}`
            : t('archiveGroupConfirm')
        }
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
        onOpenChange={(open) => {
          if (!open) setRestoreTarget(null);
        }}
        title={t('restoreGroupTitle')}
        description={
          restoreTarget
            ? `${restoreTarget.name} — ${t('restoreGroupConfirm')}`
            : t('restoreGroupConfirm')
        }
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
  const detailAttendanceRate = detailGroup ? groupAttendanceRateById.get(detailGroup.id) : undefined;

  const studentsContent = (
    <div className="space-y-3 border-t border-border/70 pt-4">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <h4 className="text-sm font-semibold">
          {t('groupStudentsCount').replace('{count}', String(groupStudents.length))}
        </h4>
        {groupStudents.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-44 flex-1 sm:w-52">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={studentQuery}
                onChange={(event) => setStudentQuery(event.target.value)}
                placeholder={t('teacherGroupsSearchStudents')}
                aria-label={t('teacherGroupsSearchStudents')}
                className="h-8 pl-8 text-xs"
              />
            </div>
            <div className="inline-flex rounded-lg border border-border/70 bg-muted/40 p-0.5">
              <button
                type="button"
                onClick={() => setOnlyLowAttendance(false)}
                className={cn(
                  'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                  !onlyLowAttendance
                    ? 'bg-background text-foreground shadow-2xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t('teacherGroupsAllStudents')}
              </button>
              <button
                type="button"
                onClick={() => setOnlyLowAttendance(true)}
                className={cn(
                  'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                  onlyLowAttendance
                    ? 'bg-background text-foreground shadow-2xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t('teacherGroupsLowAttendance')}
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <DataTable
        columns={studentColumns}
        data={filteredGroupStudents}
        keyExtractor={(row) => String(row.id)}
        onRowClick={onOpenStudent}
        emptyState={<EmptyState icon={Users} title={t('noStudents')} />}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="border-border/70">
          <CardContent className="flex items-center gap-3 p-3.5">
            <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', TEACHER_TONE_ICON_CLASS.accent)}>
              <UsersRound className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">{t('teacherGroupsActiveCount')}</p>
              <p className="text-2xl font-bold tabular-nums text-foreground">{summaryKpis.activeCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/70">
          <CardContent className="flex items-center gap-3 p-3.5">
            <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', TEACHER_TONE_ICON_CLASS.info)}>
              <Users className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">{t('totalStudents')}</p>
              <p className="text-2xl font-bold tabular-nums text-foreground">{summaryKpis.totalStudents}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/70">
          <CardContent className="flex items-center gap-3 p-3.5">
            <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', TEACHER_TONE_ICON_CLASS.success)}>
              <TrendingUp className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">{t('teacherGroupsAvgCompletion')}</p>
              <p className="text-2xl font-bold tabular-nums text-foreground">{summaryKpis.avgCompletion}%</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/70">
          <CardContent className="flex items-center gap-3 p-3.5">
            <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', TEACHER_TONE_ICON_CLASS.warning)}>
              <CheckCircle2 className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">{t('averageAttendance')}</p>
              <p className="text-2xl font-bold tabular-nums text-foreground">
                {summaryKpis.avgAttendance != null ? `${summaryKpis.avgAttendance}%` : t('noData')}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70">
        <CardContent className={cn('flex flex-col gap-2.5', TEACHER_CARD_PADDING_DENSE)}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div
              className="inline-flex w-full items-center gap-1 self-start rounded-lg border border-border bg-muted/50 p-1 sm:w-auto"
              role="group"
              aria-label={t('groupListView')}
            >
              <Button
                type="button"
                size="sm"
                variant={isArchiveView ? 'ghost' : 'secondary'}
                className="min-h-10 min-w-0 flex-1 gap-2 px-2 sm:flex-none sm:px-3"
                aria-pressed={!isArchiveView}
                onClick={() => onChangeView('active')}
              >
                <UsersRound className="hidden sm:block" />
                <span className="sm:hidden">{t('groupCurrentShort')}</span>
                <span className="hidden sm:inline">{t('adminActiveGroups')}</span>
                <Badge variant="outline" className="min-w-6 justify-center bg-background tabular-nums">
                  {activeGroups.length}
                </Badge>
              </Button>
              <Button
                type="button"
                size="sm"
                variant={isArchiveView ? 'secondary' : 'ghost'}
                className="min-h-10 min-w-0 flex-1 gap-2 px-2 sm:flex-none sm:px-3"
                aria-pressed={isArchiveView}
                onClick={() => onChangeView('archive')}
              >
                <Archive className="hidden sm:block" />
                <span className="sm:hidden">{t('groupArchivedShort')}</span>
                <span className="hidden sm:inline">{t('groupArchiveLabel')}</span>
                <Badge variant="outline" className="min-w-6 justify-center bg-background tabular-nums">
                  {archivedGroups.length}
                </Badge>
              </Button>
            </div>

            <div className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-muted/40 p-1">
              <Button
                type="button"
                size="sm"
                variant={layoutMode === 'cards' ? 'secondary' : 'ghost'}
                className="h-8 gap-1.5 px-2.5 text-xs"
                onClick={() => setLayoutMode('cards')}
              >
                <LayoutGrid className="size-3.5" />
                {t('teacherGroupsViewCards')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={layoutMode === 'table' ? 'secondary' : 'ghost'}
                className="h-8 gap-1.5 px-2.5 text-xs"
                onClick={() => setLayoutMode('table')}
              >
                <List className="size-3.5" />
                {t('teacherGroupsViewTable')}
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('searchGroupsPlaceholder')}
                aria-label={t('searchGroupsPlaceholder')}
                className="h-10 rounded-lg pl-9 pr-8"
              />
              {query ? (
                <button
                  type="button"
                  aria-label={t('clearSearch')}
                  onClick={() => setQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
            {courseOptions.length > 1 ? (
              <Select value={courseFilter} onValueChange={setCourseFilter}>
                <SelectTrigger className="h-10 w-full rounded-lg sm:w-[200px]" aria-label={t('course')}>
                  <SelectValue placeholder={t('teacherGroupsAllCourses')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('teacherGroupsAllCourses')}</SelectItem>
                  {courseOptions.map((courseName) => (
                    <SelectItem key={courseName} value={courseName}>
                      {courseName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Select value={sortKey} onValueChange={(value) => setSortKey(value as GroupSortKey)}>
              <SelectTrigger className="h-10 w-full rounded-lg sm:w-[200px]" aria-label={t('sortGroupsLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GROUP_SORT_KEYS.map((key) => (
                  <SelectItem key={key} value={key}>
                    {t(GROUP_SORT_LABEL_KEYS[key])}
                  </SelectItem>
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
              title={
                listedGroups.length === 0
                  ? isArchiveView
                    ? t('noArchivedGroups')
                    : t('noGroups')
                  : t('noScheduleGroupsFound')
              }
              action={
                listedGroups.length === 0 ? undefined : (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setQuery('');
                      setCourseFilter('all');
                    }}
                  >
                    {t('resetFilters')}
                  </Button>
                )
              }
            />
          </CardContent>
        </Card>
      ) : layoutMode === 'table' ? (
        <Card className="border-border/70">
          <CardContent className="p-3">
            <DataTable
              columns={groupTableColumns}
              data={visibleGroups}
              keyExtractor={(row) => String(row.id)}
              onRowClick={(row) => onSelectGroup(row.id)}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleGroups.map((group) => {
            const gProgress = progressById.get(group.id);
            const gConducted = gProgress?.conducted ?? 0;
            const gTotal = gProgress?.total ?? 0;
            const gProgressLabel = t('lessonsConductedCount')
              .replace('{conducted}', String(gConducted))
              .replace('{total}', String(gTotal));
            const attendanceRate = groupAttendanceRateById.get(group.id);
            const nextGroupLesson = nextLessonByGroupId.get(group.id);

            return (
              <Card
                key={group.id}
                onClick={() => onSelectGroup(group.id)}
                className="group min-w-0 cursor-pointer border-border/70 transition-all hover:border-primary/40 hover:shadow-md"
              >
                <CardContent className={cn('flex h-full flex-col justify-between gap-3.5', TEACHER_CARD_PADDING)}>
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <h3 className="truncate text-base font-semibold text-foreground transition-colors group-hover:text-primary">
                          {group.name}
                        </h3>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1 truncate font-medium text-foreground/80">
                            <BookOpen className="size-3.5 shrink-0 text-primary/80" />
                            {group.courseName || t('noCourse')}
                          </span>
                          <span>·</span>
                          <span className="inline-flex items-center gap-1 truncate">
                            <MapPin className="size-3 shrink-0" />
                            {group.schoolName || t('schoolNotSelected')}
                          </span>
                        </div>
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
                        <span className="font-medium tabular-nums text-foreground">
                          {gProgressLabel}
                        </span>
                      </div>
                      <Progress
                        value={teacherPercent(gConducted, gTotal)}
                        className="h-2"
                        aria-label={`${group.name} — ${gProgressLabel}`}
                      />
                    </div>

                    {group.schedule && group.schedule.length > 0 ? (
                      <ScheduleBadges
                        schedule={group.schedule}
                        dayNames={dayNames}
                        unknownLabel={t('weekdayNotSpecified')}
                      />
                    ) : null}

                    {nextGroupLesson ? (
                      <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/25 px-2.5 py-1.5 text-xs">
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                          <CalendarClock className="size-3.5 text-primary" />
                          {t('teacherGroupsNextLesson')}
                        </span>
                        <span className="font-semibold tabular-nums text-foreground">
                          {formatAcademyDate(nextGroupLesson.scheduledAt, language, {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <Users className="size-3.5" />
                        <span className="tabular-nums">
                          {t('studentsCountValue').replace(
                            '{count}',
                            String(group.currentStudents || 0),
                          )}
                        </span>
                      </span>
                      {attendanceRate != null ? (
                        <Badge
                          variant="outline"
                          className={cn(
                            'rounded-md border text-[11px] tabular-nums',
                            attendanceRate >= 80
                              ? TEACHER_TONE_CLASS.success
                              : attendanceRate >= 60
                                ? TEACHER_TONE_CLASS.warning
                                : TEACHER_TONE_CLASS.danger,
                          )}
                        >
                          {t('groupAttendanceValue', { percent: attendanceRate })}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <GroupArchiveAction
                        group={group}
                        isPending={archivePendingGroupId === group.id}
                        onArchive={setArchiveTarget}
                        onRestore={setRestoreTarget}
                      />
                      {learningEnabled && onOpenLearningGroup && !group.isArchived ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="min-h-10 rounded-lg"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenLearningGroup(group.id);
                          }}
                        >
                          <GraduationCap className="mr-1.5 size-4" />
                          {t('lmsStaffTitle')}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-10 rounded-lg"
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelectGroup(group.id);
                        }}
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

      <Sheet
        open={detailGroup !== null && !studentProfileOpen}
        onOpenChange={(open) => {
          if (!open) onSelectGroup(null);
        }}
      >
        <SheetContent
          className={cn(
            'flex w-full flex-col gap-0 overflow-hidden p-0',
            learningEnabled ? 'sm:max-w-5xl' : 'sm:max-w-xl',
          )}
        >
          {detailGroup ? (
            <>
              <SheetHeader className="gap-1.5 border-b border-border/70 bg-muted/20 px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2 pr-8">
                  <SheetTitle className="flex flex-wrap items-center gap-2 text-lg">
                    <span className="min-w-0 truncate">{detailGroup.name}</span>
                    <GroupStatusBadge status={detailGroup.status} />
                    {detailGroup.isArchived ? (
                      <Badge
                        variant="outline"
                        className={cn('rounded-lg border', TEACHER_TONE_CLASS.neutral)}
                      >
                        {t('groupInArchive')}
                      </Badge>
                    ) : null}
                  </SheetTitle>
                  {learningEnabled && onOpenLearningGroup && !detailGroup.isArchived ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onOpenLearningGroup(detailGroup.id)}
                    >
                      <GraduationCap className="mr-1.5 size-4" />
                      {t('teacherOpenLearning')}
                    </Button>
                  ) : null}
                </div>
                <SheetDescription className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                  <span className="font-medium text-foreground/80">
                    {detailGroup.courseName || t('noCourse')}
                  </span>
                  <span>·</span>
                  <span>
                    {t('groupTeacherLine').replace(
                      '{name}',
                      detailGroup.teacherName || t('notAssigned'),
                    )}
                    {detailGroup.isArchived && detailGroup.archivedAt
                      ? ` · ${t('groupArchivedOn').replace('{date}', formatArchivedAt(detailGroup.archivedAt))}`
                      : ''}
                  </span>
                </SheetDescription>
              </SheetHeader>

              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-border/70 bg-muted/20 p-3 sm:col-span-2">
                    <div className="mb-2 flex justify-between text-xs">
                      <span className="font-medium text-muted-foreground">{t('lessonProgress')}</span>
                      <span className="font-semibold tabular-nums text-foreground">
                        {progressLabel}
                      </span>
                    </div>
                    <Progress
                      value={teacherPercent(conducted, total)}
                      aria-label={`${t('lessonProgress')} — ${progressLabel}`}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-border/70 bg-muted/20 p-3">
                    <div>
                      <p className="text-xs text-muted-foreground">{t('attendanceLabel')}</p>
                      <p className="text-lg font-bold tabular-nums text-foreground">
                        {detailAttendanceRate != null ? `${detailAttendanceRate}%` : t('noData')}
                      </p>
                    </div>
                    <GroupArchiveAction
                      group={detailGroup}
                      isPending={archivePendingGroupId === detailGroup.id}
                      onArchive={setArchiveTarget}
                      onRestore={setRestoreTarget}
                    />
                  </div>
                </div>

                {detailGroup.schedule && detailGroup.schedule.length > 0 ? (
                  <ScheduleBadges
                    schedule={detailGroup.schedule}
                    dayNames={dayNamesFull}
                    unknownLabel={t('weekdayNotSpecified')}
                  />
                ) : null}

                {learningEnabled ? (
                  <LearningGroupTabs key={detailGroup.id} groupId={detailGroup.id} enabled>
                    {studentsContent}
                  </LearningGroupTabs>
                ) : (
                  studentsContent
                )}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
