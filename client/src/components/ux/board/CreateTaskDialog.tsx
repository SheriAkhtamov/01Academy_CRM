import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { apiRequest } from '@/lib/queryClient';
import { boardQueryKeys } from '@/features/board/api';
import { academyInstant, academyToday } from '@/lib/localeFormat';
import type { TranslationKey } from '@/lib/i18n';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { TaskColorPicker } from './TaskColorPicker';
import { PRIORITY_ORDER, type BoardPriority, type BoardTaskColor, type UserMini } from '@/lib/boardTypes';

interface CreateTaskDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    users: UserMini[];
    currentUser: UserMini | null;
    canAssignUsers: boolean;
}

const UNASSIGNED = 'unassigned';

const dueInputToInstant = (value: string): string | null => {
    const [dateKey, timePart] = value.split('T');
    if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
    const instant = academyInstant(dateKey, (timePart ?? '').slice(0, 5) || '00:00');
    return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
};

export function CreateTaskDialog({ open, onOpenChange, users, currentUser, canAssignUsers }: CreateTaskDialogProps) {
    const { t } = useTranslation();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const defaultAssigneeId = currentUser ? String(currentUser.id) : UNASSIGNED;
    const assignableUsers = useMemo(() => (
        canAssignUsers
            ? users
            : currentUser
                ? [currentUser]
                : []
    ), [canAssignUsers, currentUser, users]);

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [priority, setPriority] = useState<BoardPriority>('normal');
    const [color, setColor] = useState<BoardTaskColor | null>(null);
    const [assigneeId, setAssigneeId] = useState<string>(defaultAssigneeId);
    const [dueAt, setDueAt] = useState('');

    const reset = () => {
        setTitle('');
        setDescription('');
        setPriority('normal');
        setColor(null);
        setAssigneeId(defaultAssigneeId);
        setDueAt('');
    };

    useEffect(() => {
        if (open) {
            setAssigneeId(defaultAssigneeId);
        }
    }, [defaultAssigneeId, open]);

    const mutation = useMutation({
        mutationFn: () =>
            apiRequest('POST', '/api/board/tasks', {
                title: title.trim(),
                description: description.trim() || null,
                priority,
                color,
                assigneeId: canAssignUsers
                    ? assigneeId === UNASSIGNED ? null : Number(assigneeId)
                    : currentUser?.id ?? null,
                dueAt: dueAt ? dueInputToInstant(dueAt) : null,
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: boardQueryKeys.all });
            toast({ title: t('taskCreated') });
            reset();
            onOpenChange(false);
        },
        onError: (error: Error) => {
            toast({ title: error.message, variant: 'destructive' });
        },
    });

    const handleSubmit = (event?: React.FormEvent) => {
        event?.preventDefault();
        if (mutation.isPending) return;
        if (!title.trim()) {
            toast({ title: t('titleRequired'), variant: 'destructive' });
            return;
        }
        if (dueAt && dueAt.slice(0, 10) < academyToday()) {
            toast({ title: t('taskDueDateInPast' as TranslationKey), variant: 'destructive' });
            return;
        }
        mutation.mutate();
    };

    const handleOpenChange = (next: boolean) => {
        // Never drop the draft while the create request is still in flight —
        // Esc/overlay clicks would otherwise close the dialog mid-submit.
        if (!next && mutation.isPending) return;
        if (!next) reset();
        onOpenChange(next);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-lg flex-col gap-0 overflow-hidden p-0">
                <DialogHeader className="shrink-0 border-b px-6 py-4">
                    <DialogTitle>{t('addTask')}</DialogTitle>
                    <DialogDescription className="sr-only">{t('addTask')}</DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-6 py-4">
                    <div className="space-y-1.5">
                        <Label htmlFor="create-task-title" className="text-xs text-muted-foreground">{t('taskTitle')} <span aria-hidden="true" className="select-none text-destructive">*</span></Label>
                        <Input
                            id="create-task-title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder={t('taskTitlePlaceholder')}
                            autoFocus
                        />
                    </div>

                    <TaskColorPicker value={color} onChange={setColor} disabled={mutation.isPending} />

                    <div className="space-y-1.5">
                        <Label htmlFor="create-task-description" className="text-xs text-muted-foreground">{t('description')}</Label>
                        <Textarea
                            id="create-task-description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder={t('taskDescriptionPlaceholder')}
                            rows={3}
                            // Enter inserts a newline here, so keep the modifier shortcut
                            // as the way to submit without leaving the description.
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
                            }}
                        />
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="create-task-priority" className="text-xs text-muted-foreground">{t('priorityLabel')}</Label>
                            <Select value={priority} onValueChange={(v) => setPriority(v as BoardPriority)}>
                                <SelectTrigger id="create-task-priority">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {PRIORITY_ORDER.map((p) => (
                                        <SelectItem key={p} value={p}>
                                            {t(p === 'urgent' ? 'priorityUrgent' : p === 'normal' ? 'priorityNormal' : 'priorityLow')}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="create-task-assignee" className="text-xs text-muted-foreground">{t('assigneeLabel')}</Label>
                            {canAssignUsers ? (
                                <Select value={assigneeId} onValueChange={setAssigneeId}>
                                    <SelectTrigger id="create-task-assignee">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={UNASSIGNED}>{t('unassigned')}</SelectItem>
                                        {assignableUsers.map((u) => (
                                            <SelectItem key={u.id} value={String(u.id)}>
                                                {u.fullName}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <Input id="create-task-assignee" value={currentUser?.fullName ?? ''} disabled />
                            )}
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="create-task-due" className="text-xs text-muted-foreground">{t('dueDateLabel')}</Label>
                        <Input id="create-task-due" type="datetime-local" min={`${academyToday()}T00:00`} value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
                    </div>
                    </div>

                    <div className="flex shrink-0 justify-end gap-2 border-t bg-background/95 px-6 py-4">
                        <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={mutation.isPending}>
                            {t('cancel')}
                        </Button>
                        <Button type="submit" disabled={!title.trim() || mutation.isPending}>
                            {mutation.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
                            {mutation.isPending ? t('saving') : t('createTask')}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
