import { useMemo, useState } from 'react';
import { ArrowLeft, Search, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable, type DataTableColumn } from '@/components/ux/DataTable';
import { EmptyState } from '@/components/ux/EmptyState';
import { GroupStatusBadge } from '@/components/ux/teacher/TeacherStatusBadge';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import {
  TEACHER_CARD_PADDING,
  TEACHER_CARD_PADDING_DENSE,
  TEACHER_TONE_CLASS,
  formatGroupScheduleTime,
  teacherPercent,
  weekdayIndexFromDayOfWeek,
  type TeacherGroup,
  type TeacherGroupSchedule,
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
  selectedGroup: TeacherGroup | null;
  groupStudents: TeacherStudent[];
  progressById: Map<number, TeacherLessonProgress>;
  attendanceByStudentId: Map<number, { attended: number; missed: number }>;
  dayNames: string[];
  dayNamesFull: string[];
  onSelectGroup: (groupId: number | null) => void;
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

/**
 * Selecting a group used to swap the list for a detail view without touching
 * the URL, so the browser Back button threw the teacher out of the module
 * entirely. The parent now owns the selection through a query parameter and
 * this component is a pure rendering of it.
 */
export function TeacherGroupsSection({
  groups,
  selectedGroup,
  groupStudents,
  progressById,
  attendanceByStudentId,
  dayNames,
  dayNamesFull,
  onSelectGroup,
}: TeacherGroupsSectionProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<GroupSortKey>('name');

  const visibleGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? groups.filter((group) => (
        `${group.name} ${group.courseName ?? ''} ${group.schoolName ?? ''}`.toLowerCase().includes(needle)
      ))
      : [...groups];

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
  }, [groups, progressById, query, sortKey]);

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

  if (selectedGroup) {
    const progress = progressById.get(selectedGroup.id);
    const conducted = progress?.conducted ?? 0;
    const total = progress?.total ?? 0;
    const progressLabel = t('lessonsConductedCount')
      .replace('{conducted}', String(conducted))
      .replace('{total}', String(total));

    return (
      <div className="space-y-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 rounded-lg"
          onClick={() => onSelectGroup(null)}
        >
          <ArrowLeft className="mr-1.5 size-4" />
          {t('backToGroups')}
        </Button>

        <Card className="border-border/70">
          <CardHeader className="gap-3 pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-lg">{selectedGroup.name}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selectedGroup.courseName || t('noCourse')}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {t('groupTeacherLine').replace('{name}', selectedGroup.teacherName || t('notAssigned'))}
                </p>
              </div>
              <GroupStatusBadge status={selectedGroup.status} />
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <div className="mb-2 flex justify-between text-sm">
                <span className="text-muted-foreground">{t('lessonProgress')}</span>
                <span className="font-medium tabular-nums text-foreground">{progressLabel}</span>
              </div>
              <Progress
                value={teacherPercent(conducted, total)}
                aria-label={`${t('lessonProgress')} — ${progressLabel}`}
              />
            </div>

            {selectedGroup.schedule && selectedGroup.schedule.length > 0 ? (
              <ScheduleBadges
                schedule={selectedGroup.schedule}
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
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-border/70">
        <CardContent className={cn('flex flex-col gap-2.5 sm:flex-row sm:items-center', TEACHER_CARD_PADDING_DENSE)}>
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
              .replace('{total}', String(groups.length))}
          </p>
        </CardContent>
      </Card>

      {visibleGroups.length === 0 ? (
        <Card className="border-dashed border-border/70">
          <CardContent className="p-0">
            <EmptyState
              icon={Users}
              title={groups.length === 0 ? t('noGroups') : t('noScheduleGroupsFound')}
              description={groups.length === 0 ? t('noGroupsAssigned') : t('adjustSearchCriteria')}
              action={groups.length === 0 ? undefined : (
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

                  <div className="flex items-center justify-between gap-2 border-t border-border/70 pt-3">
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Users className="size-3.5" />
                      <span className="tabular-nums">
                        {t('studentsCountValue').replace('{count}', String(group.currentStudents || 0))}
                      </span>
                    </span>
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
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
