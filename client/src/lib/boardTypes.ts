import type { TranslationKey } from '@/lib/i18n';

export type BoardStatus = 'backlog' | 'todo' | 'in_progress' | 'done' | 'accepted';
export type BoardPriority = 'urgent' | 'normal' | 'low';

export interface UserMini {
    id: number;
    fullName: string;
    position: string | null;
    role: string;
}

export interface TaskSummary {
    id: number;
    boardId: number;
    title: string;
    description: string | null;
    status: BoardStatus;
    priority: BoardPriority;
    position: number;
    dueAt: string | null;
    acceptedAt: string | null;
    createdAt: string;
    updatedAt: string;
    creator: UserMini | null;
    assignee: UserMini | null;
    commentCount: number;
    attachmentCount: number;
    checklistTotal: number;
    checklistDone: number;
}

export interface TaskComment {
    id: number;
    taskId: number;
    body: string;
    createdAt: string;
    updatedAt: string;
    author: UserMini | null;
}

export interface TaskChecklistItem {
    id: number;
    taskId: number;
    content: string;
    isDone: boolean;
    position: number;
    createdBy: number | null;
    createdAt: string;
}

export interface TaskAttachment {
    id: number;
    taskId: number;
    fileName: string;
    originalName: string;
    mimeType: string | null;
    size: number;
    createdAt: string;
    uploadedBy: UserMini | null;
}

export interface TaskActivity {
    id: number;
    taskId: number;
    type: string;
    fromValue: string | null;
    toValue: string | null;
    meta: unknown;
    createdAt: string;
    actor: UserMini | null;
}

export interface TaskDetail {
    id: number;
    boardId: number;
    title: string;
    description: string | null;
    status: BoardStatus;
    priority: BoardPriority;
    position: number;
    creatorId: number | null;
    assigneeId: number | null;
    dueAt: string | null;
    acceptedAt: string | null;
    acceptedBy: number | null;
    createdAt: string;
    updatedAt: string;
    creator: UserMini | null;
    assignee: UserMini | null;
    comments: TaskComment[];
    checklist: TaskChecklistItem[];
    attachments: TaskAttachment[];
    activity: TaskActivity[];
}

export interface BoardInfo {
    id: number;
    name: string;
    description: string | null;
    isDefault: boolean;
    isArchived: boolean;
}

export interface BoardTasksResponse {
    board: BoardInfo | null;
    tasks: TaskSummary[];
}

export const BOARD_COLUMNS: { status: BoardStatus; labelKey: TranslationKey }[] = [
    { status: 'backlog', labelKey: 'colBacklog' },
    { status: 'todo', labelKey: 'colTodo' },
    { status: 'in_progress', labelKey: 'colInProgress' },
    { status: 'done', labelKey: 'colDone' },
    { status: 'accepted', labelKey: 'colAccepted' },
];

// Traffic-light priorities: urgent (red), normal (amber), non-urgent (green).
// Declared with `satisfies` so the i18n audit recognises the dynamically-used
// label keys (they are looked up via PRIORITY_META[p].labelKey, not literal t()).
export const PRIORITY_META = {
    urgent: { labelKey: 'priorityUrgent', dot: 'bg-red-500', badge: 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400' },
    normal: { labelKey: 'priorityNormal', dot: 'bg-amber-500', badge: 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400' },
    low: { labelKey: 'priorityLow', dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400' },
} satisfies Record<BoardPriority, { labelKey: TranslationKey; dot: string; badge: string }>;

export const PRIORITY_ORDER: BoardPriority[] = ['urgent', 'normal', 'low'];

export function formatBoardDate(value: string | null): string {
    if (!value) return '';
    const date = new Date(value);
    return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

export function formatBoardDateTime(value: string | null): string {
    if (!value) return '';
    const date = new Date(value);
    return date.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function isOverdue(task: { dueAt: string | null; status: BoardStatus }): boolean {
    if (!task.dueAt || task.status === 'accepted' || task.status === 'done') return false;
    return new Date(task.dueAt).getTime() < Date.now();
}

export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
