import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/ux/PageHeader';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TaskBoard } from '@/components/ux/board/TaskBoard';
import { CreateTaskDialog } from '@/components/ux/board/CreateTaskDialog';
import { TaskDetailSheet } from '@/components/ux/board/TaskDetailSheet';
import { apiRequest } from '@/lib/queryClient';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { hasLeadershipAccess } from '@shared/academy';
import type { BoardStatus, BoardTasksResponse, UserMini } from '@/lib/boardTypes';

interface ApiUser {
    id: number;
    fullName: string;
    position: string | null;
    workspace: string;
    isActive?: boolean;
}

export default function TasksPage() {
    const { t } = useTranslation();
    const { user } = useAuth();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const isTaskSupervisor = hasLeadershipAccess(user);

    const [createOpen, setCreateOpen] = useState(false);
    const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);

    const { data, isLoading } = useQuery<BoardTasksResponse>({
        queryKey: ['/api/board/tasks'],
    });

    const { data: usersData } = useQuery<ApiUser[]>({
        queryKey: ['/api/users'],
        enabled: Boolean(user),
    });

    const currentUser: UserMini | null = useMemo(() => (
        user
            ? { id: user.id, fullName: user.fullName, position: user.position, workspace: user.workspace }
            : null
    ), [user]);

    const users: UserMini[] = useMemo(
        () => (usersData ?? [])
            .filter((employee) => employee.isActive !== false)
            .map((employee) => ({
                id: employee.id,
                fullName: employee.fullName,
                position: employee.position,
                workspace: employee.workspace,
            })),
        [usersData],
    );

    const handleStatusChange = async (taskId: number, status: BoardStatus): Promise<boolean> => {
        try {
            await apiRequest('PATCH', `/api/board/tasks/${taskId}/status`, { status });
            queryClient.invalidateQueries({ queryKey: ['/api/board/tasks'] });
            queryClient.invalidateQueries({ queryKey: [`/api/board/tasks/${taskId}`] });
            return true;
        } catch (error) {
            queryClient.invalidateQueries({ queryKey: ['/api/board/tasks'] });
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
        <div className="flex h-full flex-col p-6 lg:p-8">
            <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col">
                <PageHeader
                    title={t('taskBoard')}
                    subtitle={t('taskBoardSubtitle')}
                    actions={
                        <Button className="gap-1.5" onClick={() => setCreateOpen(true)}>
                            <Plus className="size-4" /> {t('addTask')}
                        </Button>
                    }
                />

                {isLoading ? (
                    <div className="mt-2 flex gap-4 overflow-hidden">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="w-80 shrink-0 space-y-3">
                                <Skeleton className="h-10 w-full rounded-xl" />
                                <Skeleton className="h-24 w-full rounded-lg" />
                                <Skeleton className="h-24 w-full rounded-lg" />
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="mt-2 flex min-h-0 flex-1 flex-col">
                        <TaskBoard
                            tasks={data?.tasks ?? []}
                            onStatusChange={handleStatusChange}
                            onTaskClick={openTask}
                            canMoveTask={canMoveTask}
                        />
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
