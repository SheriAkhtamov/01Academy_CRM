import { type ButtonHTMLAttributes } from 'react';
import { Badge } from '@/components/ui/badge';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { CalendarClock, CheckCircle2, CheckSquare, MessageSquare, Paperclip, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { UnreadTaskCommentDot } from './UnreadTaskCommentDot';
import { TaskCardPeople } from './TaskCardPeople';
import {
    PRIORITY_META,
    TASK_COLOR_META,
    formatBoardDate,
    isOverdue,
    type TaskSummary,
} from '@/lib/boardTypes';

interface TaskCardProps {
    task: TaskSummary;
    onClick?: () => void;
    dragProps?: ButtonHTMLAttributes<HTMLButtonElement>;
}

export function TaskCard({ task, onClick, dragProps }: TaskCardProps) {
    const { t, language } = useTranslation();
    const priority = PRIORITY_META[task.priority];
    const taskColor = task.color ? TASK_COLOR_META[task.color] : null;
    const overdue = isOverdue(task);

    return (
        <button
            {...dragProps}
            type="button"
            onClick={onClick}
            className={cn(
                'group w-full rounded-lg border border-border/80 bg-card p-3 text-left shadow-2xs transition-[box-shadow,border-color] duration-200 hover:border-border hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                taskColor?.card,
                dragProps && 'cursor-grab active:cursor-grabbing',
            )}
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
                {task.status === 'done' && task.awaitingAcceptance ? (
                    <span role="img" aria-label={t('taskAwaitingAcceptance')} title={t('taskAwaitingAcceptance')} className="mt-1.5 size-2 shrink-0 rounded-full bg-red-500" />
                ) : null}
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary" className={cn('h-5 px-1.5 text-[10px] font-medium', priority.badge)}>
                    {t(priority.labelKey)}
                </Badge>
                {task.lead ? (
                    <Badge variant="outline" className="h-5 max-w-full gap-1 px-1.5 text-[10px] font-medium">
                        <UserRound className="size-3 shrink-0" />
                        <span className="truncate">{task.lead.contactName}</span>
                    </Badge>
                ) : null}
                {task.status === 'accepted' && task.acceptedAt ? (
                    <Badge
                        variant="outline"
                        title={`${t('taskAcceptedOn')} ${formatBoardDate(task.acceptedAt, language)}`}
                        className="h-5 gap-1 border-emerald-300 bg-emerald-50 px-1.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                    >
                        <CheckCircle2 className="size-3" />
                        {formatBoardDate(task.acceptedAt, language)}
                    </Badge>
                ) : task.dueAt ? (
                    <Badge
                        variant="outline"
                        className={cn(
                            'h-5 gap-1 px-1.5 text-[10px] font-medium',
                            overdue && 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400',
                        )}
                    >
                        <CalendarClock className="size-3" />
                        {formatBoardDate(task.dueAt, language)}
                    </Badge>
                ) : null}
            </div>

            <div className="mt-3 grid min-w-0 gap-2.5">
                {task.checklistTotal > 0 || task.commentCount > 0 || task.attachmentCount > 0 ? (
                    <div className="flex flex-wrap items-center gap-2.5 text-[11px] text-muted-foreground">
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
                                {(task.unreadCommentCount ?? 0) > 0 ? <UnreadTaskCommentDot /> : null}
                            </span>
                        ) : null}
                        {task.attachmentCount > 0 ? (
                            <span className="flex items-center gap-1">
                                <Paperclip className="size-3.5" />
                                {task.attachmentCount}
                            </span>
                        ) : null}
                    </div>
                ) : null}
                <TaskCardPeople creator={task.creator} assignee={task.assignee} />
            </div>
        </button>
    );
}
