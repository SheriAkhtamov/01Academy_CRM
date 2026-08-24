import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Archive, CalendarDays, Columns3, ListTodo, Plus, Users, type LucideIcon } from 'lucide-react';
import { PageHeader } from '@/components/ux/PageHeader';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TaskBoard } from '@/components/ux/board/TaskBoard';
import { TaskCalendar } from '@/components/ux/board/TaskCalendar';
import { CreateTaskDialog } from '@/components/ux/board/CreateTaskDialog';
import { TaskDetailSheet } from '@/components/ux/board/TaskDetailSheet';
import { TaskCard } from '@/components/ux/board/TaskCard';
import { boardApi, boardQueryKeys } from '@/features/board/api';
import { useCalendarPreference } from '@/hooks/useCalendarPreference';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { hasLeadershipAccess, type AcademyModule } from '@shared/academy';
import type { TranslationKey } from '@/lib/i18n';
import {
    TASK_OWNER_ALL,
    countTasksByOwner,
    filterTasksByOwner,
    type BoardStatus,
    type BoardTasksResponse,
    type TaskOwnerFilter,
    type UserMini,
} from '@/lib/boardTypes';

interface ApiUser {
    id: number;
    fullName: string;
    position: string | null;
    module: AcademyModule;
    isActive?: boolean;
}

// The viewer's own id is only known once the session resolves, so the filter
// keeps a stable sentinel instead of an id and translates it when it reads.
const OWNER_FILTER_SELF = 'me';

// The board answers "what is everyone working on", the calendar answers "what
// is due when" — two readings of the same tasks, so the choice is a view
// switch rather than a route, and it is remembered per person.
const TASK_VIEWS = ['board', 'calendar'] as const;
type TaskViewMode = (typeof TASK_VIEWS)[number];
type TaskListView = 'active' | 'archive';

const TASK_VIEW_META = {
    board: { labelKey: 'taskViewBoard', icon: Columns3 },
    calendar: { labelKey: 'taskViewCalendar', icon: CalendarDays },
} satisfies Record<TaskViewMode, { labelKey: TranslationKey; icon: LucideIcon }>;

function OwnerOption({ name, count }: { name: string; count: number }) {
    return (
        <span className="inline-flex items-center gap-2">
            <span className="truncate">{name}</span>
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                {count}
            </span>
        </span>
    );
}

export default function TasksPage() {
    const { t, language } = useTranslation();
    const { user } = useAuth();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const isTaskSupervisor = hasLeadershipAccess(user);

    const [createOpen, setCreateOpen] = useState(false);
    const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);
    const [ownerFilter, setOwnerFilter] = useState<string>(OWNER_FILTER_SELF);
    const [taskView, setTaskView] = useCalendarPreference<TaskViewMode>('taskSectionView', TASK_VIEWS, 'board');
    const [taskListView, setTaskListView] = useState<TaskListView>('active');
    const isArchiveView = taskListView === 'archive';

    const { data, isLoading, isError, error, refetch, isFetching } = useQuery<BoardTasksResponse>({
        queryKey: isArchiveView ? boardQueryKeys.archive : boardQueryKeys.tasks,
        queryFn: () => boardApi.listTasks<BoardTasksResponse>(isArchiveView),
    });

    const { data: usersData } = useQuery<ApiUser[]>({
        queryKey: ['/api/users'],
        enabled: Boolean(user),
    });

    const currentUser: UserMini | null = useMemo(() => (
        user
            ? { id: user.id, fullName: user.fullName, position: user.position, module: user.module }
            : null
    ), [user]);

    const users: UserMini[] = useMemo(
        () => (usersData ?? [])
            .filter((employee) => employee.isActive !== false)
            .map((employee) => ({
                id: employee.id,
                fullName: employee.fullName,
                position: employee.position,
                module: employee.module,
            })),
        [usersData],
    );

    const tasks = useMemo(() => data?.tasks ?? [], [data]);
    const taskCounts = useMemo(() => countTasksByOwner(tasks), [tasks]);

    const selectedOwner: TaskOwnerFilter = useMemo(() => {
        if (ownerFilter === TASK_OWNER_ALL) return TASK_OWNER_ALL;
        if (ownerFilter === OWNER_FILTER_SELF) return user?.id ?? TASK_OWNER_ALL;
        const employeeId = Number(ownerFilter);
        return Number.isSafeInteger(employeeId) ? employeeId : TASK_OWNER_ALL;
    }, [ownerFilter, user?.id]);

    const visibleTasks = useMemo(() => filterTasksByOwner(tasks, selectedOwner), [tasks, selectedOwner]);

    const ownerOptions = useMemo(() => {
        const options = new Map<number, UserMini>();
        // A head receives every task, so the whole roster is a fair offer — a
        // colleague with a zero next to their name simply has nothing open.
        // Everyone else only ever receives the tasks they take part in, so the
        // roster would be a list of names that all resolve to an empty board.
        if (isTaskSupervisor) {
            for (const employee of users) options.set(employee.id, employee);
        }
        // A deactivated employee drops out of /api/users while their open tasks
        // stay on the board, so whoever is still on a card stays selectable.
        for (const task of tasks) {
            for (const person of [task.assignee, task.creator]) {
                if (person) options.set(person.id, person);
            }
        }
        if (user) options.delete(user.id);
        return [...options.values()].sort((a, b) => a.fullName.localeCompare(b.fullName, language));
    }, [isTaskSupervisor, language, tasks, user, users]);

    // A colleague can leave the list between refetches — their last shared task
    // was deleted, or their account was closed. Fall back to the viewer's own
    // tasks rather than leaving the board filtered by an absent selection.
    useEffect(() => {
        if (isLoading || ownerFilter === OWNER_FILTER_SELF || ownerFilter === TASK_OWNER_ALL) return;
        if (!ownerOptions.some((option) => String(option.id) === ownerFilter)) {
            setOwnerFilter(OWNER_FILTER_SELF);
        }
    }, [isLoading, ownerFilter, ownerOptions]);

    const selectedOwnerName = useMemo(() => {
        if (ownerFilter === TASK_OWNER_ALL) return t('allEmployees');
        if (ownerFilter === OWNER_FILTER_SELF) return t('myTasks');
        return ownerOptions.find((option) => String(option.id) === ownerFilter)?.fullName ?? t('myTasks');
    }, [ownerFilter, ownerOptions, t]);

    const handleStatusChange = async (taskId: number, status: BoardStatus): Promise<boolean> => {
        try {
            await boardApi.updateTaskStatus(taskId, status);
            queryClient.invalidateQueries({ queryKey: boardQueryKeys.all });
            queryClient.invalidateQueries({ queryKey: [`/api/board/tasks/${taskId}`] });
            return true;
        } catch (error) {
            queryClient.invalidateQueries({ queryKey: boardQueryKeys.all });
            toast({
                title: t('taskUpdateFailed'),
                description: error instanceof Error ? error.message : t('errorOccurred'),
                variant: 'destructive',
            });
            return false;
        }
    };

    const handleReschedule = async (taskId: number, dueAt: string | null): Promise<boolean> => {
        try {
            await boardApi.updateTaskDueAt(taskId, dueAt);
            queryClient.invalidateQueries({ queryKey: boardQueryKeys.all });
            queryClient.invalidateQueries({ queryKey: [`/api/board/tasks/${taskId}`] });
            toast({ title: dueAt ? t('taskRescheduled') : t('taskDueDateCleared') });
            return true;
        } catch (error) {
            queryClient.invalidateQueries({ queryKey: boardQueryKeys.all });
            toast({
                title: t('taskUpdateFailed'),
                description: error instanceof Error ? error.message : t('errorOccurred'),
                variant: 'destructive',
            });
            return false;
        }
    };

    const canMoveTask = (task: BoardTasksResponse['tasks'][number], status: BoardStatus) => {
        if (task.status === status) return true;
        return task.status !== 'accepted' && status !== 'accepted';
    };

    const changeTaskListView = (nextView: TaskListView) => {
        setTaskListView(nextView);
        setDetailOpen(false);
        setSelectedTaskId(null);
    };

    const openTask = (taskId: number) => {
        setSelectedTaskId(taskId);
        setDetailOpen(true);
    };

    return (
        <div className="flex h-full min-h-0 flex-col p-4 sm:p-5 md:p-6 lg:p-8">
            <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col">
                <PageHeader
                    title={t('taskBoard')}
                    subtitle={t('taskBoardSubtitle')}
                    actions={
                        <>
                            <div
                                role="group"
                                aria-label={t('taskListMode')}
                                className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5"
                            >
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    data-testid="task-list-active"
                                    aria-pressed={!isArchiveView}
                                    className={cn(
                                        'h-8 gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-card/70 max-md:h-11 max-md:px-3.5',
                                        !isArchiveView && 'bg-card text-foreground shadow-2xs hover:bg-card',
                                    )}
                                    onClick={() => changeTaskListView('active')}
                                >
                                    <ListTodo className="size-4" aria-hidden="true" />
                                    {t('activeTasks')}
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    data-testid="task-list-archive"
                                    aria-pressed={isArchiveView}
                                    className={cn(
                                        'h-8 gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-card/70 max-md:h-11 max-md:px-3.5',
                                        isArchiveView && 'bg-card text-foreground shadow-2xs hover:bg-card',
                                    )}
                                    onClick={() => changeTaskListView('archive')}
                                >
                                    <Archive className="size-4" aria-hidden="true" />
                                    {t('taskArchive')}
                                </Button>
                            </div>
                            {!isArchiveView ? (
                                <div
                                    role="group"
                                    aria-label={t('taskViewMode')}
                                    className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5"
                                >
                                    {TASK_VIEWS.map((mode) => {
                                        const { labelKey, icon: Icon } = TASK_VIEW_META[mode];
                                        return (
                                            <Button
                                                key={mode}
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                data-testid={`task-view-${mode}`}
                                                aria-pressed={mode === taskView}
                                                className={cn(
                                                    'h-8 gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-card/70 max-md:h-11 max-md:px-3.5',
                                                    mode === taskView && 'bg-card text-foreground shadow-2xs hover:bg-card',
                                                )}
                                                onClick={() => setTaskView(mode)}
                                            >
                                                <Icon className="size-4" aria-hidden="true" />
                                                {t(labelKey)}
                                            </Button>
                                        );
                                    })}
                                </div>
                            ) : null}
                            <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                                <SelectTrigger className="w-full sm:w-60" aria-label={t('taskOwnerFilter')}>
                                    <SelectValue>
                                        <span className="inline-flex items-center gap-2">
                                            <Users className="size-4 shrink-0 opacity-60" />
                                            <span className="truncate">{selectedOwnerName}</span>
                                        </span>
                                    </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={OWNER_FILTER_SELF} textValue={t('myTasks')}>
                                        <OwnerOption
                                            name={t('myTasks')}
                                            count={user ? taskCounts.get(user.id) ?? 0 : 0}
                                        />
                                    </SelectItem>
                                    {isTaskSupervisor ? (
                                        <SelectItem value={TASK_OWNER_ALL} textValue={t('allEmployees')}>
                                            <OwnerOption name={t('allEmployees')} count={tasks.length} />
                                        </SelectItem>
                                    ) : null}
                                    {ownerOptions.map((option) => (
                                        <SelectItem
                                            key={option.id}
                                            value={String(option.id)}
                                            textValue={option.fullName}
                                        >
                                            <OwnerOption
                                                name={option.fullName}
                                                count={taskCounts.get(option.id) ?? 0}
                                            />
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {!isArchiveView ? (
                                <Button className="gap-1.5" onClick={() => setCreateOpen(true)}>
                                    <Plus className="size-4" /> {t('addTask')}
                                </Button>
                            ) : null}
                        </>
                    }
                />

                {isLoading ? (
                    /* The placeholder has to be shaped like whatever is loading:
                       four column stubs where a calendar is about to appear read
                       as the wrong screen for the second it is up. */
                    isArchiveView ? (
                        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                            {Array.from({ length: 8 }).map((_, i) => (
                                <Skeleton key={i} className="h-32 w-full rounded-lg" />
                            ))}
                        </div>
                    ) : taskView === 'calendar' ? (
                        <div className="mt-2 space-y-3">
                            <Skeleton className="h-12 w-full rounded-xl" />
                            <div className="grid grid-cols-7 gap-2">
                                {Array.from({ length: 21 }).map((_, i) => (
                                    <Skeleton key={i} className="h-24 w-full rounded-lg" />
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="mt-2 flex gap-4 overflow-hidden">
                            {Array.from({ length: 4 }).map((_, i) => (
                                <div key={i} className="w-80 shrink-0 space-y-3">
                                    <Skeleton className="h-10 w-full rounded-xl" />
                                    <Skeleton className="h-24 w-full rounded-lg" />
                                    <Skeleton className="h-24 w-full rounded-lg" />
                                </div>
                            ))}
                        </div>
                    )
                ) : isError ? (
                    <Alert variant="destructive" className="mt-4">
                        <AlertCircle />
                        <AlertTitle>{t('failedToLoadData')}</AlertTitle>
                        <AlertDescription className="flex flex-col items-start gap-3">
                            <span>{error instanceof Error ? error.message : t('errorOccurred')}</span>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => refetch()}
                                disabled={isFetching}
                            >
                                {isFetching ? t('loading') : t('retry')}
                            </Button>
                        </AlertDescription>
                    </Alert>
                ) : (
                    <div className="mt-2 flex min-h-0 flex-1 flex-col">
                        {isArchiveView ? (
                            <section
                                aria-label={t('taskArchive')}
                                className="flex min-h-[30rem] flex-1 flex-col overflow-hidden rounded-xl border border-border bg-muted/20"
                            >
                                <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
                                    <div className="flex min-w-0 items-center gap-3">
                                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                            <Archive className="size-4" aria-hidden="true" />
                                        </div>
                                        <div className="min-w-0">
                                            <h2 className="text-sm font-semibold text-foreground">{t('taskArchive')}</h2>
                                            <p className="truncate text-xs text-muted-foreground">{t('taskArchiveDescription')}</p>
                                        </div>
                                    </div>
                                    <span className="rounded-full bg-muted px-2 py-1 text-xs font-semibold tabular-nums text-muted-foreground">
                                        {visibleTasks.length}
                                    </span>
                                </div>
                                <div className="min-h-0 flex-1 overflow-y-auto p-4 [scrollbar-gutter:stable]">
                                    {visibleTasks.length > 0 ? (
                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                                            {visibleTasks.map((task) => (
                                                <TaskCard key={task.id} task={task} onClick={() => openTask(task.id)} />
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card/60 p-6 text-center">
                                            <Archive className="size-8 text-muted-foreground/50" aria-hidden="true" />
                                            <p className="text-sm font-medium text-foreground">{t('taskArchiveEmpty')}</p>
                                            <p className="max-w-sm text-xs text-muted-foreground">{t('taskArchiveEmptyDescription')}</p>
                                        </div>
                                    )}
                                </div>
                            </section>
                        ) : taskView === 'calendar' ? (
                            <TaskCalendar
                                tasks={visibleTasks}
                                onTaskClick={openTask}
                                onReschedule={handleReschedule}
                            />
                        ) : (
                            <TaskBoard
                                tasks={visibleTasks}
                                onStatusChange={handleStatusChange}
                                onTaskClick={openTask}
                                canMoveTask={canMoveTask}
                            />
                        )}
                    </div>
                )}
            </div>

            <CreateTaskDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                users={users}
                currentUser={currentUser}
                canAssignUsers
            />
            <TaskDetailSheet taskId={selectedTaskId} open={detailOpen} onOpenChange={setDetailOpen} users={users} />
        </div>
    );
}
