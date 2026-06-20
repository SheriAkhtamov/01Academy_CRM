import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { CalendarClock, CheckSquare, MessageSquare, Paperclip } from 'lucide-react';
import { getInitials } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import {
    PRIORITY_META,
    formatBoardDate,
    isOverdue,
    type TaskSummary,
} from '@/lib/boardTypes';

interface TaskCardProps {
    task: TaskSummary;
    onClick?: () => void;
    dragHandleProps?: React.HTMLAttributes<HTMLElement>;
}

export function TaskCard({ task, onClick }: TaskCardProps) {
    const { t } = useTranslation();
    const priority = PRIORITY_META[task.priority];
    const overdue = isOverdue(task);

    return (
        <button
            type="button"
            onClick={onClick}
            className="group w-full rounded-lg border border-border/80 bg-card p-3 text-left shadow-2xs transition-[box-shadow,border-color] duration-200 hover:border-border hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
            <div className="flex items-start gap-2">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', priority.dot)} />
                    </TooltipTrigger>
                    <TooltipContent side="top">{t(priority.labelKey)}</TooltipContent>
                </Tooltip>
                <span className="min-w-0 flex-1 text-sm font-medium leading-snug text-foreground line-clamp-3">
                    {task.title}
                </span>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary" className={cn('h-5 px-1.5 text-[10px] font-medium', priority.badge)}>
                    {t(priority.labelKey)}
                </Badge>
                {task.dueAt ? (
                    <Badge
                        variant="outline"
                        className={cn(
                            'h-5 gap-1 px-1.5 text-[10px] font-medium',
                            overdue && 'border-red-300 bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400',
                        )}
                    >
                        <CalendarClock className="size-3" />
                        {formatBoardDate(task.dueAt)}
                    </Badge>
                ) : null}
            </div>

            <div className="mt-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground">
                    {task.checklistTotal > 0 ? (
                        <span className="flex items-center gap-1">
                            <CheckSquare className="size-3.5" />
                            {task.checklistDone}/{task.checklistTotal}
                        </span>
                    ) : null}
                    {task.commentCount > 0 ? (
                        <span className="flex items-center gap-1">
                            <MessageSquare className="size-3.5" />
                            {task.commentCount}
                        </span>
                    ) : null}
                    {task.attachmentCount > 0 ? (
                        <span className="flex items-center gap-1">
                            <Paperclip className="size-3.5" />
                            {task.attachmentCount}
                        </span>
                    ) : null}
                </div>

                {task.assignee ? (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Avatar className="size-6 border border-border">
                                <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
                                    {getInitials(task.assignee.fullName)}
                                </AvatarFallback>
                            </Avatar>
                        </TooltipTrigger>
                        <TooltipContent side="top">{task.assignee.fullName}</TooltipContent>
                    </Tooltip>
                ) : (
                    <span className="text-[10px] text-muted-foreground/60">{t('unassigned')}</span>
                )}
            </div>
        </button>
    );
}
