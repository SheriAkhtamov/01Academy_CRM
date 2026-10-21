import { useTranslation } from '@/hooks/useTranslation';
import type { TaskSummary } from '@/lib/boardTypes';
import { cn } from '@/lib/utils';
import { BoardUserAvatar } from './BoardUserAvatar';
import { EmployeeCardTrigger } from '@/features/employees/EmployeeCardTrigger';

interface TaskCardPeopleProps extends Pick<TaskSummary, 'creator' | 'assignee'> {
    className?: string;
    miniMode?: boolean;
}

export function TaskCardPeople({ creator, assignee, className, miniMode = false }: TaskCardPeopleProps) {
    const { t } = useTranslation();
    const people = [
        { role: t('creatorLabel'), user: creator, name: creator?.fullName.trim() || t('taskCreatorUnknown') },
        { role: t('assigneeLabel'), user: assignee, name: assignee?.fullName.trim() || t(assignee ? 'unknown' : 'unassigned') },
    ];

    return (
        <span className={cn('grid min-w-0 gap-1.5', miniMode && 'mini-task-people', className)}>
            {people.map(({ role, user, name }, index) => (
                <EmployeeCardTrigger userId={user?.id} name={name} interactive={!miniMode}
                    key={index}
                    className={cn(
                        'grid min-w-0 grid-cols-[1.5rem_5.5rem_minmax(0,1fr)] items-center gap-x-2 leading-tight',
                        miniMode ? 'text-xs' : 'text-[11px]',
                    )}
                >
                    <BoardUserAvatar user={user} miniMode={miniMode} />
                    <span className="text-muted-foreground">{role}:</span>
                    <span className="min-w-0 truncate font-medium text-foreground">{name}</span>
                </EmployeeCardTrigger>
            ))}
        </span>
    );
}
