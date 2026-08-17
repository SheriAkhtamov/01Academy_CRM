import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
    closestCorners,
    DndContext,
    KeyboardSensor,
    MouseSensor,
    TouchSensor,
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
import { useTranslation } from '@/hooks/useTranslation';
import {
    finishOptimisticChange,
    incomingValueChangedSinceStart,
    reconcileOptimisticItems,
    type OptimisticChange,
} from '@/lib/optimisticReconciliation';
import { cn } from '@/lib/utils';
import { SPRING, TRANSITION } from '@/lib/motion';
import { TaskCard } from './TaskCard';
import { DragOverlayPortal } from '@/components/ux/DragOverlayPortal';
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
    const suppressClickRef = useRef(false);
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: `task-${task.id}`,
        data: { taskId: task.id, status: task.status },
    });

    useEffect(() => {
        if (isDragging) {
            suppressClickRef.current = true;
            return undefined;
        }
        if (!suppressClickRef.current) return undefined;

        const timer = window.setTimeout(() => {
            suppressClickRef.current = false;
        }, 0);
        return () => window.clearTimeout(timer);
    }, [isDragging]);

    return (
        // Mirrors the lead kanban: `layout` glides a dropped task into its new
        // slot and slides its neighbours aside, and the exit variant keeps a
        // completed task from simply blinking out of the column.
        <motion.div
            ref={setNodeRef}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, transition: TRANSITION.exit }}
            transition={SPRING.layout}
            className={cn(isDragging && 'opacity-25')}
        >
            <TaskCard
                task={task}
                dragProps={{ ...attributes, ...listeners }}
                onClick={() => {
                    if (!suppressClickRef.current) onClick();
                }}
            />
        </motion.div>
    );
}

function TaskColumn({
    status,
    label,
    tasks,
    onTaskClick,
    canDrop,
}: {
    status: BoardStatus;
    label: string;
    tasks: TaskSummary[];
    onTaskClick: (taskId: number) => void;
    canDrop: boolean;
}) {
    const { t } = useTranslation();
    const { isOver, setNodeRef } = useDroppable({
        id: `col-${status}`,
        data: { status },
        disabled: !canDrop,
    });

    return (
        <div
            ref={setNodeRef}
            role="region"
            aria-label={label}
            className={cn(
                'flex h-full min-h-0 w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-muted/40 transition-all duration-200 ease-out-expo',
                isOver && 'border-primary bg-primary/5 shadow-xl ring-2 ring-primary/50 scale-[1.015]',
                !canDrop && 'opacity-60',
            )}
        >
            <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-muted/95 p-3.5 backdrop-blur-sm">
                <span className="truncate text-sm font-semibold text-foreground">{label}</span>
                <span className="flex h-6 min-w-6 items-center justify-center rounded-full border border-border bg-background px-1.5 text-xs font-semibold text-muted-foreground">
                    {tasks.length}
                </span>
            </div>

            <div
                data-task-column-scroll
                className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-x-hidden overflow-y-auto overscroll-y-contain p-3 [scrollbar-gutter:stable]"
            >
                <AnimatePresence initial={false}>
                    {tasks.map((task) => (
                        <DraggableTaskCard key={task.id} task={task} onClick={() => onTaskClick(task.id)} />
                    ))}
                </AnimatePresence>
                {tasks.length === 0 ? (
                    <div className="flex min-h-40 flex-1 items-center justify-center rounded-lg border border-dashed border-border bg-background/40 px-4 text-center">
                        <p className="text-xs text-muted-foreground">{t('noTasks')}</p>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

const columnCollisionDetection: CollisionDetection = (args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) return pointerCollisions;

    const intersectingColumns = rectIntersection(args);
    return intersectingColumns.length > 0 ? intersectingColumns : closestCorners(args);
};

export function TaskBoard({ tasks, onStatusChange, onTaskClick, canMoveTask }: TaskBoardProps) {
    const { t } = useTranslation();
    const [boardTasks, setBoardTasks] = useState(tasks);
    const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
    const latestTasksRef = useRef(tasks);
    const pendingMovesRef = useRef(new Map<number, OptimisticChange<BoardStatus>>());
    const nextMoveTokenRef = useRef(0);
    latestTasksRef.current = tasks;

    const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
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

    /* Same floor as the lead board: clipping is required for the columns to
       scroll inside themselves, so the box must never be squeezed smaller
       than a usable column. See KanbanBoard. */
    return (
        <div
            className="flex min-h-[26rem] flex-1 flex-col overflow-hidden"
            style={{ contain: 'layout paint' }}
        >
            <DndContext
                sensors={sensors}
                collisionDetection={columnCollisionDetection}
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
                <div className="min-h-0 min-w-0 max-w-full flex-1 overflow-x-auto overflow-y-hidden overscroll-contain pb-2">
                    <div className="flex h-full min-w-max items-stretch gap-4 px-1">
                        {columns.map((col) => (
                            <TaskColumn
                                key={col.status}
                                status={col.status}
                                label={t(col.labelKey)}
                                tasks={col.tasks}
                                onTaskClick={onTaskClick}
                                canDrop={!activeTask || !canMoveTask || canMoveTask(activeTask, col.status)}
                            />
                        ))}
                    </div>
                </div>
                <DragOverlayPortal
                    adjustScale={false}
                    dropAnimation={{ duration: 180, easing: 'ease-out' }}
                    style={{ zIndex: 90 }}
                >
                    {activeTask ? (
                        <motion.div
                            initial={{ scale: 1, rotate: 0 }}
                            animate={{ scale: 1.04, rotate: -2 }}
                            transition={SPRING.bouncy}
                            className="w-[296px] cursor-grabbing opacity-95 shadow-2xl"
                        >
                            <TaskCard task={activeTask} />
                        </motion.div>
                    ) : null}
                </DragOverlayPortal>
            </DndContext>
        </div>
    );
}
