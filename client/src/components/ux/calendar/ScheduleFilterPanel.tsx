import { useMemo, useState } from 'react';
import {
  BookOpen,
  Building2,
  CalendarDays,
  ChevronDown,
  Minus,
  Search,
  SearchX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SalesScheduleTeacherFilter } from '@/components/ux/SalesScheduleTeacherFilter';
import { calendarToneAt } from '@/components/ux/calendar/calendarTones';
import { useTranslation } from '@/hooks/useTranslation';
import {
  getGroupSelectionState,
  searchSalesScheduleFilterTree,
  type SalesScheduleFilterSchool,
  type SalesScheduleGroup,
  type SalesScheduleTeacherOption,
} from '@/lib/salesSchedule';
import { cn } from '@/lib/utils';

interface ScheduleFilterPanelProps {
  filterTree: SalesScheduleFilterSchool[];
  groupCount: number;
  eventCount: number;
  selectedGroupIds: Set<number>;
  groupIndexById: Map<number, number>;
  dayNames: string[];
  teachers: SalesScheduleTeacherOption[];
  selectedTeacherIds: Set<number>;
  teacherEventCounts: Map<number, number>;
  onToggleGroup: (groupId: number, checked: boolean) => void;
  onToggleGroups: (groupIds: number[], checked: boolean) => void;
  onSelectAllGroups: () => void;
  onClearGroups: () => void;
  onToggleTeacher: (teacherId: number, checked: boolean) => void;
  onClearTeachers: () => void;
}

const availableSeats = (group: SalesScheduleGroup) => Math.max(
  0,
  Number(group.maxStudents ?? 12)
  - Number(group.currentStudents ?? 0)
  - Number(group.reservedStudents ?? 0),
);

export function ScheduleFilterPanel({
  filterTree,
  groupCount,
  eventCount,
  selectedGroupIds,
  groupIndexById,
  dayNames,
  teachers,
  selectedTeacherIds,
  teacherEventCounts,
  onToggleGroup,
  onToggleGroups,
  onSelectAllGroups,
  onClearGroups,
  onToggleTeacher,
  onClearTeachers,
}: ScheduleFilterPanelProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [collapsedSchools, setCollapsedSchools] = useState<Set<string>>(() => new Set());
  const visibleTree = useMemo(
    () => searchSalesScheduleFilterTree(filterTree, search),
    [filterTree, search],
  );
  const allSelected = groupCount > 0 && selectedGroupIds.size === groupCount;

  const groupSchedule = (group: SalesScheduleGroup) => (group.schedule ?? [])
    .map((item) => {
      const day = dayNames[Number(item.dayOfWeek) - 1] ?? '';
      const start = item.startTime ?? item.time ?? '';
      return `${day} ${start}`.trim();
    })
    .filter(Boolean)
    .join(' · ');

  const toggleSchool = (key: string) => {
    setCollapsedSchools((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className="text-xs text-muted-foreground">
          {selectedGroupIds.size} {t('ofLabel')} {groupCount} {t('groupsSelected')}
        </p>
        <p className="text-xs font-medium tabular-nums text-foreground">
          {t('lessonsThisWeekCount').replace('{count}', String(eventCount))}
        </p>
      </div>

      {teachers.length > 0 ? (
        <SalesScheduleTeacherFilter
          teachers={teachers}
          selectedTeacherIds={selectedTeacherIds}
          eventCounts={teacherEventCounts}
          onToggle={onToggleTeacher}
          onClear={onClearTeachers}
        />
      ) : null}

      {groupCount > 0 ? (
        <>
          <div className="flex items-center gap-1.5">
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('searchScheduleGroups')}
                aria-label={t('searchScheduleGroups')}
                className="h-9 pl-8"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 shrink-0 px-2 text-xs"
              disabled={allSelected}
              onClick={onSelectAllGroups}
            >
              {t('selectAllScheduleGroups')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 shrink-0 px-2 text-xs"
              disabled={selectedGroupIds.size === 0}
              onClick={onClearGroups}
            >
              {t('clearScheduleGroups')}
            </Button>
          </div>

          <ScrollArea className="-mr-2 h-auto max-h-72 min-h-0 flex-1 lg:max-h-none">
            <div className="flex flex-col gap-1 pr-2">
              {visibleTree.map((school) => {
                const schoolGroupIds = school.courses.flatMap((course) => (
                  course.groups.map((group) => group.id)
                ));
                const schoolState = getGroupSelectionState(schoolGroupIds, selectedGroupIds);
                const collapsed = collapsedSchools.has(school.key);
                const selectedInSchool = schoolGroupIds
                  .filter((id) => selectedGroupIds.has(id)).length;

                return (
                  <div key={school.key} className="flex flex-col gap-1">
                    <div className="flex items-center gap-1 rounded-lg bg-muted/50 pr-1 hover:bg-muted">
                      <Label
                        htmlFor={`sales-schedule-${school.key}`}
                        className="flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 font-medium focus-within:ring-2 focus-within:ring-ring"
                      >
                        <span className="relative flex size-4 shrink-0 items-center justify-center">
                          <Checkbox
                            id={`sales-schedule-${school.key}`}
                            checked={schoolState}
                            onCheckedChange={(value) => onToggleGroups(schoolGroupIds, value === true)}
                            className="[&[data-state=indeterminate]_svg]:hidden"
                          />
                          {schoolState === 'indeterminate' ? (
                            <Minus className="pointer-events-none absolute size-3 text-primary" />
                          ) : null}
                        </span>
                        <Building2 className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-xs">
                          {school.name || t('schoolNotSelected')}
                        </span>
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          {selectedInSchool}/{schoolGroupIds.length}
                        </span>
                      </Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 rounded-md"
                        aria-expanded={!collapsed}
                        aria-label={school.name || t('schoolNotSelected')}
                        onClick={() => toggleSchool(school.key)}
                      >
                        <ChevronDown className={cn('transition-transform', collapsed && '-rotate-90')} />
                      </Button>
                    </div>

                    {!collapsed ? (
                      <div className="flex flex-col gap-1 pl-3">
                        {school.courses.map((course) => {
                          const courseGroupIds = course.groups.map((group) => group.id);
                          const courseState = getGroupSelectionState(courseGroupIds, selectedGroupIds);

                          return (
                            <div key={course.key} className="flex flex-col gap-0.5">
                              <Label
                                htmlFor={`sales-schedule-${course.key}`}
                                className="flex min-h-8 cursor-pointer items-center gap-2 rounded-lg px-2 py-1 hover:bg-muted/60 focus-within:ring-2 focus-within:ring-ring"
                              >
                                <span className="relative flex size-4 shrink-0 items-center justify-center">
                                  <Checkbox
                                    id={`sales-schedule-${course.key}`}
                                    checked={courseState}
                                    onCheckedChange={(value) => onToggleGroups(courseGroupIds, value === true)}
                                    className="[&[data-state=indeterminate]_svg]:hidden"
                                  />
                                  {courseState === 'indeterminate' ? (
                                    <Minus className="pointer-events-none absolute size-3 text-primary" />
                                  ) : null}
                                </span>
                                <BookOpen className="size-4 shrink-0 text-muted-foreground" />
                                <span className="min-w-0 truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                  {course.name || t('noCourse')}
                                </span>
                              </Label>

                              <div className="flex flex-col gap-0.5 pl-5">
                                {course.groups.map((group) => {
                                  const checked = selectedGroupIds.has(group.id);
                                  const tone = calendarToneAt(groupIndexById.get(group.id) ?? 0);
                                  const seats = availableSeats(group);
                                  return (
                                    <Label
                                      key={group.id}
                                      htmlFor={`sales-schedule-group-${group.id}`}
                                      className={cn(
                                        'flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5',
                                        'hover:bg-muted/60 focus-within:ring-2 focus-within:ring-ring',
                                        checked ? 'bg-muted/40' : 'opacity-55 hover:opacity-100',
                                      )}
                                    >
                                      <Checkbox
                                        id={`sales-schedule-group-${group.id}`}
                                        checked={checked}
                                        onCheckedChange={(value) => onToggleGroup(group.id, value === true)}
                                      />
                                      <span
                                        className="h-7 w-1 shrink-0 rounded-full"
                                        style={{ backgroundColor: tone.solid }}
                                        aria-hidden="true"
                                      />
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate text-xs font-medium text-foreground">
                                          {group.name}
                                        </span>
                                        <span className="block truncate text-[11px] text-muted-foreground">
                                          {groupSchedule(group) || t('noScheduleYet')}
                                        </span>
                                      </span>
                                      <span
                                        className={cn(
                                          'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                                          seats > 0
                                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                            : 'bg-muted text-muted-foreground',
                                        )}
                                        aria-label={`${seats} ${t('seatsAvailable')}`}
                                      >
                                        {seats}
                                      </span>
                                    </Label>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}

              {visibleTree.length === 0 ? (
                <div className="flex min-h-28 flex-col items-center justify-center gap-2 px-3 text-center">
                  <SearchX className="text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">{t('noScheduleGroupsFound')}</p>
                </div>
              ) : null}
            </div>
          </ScrollArea>
        </>
      ) : (
        <div className="flex min-h-32 flex-col items-center justify-center gap-2 text-center">
          <CalendarDays className="text-muted-foreground" />
          <p className="text-sm font-medium">{t('noScheduledGroups')}</p>
          <p className="text-xs text-muted-foreground">{t('noScheduledGroupsDescription')}</p>
        </div>
      )}
    </div>
  );
}
