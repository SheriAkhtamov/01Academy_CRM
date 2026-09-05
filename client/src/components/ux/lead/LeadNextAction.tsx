import { ArrowRight, CalendarClock, ClipboardList, UserRound, Users } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface LeadNextActionProps {
  tasks: Array<{ id: number; title: string; status: string; dueAt?: string | null }>;
  hasContact: boolean;
  hasStudents: boolean;
  dateTime: (value: string | null | undefined) => string;
  onContact: () => void;
  onStudent: () => void;
  onTask: () => void;
  onViewTasks: () => void;
}

export function LeadNextAction({
  tasks, hasContact, hasStudents, dateTime, onContact, onStudent, onTask, onViewTasks,
}: LeadNextActionProps) {
  const { t } = useTranslation();
  const deadline = (value?: string | null) => {
    const timestamp = value ? new Date(value).getTime() : NaN;
    return Number.isFinite(timestamp) ? timestamp : Infinity;
  };
  const nextTask = tasks.filter((task) => task.status !== 'done' && task.status !== 'accepted')
    .sort((a, b) => deadline(a.dueAt) - deadline(b.dueAt))[0];
  const overdue = nextTask && deadline(nextTask.dueAt) < Date.now();
  const Icon = nextTask ? ClipboardList : !hasContact ? UserRound : !hasStudents ? Users : CalendarClock;
  const title = nextTask?.title ?? (!hasContact ? t('leadWorkspaceAddContact')
    : !hasStudents ? t('leadWorkspaceAddStudent') : t('leadWorkspaceNoTask'));
  const hint = nextTask
    ? Number.isFinite(deadline(nextTask.dueAt)) ? dateTime(nextTask.dueAt) : t('leadWorkspaceNoDeadline')
    : !hasContact ? t('leadWorkspaceAddContactHint')
      : !hasStudents ? t('leadWorkspaceAddStudentHint') : t('leadWorkspaceNoTaskHint');
  const action = nextTask ? onViewTasks : !hasContact ? onContact : !hasStudents ? onStudent : onTask;
  const actionLabel = nextTask ? t('leadWorkspaceOpenTask') : !hasContact ? t('leadWorkspaceContacts')
    : !hasStudents ? t('createStudent') : t('createTask');

  return (
    <Card className={cn('border-primary/20 bg-primary/5 shadow-none', overdue && 'border-destructive/25 bg-destructive/5')}>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className={cn('hidden size-10 shrink-0 items-center justify-center rounded-xl bg-background text-primary sm:flex', overdue && 'text-destructive')}>
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <p className="text-xs font-medium text-foreground/80">{t('leadWorkspaceNextStep')}</p>
            {overdue ? <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-red-700 dark:text-red-300">{t('taskOverdue')}</Badge> : null}
          </div>
          <p className="break-words text-sm font-semibold">{title}</p>
          <p className="mt-1 text-xs leading-relaxed text-foreground/80">{hint}</p>
        </div>
        <Button type="button" variant="outline" size="sm" className="shrink-0 self-start bg-background sm:self-center" onClick={action}>
          {actionLabel}
          <ArrowRight data-icon="inline-end" />
        </Button>
      </CardContent>
    </Card>
  );
}
