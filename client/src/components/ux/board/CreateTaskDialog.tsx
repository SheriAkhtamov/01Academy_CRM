import { DateTimeInput } from '@/components/ui/date-time-input';
import { BoardUserAvatar, BoardUserIdentity } from './BoardUserAvatar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Loader2, Paperclip } from 'lucide-react';
import { CompactModalSection } from '@/components/ux/CompactModalSection';
import {
    DialogFooter,
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
import { boardRequest as apiRequest } from '@/features/board/transport';
import { hapticNotify } from '@/features/board/telegram';
import { boardApi, boardQueryKeys } from '@/features/board/api';
import { academyDateInputValue, academyInstant, academyMinutesOfDay, academyToday } from '@/lib/localeFormat';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { TaskColorPicker } from './TaskColorPicker';
import { TaskFilePicker } from './TaskFilePicker';
import { uploadTaskAttachment } from '@/features/board/attachment-upload';
import { attachmentErrorKey } from '@/lib/attachments';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { PRIORITY_ORDER, TASK_COLOR_META, type BoardPriority, type BoardTaskColor, type UserMini } from '@/lib/boardTypes';
import { cn } from '@/lib/utils';
import { useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';

interface CreateTaskDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated?: (task: { assigneeId: number | null }) => void;
    users: UserMini[];
    currentUser: UserMini | null;
    canAssignUsers: boolean;
    miniMode?: boolean;
}

const dueInputToInstant = (value: string): string | null => {
    const [dateKey, timePart] = value.split('T');
    if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
    const instant = academyInstant(dateKey, (timePart ?? '').slice(0, 5) || '00:00');
    return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
};

const quickTodayDue = (): string | null => {
    const minutes = Math.max(18 * 60, Math.ceil((academyMinutesOfDay(new Date()) + 30) / 30) * 30);
    if (minutes >= 24 * 60) return null;
    return `${academyToday()}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};

const quickTomorrowDue = () => `${academyDateInputValue(Date.now() + 24 * 60 * 60 * 1000)}T18:00`;

export function CreateTaskDialog({ open, onOpenChange, onCreated, users, currentUser, canAssignUsers, miniMode = false }: CreateTaskDialogProps) {
    const { t } = useTranslation();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const defaultAssigneeId = currentUser ? String(currentUser.id) : '';
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
    const [files, setFiles] = useState<File[]>([]);
    const [uploaded, setUploaded] = useState<File[]>([]);
    const [activeFile, setActiveFile] = useState<File | null>(null);
    const [percent, setPercent] = useState(0);
    const [attempted, setAttempted] = useState(false);
    const [optionalOpen, setOptionalOpen] = useState(false);
    const createdTaskId = useRef<number | null>(null);
    const requestKey = useRef<string>();
    const submitting = useRef(false);

    const reset = () => {
        setTitle('');
        setDescription('');
        setPriority('normal');
        setColor(null);
        setAssigneeId(defaultAssigneeId);
        setDueAt('');
        setOptionalOpen(false);
        setFiles([]); setUploaded([]); setActiveFile(null); setAttempted(false);
        createdTaskId.current = null; requestKey.current = undefined;
    };

    useEffect(() => {
        if (open) {
            setAssigneeId(defaultAssigneeId);
        }
    }, [defaultAssigneeId, open]);

    const mutation = useMutation({
        mutationFn: async () => {
            if (!assigneeId || !currentUser) throw new Error(t('taskAssigneeRequired'));
            requestKey.current ??= crypto.randomUUID();
            const targetAssigneeId = canAssignUsers
                ? assigneeId ? Number(assigneeId) : null
                : currentUser?.id ?? null;
            const needsHandover = files.length > 0 && targetAssigneeId !== null
                && targetAssigneeId !== currentUser?.id;
            if (createdTaskId.current === null) {
                const task = await apiRequest('POST', '/api/board/tasks', {
                title: title.trim(),
                description: description.trim() || null,
                priority,
                color,
                assigneeId: needsHandover ? currentUser?.id : targetAssigneeId,
                dueAt: dueAt ? dueInputToInstant(dueAt) : null,
                requestKey: requestKey.current,
                }) as { id: number };
                createdTaskId.current = task.id;
            }
            for (const file of files) {
                if (uploaded.includes(file)) continue;
                setActiveFile(file); setPercent(0);
                await uploadTaskAttachment(createdTaskId.current, file, setPercent);
                setUploaded((previous) => [...previous, file]);
            }
            if (needsHandover) {
                // Reading before retrying also handles a successful handover whose response was lost.
                const task = await boardApi.getTask<{ assigneeId: number | null }>(createdTaskId.current!);
                if (task.assigneeId !== targetAssigneeId) {
                    await boardApi.updateTaskAssignee(createdTaskId.current!, targetAssigneeId!);
                }
            }
            return { assigneeId: targetAssigneeId };
        },
        onSuccess: (task) => {
            hapticNotify('success');
            queryClient.invalidateQueries({ queryKey: boardQueryKeys.all });
            toast({ title: t('taskCreated') });
            reset();
            onOpenChange(false);
            onCreated?.(task);
        },
        onError: (error: Error & { status?: number }) => {
            hapticNotify('error');
            // A definitive validation error did not create anything: allow the
            // user to fix the form. For ambiguous failures retain the same key.
            if (createdTaskId.current === null && error.status && error.status >= 400 && error.status < 500) {
                setAttempted(false); requestKey.current = undefined;
            }
            toast({ title: createdTaskId.current ? t(attachmentErrorKey(error.message)) : error.message, variant: 'destructive' });
        },
        onSettled: () => {
            submitting.current = false; setActiveFile(null);
            queryClient.invalidateQueries({ queryKey: boardQueryKeys.all });
        },
    });

    const handleSubmit = (event?: React.FormEvent) => {
        event?.preventDefault();
        if (submitting.current) return;
        if (!title.trim()) {
            toast({ title: t('titleRequired'), variant: 'destructive' });
            return;
        }
        if (!assigneeId || !Number.isSafeInteger(Number(assigneeId)) || Number(assigneeId) <= 0) {
            toast({ title: t('taskAssigneeRequired'), variant: 'destructive' });
            return;
        }
        const dueInstant = dueAt ? dueInputToInstant(dueAt) : null;
        if (!attempted && dueAt && (!dueInstant || new Date(dueInstant).getTime() <= Date.now())) {
            toast({ title: t('taskDueDateInPast'), variant: 'destructive' });
            return;
        }
        if (files.length) setOptionalOpen(true);
        submitting.current = true; setAttempted(true); mutation.mutate();
    };

    const guard = useUnsavedChangesGuard({
        open,
        isDirty: Boolean(title || description || files.length || color || priority !== 'normal' || assigneeId !== defaultAssigneeId || dueAt || attempted),
        isPending: mutation.isPending,
        onOpenChange: (next) => {
            if (!next) { reset(); mutation.reset(); }
            onOpenChange(next);
        },
    });
    const handleOpenChange = guard.handleOpenChange;

    const todayDue = miniMode ? quickTodayDue() : null;
    const tomorrowDue = miniMode ? quickTomorrowDue() : '';
    const descriptionField = <div className="space-y-1.5">
        <Label htmlFor="create-task-description" className="text-xs text-muted-foreground">{t('description')}</Label>
        <Textarea
            id="create-task-description"
            disabled={attempted || mutation.isPending}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) handleSubmit(); }}
        />
    </div>;
    const priorityField = <div className="space-y-1.5">
        <Label htmlFor="create-task-priority" className="text-xs text-muted-foreground">{t('priorityLabel')}</Label>
        <Select value={priority} onValueChange={(value) => setPriority(value as BoardPriority)} disabled={attempted || mutation.isPending}>
            <SelectTrigger id="create-task-priority"><SelectValue /></SelectTrigger>
            <SelectContent>{PRIORITY_ORDER.map((value) => <SelectItem key={value} value={value}>{t(value === 'urgent' ? 'priorityUrgent' : value === 'normal' ? 'priorityNormal' : 'priorityLow')}</SelectItem>)}</SelectContent>
        </Select>
    </div>;
    const assigneeField = <div className="space-y-1.5">
        <Label htmlFor="create-task-assignee" className="text-xs text-muted-foreground">{t('assigneeLabel')}</Label>
        {canAssignUsers ? <Select value={assigneeId} onValueChange={setAssigneeId} disabled={attempted || mutation.isPending}>
            <SelectTrigger id="create-task-assignee"><SelectValue placeholder={t('taskAssigneeRequired')} /></SelectTrigger>
            <SelectContent>{assignableUsers.map((person) => <SelectItem key={person.id} value={String(person.id)} textValue={person.fullName}><BoardUserIdentity user={person} miniMode={miniMode} /></SelectItem>)}</SelectContent>
        </Select> : <div className="relative"><BoardUserAvatar user={currentUser} miniMode={miniMode} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2" /><Input id="create-task-assignee" className="pl-11" value={currentUser?.fullName ?? ''} disabled /></div>}
    </div>;
    const dueField = <div className="space-y-1.5">
        <Label htmlFor="create-task-due" className="text-xs text-muted-foreground">{t('dueDateLabel')}</Label>
        {miniMode ? <div className="flex flex-wrap gap-2" role="group" aria-label={t('dueDateLabel')}>
            <Button type="button" size="sm" variant="outline" disabled={!todayDue || attempted || mutation.isPending} aria-pressed={Boolean(todayDue && dueAt === todayDue)} className={cn('rounded-full', todayDue && dueAt === todayDue && 'border-primary bg-primary/10 text-primary')} onClick={() => { if (todayDue) setDueAt(todayDue); }}>{t('today')}</Button>
            <Button type="button" size="sm" variant="outline" disabled={attempted || mutation.isPending} aria-pressed={dueAt === tomorrowDue} className={cn('rounded-full', dueAt === tomorrowDue && 'border-primary bg-primary/10 text-primary')} onClick={() => setDueAt(tomorrowDue)}>{t('adminTomorrow')}</Button>
            <Button type="button" size="sm" variant="outline" disabled={attempted || mutation.isPending} aria-pressed={!dueAt} className={cn('rounded-full', !dueAt && 'border-primary bg-primary/10 text-primary')} onClick={() => setDueAt('')}>{t('noDueDate')}</Button>
        </div> : null}
        <DateTimeInput disabled={attempted || mutation.isPending} id="create-task-due" min={`${academyToday()}T00:00`} value={dueAt} onValueChange={(value) => setDueAt(value)} />
    </div>;

    return (
        <><Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent data-mini-task-create={miniMode || undefined} className="compact-modal flex max-h-[calc(100dvh-2rem)] max-w-lg flex-col overflow-hidden p-0">
                <DialogHeader className="compact-modal-header">
                    <DialogTitle>{t('addTask')}</DialogTitle>
                    <DialogDescription className="sr-only">{t('addTask')}</DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
                    <div className={cn('compact-modal-body min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain', miniMode && 'mini-task-create-body')}>
                    <CompactModalSection title={t('taskDetails')} icon={ClipboardList} tone="sky" collapsible={false}
                        disabled={attempted || mutation.isPending} sectionId="task-create-main"
                        contentClassName={cn('grid grid-cols-1 gap-3 sm:grid-cols-2', miniMode && 'mini-task-create-fields')}>

                    <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor="create-task-title" className="text-xs text-muted-foreground">{t('taskTitle')} <span aria-hidden="true" className="select-none text-destructive">*</span></Label>
                        <Input
                            id="create-task-title"
                            maxLength={255}
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            autoFocus
                        />
                    </div>

                    {assigneeField}
                    {priorityField}
                    <div className="sm:col-span-2">{dueField}</div>
                    </CompactModalSection>
                    <CompactModalSection title={t('miniTaskOptionalFields')} icon={Paperclip} tone="violet"
                        open={optionalOpen} onOpenChange={setOptionalOpen} disabled={attempted || mutation.isPending}
                        count={files.length || undefined} sectionId="task-create-extra"
                        summary={[description.trim().split('\n')[0], color ? t(TASK_COLOR_META[color].labelKey) : ''].filter(Boolean).join(' · ')} contentClassName="space-y-3">
                        {descriptionField}
                        <TaskColorPicker value={color} onChange={setColor} disabled={attempted || mutation.isPending} />
                        <TaskFilePicker files={files} onChange={(nextFiles) => { setFiles(nextFiles); if (nextFiles.length) setOptionalOpen(true); }}
                            disabled={attempted || mutation.isPending} uploaded={uploaded} activeFile={activeFile} percent={percent} />
                    </CompactModalSection>
                    {mutation.isError && attempted ? <p role="alert" className="text-sm text-destructive">{createdTaskId.current === null ? t('taskSaveIncomplete') : t('taskAttachmentPartialFailure')}</p> : null}
                    </div>

                    <DialogFooter className={cn('compact-modal-footer flex justify-end', miniMode && 'mini-task-create-footer')}>
                        <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={mutation.isPending}>
                            {t('cancel')}
                        </Button>
                        <Button type="submit" disabled={!title.trim() || !assigneeId || mutation.isPending}>
                            {mutation.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
                            {mutation.isPending ? activeFile ? t('attachmentUploading') : t('saving') : mutation.isError ? t('attachmentRetry') : t('createTask')}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
        <AlertDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen}>
            <AlertDialogContent>
                <AlertDialogHeader><AlertDialogTitle>{t('attachmentDraftDiscardTitle')}</AlertDialogTitle><AlertDialogDescription>{t('attachmentDraftDiscardDescription')}</AlertDialogDescription></AlertDialogHeader>
                <AlertDialogFooter><AlertDialogCancel>{t('keepEditing')}</AlertDialogCancel><AlertDialogAction onClick={guard.discardChanges}>{t('discardChanges')}</AlertDialogAction></AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog></>
    );
}
