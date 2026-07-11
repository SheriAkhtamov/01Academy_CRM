import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    closestCorners,
    DndContext,
    DragOverlay,
    KeyboardSensor,
    PointerSensor,
    useDraggable,
    useDroppable,
    useSensor,
    useSensors,
    type DragEndEvent,
    type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from '@/hooks/useTranslation';
import {
    finishOptimisticChange,
    incomingValueChangedSinceStart,
    reconcileOptimisticItems,
    type OptimisticChange,
} from '@/lib/optimisticReconciliation';
import { cn } from '@/lib/utils';
import { TaskCard } from './TaskCard';
import { BOARD_COLUMNS, type BoardStatus, type TaskSummary } from '@/lib/boardTypes';

interface TaskBoardProps {
    tasks: TaskSummary[];
    onStatusChange: (taskId: number, status: BoardStatus) => Promise<boolean>;
    onTaskClick: (taskId: number) => void;
    canMoveTask?: (task: TaskSummary, status: BoardStatus) => boolean;
}

const reconcileBoardTasks = (
    incoming: TaskSummary[],
    pending: ReadonlyMap<number, OptimisticChange<BoardStatus>>,
) => reconcileOptimisticItems(
    incoming,
    pending,
    (task) => task.id,
    (task) => task.status,
    (task, status) => ({ ...task, status }),
);

function DraggableTaskCard({
    task,
    onClick,
}: {
    task: TaskSummary;
    onClick: () => void;
}) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: `task-${task.id}`,
        data: { taskId: task.id, status: task.status },
    });

    return (
        <div
            ref={setNodeRef}
            style={{ transform: CSS.Translate.toString(transform) }}
            className={cn('touch-none', isDragging && 'opacity-30')}
            {...attributes}
            {...listeners}
        >
            <TaskCard task={task} onClick={onClick} />
        </div>
    );
}

function TaskColumn({
    status,
    label,
    tasks,
    onTaskClick,
}: {
    status: BoardStatus;
    label: string;
    tasks: TaskSummary[];
    onTaskClick: (taskId: number) => void;
}) {
    const { t } = useTranslation();
    const { isOver, setNodeRef } = useDroppable({ id: `col-${status}`, data: { status } });

    return (
        <div
            ref={setNodeRef}
            className={cn(
                'flex h-[calc(100dvh-13rem)] min-h-[24rem] w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-muted/40 transition-[border-color,background-color,box-shadow]',
                isOver && 'border-primary bg-primary/5 shadow-md',
            )}
        >
            <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-muted/95 p-3.5 backdrop-blur-sm">
                <span className="truncate text-sm font-semibold text-foreground">{label}</span>
                <span className="flex h-6 min-w-6 items-center justify-center rounded-full border border-border bg-background px-1.5 text-xs font-semibold text-muted-foreground">
                    {tasks.length}
                </span>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3">
                {tasks.map((task) => (
                    <DraggableTaskCard key={task.id} task={task} onClick={() => onTaskClick(task.id)} />
                ))}
                {tasks.length === 0 ? (
                    <div className="flex min-h-40 flex-1 items-center justify-center rounded-lg border border-dashed border-border bg-background/40 px-4 text-center">
                        <p className="text-xs text-muted-foreground">{t('noTasks')}</p>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

export function TaskBoard({ tasks, onStatusChange, onTaskClick, canMoveTask }: TaskBoardProps) {
    const { t } = useTranslation();
    const [boardTasks, setBoardTasks] = useState(tasks);
    const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
    const latestTasksRef = useRef(tasks);
    const pendingMovesRef = useRef(new Map<number, OptimisticChange<BoardStatus>>());
    const nextMoveTokenRef = useRef(0);
    latestTasksRef.current = tasks;

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(KeyboardSensor),
    );

    useEffect(() => {
        setBoardTasks(reconcileBoardTasks(tasks, pendingMovesRef.current));
    }, [tasks]);

    const activeTask = activeTaskId === null ? null : boardTasks.find((task) => task.id === activeTaskId) ?? null;

    const moveTask = useCallback(
        (taskId: number, status: BoardStatus) => {
            const task = boardTasks.find((item) => item.id === taskId);
            if (!task || task.status === status) return;
            if (canMoveTask && !canMoveTask(task, status)) return;
            const baselineStatus = latestTasksRef.current.find((item) => item.id === taskId)?.status
                ?? task.status;
            const token = ++nextMoveTokenRef.current;
            pendingMovesRef.current.set(taskId, {
                token,
                value: status,
                baselineValue: baselineStatus,
            });

            setBoardTasks((current) => current.map((item) => (item.id === taskId ? { ...item, status } : item)));

            const finishMove = (accepted: boolean) => {
                const change = finishOptimisticChange(pendingMovesRef.current, taskId, token);
                if (!change) return;

                const latestTask = latestTasksRef.current.find((item) => item.id === taskId);
                if (!accepted || incomingValueChangedSinceStart(latestTask, change, (item) => item.status)) {
                    setBoardTasks(reconcileBoardTasks(latestTasksRef.current, pendingMovesRef.current));
                }
            };

            Promise.resolve()
                .then(() => onStatusChange(taskId, status))
                .then((ok) => {
                    finishMove(ok);
                })
                .catch(() => {
                    finishMove(false);
                });
        },
        [boardTasks, canMoveTask, onStatusChange],
    );

    const handleDragStart = useCallback((event: DragStartEvent) => {
        setActiveTaskId(Number(event.active.data.current?.taskId));
    }, []);

    const handleDragEnd = useCallback(
        (event: DragEndEvent) => {
            const taskId = Number(event.active.data.current?.taskId);
            const status = event.over?.data.current?.status as BoardStatus | undefined;
            setActiveTaskId(null);
            if (Number.isFinite(taskId) && status) {
                moveTask(taskId, status);
            }
        },
        [moveTask],
    );

    const columns = useMemo(
        () =>
            BOARD_COLUMNS.map((col) => ({
                ...col,
                tasks: boardTasks
                    .filter((task) => task.status === col.status)
                    .sort((a, b) => a.position - b.position || a.id - b.id),
            })),
        [boardTasks],
    );

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragCancel={() => setActiveTaskId(null)}
            onDragEnd={handleDragEnd}
            accessibility={{
                announcements: {
                    onDragStart: () => t('dragTaskHint'),
                    onDragOver: () => t('dragTaskHint'),
                    onDragEnd: () => t('dragTaskHint'),
                    onDragCancel: () => t('dragTaskHint'),
                },
            }}
        >
            <div className="-mx-1 min-w-0 max-w-full flex-1 overflow-x-auto overscroll-x-contain pb-2">
                <div className="flex min-h-full min-w-max items-stretch gap-4 px-1">
                    {columns.map((col) => (
                        <TaskColumn
                            key={col.status}
                            status={col.status}
                            label={t(col.labelKey)}
                            tasks={col.tasks}
                            onTaskClick={onTaskClick}
                        />
                    ))}
                </div>
            </div>
            <DragOverlay>
                {activeTask ? (
                    <div className="w-72 rotate-2">
                        <TaskCard task={activeTask} />
                    </div>
                ) : null}
            </DragOverlay>
        </DndContext>
    );
}
