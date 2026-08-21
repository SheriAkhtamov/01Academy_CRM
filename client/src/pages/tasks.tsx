import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CalendarDays, Columns3, Plus, Users, type LucideIcon } from 'lucide-react';
import { PageHeader } from '@/components/ux/PageHeader';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TaskBoard } from '@/components/ux/board/TaskBoard';
import { TaskCalendar } from '@/components/ux/board/TaskCalendar';
import { CreateTaskDialog } from '@/components/ux/board/CreateTaskDialog';
import { TaskDetailSheet } from '@/components/ux/board/TaskDetailSheet';
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

    const { data, isLoading, isError, error, refetch, isFetching } = useQuery<BoardTasksResponse>({
        queryKey: boardQueryKeys.tasks,
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
            queryClient.invalidateQueries({ queryKey: boardQueryKeys.tasks });
            queryClient.invalidateQueries({ queryKey: [`/api/board/tasks/${taskId}`] });
            return true;
        } catch (error) {
            queryClient.invalidateQueries({ queryKey: boardQueryKeys.tasks });
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
            queryClient.invalidateQueries({ queryKey: boardQueryKeys.tasks });
            queryClient.invalidateQueries({ queryKey: [`/api/board/tasks/${taskId}`] });
            toast({ title: dueAt ? t('taskRescheduled') : t('taskDueDateCleared') });
            return true;
        } catch (error) {
            queryClient.invalidateQueries({ queryKey: boardQueryKeys.tasks });
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
        const canAcceptOrReopen = isTaskSupervisor || task.creator?.id === user?.id;
        if (status === 'accepted') return task.status === 'done' && canAcceptOrReopen;
        if (task.status === 'accepted') return canAcceptOrReopen;
        return true;
    };

    const openTask = (taskId: number) => {
        setSelectedTaskId(taskId);
        setDetailOpen(true);
    };

    return (
        <div className="flex h-full min-h-0 flex-col p-6 lg:p-8">
            <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col">
                <PageHeader
                    title={t('taskBoard')}
                    subtitle={t('taskBoardSubtitle')}
                    actions={
                        <>
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
                            <Button className="gap-1.5" onClick={() => setCreateOpen(true)}>
                                <Plus className="size-4" /> {t('addTask')}
                            </Button>
                        </>
                    }
                />

                {isLoading ? (
                    /* The placeholder has to be shaped like whatever is loading:
                       five column stubs where a calendar is about to appear read
                       as the wrong screen for the second it is up. */
                    taskView === 'calendar' ? (
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
                            {Array.from({ length: 5 }).map((_, i) => (
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
                        {taskView === 'calendar' ? (
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
