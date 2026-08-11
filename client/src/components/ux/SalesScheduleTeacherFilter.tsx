import { useMemo, useState } from 'react';
import { ChevronsUpDown, Search, UsersRound, X } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/hooks/useTranslation';
import type { SalesScheduleTeacherOption } from '@/lib/salesSchedule';
import { cn } from '@/lib/utils';

interface SalesScheduleTeacherFilterProps {
  teachers: SalesScheduleTeacherOption[];
  selectedTeacherIds: Set<number>;
  eventCounts: Map<number, number>;
  onToggle: (teacherId: number, checked: boolean) => void;
  onClear: () => void;
}

const teacherInitials = (name: string) => name
  .trim()
  .split(/\s+/)
  .slice(0, 2)
  .map((part) => part[0]?.toLocaleUpperCase() ?? '')
  .join('');

export function SalesScheduleTeacherFilter({
  teachers,
  selectedTeacherIds,
  eventCounts,
  onToggle,
  onClear,
}: SalesScheduleTeacherFilterProps) {
  const { t, language } = useTranslation();
  const [search, setSearch] = useState('');
  const selectedTeachers = useMemo(
    () => teachers.filter((teacher) => selectedTeacherIds.has(teacher.id)),
    [selectedTeacherIds, teachers],
  );
  const normalizedSearch = search.trim().toLocaleLowerCase(language);
  const searchedTeachers = useMemo(
    () => normalizedSearch
      ? teachers.filter((teacher) => (
          teacher.name.toLocaleLowerCase(language).includes(normalizedSearch)
        ))
      : teachers,
    [language, normalizedSearch, teachers],
  );
  const triggerLabel = selectedTeachers.length === 0
    ? t('allTeachers')
    : selectedTeachers.length === 1
      ? selectedTeachers[0].name
      : t('teachersSelectedCount').replace('{count}', String(selectedTeachers.length));

  return (
    <div className="rounded-xl border border-border/70 bg-muted/25 p-2.5">
      <div className="mb-2 flex items-start gap-2">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <UsersRound className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-foreground">{t('scheduleTeacherFilter')}</p>
          <p className="text-[11px] leading-4 text-muted-foreground">
            {t('scheduleTeacherFilterDescription')}
          </p>
        </div>
        {selectedTeachers.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={onClear}
          >
            {t('reset')}
          </Button>
        ) : null}
      </div>

      <DropdownMenu onOpenChange={(open) => {
        if (!open) setSearch('');
      }}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full justify-start gap-2 bg-card px-2.5 shadow-2xs"
            aria-label={`${t('scheduleTeacherFilter')}: ${triggerLabel}`}
          >
            {selectedTeachers.length > 0 ? (
              <span className="flex shrink-0 -space-x-1.5" aria-hidden="true">
                {selectedTeachers.slice(0, 3).map((teacher) => (
                  <Avatar key={teacher.id} className="size-7 border-2 border-card" aria-hidden="true">
                    <AvatarFallback className="bg-primary/10 text-[9px] font-bold text-primary">
                      {teacherInitials(teacher.name)}
                    </AvatarFallback>
                  </Avatar>
                ))}
              </span>
            ) : (
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <UsersRound className="size-3.5" aria-hidden="true" />
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-left">{triggerLabel}</span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-64 p-2"
        >
          <DropdownMenuLabel className="px-1 pb-2 text-xs text-muted-foreground">
            {t('scheduleTeacherFilter')}
          </DropdownMenuLabel>
          <div className="relative mb-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
              placeholder={t('searchTeachers')}
              aria-label={t('searchTeachers')}
              className="h-9 pl-8"
            />
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className={cn(
              'min-h-10',
              selectedTeachers.length === 0 && 'bg-primary/10 text-primary',
            )}
            onSelect={onClear}
          >
            <span className="flex size-7 items-center justify-center rounded-full bg-muted">
              <UsersRound className="size-3.5" aria-hidden="true" />
            </span>
            <span className="flex-1">{t('showAllTeachers')}</span>
          </DropdownMenuItem>
          {searchedTeachers.length > 0 ? searchedTeachers.map((teacher) => {
            const eventCount = eventCounts.get(teacher.id) ?? 0;
            return (
              <DropdownMenuCheckboxItem
                key={teacher.id}
                checked={selectedTeacherIds.has(teacher.id)}
                onCheckedChange={(checked) => onToggle(teacher.id, checked === true)}
                onSelect={(event) => event.preventDefault()}
                className="pr-2"
                aria-label={`${teacher.name}. ${t('lessonsThisWeekCount').replace('{count}', String(eventCount))}`}
              >
                <Avatar className="size-7" aria-hidden="true">
                  <AvatarFallback className="bg-primary/10 text-[9px] font-bold text-primary">
                    {teacherInitials(teacher.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate">{teacher.name}</span>
                <span
                  className="min-w-6 rounded-md bg-muted px-1.5 py-0.5 text-center text-[10px] tabular-nums text-muted-foreground"
                  aria-label={t('lessonsThisWeekCount').replace('{count}', String(eventCount))}
                >
                  {eventCount}
                </span>
              </DropdownMenuCheckboxItem>
            );
          }) : (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              {t('noTeachersFound')}
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {selectedTeachers.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selectedTeachers.slice(0, 3).map((teacher) => (
            <button
              key={teacher.id}
              type="button"
              className="group inline-flex max-w-full items-center gap-1 rounded-full border border-primary/20 bg-primary/5 py-1 pl-1.5 pr-2 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t('removeTeacherFilter').replace('{name}', teacher.name)}
              onClick={() => onToggle(teacher.id, false)}
            >
              <Avatar className="size-5" aria-hidden="true">
                <AvatarFallback className="bg-primary/10 text-[8px] font-bold text-primary">
                  {teacherInitials(teacher.name)}
                </AvatarFallback>
              </Avatar>
              <span className="truncate">{teacher.name}</span>
              <X className="size-3 opacity-60 transition-opacity group-hover:opacity-100" aria-hidden="true" />
            </button>
          ))}
          {selectedTeachers.length > 3 ? (
            <span
              className="inline-flex min-h-7 items-center rounded-full border border-primary/20 bg-primary/5 px-2 text-[11px] font-semibold tabular-nums text-primary"
              aria-label={t('teachersSelectedCount').replace('{count}', String(selectedTeachers.length))}
            >
              +{selectedTeachers.length - 3}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
