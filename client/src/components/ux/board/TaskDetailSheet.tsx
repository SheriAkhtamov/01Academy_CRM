import { CompactModalSection } from '@/components/ux/CompactModalSection';
import { DateTimeInput } from '@/components/ui/date-time-input';
import type { TelegramTaskSection } from '@shared/telegram-task-links';
import { getPendingAttachment, retainPendingAttachment, clearPendingAttachment } from '@/features/board/pending-attachments';
import { useUnsavedChangesGuard, UnsavedChangesDialog } from '@/components/ux/UnsavedChangesGuard';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
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
import { BoardUserAvatar, BoardUserIdentity } from './BoardUserAvatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import ConfirmDialog from '@/components/ConfirmDialog';
import {
    CheckCircle2,
    ClipboardList,
    FileText,
    History,
    ListChecks,
    MessageSquare,
    Loader2,
    Paperclip,
    Pencil,
    RotateCcw,
    Trash2,
    UserRound,
    X,
} from 'lucide-react';
import { boardRequest as apiRequest } from '@/features/board/transport';
import { hapticNotify } from '@/features/board/telegram';
import { TaskAttachmentDownload } from './TaskAttachmentDownload';
import {
    attachmentErrorKey,
    validateAttachment,
} from '@/lib/attachments';
import { academyDateInputValue, academyInstant, academyTimeOfDay } from '@/lib/localeFormat';
import { boardApi, boardQueryKeys } from '@/features/board/api';
import { useTaskCommentReads } from '@/features/board/useTaskCommentReads';
import { UnreadTaskCommentDot } from './UnreadTaskCommentDot';
import { TaskColorPicker } from './TaskColorPicker';
import { TaskPhotoPreview } from './TaskPhotoPreview';
import { ALLOWED_ATTACHMENT_EXTENSIONS, isPhotoAttachment } from '@shared/board-attachments';
import { uploadTaskAttachment } from '@/features/board/attachment-upload';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { canCommentOnBoardTask, canEditBoardTask, canFinalizeBoardTask, canManageBoardTask, isSelfAssignedBoardTask } from '@shared/board-permissions';
import { cn } from '@/lib/utils';
import {
    PRIORITY_META,
    PRIORITY_ORDER,
    TASK_COLOR_META,
    formatBoardDateTime,
    formatFileSize,
    type BoardPriority,
    type BoardStatus,
    type BoardTaskColor,
    type TaskActivity,
    type TaskDetail,
    type UserMini,
} from '@/lib/boardTypes';

interface TaskDetailSheetProps {
    initialSection?: TelegramTaskSection;
    focusCommentId?: number;
    focusAttachmentId?: number;
    tasksOnly?: boolean;
    taskId: number | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    users: UserMini[];
}

// Statuses reachable through the plain move dropdown. Accepted is the archive
// state; accepting and restoring it are handled by dedicated buttons.
const WORKING_STATUSES: BoardStatus[] = ['backlog', 'todo', 'in_progress', 'done'];
const UNASSIGNED = 'unassigned';

function UserChip({ user, miniMode = false }: { user: UserMini | null; miniMode?: boolean }) {
    const { t } = useTranslation();
    if (!user) return <span className="text-sm text-muted-foreground">{t('unassigned')}</span>;
    return (
        <BoardUserIdentity user={user} miniMode={miniMode} className="text-sm text-foreground" />
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
        case 'color_changed': return t('activityColorChanged');
        case 'comment_added': return t('activityCommented');
        case 'attachment_added': return t('activityAttached');
        default: return t('taskUpdated');
    }
}

function columnLabel(status: string | null, t: (k: any) => string): string {
    switch (status) {
        case 'backlog': return t('colBacklog');
        case 'todo': return t('colTodo');
        case 'in_progress': return t('taskInProgress');
        case 'done': return t('taskDone');
        case 'accepted': return t('colAccepted');
        default: return t('taskStatusUnknown');
    }
}

export function TaskDetailSheet({ taskId, open, onOpenChange, users, tasksOnly = false, initialSection, focusCommentId, focusAttachmentId }: TaskDetailSheetProps) {
    const { t, language } = useTranslation();
    const { toast } = useToast();
    const { user } = useAuth();
    const queryClient = useQueryClient();

    const queryKey = [`/api/board/tasks/${taskId}`];
    const { data: task, isLoading, isError, refetch } = useQuery<TaskDetail>({
        queryKey,
        queryFn: () => boardApi.getTask<TaskDetail>(taskId!),
        refetchInterval: tasksOnly ? 30_000 : false,
        enabled: open && taskId !== null,
    });

    const [editing, setEditing] = useState(false);
    const [detailsOpen, setDetailsOpen] = useState(true);
    const [descriptionOpen, setDescriptionOpen] = useState(false);
    const [draftTitle, setDraftTitle] = useState('');
    const [draftDescription, setDraftDescription] = useState('');
    const [draftPriority, setDraftPriority] = useState<BoardPriority>('normal');
    const [draftColor, setDraftColor] = useState<BoardTaskColor | null>(null);
    const [draftAssignee, setDraftAssignee] = useState<string>(UNASSIGNED);
    const [draftDue, setDraftDue] = useState('');
    const [commentText, setCommentText] = useState('');
    const [checklistText, setChecklistText] = useState('');
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleteError, setDeleteError] = useState('');
    const [pendingDelete, setPendingDelete] = useState<
        | { kind: 'comment'; id: number }
        | { kind: 'checklist'; id: number }
        | { kind: 'attachment'; id: number }
        | null
    >(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const submittingComment = useRef(false);
    const submittingChecklist = useRef(false);
    const [failedUpload, setFailedUpload] = useState<File | null>(null);
    const [activeTab, setActiveTab] = useState<string>(initialSection ?? (focusAttachmentId ? 'attachments' : 'comments'));
    const tabsRef = useRef<HTMLDivElement>(null);
    const focusedTarget = useRef<string | null>(null);
    const userId = user?.id;
    const [uploadPercent, setUploadPercent] = useState<number | null>(null);
    const commentReads = useTaskCommentReads(task, userId, open, activeTab === 'comments');

    useEffect(() => {
        setEditing(false);
        setDetailsOpen(true);
        setDescriptionOpen(false);
        setCommentText('');
        setChecklistText('');
        setConfirmDelete(false);
        setPendingDelete(null);
        const pending = userId && taskId ? getPendingAttachment(userId, taskId) : null;
        setFailedUpload(pending);
        setActiveTab(initialSection ?? (pending ? 'attachments' : 'comments'));
        focusedTarget.current = null;
    }, [taskId, open, userId, initialSection]);

    useEffect(() => {
        if (!open) return;
        if (focusAttachmentId) setActiveTab('attachments');
        else if (focusCommentId) setActiveTab('comments');
    }, [open, taskId, focusCommentId, focusAttachmentId]);

    const focusNotificationTarget = useCallback(() => {
        if (!open || task?.id !== taskId) return false;
        const target = activeTab === 'comments' && focusCommentId ? `comment-${focusCommentId}`
            : activeTab === 'attachments' && focusAttachmentId ? `attachment-${focusAttachmentId}` : null;
        if (!target) return false;
        if (focusedTarget.current === target) return true;
        const element = tabsRef.current?.querySelector<HTMLElement>(`[data-task-target="${target}"]`);
        if (!element) return false;
        element.scrollIntoView?.({ block: 'center' });
        element.focus({ preventScroll: true });
        focusedTarget.current = target;
        return true;
    }, [open, taskId, task, activeTab, focusCommentId, focusAttachmentId]);

    useEffect(() => { focusNotificationTarget(); }, [focusNotificationTarget]);

    useEffect(() => {
        if (task && !editing) {
            setDraftTitle(task.title);
            setDraftDescription(task.description ?? '');
            setDraftPriority(task.priority);
            setDraftColor(task.color);
            setDraftAssignee(task.assigneeId ? String(task.assigneeId) : UNASSIGNED);
            setDraftDue(task.dueAt ? toLocalInput(task.dueAt) : '');
        }
    }, [task, editing]);

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey });
        queryClient.invalidateQueries({ queryKey: boardQueryKeys.all });
    };

    const canManage = canManageBoardTask(user, task);
    const canEdit = canEditBoardTask(user, task);
    const canComment = canCommentOnBoardTask(user, task);
    const canFinalize = canFinalizeBoardTask(user, task);
    const selfAssigned = isSelfAssignedBoardTask(task);
    const canDelete = canEdit;

    useEffect(() => {
        if (!canEdit) {
            setEditing(false);
            setConfirmDelete(false);
        }
        if (!canComment) setPendingDelete(null);
    }, [canEdit, canComment]);

    const onError = (error: Error) => { hapticNotify('error'); toast({ title: error.message, variant: 'destructive' }); };

    const saveMutation = useMutation({
        mutationFn: () => {
            if (!draftTitle.trim()) throw new Error(t('titleRequired'));
            if (draftAssignee === UNASSIGNED || !draftAssignee) throw new Error(t('taskAssigneeRequired'));
            const payload: Record<string, unknown> = {
                title: draftTitle.trim(),
                description: draftDescription.trim() || null,
                priority: draftPriority,
                color: draftColor,
                dueAt: draftDue ? dueInputToInstant(draftDue) : null,
            };
            payload.assigneeId = Number(draftAssignee);
            return apiRequest('PATCH', `/api/board/tasks/${taskId}`, payload);
        },
        onSuccess: () => { hapticNotify('success'); invalidate(); setEditing(false); toast({ title: t('taskUpdated') }); },
        onError,
    });

    const statusMutation = useMutation({
        mutationFn: (status: BoardStatus) => apiRequest('PATCH', `/api/board/tasks/${taskId}/status`, { status }),
        onSuccess: (_updated, status) => {
            hapticNotify('success');
            invalidate();
            if (status === 'accepted') {
                toast({ title: selfAssigned ? t('taskCompletedAndArchived') : t('taskAcceptedAndArchived') });
                unsavedGuard.handleOpenChange(false);
            } else if (task?.status === 'accepted') {
                toast({ title: t('taskReopened') });
                unsavedGuard.handleOpenChange(false);
            }
        },
        onError,
    });

    const deleteMutation = useMutation({
        mutationFn: () => apiRequest('DELETE', `/api/board/tasks/${taskId}`),
        onSuccess: () => { hapticNotify('success'); queryClient.invalidateQueries({ queryKey: boardQueryKeys.all }); toast({ title: t('taskDeletedToast') }); setConfirmDelete(false); onOpenChange(false); },
        onError: (error: Error) => { setDeleteError(error.message); onError(error); },
    });

    const commentMutation = useMutation({
        mutationFn: ({ draft, throughCommentId }: { draft: string; throughCommentId: number }) => apiRequest('POST', `/api/board/tasks/${taskId}/comments`, { body: draft.trim(), readThroughCommentId: throughCommentId }),
        onSuccess: (_result, { draft, throughCommentId }) => { setCommentText((current) => current === draft ? '' : current); commentReads.acknowledgeReply(throughCommentId); invalidate(); },
        onError,
        onSettled: () => { submittingComment.current = false; },
    });

    const deleteCommentMutation = useMutation({
        mutationFn: (id: number) => apiRequest('DELETE', `/api/board/comments/${id}`),
        onSuccess: () => { setPendingDelete(null); setDeleteError(''); invalidate(); },
        onError: (error: Error) => { setDeleteError(error.message); onError(error); },
    });

    const addChecklistMutation = useMutation({
        mutationFn: (draft: string) => apiRequest('POST', `/api/board/tasks/${taskId}/checklist`, { content: draft.trim() }),
        onSuccess: (_result, draft) => { setChecklistText((current) => current === draft ? '' : current); invalidate(); },
        onError,
        onSettled: () => { submittingChecklist.current = false; },
    });

    const sendComment = () => {
        if (!commentText.trim() || submittingComment.current || pending) return;
        submittingComment.current = true;
        commentMutation.mutate({ draft: commentText, throughCommentId: commentReads.getSeenCommentId() });
    };
    const addChecklistItem = () => {
        if (!checklistText.trim() || submittingChecklist.current || pending) return;
        submittingChecklist.current = true;
        addChecklistMutation.mutate(checklistText);
    };

    const toggleChecklistMutation = useMutation({
        mutationFn: ({ id, isDone }: { id: number; isDone: boolean }) =>
            apiRequest('PATCH', `/api/board/checklist/${id}`, { isDone }),
        onSuccess: () => invalidate(),
        onError,
    });

    const deleteChecklistMutation = useMutation({
        mutationFn: (id: number) => apiRequest('DELETE', `/api/board/checklist/${id}`),
        onSuccess: () => { setPendingDelete(null); setDeleteError(''); invalidate(); },
        onError: (error: Error) => { setDeleteError(error.message); onError(error); },
    });

    const uploadMutation = useMutation({
        mutationFn: ({ file, onProgress }: { file: File; onProgress: (percent: number) => void }) =>
            uploadTaskAttachment(taskId!, file, onProgress),
        onSuccess: (_result, { file }) => {
            if (userId && taskId) clearPendingAttachment(userId, taskId, file);
            setUploadPercent(null);
            setFailedUpload(null);
            invalidate();
        },
        onError: (error: Error, { file }) => {
            setFailedUpload(file);
            setUploadPercent(null);
            toast({ title: t(attachmentErrorKey(error.message)), variant: 'destructive' });
        },
    });

    const handleAttachmentSelected = (file: File | undefined) => {
        if (!file || uploadMutation.isPending) return;
        const validationError = validateAttachment(file);
        if (validationError) {
            toast({ title: t(validationError), variant: 'destructive' });
            return;
        }
        if (userId && taskId) retainPendingAttachment(userId, taskId, file);
        setUploadPercent(0);
        uploadMutation.mutate({ file, onProgress: setUploadPercent });
    };

    const deleteAttachmentMutation = useMutation({
        mutationFn: (id: number) => apiRequest('DELETE', `/api/board/attachments/${id}`),
        onSuccess: () => { setPendingDelete(null); setDeleteError(''); invalidate(); },
        onError: (error: Error) => { setDeleteError(error.message); onError(error); },
    });

    const handleConfirmPendingDelete = () => {
        if (!pendingDelete || deleteCommentMutation.isPending || deleteChecklistMutation.isPending || deleteAttachmentMutation.isPending) return;
        setDeleteError('');
        if (pendingDelete.kind === 'comment') deleteCommentMutation.mutate(pendingDelete.id);
        else if (pendingDelete.kind === 'checklist') deleteChecklistMutation.mutate(pendingDelete.id);
        else deleteAttachmentMutation.mutate(pendingDelete.id);
    };

    const pendingDeleteMeta = pendingDelete
        ? pendingDelete.kind === 'comment'
            ? { title: t('deleteCommentTitle'), description: t('deleteCommentConfirm') }
            : pendingDelete.kind === 'checklist'
                ? { title: t('deleteChecklistItemTitle'), description: t('deleteChecklistItemConfirm') }
                : { title: t('deleteAttachmentTitle'), description: t('deleteAttachmentConfirm') }
        : null;

    const pending = saveMutation.isPending || statusMutation.isPending || deleteMutation.isPending
        || commentMutation.isPending || deleteCommentMutation.isPending || addChecklistMutation.isPending
        || toggleChecklistMutation.isPending || deleteChecklistMutation.isPending
        || uploadMutation.isPending || deleteAttachmentMutation.isPending;

    const saveChanges = () => {
        if (pending) return;
        if (!draftTitle.trim()) {
            toast({ title: t('titleRequired'), variant: 'destructive' });
            document.getElementById('task-detail-title')?.focus();
            return;
        }
        if (draftAssignee === UNASSIGNED || !draftAssignee) {
            setDetailsOpen(true);
            toast({ title: t('taskAssigneeRequired'), variant: 'destructive' });
            requestAnimationFrame(() => document.getElementById('task-detail-assignee')?.focus());
            return;
        }
        saveMutation.mutate();
    };

    const editDirty = editing && !!task && (
        draftTitle !== task.title || draftDescription !== (task.description ?? '')
        || draftPriority !== task.priority || draftColor !== task.color
        || draftAssignee !== (task.assigneeId ? String(task.assigneeId) : UNASSIGNED)
        || draftDue !== (task.dueAt ? toLocalInput(task.dueAt) : '')
    );
    const unsavedGuard = useUnsavedChangesGuard({
        open, isPending: saveMutation.isPending || deleteMutation.isPending || deleteCommentMutation.isPending || deleteChecklistMutation.isPending || deleteAttachmentMutation.isPending, onOpenChange: (nextOpen) => {
            if (!nextOpen) commentReads.markSeen();
            if (!nextOpen && userId && taskId) clearPendingAttachment(userId, taskId);
            onOpenChange(nextOpen);
        },
        isDirty: editDirty || !!commentText.trim() || !!checklistText.trim() || !!failedUpload || uploadMutation.isPending,
    });

    const summaryAssignee = editing
        ? users.find((person) => String(person.id) === draftAssignee)
            ?? (String(task?.assigneeId) === draftAssignee ? task?.assignee : null)
        : task?.assignee;
    const summaryDue = editing ? draftDue ? dueInputToInstant(draftDue) : null : task?.dueAt;
    const detailsSummary = [
        summaryAssignee?.fullName ?? t('unassigned'),
        summaryDue ? formatBoardDateTime(summaryDue, language)
            : editing && draftDue ? t('dateTimeInvalid') : t('noDueDate'),
    ].join(' · ');

    const priorityMeta = task ? PRIORITY_META[task.priority] : null;
    const checklistDone = task?.checklist.filter((c) => c.isDone).length ?? 0;

    return (
        <Sheet open={open} onOpenChange={unsavedGuard.handleOpenChange}>
            <SheetContent onOpenAutoFocus={(event) => { if (focusNotificationTarget()) event.preventDefault(); }} data-mini-task-sheet={tasksOnly || undefined} className="compact-modal flex w-full flex-col overflow-hidden p-0 sm:max-w-xl">
                {isError ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                        <SheetTitle className="sr-only">{t('taskDetails')}</SheetTitle>
                        <SheetDescription className="sr-only">{t('taskDetails')}</SheetDescription>
                        <p className="text-sm text-muted-foreground">{t('failedToLoadData')}</p>
                        <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
                            {t('retry')}
                        </Button>
                    </div>
                ) : isLoading || !task ? (
                    <div className="flex h-full items-center justify-center">
                        <SheetTitle className="sr-only">{t('taskDetails')}</SheetTitle>
                        <SheetDescription className="sr-only">{t('taskDetails')}</SheetDescription>
                        <Loader2 className="size-6 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <>
                        <SheetHeader className="compact-modal-header">
                            <div className={cn('flex flex-wrap items-start justify-between gap-3', tasksOnly && 'mini-task-heading')}>
                                <div className="min-w-0 flex-1">
                                    {editing && canEdit ? (
                                        <><SheetTitle className="sr-only">{t('taskDetails')}</SheetTitle><Input id="task-detail-title" disabled={pending} aria-label={t('taskTitle')} value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} className="text-base font-semibold" /></>
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
                                        {task.lead && !tasksOnly ? (
                                            <Button asChild variant="outline" size="sm" className="h-6 max-w-full gap-1.5 px-2 text-xs">
                                                <Link href={`/sales/pipeline?lead=${task.lead.id}`}>
                                                    <UserRound className="size-3.5 shrink-0" />
                                                    <span className="truncate">{task.lead.contactName}</span>
                                                </Link>
                                            </Button>
                                        ) : null}
                                        <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{columnLabel(task.status, t)}</Badge>
                                    </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                    {canEdit ? (
                                        editing ? (
                                            <>
                                                <Button size="sm" onClick={saveChanges} disabled={pending}>{saveMutation.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}{t('saveChanges')}</Button>
                                                <Button size="icon" variant="ghost" className="size-8" aria-label={t('cancel')} disabled={pending} onClick={() => unsavedGuard.requestAction(() => setEditing(false))}><X className="size-4" /></Button>
                                            </>
                                        ) : (
                                            <Button size="icon" variant="ghost" className="size-8" aria-label={t('edit')} disabled={pending} onClick={() => { setEditing(true); setDetailsOpen(true); setDescriptionOpen(true); }}><Pencil className="size-4" /></Button>
                                        )
                                    ) : null}
                                </div>
                            </div>
                        </SheetHeader>

                        <div className="compact-modal-body min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain">
                            {/* Status actions */}
                            <div className={cn('flex flex-wrap items-center gap-2', tasksOnly && 'mini-task-actions')}>
                                {tasksOnly && canManage && (task.status === 'backlog' || task.status === 'todo' || task.status === 'in_progress') ? (
                                    <Button
                                        className="mini-task-primary-action"
                                        onClick={() => statusMutation.mutate(task.status === 'in_progress' ? 'done' : 'in_progress')}
                                        disabled={pending}
                                    >
                                        <CheckCircle2 className="size-4" />
                                        {task.status === 'in_progress' ? t('miniTaskMarkDone') : t('miniTaskStartWork')}
                                    </Button>
                                ) : null}
                                {canManage ? (
                                    <Select
                                        value={WORKING_STATUSES.includes(task.status) ? task.status : ''}
                                        onValueChange={(v) => statusMutation.mutate(v as BoardStatus)}
                                        disabled={!canManage || task.status === 'accepted' || pending}
                                    >
                                        <SelectTrigger aria-label={t('status')} className={cn('h-9 w-44', tasksOnly && 'mini-task-status-select')}><SelectValue placeholder={columnLabel(task.status, t)} /></SelectTrigger>
                                        <SelectContent>
                                            {WORKING_STATUSES.map((s) => (
                                                <SelectItem key={s} value={s}>{columnLabel(s, t)}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                ) : <Badge variant="outline">{columnLabel(task.status, t)}</Badge>}

                                {task.status === 'done' && canFinalize ? (
                                    <Button
                                        size="sm"
                                        className={cn('gap-1.5', tasksOnly && 'mini-task-primary-action order-first')}
                                        onClick={() => statusMutation.mutate('accepted')}
                                        disabled={pending}
                                    >
                                        <CheckCircle2 className="size-4" /> {selfAssigned ? t('finishOwnTask') : t('acceptTask')}
                                    </Button>
                                ) : null}

                                {task.status === 'accepted' && canManage ? (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className={cn('gap-1.5', tasksOnly && 'mini-task-primary-action order-first')}
                                        onClick={() => statusMutation.mutate('in_progress')}
                                        disabled={pending}
                                    >
                                        <RotateCcw className="size-4" /> {t('reopenTask')}
                                    </Button>
                                ) : null}

                            </div>

                            {/* Meta + edit form */}
                            <CompactModalSection title={t('taskDetails')} icon={ClipboardList} tone="sky"
                                open={detailsOpen} onOpenChange={setDetailsOpen} disabled={pending} sectionId="task-details"
                                summary={detailsSummary}
                                contentClassName={cn('space-y-3', tasksOnly && 'mini-task-details')}>
                                {editing && canEdit ? (
                                    <>
                                        <TaskColorPicker value={draftColor} onChange={setDraftColor} disabled={pending} />
                                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                            <div className="space-y-1.5">
                                                <Label htmlFor="task-detail-priority" className="text-xs text-muted-foreground">{t('priorityLabel')}</Label>
                                                <Select disabled={pending} value={draftPriority} onValueChange={(v) => setDraftPriority(v as BoardPriority)}>
                                                    <SelectTrigger id="task-detail-priority"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        {PRIORITY_ORDER.map((p) => (
                                                            <SelectItem key={p} value={p}>{t(PRIORITY_META[p].labelKey)}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label htmlFor="task-detail-assignee" className="text-xs text-muted-foreground">{t('assigneeLabel')}</Label>
                                                {canEdit ? (
                                                    <Select disabled={pending} value={draftAssignee} onValueChange={setDraftAssignee}>
                                                        <SelectTrigger id="task-detail-assignee"><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            {draftAssignee === UNASSIGNED ? <SelectItem value={UNASSIGNED} disabled>{t('taskAssigneeRequired')}</SelectItem> : null}
                                                            {users.map((u) => (<SelectItem key={u.id} value={String(u.id)} textValue={u.fullName}><BoardUserIdentity user={u} miniMode={tasksOnly} /></SelectItem>))}
                                                        </SelectContent>
                                                    </Select>
                                                ) : (
                                                    <div className="relative"><BoardUserAvatar user={task.assignee} miniMode={tasksOnly} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2" /><Input id="task-detail-assignee" className="pl-11" value={task.assignee?.fullName ?? t('unassigned')} disabled /></div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label htmlFor="task-detail-due" className="text-xs text-muted-foreground">{t('dueDateLabel')}</Label>
                                            <DateTimeInput disabled={pending} id="task-detail-due" value={draftDue} onValueChange={(value) => setDraftDue(value)} />
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className={cn('grid grid-cols-2 gap-x-4 gap-y-3 text-sm', tasksOnly && 'mini-task-metadata')}>
                                            <MetaRow label={t('creatorLabel')}><UserChip user={task.creator} miniMode={tasksOnly} /></MetaRow>
                                            <MetaRow label={t('assigneeLabel')}><UserChip user={task.assignee} miniMode={tasksOnly} /></MetaRow>
                                            <MetaRow label={t('dueDateLabel')}>
                                                <span className="text-foreground">{task.dueAt ? formatBoardDateTime(task.dueAt, language) : t('noDueDate')}</span>
                                            </MetaRow>
                                            <MetaRow label={t('priorityLabel')}>
                                                {priorityMeta ? <span className="text-foreground">{t(priorityMeta.labelKey)}</span> : null}
                                            </MetaRow>
                                            {(!tasksOnly || task.color) ? <MetaRow label={t('taskColorLabel')}>
                                                {task.color ? (
                                                    <span className="flex items-center gap-2 text-foreground">
                                                        <span className={cn('size-3 rounded-full', TASK_COLOR_META[task.color].swatch)} aria-hidden="true" />
                                                        {t(TASK_COLOR_META[task.color].labelKey)}
                                                    </span>
                                                ) : (
                                                    <span className="text-foreground">{t('taskColorNone')}</span>
                                                )}
                                            </MetaRow> : null}
                                        </div>
                                    </>
                                )}
                            </CompactModalSection>

                            {editing || task.description ? (
                                <CompactModalSection title={t('description')} icon={FileText} tone="violet"
                                    open={descriptionOpen} onOpenChange={setDescriptionOpen} disabled={pending} sectionId="task-description"
                                    summary={(editing ? draftDescription : task.description)?.split('\n')[0]}>
                                    {editing && canEdit ? (
                                        <Textarea disabled={pending} id="task-detail-description" aria-label={t('description')}
                                            value={draftDescription} onChange={(event) => setDraftDescription(event.target.value)} rows={3} />
                                    ) : <p className="whitespace-pre-wrap break-words text-sm text-foreground/90">{task.description}</p>}
                                </CompactModalSection>
                            ) : null}

                            {/* Tabs */}
                            <Tabs ref={tabsRef} value={activeTab} onValueChange={setActiveTab} className={cn('min-w-0', tasksOnly && 'mini-task-tabs')}>
                                <TabsList className={cn('grid h-auto w-full grid-cols-4 gap-1 rounded-lg border border-border-strong bg-card p-1', tasksOnly && 'flex justify-start overflow-x-auto')}>
                                    <TabsTrigger value="comments" className={cn('min-w-0 truncate gap-1 px-1 py-2 text-xs sm:gap-1.5 sm:px-3 sm:text-sm', tasksOnly && 'shrink-0 px-3')}>{t('commentsLabel')}{task.comments.length ? ` (${task.comments.length})` : ''}{task.comments.some((comment) => comment.isUnread) ? <UnreadTaskCommentDot /> : null}</TabsTrigger>
                                    <TabsTrigger value="checklist" className={cn('min-w-0 truncate gap-1 px-1 py-2 text-xs sm:gap-1.5 sm:px-3 sm:text-sm', tasksOnly && 'shrink-0 px-3')}>{t('checklistLabel')}{task.checklist.length ? ` ${checklistDone}/${task.checklist.length}` : ''}</TabsTrigger>
                                    <TabsTrigger value="attachments" className={cn('min-w-0 truncate gap-1 px-1 py-2 text-xs sm:gap-1.5 sm:px-3 sm:text-sm', tasksOnly && 'shrink-0 px-3')}>{t('attachmentsLabel')}{task.attachments.length ? ` (${task.attachments.length})` : ''}</TabsTrigger>
                                    <TabsTrigger value="activity" className={cn('min-w-0 truncate gap-1 px-1 py-2 text-xs sm:gap-1.5 sm:px-3 sm:text-sm', tasksOnly && 'shrink-0 px-3')}>{t('activityTab')}</TabsTrigger>
                                </TabsList>

                                {/* Comments */}
                                <TabsContent value="comments" className="mt-3">
                                    <CompactModalSection title={t('commentsLabel')} icon={MessageSquare} tone="teal" collapsible={false}
                                        sectionId="task-comments" contentClassName="space-y-3">
                                        {canComment ? (
                                            <>
                                                <div className="flex gap-2">
                                                    <Textarea
                                                        value={commentText}
                                                        onChange={(e) => setCommentText(e.target.value)}
                                                        aria-label={t('comment')}
                                                        rows={2}
                                                        className="resize-none"
                                                        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendComment(); } }}
                                                    />
                                                    <Button size="sm" className="self-end" disabled={!commentText.trim() || pending} onClick={sendComment}>{commentMutation.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}{t('send')}</Button>
                                                </div>
                                            </>
                                        ) : null}
                                        {task.comments.length === 0 ? (
                                            <p className="py-3 text-center text-sm text-muted-foreground">{t('noCommentsYet')}</p>
                                        ) : (
                                            <ul className="space-y-3">
                                                {task.comments.map((c) => (
                                                    <li key={c.id} data-task-target={`comment-${c.id}`} tabIndex={-1} className="rounded-md border border-border bg-background p-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                                                                <BoardUserIdentity user={c.author} miniMode={tasksOnly} className="text-xs font-medium text-foreground" />
                                                                {c.isUnread ? <UnreadTaskCommentDot /> : null}
                                                                <span className="text-[11px] text-muted-foreground">{formatBoardDateTime(c.createdAt, language)}</span>
                                                            </div>
                                                            {canComment && user?.id === c.author?.id ? (
                                                                <Button size="icon" variant="ghost" className="size-7 text-muted-foreground" aria-label={t('delete')} disabled={pending} onClick={() => { setDeleteError(''); setPendingDelete({ kind: 'comment', id: c.id }); } }><Trash2 className="size-3.5" /></Button>
                                                            ) : null}
                                                        </div>
                                                        <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/90">{c.body}</p>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </CompactModalSection>
                                </TabsContent>

                                {/* Checklist */}
                                <TabsContent value="checklist" className="mt-3">
                                    <CompactModalSection title={t('checklistLabel')} icon={ListChecks} tone="sky" collapsible={false}
                                        sectionId="task-checklist" contentClassName="space-y-3">
                                        {canManage ? (
                                            <>
                                                <div className="flex gap-2">
                                                    <Input
                                                        value={checklistText}
                                                        onChange={(e) => setChecklistText(e.target.value)}
                                                        aria-label={t('checklistLabel')}
                                                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChecklistItem(); } }}
                                                    />
                                                    <Button size="sm" disabled={!checklistText.trim() || pending} onClick={addChecklistItem}>{addChecklistMutation.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}{t('addChecklistItem')}</Button>
                                                </div>
                                            </>
                                        ) : null}
                                        {task.checklist.length === 0 ? (
                                            <p className="py-3 text-center text-sm text-muted-foreground">{t('noChecklistYet')}</p>
                                        ) : (
                                            <ul className="space-y-1.5">
                                                {task.checklist.map((item) => (
                                                    <li key={item.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/60">
                                                        <Checkbox disabled={!canManage || pending} aria-label={item.content} checked={item.isDone} onCheckedChange={(v) => toggleChecklistMutation.mutate({ id: item.id, isDone: Boolean(v) })} />
                                                        <span className={cn('flex-1 text-sm', item.isDone && 'text-muted-foreground line-through')}>{item.content}</span>
                                                        {canManage ? (
                                                            <Button size="icon" variant="ghost" className="size-7 text-muted-foreground opacity-100 transition-opacity hover:opacity-100 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100" aria-label={t('delete')} disabled={pending} onClick={() => { setDeleteError(''); setPendingDelete({ kind: 'checklist', id: item.id }); } }><Trash2 className="size-3.5" /></Button>
                                                        ) : null}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </CompactModalSection>
                                </TabsContent>

                                {/* Attachments */}
                                <TabsContent value="attachments" className="mt-3">
                                    <CompactModalSection title={t('attachmentsLabel')} icon={Paperclip} tone="amber" collapsible={false}
                                        sectionId="task-attachments" contentClassName="space-y-3">
                                        {canManage ? (
                                            <>
                                                {failedUpload ? <div role="alert" className="flex items-center gap-2 text-sm text-destructive"><span className="min-w-0 break-all">{t('attachmentUploadFailed')}: {failedUpload.name}</span><Button variant="outline" disabled={pending} onClick={() => handleAttachmentSelected(failedUpload)}>{t('retry')}</Button></div> : null}
                                                <input
                                                    ref={fileInputRef}
                                                    disabled={pending}
                                                    type="file"
                                                    accept={ALLOWED_ATTACHMENT_EXTENSIONS.join(',')}
                                                    className="hidden"
                                                    onChange={(e) => { const f = e.target.files?.[0]; handleAttachmentSelected(f); e.target.value = ''; }}
                                                />
                                                <div className="flex flex-wrap items-center gap-3">
                                                    <Button variant="outline" size="sm" className="gap-1.5" disabled={pending} onClick={() => fileInputRef.current?.click()}>
                                                        {uploadMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />} {t('attachFile')}
                                                    </Button>
                                                </div>
                                                {uploadPercent !== null ? (
                                                    <div className="flex items-center gap-2" role="progressbar" aria-label={t('attachmentUploading')} aria-valuenow={uploadPercent} aria-valuemin={0} aria-valuemax={100}>
                                                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                                                            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${uploadPercent}%` }} />
                                                        </div>
                                                        <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{uploadPercent}%</span>
                                                    </div>
                                                ) : null}
                                            </>
                                        ) : null}
                                        {task.attachments.length === 0 ? (
                                            <p className="py-3 text-center text-sm text-muted-foreground">{t('noAttachmentsYet')}</p>
                                        ) : (
                                            <ul className="space-y-2">
                                                {task.attachments.map((a) => (
                                                    <li key={a.id} data-task-target={`attachment-${a.id}`} tabIndex={-1} className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-background p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                                        {isPhotoAttachment(a.originalName) ? <TaskPhotoPreview name={a.originalName} attachmentId={a.id} /> : <Paperclip className="size-4 shrink-0 text-muted-foreground" />}
                                                        <div className="min-w-0 flex-1">
                                                            <p className="truncate text-sm text-foreground">{a.originalName}</p>
                                                            <div className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] text-muted-foreground"><span>{formatFileSize(a.size)} ·</span><BoardUserIdentity user={a.uploadedBy} miniMode={tasksOnly} avatarClassName="size-5 text-[9px]" /></div>
                                                        </div>
                                                        <TaskAttachmentDownload id={a.id} name={a.originalName} compact />
                                                        {canManage ? (
                                                            <Button size="icon" variant="ghost" className="size-7 text-muted-foreground" aria-label={t('delete')} disabled={pending} onClick={() => { setDeleteError(''); setPendingDelete({ kind: 'attachment', id: a.id }); } }><Trash2 className="size-3.5" /></Button>
                                                        ) : null}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </CompactModalSection>
                                </TabsContent>

                                {/* Activity */}
                                <TabsContent value="activity" className="mt-3">
                                    <CompactModalSection title={t('activityTab')} icon={History} tone="violet" collapsible={false}
                                        sectionId="task-activity" contentClassName="space-y-3">
                                        {task.activity.length === 0 ? (
                                            <p className="py-3 text-center text-sm text-muted-foreground">{t('noActivityYet')}</p>
                                        ) : (
                                            <ul className="space-y-3">
                                                {[...task.activity].reverse().map((item) => (
                                                    <li key={item.id} className="flex items-start gap-2 text-sm">
                                                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/60" />
                                                        <span className="text-foreground/90">
                                                            <BoardUserIdentity user={item.actor} miniMode={tasksOnly} className="font-medium" avatarClassName="size-5 text-[9px]" />{' '}
                                                            {activityLabel(item, t)}
                                                            <span className="ml-1.5 text-[11px] text-muted-foreground">{formatBoardDateTime(item.createdAt, language)}</span>
                                                        </span>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </CompactModalSection>
                                </TabsContent>
                            </Tabs>
                        </div>

                        {canDelete ? (
                            <div className="compact-modal-footer">
                                <Button variant="ghost" size="sm" className="gap-1.5 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40" disabled={pending} onClick={() => { setDeleteError(''); setConfirmDelete(true); }}>
                                    <Trash2 className="size-4" /> {t('deleteTaskTitle')}
                                </Button>
                            </div>
                        ) : null}
                    </>
                )}
            </SheetContent>

            <ConfirmDialog open={pendingDelete !== null} onOpenChange={(next) => { if (!next) setPendingDelete(null); }}
                title={pendingDeleteMeta?.title || t('delete')} description={pendingDeleteMeta?.description || ''}
                confirmLabel={t('delete')} onConfirm={handleConfirmPendingDelete} variant="destructive" keepOpenOnConfirm
                error={deleteError} isPending={deleteCommentMutation.isPending || deleteChecklistMutation.isPending || deleteAttachmentMutation.isPending} />
            <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete}
                title={t('deleteTaskTitle')} description={t('deleteTaskConfirm')} confirmLabel={t('delete')}
                target={task?.title}
                onConfirm={() => { setDeleteError(''); deleteMutation.mutate(); }} variant="destructive" keepOpenOnConfirm
                error={deleteError} isPending={deleteMutation.isPending} />
            <UnsavedChangesDialog open={unsavedGuard.confirmationOpen} onOpenChange={unsavedGuard.setConfirmationOpen} onDiscard={unsavedGuard.discardChanges} />
        </Sheet>
    );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="min-w-0 space-y-1 break-words">
            <p className="text-xs text-muted-foreground">{label}</p>
            {children}
        </div>
    );
}

function toLocalInput(iso: string): string {
    const dateKey = academyDateInputValue(iso);
    const time = academyTimeOfDay(iso);
    return dateKey && time ? `${dateKey}T${time}` : '';
}

function dueInputToInstant(value: string): string | null {
    const [dateKey, timePart] = value.split('T');
    if (!dateKey || !timePart || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
    const instant = academyInstant(dateKey, timePart.slice(0, 5));
    return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

export default TaskDetailSheet;
