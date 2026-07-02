import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
    CheckCircle2,
    Download,
    Loader2,
    Lock,
    Paperclip,
    Pencil,
    RotateCcw,
    Trash2,
    X,
} from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { hasLeadershipAccess } from '@shared/academy';
import { getInitials } from '@/lib/auth';
import { cn } from '@/lib/utils';
import {
    PRIORITY_META,
    PRIORITY_ORDER,
    formatBoardDateTime,
    formatFileSize,
    type BoardPriority,
    type BoardStatus,
    type TaskActivity,
    type TaskDetail,
    type UserMini,
} from '@/lib/boardTypes';

interface TaskDetailSheetProps {
    taskId: number | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    users: UserMini[];
}

// Statuses reachable through the plain move dropdown. Accept (-> accepted) and
// re-open (out of accepted) are creator-only and handled by dedicated buttons.
const WORKING_STATUSES: BoardStatus[] = ['backlog', 'todo', 'in_progress', 'done'];
const UNASSIGNED = 'unassigned';

function UserChip({ user }: { user: UserMini | null }) {
    const { t } = useTranslation();
    if (!user) return <span className="text-sm text-muted-foreground">{t('unassigned')}</span>;
    return (
        <span className="flex items-center gap-2">
            <Avatar className="size-6 border border-border">
                <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
                    {getInitials(user.fullName)}
                </AvatarFallback>
            </Avatar>
            <span className="text-sm text-foreground">{user.fullName}</span>
        </span>
    );
}

function activityLabel(item: TaskActivity, t: (k: any) => string): string {
    switch (item.type) {
        case 'created': return t('activityCreated');
        case 'status_changed': return `${t('activityMovedTo')} ${columnLabel(item.toValue, t)}`;
        case 'accepted': return t('activityAccepted');
        case 'reopened': return t('activityReopened');
        case 'assigned': return t('activityAssigned');
        case 'unassigned': return t('activityUnassigned');
        case 'priority_changed': return t('activityPriorityChanged');
        case 'comment_added': return t('activityCommented');
        case 'attachment_added': return t('activityAttached');
        default: return item.type;
    }
}

function columnLabel(status: string | null, t: (k: any) => string): string {
    switch (status) {
        case 'backlog': return t('colBacklog');
        case 'todo': return t('colTodo');
        case 'in_progress': return t('taskInProgress');
        case 'done': return t('taskDone');
        case 'accepted': return t('colAccepted');
        default: return status ?? '';
    }
}

export function TaskDetailSheet({ taskId, open, onOpenChange, users }: TaskDetailSheetProps) {
    const { t } = useTranslation();
    const { toast } = useToast();
    const { user } = useAuth();
    const queryClient = useQueryClient();

    const queryKey = [`/api/board/tasks/${taskId}`];
    const { data: task, isLoading } = useQuery<TaskDetail>({
        queryKey,
        enabled: open && taskId !== null,
    });

    const [editing, setEditing] = useState(false);
    const [draftTitle, setDraftTitle] = useState('');
    const [draftDescription, setDraftDescription] = useState('');
    const [draftPriority, setDraftPriority] = useState<BoardPriority>('normal');
    const [draftAssignee, setDraftAssignee] = useState<string>(UNASSIGNED);
    const [draftDue, setDraftDue] = useState('');
    const [commentText, setCommentText] = useState('');
    const [checklistText, setChecklistText] = useState('');
    const [confirmDelete, setConfirmDelete] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (task && !editing) {
            setDraftTitle(task.title);
            setDraftDescription(task.description ?? '');
            setDraftPriority(task.priority);
            setDraftAssignee(task.assigneeId ? String(task.assigneeId) : UNASSIGNED);
            setDraftDue(task.dueAt ? toLocalInput(task.dueAt) : '');
        }
    }, [task, editing]);

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey });
        queryClient.invalidateQueries({ queryKey: ['/api/board/tasks'] });
    };

    const isTaskSupervisor = hasLeadershipAccess(user);
    const canManage = !!task && !!user && (user.id === task.creatorId || user.id === task.assigneeId || isTaskSupervisor);
    const canAcceptReopen = !!task && !!user && (user.id === task.creatorId || isTaskSupervisor);
    const canDelete = canAcceptReopen;

    const onError = (error: Error) => toast({ title: error.message, variant: 'destructive' });

    const saveMutation = useMutation({
        mutationFn: () => {
            const payload: Record<string, unknown> = {
                title: draftTitle.trim(),
                description: draftDescription.trim() || null,
                priority: draftPriority,
                dueAt: draftDue ? new Date(draftDue).toISOString() : null,
            };
            if (isTaskSupervisor) {
                payload.assigneeId = draftAssignee === UNASSIGNED ? null : Number(draftAssignee);
            }
            return apiRequest('PATCH', `/api/board/tasks/${taskId}`, payload);
        },
        onSuccess: () => { invalidate(); setEditing(false); toast({ title: t('taskUpdated') }); },
        onError,
    });

    const statusMutation = useMutation({
        mutationFn: (status: BoardStatus) => apiRequest('PATCH', `/api/board/tasks/${taskId}/status`, { status }),
        onSuccess: () => invalidate(),
        onError,
    });

    const deleteMutation = useMutation({
        mutationFn: () => apiRequest('DELETE', `/api/board/tasks/${taskId}`),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/board/tasks'] }); toast({ title: t('taskDeletedToast') }); onOpenChange(false); },
        onError,
    });

    const commentMutation = useMutation({
        mutationFn: () => apiRequest('POST', `/api/board/tasks/${taskId}/comments`, { body: commentText.trim() }),
        onSuccess: () => { setCommentText(''); invalidate(); },
        onError,
    });

    const deleteCommentMutation = useMutation({
        mutationFn: (id: number) => apiRequest('DELETE', `/api/board/comments/${id}`),
        onSuccess: () => invalidate(),
        onError,
    });

    const addChecklistMutation = useMutation({
        mutationFn: () => apiRequest('POST', `/api/board/tasks/${taskId}/checklist`, { content: checklistText.trim() }),
        onSuccess: () => { setChecklistText(''); invalidate(); },
        onError,
    });

    const toggleChecklistMutation = useMutation({
        mutationFn: ({ id, isDone }: { id: number; isDone: boolean }) =>
            apiRequest('PATCH', `/api/board/checklist/${id}`, { isDone }),
        onSuccess: () => invalidate(),
        onError,
    });

    const deleteChecklistMutation = useMutation({
        mutationFn: (id: number) => apiRequest('DELETE', `/api/board/checklist/${id}`),
        onSuccess: () => invalidate(),
        onError,
    });

    const uploadMutation = useMutation({
        mutationFn: (file: File) => {
            const form = new FormData();
            form.append('file', file);
            return apiRequest('POST', `/api/board/tasks/${taskId}/attachments`, form);
        },
        onSuccess: () => invalidate(),
        onError,
    });

    const deleteAttachmentMutation = useMutation({
        mutationFn: (id: number) => apiRequest('DELETE', `/api/board/attachments/${id}`),
        onSuccess: () => invalidate(),
        onError,
    });

    const priorityMeta = task ? PRIORITY_META[task.priority] : null;
    const checklistDone = task?.checklist.filter((c) => c.isDone).length ?? 0;

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
                {isLoading || !task ? (
                    <div className="flex h-full items-center justify-center">
                        <Loader2 className="size-6 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <>
                        <SheetHeader className="space-y-0 border-b border-border p-5 pr-14">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                    {editing ? (
                                        <Input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} className="text-base font-semibold" />
                                    ) : (
                                        <SheetTitle className="text-base leading-snug">{task.title}</SheetTitle>
                                    )}
                                    <SheetDescription className="sr-only">{t('taskDetails')}</SheetDescription>
                                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                        {priorityMeta ? (
                                            <Badge variant="secondary" className={cn('h-5 gap-1 px-1.5 text-[10px]', priorityMeta.badge)}>
                                                <span className={cn('size-1.5 rounded-full', priorityMeta.dot)} />
                                                {t(priorityMeta.labelKey)}
                                            </Badge>
                                        ) : null}
                                        <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{columnLabel(task.status, t)}</Badge>
                                    </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                    {canManage ? (
                                        editing ? (
                                            <>
                                                <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>{t('saveChanges')}</Button>
                                                <Button size="icon" variant="ghost" className="size-8" onClick={() => setEditing(false)}><X className="size-4" /></Button>
                                            </>
                                        ) : (
                                            <Button size="icon" variant="ghost" className="size-8" onClick={() => setEditing(true)}><Pencil className="size-4" /></Button>
                                        )
                                    ) : null}
                                </div>
                            </div>
                        </SheetHeader>

                        <div className="min-h-0 flex-1 overflow-y-auto">
                            {/* Status actions */}
                            <div className="flex flex-wrap items-center gap-2 border-b border-border p-5">
                                <Select
                                    value={WORKING_STATUSES.includes(task.status) ? task.status : ''}
                                    onValueChange={(v) => statusMutation.mutate(v as BoardStatus)}
                                    disabled={task.status === 'accepted' || statusMutation.isPending}
                                >
                                    <SelectTrigger className="h-9 w-44"><SelectValue placeholder={columnLabel(task.status, t)} /></SelectTrigger>
                                    <SelectContent>
                                        {WORKING_STATUSES.map((s) => (
                                            <SelectItem key={s} value={s}>{columnLabel(s, t)}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                {task.status === 'done' ? (
                                    <Button
                                        size="sm"
                                        className="gap-1.5"
                                        onClick={() => statusMutation.mutate('accepted')}
                                        disabled={!canAcceptReopen || statusMutation.isPending}
                                        title={!canAcceptReopen ? t('onlyCreatorCanAcceptHint') : undefined}
                                    >
                                        <CheckCircle2 className="size-4" /> {t('acceptTask')}
                                    </Button>
                                ) : null}

                                {task.status === 'accepted' ? (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="gap-1.5"
                                        onClick={() => statusMutation.mutate('in_progress')}
                                        disabled={!canAcceptReopen || statusMutation.isPending}
                                        title={!canAcceptReopen ? t('onlyCreatorCanAcceptHint') : undefined}
                                    >
                                        <RotateCcw className="size-4" /> {t('reopenTask')}
                                    </Button>
                                ) : null}

                                {!canAcceptReopen && (task.status === 'done' || task.status === 'accepted') ? (
                                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Lock className="size-3" />{t('onlyCreatorCanAcceptHint')}</span>
                                ) : null}
                            </div>

                            {/* Meta + edit form */}
                            <div className="space-y-4 border-b border-border p-5">
                                {editing ? (
                                    <>
                                        <div className="space-y-1.5">
                                            <Label className="text-xs text-slate-500">{t('description')}</Label>
                                            <Textarea value={draftDescription} onChange={(e) => setDraftDescription(e.target.value)} rows={3} placeholder={t('taskDescriptionPlaceholder')} />
                                        </div>
                                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                            <div className="space-y-1.5">
                                                <Label className="text-xs text-slate-500">{t('priorityLabel')}</Label>
                                                <Select value={draftPriority} onValueChange={(v) => setDraftPriority(v as BoardPriority)}>
                                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        {PRIORITY_ORDER.map((p) => (
                                                            <SelectItem key={p} value={p}>{t(PRIORITY_META[p].labelKey)}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label className="text-xs text-slate-500">{t('assigneeLabel')}</Label>
                                                {isTaskSupervisor ? (
                                                    <Select value={draftAssignee} onValueChange={setDraftAssignee}>
                                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value={UNASSIGNED}>{t('unassigned')}</SelectItem>
                                                            {users.map((u) => (<SelectItem key={u.id} value={String(u.id)}>{u.fullName}</SelectItem>))}
                                                        </SelectContent>
                                                    </Select>
                                                ) : (
                                                    <Input value={task.assignee?.fullName ?? t('unassigned')} disabled />
                                                )}
                                            </div>
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label className="text-xs text-slate-500">{t('dueDateLabel')}</Label>
                                            <Input type="datetime-local" value={draftDue} onChange={(e) => setDraftDue(e.target.value)} />
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        {task.description ? (
                                            <p className="whitespace-pre-wrap text-sm text-foreground/90">{task.description}</p>
                                        ) : null}
                                        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                                            <MetaRow label={t('creatorLabel')}><UserChip user={task.creator} /></MetaRow>
                                            <MetaRow label={t('assigneeLabel')}><UserChip user={task.assignee} /></MetaRow>
                                            <MetaRow label={t('dueDateLabel')}>
                                                <span className="text-foreground">{task.dueAt ? formatBoardDateTime(task.dueAt) : t('noDueDate')}</span>
                                            </MetaRow>
                                            <MetaRow label={t('priorityLabel')}>
                                                {priorityMeta ? <span className="text-foreground">{t(priorityMeta.labelKey)}</span> : null}
                                            </MetaRow>
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* Tabs */}
                            <Tabs defaultValue="comments" className="p-5">
                                <TabsList className="grid w-full grid-cols-4">
                                    <TabsTrigger value="comments">{t('commentsLabel')}{task.comments.length ? ` (${task.comments.length})` : ''}</TabsTrigger>
                                    <TabsTrigger value="checklist">{t('checklistLabel')}{task.checklist.length ? ` ${checklistDone}/${task.checklist.length}` : ''}</TabsTrigger>
                                    <TabsTrigger value="attachments">{t('attachmentsLabel')}{task.attachments.length ? ` (${task.attachments.length})` : ''}</TabsTrigger>
                                    <TabsTrigger value="activity">{t('activityTab')}</TabsTrigger>
                                </TabsList>

                                {/* Comments */}
                                <TabsContent value="comments" className="mt-4 space-y-3">
                                    <div className="flex gap-2">
                                        <Textarea
                                            value={commentText}
                                            onChange={(e) => setCommentText(e.target.value)}
                                            placeholder={t('addCommentPlaceholder')}
                                            rows={2}
                                            className="resize-none"
                                            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && commentText.trim()) commentMutation.mutate(); }}
                                        />
                                        <Button size="sm" className="self-end" disabled={!commentText.trim() || commentMutation.isPending} onClick={() => commentMutation.mutate()}>{t('send')}</Button>
                                    </div>
                                    {task.comments.length === 0 ? (
                                        <p className="py-6 text-center text-sm text-muted-foreground">{t('noCommentsYet')}</p>
                                    ) : (
                                        <ul className="space-y-3">
                                            {task.comments.map((c) => (
                                                <li key={c.id} className="rounded-lg border border-border bg-card p-3">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <div className="flex items-center gap-2">
                                                            <Avatar className="size-6 border border-border">
                                                                <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">{getInitials(c.author?.fullName ?? '?')}</AvatarFallback>
                                                            </Avatar>
                                                            <span className="text-xs font-medium text-foreground">{c.author?.fullName ?? '—'}</span>
                                                            <span className="text-[11px] text-muted-foreground">{formatBoardDateTime(c.createdAt)}</span>
                                                        </div>
                                                        {user && (user.id === c.author?.id || isTaskSupervisor) ? (
                                                            <Button size="icon" variant="ghost" className="size-7 text-muted-foreground" onClick={() => deleteCommentMutation.mutate(c.id)}><Trash2 className="size-3.5" /></Button>
                                                        ) : null}
                                                    </div>
                                                    <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/90">{c.body}</p>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </TabsContent>

                                {/* Checklist */}
                                <TabsContent value="checklist" className="mt-4 space-y-3">
                                    <div className="flex gap-2">
                                        <Input
                                            value={checklistText}
                                            onChange={(e) => setChecklistText(e.target.value)}
                                            placeholder={t('addChecklistPlaceholder')}
                                            onKeyDown={(e) => { if (e.key === 'Enter' && checklistText.trim()) addChecklistMutation.mutate(); }}
                                        />
                                        <Button size="sm" disabled={!checklistText.trim() || addChecklistMutation.isPending} onClick={() => addChecklistMutation.mutate()}>{t('addChecklistItem')}</Button>
                                    </div>
                                    {task.checklist.length === 0 ? (
                                        <p className="py-6 text-center text-sm text-muted-foreground">{t('noChecklistYet')}</p>
                                    ) : (
                                        <ul className="space-y-1.5">
                                            {task.checklist.map((item) => (
                                                <li key={item.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/60">
                                                    <Checkbox checked={item.isDone} onCheckedChange={(v) => toggleChecklistMutation.mutate({ id: item.id, isDone: Boolean(v) })} />
                                                    <span className={cn('flex-1 text-sm', item.isDone && 'text-muted-foreground line-through')}>{item.content}</span>
                                                    <Button size="icon" variant="ghost" className="size-7 text-muted-foreground opacity-0 group-hover:opacity-100" onClick={() => deleteChecklistMutation.mutate(item.id)}><Trash2 className="size-3.5" /></Button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </TabsContent>

                                {/* Attachments */}
                                <TabsContent value="attachments" className="mt-4 space-y-3">
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        className="hidden"
                                        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMutation.mutate(f); e.target.value = ''; }}
                                    />
                                    <Button variant="outline" size="sm" className="gap-1.5" disabled={uploadMutation.isPending} onClick={() => fileInputRef.current?.click()}>
                                        {uploadMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />} {t('attachFile')}
                                    </Button>
                                    {task.attachments.length === 0 ? (
                                        <p className="py-6 text-center text-sm text-muted-foreground">{t('noAttachmentsYet')}</p>
                                    ) : (
                                        <ul className="space-y-2">
                                            {task.attachments.map((a) => (
                                                <li key={a.id} className="flex items-center gap-2 rounded-lg border border-border bg-card p-2.5">
                                                    <Paperclip className="size-4 shrink-0 text-muted-foreground" />
                                                    <div className="min-w-0 flex-1">
                                                        <p className="truncate text-sm text-foreground">{a.originalName}</p>
                                                        <p className="text-[11px] text-muted-foreground">{formatFileSize(a.size)} · {a.uploadedBy?.fullName ?? '—'}</p>
                                                    </div>
                                                    <a href={`/api/board/attachments/${a.id}/download`} className="inline-flex">
                                                        <Button size="icon" variant="ghost" className="size-7 text-muted-foreground"><Download className="size-3.5" /></Button>
                                                    </a>
                                                    {user && (user.id === a.uploadedBy?.id || user.id === task.creatorId || isTaskSupervisor) ? (
                                                        <Button size="icon" variant="ghost" className="size-7 text-muted-foreground" onClick={() => deleteAttachmentMutation.mutate(a.id)}><Trash2 className="size-3.5" /></Button>
                                                    ) : null}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </TabsContent>

                                {/* Activity */}
                                <TabsContent value="activity" className="mt-4">
                                    {task.activity.length === 0 ? (
                                        <p className="py-6 text-center text-sm text-muted-foreground">{t('noActivityYet')}</p>
                                    ) : (
                                        <ul className="space-y-3">
                                            {[...task.activity].reverse().map((item) => (
                                                <li key={item.id} className="flex items-start gap-2 text-sm">
                                                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/60" />
                                                    <span className="text-foreground/90">
                                                        <span className="font-medium">{item.actor?.fullName ?? '—'}</span>{' '}
                                                        {activityLabel(item, t)}
                                                        <span className="ml-1.5 text-[11px] text-muted-foreground">{formatBoardDateTime(item.createdAt)}</span>
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </TabsContent>
                            </Tabs>
                        </div>

                        {canDelete ? (
                            <div className="border-t border-border p-4">
                                <Button variant="ghost" size="sm" className="gap-1.5 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40" onClick={() => setConfirmDelete(true)}>
                                    <Trash2 className="size-4" /> {t('deleteTaskTitle')}
                                </Button>
                            </div>
                        ) : null}
                    </>
                )}
            </SheetContent>

            <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('deleteTaskTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>{t('deleteTaskConfirm')}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                        <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deleteMutation.mutate()}>{t('delete')}</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Sheet>
    );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1">
            <p className="text-xs text-slate-500">{label}</p>
            {children}
        </div>
    );
}

function toLocalInput(iso: string): string {
    const d = new Date(iso);
    const off = d.getTimezoneOffset();
    const local = new Date(d.getTime() - off * 60000);
    return local.toISOString().slice(0, 16);
}

export default TaskDetailSheet;
