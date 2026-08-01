import { z } from 'zod';
import type { UseFormReturn } from 'react-hook-form';
import { Link } from 'wouter';
import { CheckCircle2, ClipboardList, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { LocalizedFormMessage } from '@/components/ux/lead/LocalizedFormMessage';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

export const taskSchema = z.object({
  title: z.string().trim().min(1, 'fillRequiredFields'),
  deadlineAt: z.string(),
  description: z.string(),
});

export type TaskFormValues = z.infer<typeof taskSchema>;

export interface LeadTaskRecord {
  id: number;
  title: string;
  description?: string | null;
  dueAt?: string | null;
  status: string;
}

interface LeadTasksTabProps {
  form: UseFormReturn<TaskFormValues>;
  tasks: LeadTaskRecord[];
  isCreating: boolean;
  isCompleting: boolean;
  onSubmit: (values: TaskFormValues) => void;
  onCompleteTask: (taskId: number) => void;
  dateTime: (value: string | null | undefined) => string;
}

const isOverdue = (task: LeadTaskRecord) => {
  if (task.status === 'done' || !task.dueAt) return false;
  const dueAt = new Date(task.dueAt).getTime();
  return Number.isFinite(dueAt) && dueAt < Date.now();
};

/** Open tasks first, then the nearest deadline, so the next action is on top. */
const sortTasks = (tasks: LeadTaskRecord[]) => [...tasks].sort((left, right) => {
  if ((left.status === 'done') !== (right.status === 'done')) {
    return left.status === 'done' ? 1 : -1;
  }
  const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.POSITIVE_INFINITY;
  const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.POSITIVE_INFINITY;
  return leftDue - rightDue;
});

export function LeadTasksTab({
  form,
  tasks,
  isCreating,
  isCompleting,
  onSubmit,
  onCompleteTask,
  dateTime,
}: LeadTasksTabProps) {
  const { t } = useTranslation();
  const sortedTasks = sortTasks(tasks);
  const openTasks = tasks.filter((task) => task.status !== 'done').length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">{t('leadTasks')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('leadTasksBoardHint')}</p>
        </div>
        <Button asChild type="button" variant="outline" size="sm" className="shrink-0 bg-background">
          <Link href="/tasks">
            <ExternalLink data-icon="inline-start" />
            {t('taskBoard')}
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>{t('newTask')}</CardTitle></CardHeader>
        <CardContent>
          <Form {...form}>
            <form className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={form.handleSubmit(onSubmit)}>
              <FormField
                control={form.control}
                name="title"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>{t('taskTitle')}</FormLabel>
                    <FormControl><Input {...field} aria-invalid={fieldState.invalid} /></FormControl>
                    <LocalizedFormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="deadlineAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('deadline')}</FormLabel>
                    <FormControl><Input {...field} type="datetime-local" /></FormControl>
                    <LocalizedFormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>{t('description')}</FormLabel>
                    <FormControl><Textarea {...field} rows={2} /></FormControl>
                    <LocalizedFormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end md:col-span-2">
                <Button type="submit" disabled={isCreating}>
                  <ClipboardList data-icon="inline-start" />
                  {isCreating ? t('saving') : t('createTask')}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {t('leadTasks')}
            {openTasks > 0 ? <Badge variant="secondary">{openTasks}</Badge> : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-0 divide-y divide-border">
          {sortedTasks.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">{t('noTasksAssigned')}</p>
          ) : (
            sortedTasks.map((task) => (
              <div
                key={task.id}
                className={cn(
                  'flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0',
                  task.status === 'done' && 'opacity-60',
                )}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{task.title}</p>
                  {task.description ? (
                    <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">{task.description}</p>
                  ) : null}
                  {task.dueAt ? (
                    <p className={cn('mt-1 text-xs', isOverdue(task) ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                      {t('deadline')} {dateTime(task.dueAt)}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                  <Badge variant={task.status === 'done' ? 'success' : isOverdue(task) ? 'destructive' : 'outline'}>
                    {task.status === 'done'
                      ? t('taskDone')
                      : isOverdue(task)
                        ? t('taskOverdue')
                        : t('taskInProgress')}
                  </Badge>
                  {task.status !== 'done' ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      disabled={isCompleting}
                      onClick={() => onCompleteTask(task.id)}
                    >
                      <CheckCircle2 data-icon="inline-start" />
                      {t('completeTask')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
