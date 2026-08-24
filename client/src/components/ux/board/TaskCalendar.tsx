import { useCallback, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes } from 'react';
import {
    DndContext,
    KeyboardSensor,
    MouseSensor,
    TouchSensor,
    closestCenter,
    pointerWithin,
    rectIntersection,
    useDraggable,
    useDroppable,
    useSensor,
    useSensors,
    type CollisionDetection,
    type DragEndEvent,
    type DragStartEvent,
} from '@dnd-kit/core';
import { CalendarDays, Clock3, Inbox } from 'lucide-react';
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
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { CalendarNavigator } from '@/components/ux/calendar/CalendarNavigator';
import { CALENDAR_TONES } from '@/components/ux/calendar/calendarTones';
import { DragOverlayPortal } from '@/components/ux/DragOverlayPortal';
import { EmptyState } from '@/components/ux/EmptyState';
import { useCalendarPreference } from '@/hooks/useCalendarPreference';
import { useCalendarShortcuts } from '@/hooks/useCalendarShortcuts';
import { useIsCompactViewport } from '@/hooks/useMediaQuery';
import { useTranslation } from '@/hooks/useTranslation';
import { getInitials } from '@/lib/auth';
import {
    PRIORITY_META,
    TASK_COLOR_META,
    formatBoardDateTime,
    type TaskSummary,
} from '@/lib/boardTypes';
import {
    buildMonthDays,
    buildWeekDays,
    dateFromDayKey,
    shiftDayKey,
    shiftMonthKey,
    weekStartDayKey,
} from '@/lib/calendarDays';
import type { CalendarViewMode } from '@/lib/calendarPreferences';
import type { TranslationKey } from '@/lib/i18n';
import {
    academyDateInputValue,
    academyInstant,
    academyTimeOfDay,
    resolveLocale,
} from '@/lib/localeFormat';
import {
    finishOptimisticChange,
    incomingValueChangedSinceStart,
    reconcileOptimisticItems,
    type OptimisticChange,
} from '@/lib/optimisticReconciliation';
import { cn } from '@/lib/utils';

interface TaskCalendarProps {
    tasks: TaskSummary[];
    onTaskClick: (taskId: number) => void;
    /** Resolves false when the server refused, so the move can be rolled back. */
    onReschedule: (taskId: number, dueAt: string | null) => Promise<boolean>;
}

type TaskCalendarState = 'overdue' | 'planned' | 'finished';

const VIEWS = ['month', 'week', 'agenda'] as const satisfies readonly CalendarViewMode[];
const COMPACT_VIEWS = ['agenda'] as const satisfies readonly CalendarViewMode[];
const VISIBLE_PER_DAY = 3;
const UNSCHEDULED_DROP_ID = 'task-calendar-unscheduled';

/* A deadline nobody set is due by the end of that working day rather than at
   its first minute, so scheduling a task for today does not file it as overdue
   the moment it lands. */
const DEFAULT_DUE_TIME = '18:00';

const STATE_TONES = {
    overdue: CALENDAR_TONES[4],
    planned: CALENDAR_TONES[0],
    finished: CALENDAR_TONES[1],
} as const;

const STATE_LABEL_KEYS = {
    overdue: 'taskStateOverdue',
    planned: 'taskStatePlanned',
    finished: 'taskStateFinished',
} satisfies Record<TaskCalendarState, TranslationKey>;

const STATES = ['overdue', 'planned', 'finished'] as const satisfies readonly TaskCalendarState[];

const taskCalendarState = (task: TaskSummary, now: number): TaskCalendarState => {
    if (task.status === 'done' || task.status === 'accepted') return 'finished';
    if (task.dueAt && new Date(task.dueAt).getTime() < now) return 'overdue';
    return 'planned';
};

/* Moving a deadline keeps the time of day it already carried — a review due at
   09:00 stays a morning task when it slides to Thursday. */
export const dueAtForDay = (dateKey: string, previousDueAt: string | null) => {
    const time = previousDueAt ? academyTimeOfDay(previousDueAt) || DEFAULT_DUE_TIME : DEFAULT_DUE_TIME;
    return academyInstant(dateKey, time).toISOString();
};

const reconcileCalendarTasks = (
    incoming: TaskSummary[],
    pending: ReadonlyMap<number, OptimisticChange<string | null>>,
) => reconcileOptimisticItems(
    incoming,
    pending,
    (task) => task.id,
    (task) => task.dueAt,
    (task, dueAt) => ({ ...task, dueAt }),
);

const collisionDetection: CollisionDetection = (args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) return pointerCollisions;
    const intersections = rectIntersection(args);
    return intersections.length > 0 ? intersections : closestCenter(args);
};

/**
 * The chip itself owns no drag state.
 *
 * It used to call `useDraggable`, which registers a node under its id whether
 * or not dragging is enabled — so the copy inside the drag preview overwrote
 * the registry entry of the very task being dragged, and, reading the same
 * `isDragging`, painted the preview at 25% opacity. `DraggableTaskChip`
 * supplies the drag props exactly the way `TaskBoard` does with `TaskCard`.
 */
function TaskChip({
    task,
    state,
    roomy = false,
    dragProps,
    isDragging = false,
    onClick,
}: {
    task: TaskSummary;
    state: TaskCalendarState;
    roomy?: boolean;
    dragProps?: ButtonHTMLAttributes<HTMLButtonElement> & { ref?: (node: HTMLElement | null) => void };
    isDragging?: boolean;
    onClick?: () => void;
}) {
    const { t, language } = useTranslation();
    const stateTone = STATE_TONES[state];
    const taskColor = task.color ? TASK_COLOR_META[task.color] : null;
    const tone = taskColor ? CALENDAR_TONES[taskColor.calendarToneIndex] : stateTone;
    const priority = PRIORITY_META[task.priority];
    const time = task.dueAt ? academyTimeOfDay(task.dueAt) : '';
    const due = task.dueAt ? formatBoardDateTime(task.dueAt, language) : t('noDueDate');

    return (
        <button
            {...dragProps}
            type="button"
            data-testid={`task-calendar-task-${task.id}`}
            data-task-color={task.color ?? 'none'}
            aria-haspopup="dialog"
            aria-label={[
                task.title,
                due,
                t(STATE_LABEL_KEYS[state]),
                t(priority.labelKey),
                taskColor ? t(taskColor.labelKey) : null,
            ].filter(Boolean).join('. ')}
            /* A month cell is too narrow to finish most titles, so the whole
               title stays reachable without opening the task. */
            title={task.title}
            onClick={onClick}
            className={cn(
                'w-full rounded-md border border-l-[3px] text-left transition-[box-shadow,transform] duration-150 ease-out',
                'hover:scale-[1.02] hover:shadow-md active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                roomy ? 'px-3 py-2.5' : 'px-1.5 py-1',
                dragProps && 'cursor-grab active:cursor-grabbing',
                isDragging && 'opacity-25',
            )}
            style={{
                backgroundColor: tone.background,
                borderColor: tone.border,
                borderLeftColor: stateTone.solid,
                color: tone.foreground,
            }}
        >
            <span className="flex items-center gap-1.5">
                <span className={cn('size-2 shrink-0 rounded-full', priority.dot)} aria-hidden="true" />
                {time ? (
                    <span className="flex items-center gap-1 text-xs font-semibold tabular-nums">
                        <Clock3 className="size-3" aria-hidden="true" />
                        {time}
                    </span>
                ) : null}
            </span>
            <span className={cn('block truncate font-medium', roomy ? 'mt-1 text-sm' : 'text-xs')}>
                {task.title}
            </span>
            {task.assignee ? (
                <span className={cn('block truncate opacity-90', roomy ? 'mt-0.5 text-xs' : 'text-xs')}>
                    {roomy ? task.assignee.fullName : getInitials(task.assignee.fullName)}
                </span>
            ) : null}
        </button>
    );
}

function DraggableTaskChip({
    task,
    state,
    roomy = false,
    onClick,
}: {
    task: TaskSummary;
    state: TaskCalendarState;
    roomy?: boolean;
    onClick: () => void;
}) {
    const suppressClickRef = useRef(false);
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: `calendar-task-${task.id}`,
        data: { taskId: task.id, dueAt: task.dueAt },
    });

    /* A drag ends with a click event on the same element; without this the
       detail sheet opened every time a task was dropped. */
    useEffect(() => {
        if (isDragging) {
            suppressClickRef.current = true;
            return undefined;
        }
        if (!suppressClickRef.current) return undefined;
        const timer = window.setTimeout(() => { suppressClickRef.current = false; }, 0);
        return () => window.clearTimeout(timer);
    }, [isDragging]);

    return (
        <TaskChip
            task={task}
            state={state}
            roomy={roomy}
            isDragging={isDragging}
            dragProps={{ ...attributes, ...listeners, ref: setNodeRef }}
            onClick={() => {
                if (!suppressClickRef.current) onClick();
            }}
        />
    );
}

export function TaskCalendar({ tasks, onTaskClick, onReschedule }: TaskCalendarProps) {
    const { t, language } = useTranslation();
    const locale = resolveLocale(language);
    const isCompactViewport = useIsCompactViewport();
    const scopeRef = useRef<HTMLDivElement>(null);

    const [view, setView] = useCalendarPreference<CalendarViewMode>(
        'taskCalendarView',
        VIEWS,
        isCompactViewport ? 'agenda' : 'month',
    );
    const [unscheduledPanel, setUnscheduledPanel] = useCalendarPreference(
        'taskCalendarUnscheduled',
        ['open', 'closed'] as const,
        'open',
    );

    /* A minute is fine enough for a deadline and keeps "overdue" honest without
       re-rendering the whole grid on every tick. */
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 60_000);
        return () => window.clearInterval(timer);
    }, []);

    const [calendarTasks, setCalendarTasks] = useState(tasks);
    const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
    const [hiddenStates, setHiddenStates] = useState<Set<TaskCalendarState>>(() => new Set());
    const [expandedDayKey, setExpandedDayKey] = useState<string | null>(null);
    const [clearDueTarget, setClearDueTarget] = useState<TaskSummary | null>(null);

    const latestTasksRef = useRef(tasks);
    const pendingMovesRef = useRef(new Map<number, OptimisticChange<string | null>>());
    const nextMoveTokenRef = useRef(0);
    latestTasksRef.current = tasks;

    useEffect(() => {
        setCalendarTasks(reconcileCalendarTasks(tasks, pendingMovesRef.current));
    }, [tasks]);

    const todayKey = academyDateInputValue(new Date(now));
    const [anchorKey, setAnchorKey] = useState(todayKey);

    const effectiveView: CalendarViewMode = isCompactViewport && view !== 'agenda' ? 'agenda' : view;

    const calendarDays = useMemo(
        () => (effectiveView === 'month' ? buildMonthDays(anchorKey) : buildWeekDays(anchorKey)),
        [anchorKey, effectiveView],
    );

    useEffect(() => { setExpandedDayKey(null); }, [anchorKey, effectiveView]);

    const scheduled = useMemo(
        () => calendarTasks.filter((task) => Boolean(task.dueAt)),
        [calendarTasks],
    );
    const unscheduled = useMemo(
        () => calendarTasks
            .filter((task) => !task.dueAt)
            .sort((left, right) => right.id - left.id),
        [calendarTasks],
    );

    const tasksByDate = useMemo(() => {
        const result = new Map<string, TaskSummary[]>();
        for (const task of scheduled) {
            const dateKey = academyDateInputValue(task.dueAt);
            if (!dateKey) continue;
            const dayTasks = result.get(dateKey) ?? [];
            dayTasks.push(task);
            result.set(dateKey, dayTasks);
        }
        for (const dayTasks of result.values()) {
            dayTasks.sort((left, right) => (
                new Date(left.dueAt ?? 0).getTime() - new Date(right.dueAt ?? 0).getTime()
            ));
        }
        return result;
    }, [scheduled]);

    const rangeKeys = useMemo(
        () => new Set(calendarDays.map((day) => day.dateKey)),
        [calendarDays],
    );
    const rangeTasks = useMemo(
        () => scheduled.filter((task) => rangeKeys.has(academyDateInputValue(task.dueAt))),
        [rangeKeys, scheduled],
    );

    const counts = useMemo(() => rangeTasks.reduce(
        (result, task) => {
            result[taskCalendarState(task, now)] += 1;
            return result;
        },
        { overdue: 0, planned: 0, finished: 0 },
    ), [now, rangeTasks]);

    const visibleTasksByDate = useMemo(() => {
        const result = new Map<string, TaskSummary[]>();
        for (const [dateKey, dayTasks] of tasksByDate) {
            result.set(dateKey, dayTasks.filter((task) => !hiddenStates.has(taskCalendarState(task, now))));
        }
        return result;
    }, [hiddenStates, now, tasksByDate]);
    const visibleTasksFor = (dateKey: string) => visibleTasksByDate.get(dateKey) ?? [];
    const visibleRangeCount = useMemo(
        () => rangeTasks.filter((task) => !hiddenStates.has(taskCalendarState(task, now))).length,
        [hiddenStates, now, rangeTasks],
    );

    const moveTask = useCallback((taskId: number, dueAt: string | null) => {
        const task = calendarTasks.find((item) => item.id === taskId);
        if (!task || task.dueAt === dueAt) return;

        const baseline = latestTasksRef.current.find((item) => item.id === taskId)?.dueAt ?? task.dueAt;
        const token = ++nextMoveTokenRef.current;
        pendingMovesRef.current.set(taskId, { token, value: dueAt, baselineValue: baseline });
        setCalendarTasks((current) => current.map(
            (item) => (item.id === taskId ? { ...item, dueAt } : item),
        ));

        const finishMove = (accepted: boolean) => {
            const change = finishOptimisticChange(pendingMovesRef.current, taskId, token);
            if (!change) return;
            const latest = latestTasksRef.current.find((item) => item.id === taskId);
            if (!accepted || incomingValueChangedSinceStart(latest, change, (item) => item.dueAt)) {
                setCalendarTasks(reconcileCalendarTasks(latestTasksRef.current, pendingMovesRef.current));
            }
        };

        Promise.resolve()
            .then(() => onReschedule(taskId, dueAt))
            .then(finishMove)
            .catch(() => finishMove(false));
    }, [calendarTasks, onReschedule]);

    const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
        useSensor(KeyboardSensor),
    );

    const handleDragStart = useCallback((event: DragStartEvent) => {
        setActiveTaskId(Number(event.active.data.current?.taskId));
    }, []);

    const handleDragEnd = useCallback((event: DragEndEvent) => {
        const taskId = Number(event.active.data.current?.taskId);
        setActiveTaskId(null);
        if (!Number.isFinite(taskId) || !event.over) return;

        if (event.over.id === UNSCHEDULED_DROP_ID) {
            /* Dropping a deadline is the one move on this screen that destroys
               something and cannot be undone from a toast, so it asks first.
               Scheduling — the common gesture — stays a single drag. */
            const task = latestTasksRef.current.find((item) => item.id === taskId);
            if (task?.dueAt) setClearDueTarget(task);
            return;
        }

        const dateKey = event.over.data.current?.dateKey as string | undefined;
        if (!dateKey) return;
        const previousDueAt = (event.active.data.current?.dueAt ?? null) as string | null;
        /* Dropped back onto the day it came from: comparing the day rather than
           the instant keeps a nudge from firing a request and a "moved"
           toast for a deadline that did not move. */
        if (previousDueAt && academyDateInputValue(previousDueAt) === dateKey) return;
        moveTask(taskId, dueAtForDay(dateKey, previousDueAt));
    }, [moveTask]);

    const shift = (direction: number) => {
        setAnchorKey((current) => (
            effectiveView === 'month'
                ? shiftMonthKey(current, direction)
                : shiftDayKey(current, direction * 7)
        ));
    };
    const goToday = () => setAnchorKey(todayKey);

    useCalendarShortcuts({
        onPrevious: () => shift(-1),
        onNext: () => shift(1),
        onToday: goToday,
        scopeRef,
    });

    const anchorDate = dateFromDayKey(anchorKey);
    const rangeLabel = effectiveView === 'month'
        ? new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
            .format(anchorDate)
        : `${new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })
            .format(calendarDays[0].date)} — ${new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
            .format(calendarDays[calendarDays.length - 1].date)}`;
    const atToday = effectiveView === 'month'
        ? anchorKey.slice(0, 7) === todayKey.slice(0, 7)
        : weekStartDayKey(anchorKey) === weekStartDayKey(todayKey);

    const dayNames = [
        t('mondayShort'), t('tuesdayShort'), t('wednesdayShort'), t('thursdayShort'),
        t('fridayShort'), t('saturdayShort'), t('sundayShort'),
    ];

    const toggleState = (state: TaskCalendarState) => {
        setHiddenStates((current) => {
            const next = new Set(current);
            if (next.has(state)) next.delete(state);
            else next.add(state);
            return next;
        });
    };

    const activeTask = activeTaskId === null
        ? null
        : calendarTasks.find((task) => task.id === activeTaskId) ?? null;
    const panelOpen = unscheduledPanel === 'open';

    return (
        /* Clipping is what lets the grid and the side panel scroll inside
           their own boxes, so the card needs a floor under its height —
           see TaskBoard and the app-shell scrolling rule. */
        <Card className="flex min-h-[32rem] flex-1 flex-col overflow-hidden border-border/70" ref={scopeRef}>
            <DndContext
                sensors={sensors}
                collisionDetection={collisionDetection}
                onDragStart={handleDragStart}
                onDragCancel={() => setActiveTaskId(null)}
                onDragEnd={handleDragEnd}
                accessibility={{
                    announcements: {
                        onDragStart: () => t('dragTaskToDayHint'),
                        onDragOver: () => t('dragTaskToDayHint'),
                        onDragEnd: () => t('dragTaskToDayHint'),
                        onDragCancel: () => t('dragTaskToDayHint'),
                    },
                }}
            >
                <CardHeader className="shrink-0 gap-3 border-b border-border/70 bg-muted/20 pb-4">
                    <CalendarNavigator
                        label={rangeLabel}
                        hint={t('taskCalendarHint')}
                        previousLabel={effectiveView === 'month' ? t('previousMonth') : t('previousWeek')}
                        nextLabel={effectiveView === 'month' ? t('nextMonth') : t('nextWeek')}
                        atToday={atToday}
                        onPrevious={() => shift(-1)}
                        onNext={() => shift(1)}
                        onToday={goToday}
                        views={isCompactViewport ? COMPACT_VIEWS : VIEWS}
                        view={effectiveView}
                        onViewChange={setView}
                        actions={(
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 gap-1.5 max-md:h-11"
                                aria-expanded={panelOpen}
                                /* Only points at the panel while it is mounted:
                                   a dangling `aria-controls` is a broken
                                   reference, not a hidden one. */
                                aria-controls={panelOpen ? UNSCHEDULED_DROP_ID : undefined}
                                onClick={() => setUnscheduledPanel(panelOpen ? 'closed' : 'open')}
                            >
                                <Inbox className="size-4" aria-hidden="true" />
                                {t('noDueDate')}
                                <span className="rounded-full bg-muted px-1.5 text-[10px] font-semibold tabular-nums">
                                    {unscheduled.length}
                                </span>
                            </Button>
                        )}
                    />

                    <div className="flex flex-wrap gap-1.5">
                        {STATES.map((state) => {
                            const active = !hiddenStates.has(state);
                            return (
                                <button
                                    key={state}
                                    type="button"
                                    data-testid={`task-calendar-filter-${state}`}
                                    aria-pressed={active}
                                    onClick={() => toggleState(state)}
                                    className={cn(
                                        'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                                        'max-md:min-h-11 max-md:px-4',
                                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                        active
                                            ? 'border-border bg-card text-foreground'
                                            : 'border-dashed border-border bg-transparent text-muted-foreground line-through',
                                    )}
                                >
                                    <span
                                        className="size-2 rounded-full"
                                        style={{ backgroundColor: STATE_TONES[state].solid }}
                                        aria-hidden="true"
                                    />
                                    {t(STATE_LABEL_KEYS[state])}
                                    <span className="tabular-nums opacity-70">{counts[state]}</span>
                                </button>
                            );
                        })}
                    </div>
                </CardHeader>

                <CardContent className="flex min-h-0 flex-1 flex-col gap-0 p-0 lg:flex-row">
                    <div className="relative min-h-0 flex-1 overflow-auto">
                        {visibleRangeCount === 0 ? (
                            /* The wash sits over the grid but must not swallow
                               the drop targets underneath it: an empty month is
                               precisely when a task gets dragged in from the
                               panel. Only the reset button takes clicks. */
                            <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-card/85 px-6 py-8 text-center backdrop-blur-[2px]">
                                <EmptyState
                                    icon={CalendarDays}
                                    className="py-0"
                                    title={hiddenStates.size > 0 ? t('taskCalendarHiddenByFilters') : t('taskCalendarEmpty')}
                                    description={hiddenStates.size > 0 ? t('taskCalendarHiddenByFiltersHint') : t('taskCalendarEmptyHint')}
                                    action={hiddenStates.size > 0 ? (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            className="pointer-events-auto min-h-11"
                                            onClick={() => setHiddenStates(new Set())}
                                        >
                                            {t('resetFilters')}
                                        </Button>
                                    ) : undefined}
                                />
                            </div>
                        ) : null}

                        {effectiveView === 'agenda' ? (
                            <div className="divide-y divide-border/60">
                                {calendarDays.map((day) => {
                                    const dayTasks = visibleTasksFor(day.dateKey);
                                    if (dayTasks.length === 0) return null;
                                    const dateLabel = new Intl.DateTimeFormat(locale, {
                                        weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
                                    }).format(day.date);

                                    return (
                                        <AgendaDay
                                            key={day.dateKey}
                                            dateKey={day.dateKey}
                                            label={dateLabel}
                                            isToday={day.dateKey === todayKey}
                                            tasks={dayTasks}
                                            now={now}
                                            onTaskClick={onTaskClick}
                                        />
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <div className={cn(effectiveView === 'month' ? 'min-w-[760px]' : 'min-w-[640px]')}>
                                    <div className="grid grid-cols-7 border-b bg-muted/30">
                                        {dayNames.map((dayName, index) => (
                                            <div
                                                key={`day-header-`}
                                                className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                                            >
                                                {dayName}
                                            </div>
                                        ))}
                                    </div>
                                    <div className="grid grid-cols-7">
                                        {calendarDays.map((day) => {
                                            const dayTasks = visibleTasksFor(day.dateKey);
                                            const isExpanded = expandedDayKey === day.dateKey;
                                            const shown = effectiveView === 'month' && !isExpanded
                                                ? dayTasks.slice(0, VISIBLE_PER_DAY)
                                                : dayTasks;

                                            return (
                                                <CalendarDayCell
                                                    key={day.dateKey}
                                                    dateKey={day.dateKey}
                                                    dayNumber={day.date.getUTCDate()}
                                                    label={new Intl.DateTimeFormat(locale, {
                                                        weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
                                                    }).format(day.date)}
                                                    isCurrentMonth={day.isCurrentMonth}
                                                    isToday={day.dateKey === todayKey}
                                                    compact={effectiveView === 'month'}
                                                    tasks={shown}
                                                    now={now}
                                                    onTaskClick={onTaskClick}
                                                    overflow={dayTasks.length - shown.length}
                                                    isExpanded={isExpanded}
                                                    canExpand={effectiveView === 'month' && dayTasks.length > VISIBLE_PER_DAY}
                                                    onToggleExpand={() => setExpandedDayKey(isExpanded ? null : day.dateKey)}
                                                />
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {panelOpen ? (
                        <UnscheduledPanel tasks={unscheduled} now={now} onTaskClick={onTaskClick} />
                    ) : null}
                </CardContent>

                <DragOverlayPortal
                    adjustScale={false}
                    dropAnimation={{ duration: 180, easing: 'ease-out' }}
                    style={{ zIndex: 90 }}
                >
                    {activeTask ? (
                        <div className="w-56 cursor-grabbing opacity-95 shadow-2xl">
                            <TaskChip
                                task={activeTask}
                                state={taskCalendarState(activeTask, now)}
                                roomy
                            />
                        </div>
                    ) : null}
                </DragOverlayPortal>
            </DndContext>

            <AlertDialog
                open={clearDueTarget !== null}
                onOpenChange={(open) => { if (!open) setClearDueTarget(null); }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('taskClearDueTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {clearDueTarget ? `«${clearDueTarget.title}». ` : ''}
                            {t('taskClearDueDescription')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                if (clearDueTarget) moveTask(clearDueTarget.id, null);
                                setClearDueTarget(null);
                            }}
                        >
                            {t('taskClearDueConfirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    );
}

function CalendarDayCell({
    dateKey,
    dayNumber,
    label,
    isCurrentMonth,
    isToday,
    compact,
    tasks,
    now,
    onTaskClick,
    overflow,
    isExpanded,
    canExpand,
    onToggleExpand,
}: {
    dateKey: string;
    dayNumber: number;
    label: string;
    isCurrentMonth: boolean;
    isToday: boolean;
    compact: boolean;
    tasks: TaskSummary[];
    now: number;
    onTaskClick: (taskId: number) => void;
    overflow: number;
    isExpanded: boolean;
    canExpand: boolean;
    onToggleExpand: () => void;
}) {
    const { t } = useTranslation();
    const { isOver, setNodeRef } = useDroppable({ id: `task-day-${dateKey}`, data: { dateKey } });

    return (
        <div
            ref={setNodeRef}
            /* A named `region` is a landmark, and a month grid would file 42 of
               them next to the page's own. `group` names the cell for a screen
               reader without entering the landmark list. */
            role="group"
            aria-label={label}
            className={cn(
                'flex flex-col gap-1 border-b border-r border-border/70 p-1.5 transition-colors [&:nth-child(7n)]:border-r-0',
                compact ? 'min-h-28' : 'min-h-40',
                !isCurrentMonth && 'bg-muted/20 text-muted-foreground',
                isToday && 'bg-primary/[0.05]',
                isOver && 'bg-primary/10 ring-2 ring-inset ring-primary/50',
            )}
        >
            <span
                className={cn(
                    'inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                    isToday && 'bg-primary text-primary-foreground',
                )}
            >
                {dayNumber}
            </span>
            <div id={`task-day-list-${dateKey}`} className="flex flex-col gap-1">
                {tasks.map((task) => (
                    <DraggableTaskChip
                        key={task.id}
                        task={task}
                        state={taskCalendarState(task, now)}
                        onClick={() => onTaskClick(task.id)}
                    />
                ))}
            </div>
            {canExpand ? (
                <button
                    type="button"
                    aria-expanded={isExpanded}
                    aria-controls={`task-day-list-${dateKey}`}
                    className="min-h-9 rounded px-1 py-0.5 text-left text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={onToggleExpand}
                >
                    {isExpanded ? t('collapseDay') : t('moreEventsCount').replace('{count}', String(overflow))}
                </button>
            ) : null}
        </div>
    );
}

function AgendaDay({
    dateKey,
    label,
    isToday,
    tasks,
    now,
    onTaskClick,
}: {
    dateKey: string;
    label: string;
    isToday: boolean;
    tasks: TaskSummary[];
    now: number;
    onTaskClick: (taskId: number) => void;
}) {
    const { isOver, setNodeRef } = useDroppable({ id: `task-day-${dateKey}`, data: { dateKey } });

    return (
        <section
            ref={setNodeRef}
            role="group"
            aria-label={label}
            className={cn('space-y-2 p-4 pt-3 transition-colors', isOver && 'bg-primary/10')}
        >
            <div className="flex items-center justify-between gap-3">
                <h4 className={cn('text-sm font-semibold capitalize', isToday && 'text-primary')}>{label}</h4>
                <span className="text-xs tabular-nums text-muted-foreground">{tasks.length}</span>
            </div>
            <div className="space-y-2">
                {tasks.map((task) => (
                    <DraggableTaskChip
                        key={task.id}
                        task={task}
                        state={taskCalendarState(task, now)}
                        roomy
                        onClick={() => onTaskClick(task.id)}
                    />
                ))}
            </div>
        </section>
    );
}

function UnscheduledPanel({
    tasks,
    now,
    onTaskClick,
}: {
    tasks: TaskSummary[];
    now: number;
    onTaskClick: (taskId: number) => void;
}) {
    const { t } = useTranslation();
    const { isOver, setNodeRef } = useDroppable({ id: UNSCHEDULED_DROP_ID });

    return (
        <aside
            ref={setNodeRef}
            id={UNSCHEDULED_DROP_ID}
            aria-label={t('taskUnscheduledPanel')}
            className={cn(
                'flex min-h-0 shrink-0 flex-col border-t border-border/70 transition-colors lg:w-72 lg:border-l lg:border-t-0',
                isOver && 'bg-primary/10',
            )}
        >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-3 py-2.5">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <Inbox className="size-4 text-muted-foreground" aria-hidden="true" />
                    {t('noDueDate')}
                </span>
                <span className="flex h-6 min-w-6 items-center justify-center rounded-full border border-border bg-background px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">
                    {tasks.length}
                </span>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-3 max-lg:max-h-64">
                {tasks.length === 0 ? (
                    <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                        {t('taskUnscheduledEmpty')}
                    </p>
                ) : (
                    <>
                        <p className="px-1 text-xs text-muted-foreground">{t('taskUnscheduledHint')}</p>
                        {tasks.map((task) => (
                            <DraggableTaskChip
                                key={task.id}
                                task={task}
                                state={taskCalendarState(task, now)}
                                roomy
                                onClick={() => onTaskClick(task.id)}
                            />
                        ))}
                    </>
                )}
            </div>
        </aside>
    );
}
