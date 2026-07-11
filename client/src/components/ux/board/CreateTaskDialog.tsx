import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { PRIORITY_ORDER, type BoardPriority, type UserMini } from '@/lib/boardTypes';

interface CreateTaskDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    users: UserMini[];
    currentUser: UserMini | null;
    canAssignUsers: boolean;
}

const UNASSIGNED = 'unassigned';

export function CreateTaskDialog({ open, onOpenChange, users, currentUser, canAssignUsers }: CreateTaskDialogProps) {
    const { t } = useTranslation();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const defaultAssigneeId = canAssignUsers ? UNASSIGNED : currentUser ? String(currentUser.id) : UNASSIGNED;
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
    const [assigneeId, setAssigneeId] = useState<string>(defaultAssigneeId);
    const [dueAt, setDueAt] = useState('');

    const reset = () => {
        setTitle('');
        setDescription('');
        setPriority('normal');
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
                assigneeId: canAssignUsers
                    ? assigneeId === UNASSIGNED ? null : Number(assigneeId)
                    : currentUser?.id ?? null,
                dueAt: dueAt ? new Date(dueAt).toISOString() : null,
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/board/tasks'] });
            toast({ title: t('taskCreated') });
            reset();
            onOpenChange(false);
        },
        onError: (error: Error) => {
            toast({ title: error.message, variant: 'destructive' });
        },
    });

    const handleSubmit = () => {
        if (!title.trim()) {
            toast({ title: t('titleRequired'), variant: 'destructive' });
            return;
        }
        mutation.mutate();
    };

    const handleOpenChange = (next: boolean) => {
        if (!next) reset();
        onOpenChange(next);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{t('addTask')}</DialogTitle>
                    <DialogDescription className="sr-only">{t('addTask')}</DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <Label className="text-xs text-slate-500">{t('taskTitle')}</Label>
                        <Input
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder={t('taskTitlePlaceholder')}
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
                            }}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs text-slate-500">{t('description')}</Label>
                        <Textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder={t('taskDescriptionPlaceholder')}
                            rows={3}
                        />
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label className="text-xs text-slate-500">{t('priorityLabel')}</Label>
                            <Select value={priority} onValueChange={(v) => setPriority(v as BoardPriority)}>
                                <SelectTrigger>
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
                            <Label className="text-xs text-slate-500">{t('assigneeLabel')}</Label>
                            {canAssignUsers ? (
                                <Select value={assigneeId} onValueChange={setAssigneeId}>
                                    <SelectTrigger>
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
                                <Input value={currentUser?.fullName ?? ''} disabled />
                            )}
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs text-slate-500">{t('dueDateLabel')}</Label>
                        <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
                    </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={mutation.isPending}>
                        {t('cancel')}
                    </Button>
                    <Button onClick={handleSubmit} disabled={mutation.isPending}>
                        {t('createTask')}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
