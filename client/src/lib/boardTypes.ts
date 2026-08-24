import type { TranslationKey } from '@/lib/i18n';
import type { AcademyModule } from '@shared/academy';
import { formatAcademyDate } from '@/lib/localeFormat';

export type BoardStatus = 'backlog' | 'todo' | 'in_progress' | 'done' | 'accepted';
export type BoardPriority = 'urgent' | 'normal' | 'low';
export type BoardTaskColor = 'blue' | 'emerald' | 'amber' | 'violet' | 'rose' | 'cyan';

export interface UserMini {
    id: number;
    fullName: string;
    position: string | null;
    module: AcademyModule;
}

export interface TaskSummary {
    id: number;
    boardId: number;
    title: string;
    description: string | null;
    status: BoardStatus;
    priority: BoardPriority;
    color: BoardTaskColor | null;
    position: number;
    leadId: number | null;
    lead: { id: number; contactName: string } | null;
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
    color: BoardTaskColor | null;
    position: number;
    creatorId: number | null;
    assigneeId: number | null;
    leadId: number | null;
    lead: { id: number; contactName: string } | null;
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
    { status: 'in_progress', labelKey: 'taskInProgress' },
    { status: 'done', labelKey: 'taskDone' },
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

export const TASK_COLOR_ORDER = ['blue', 'emerald', 'amber', 'violet', 'rose', 'cyan'] as const satisfies readonly BoardTaskColor[];

// Controlled colour tokens keep task cards legible in both themes and map to
// the same semantic palette used by the calendar. `null` remains the neutral
// card, so existing tasks do not change appearance after the migration.
export const TASK_COLOR_META = {
    blue: {
        labelKey: 'taskColorBlue',
        swatch: 'bg-blue-500',
        card: 'border-blue-300 bg-blue-50/70 hover:border-blue-400 dark:border-blue-800 dark:bg-blue-950/30 dark:hover:border-blue-700',
        calendarToneIndex: 0,
    },
    emerald: {
        labelKey: 'taskColorEmerald',
        swatch: 'bg-emerald-500',
        card: 'border-emerald-300 bg-emerald-50/70 hover:border-emerald-400 dark:border-emerald-800 dark:bg-emerald-950/30 dark:hover:border-emerald-700',
        calendarToneIndex: 1,
    },
    amber: {
        labelKey: 'taskColorAmber',
        swatch: 'bg-amber-400',
        card: 'border-amber-300 bg-amber-50/80 hover:border-amber-400 dark:border-amber-800 dark:bg-amber-950/30 dark:hover:border-amber-700',
        calendarToneIndex: 2,
    },
    violet: {
        labelKey: 'taskColorViolet',
        swatch: 'bg-violet-500',
        card: 'border-violet-300 bg-violet-50/70 hover:border-violet-400 dark:border-violet-800 dark:bg-violet-950/30 dark:hover:border-violet-700',
        calendarToneIndex: 3,
    },
    rose: {
        labelKey: 'taskColorRose',
        swatch: 'bg-rose-500',
        card: 'border-rose-300 bg-rose-50/70 hover:border-rose-400 dark:border-rose-800 dark:bg-rose-950/30 dark:hover:border-rose-700',
        calendarToneIndex: 4,
    },
    cyan: {
        labelKey: 'taskColorCyan',
        swatch: 'bg-cyan-500',
        card: 'border-cyan-300 bg-cyan-50/70 hover:border-cyan-400 dark:border-cyan-800 dark:bg-cyan-950/30 dark:hover:border-cyan-700',
        calendarToneIndex: 5,
    },
} satisfies Record<BoardTaskColor, {
    labelKey: TranslationKey;
    swatch: string;
    card: string;
    calendarToneIndex: number;
}>;

// These took the browser locale, so a task card's due date could disagree with
// every other date on screen. They follow the language the user picked instead.
export function formatBoardDate(value: string | null, language: string): string {
    return formatAcademyDate(value, language, { day: '2-digit', month: 'short' });
}

export function formatBoardDateTime(value: string | null, language: string): string {
    return formatAcademyDate(value, language, {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export function isOverdue(task: { dueAt: string | null; status: BoardStatus }): boolean {
    if (!task.dueAt || task.status === 'accepted' || task.status === 'done') return false;
    return new Date(task.dueAt).getTime() < Date.now();
}

// The board opens on the viewer's own work and the header filter widens it to a
// colleague — or, for a head who receives every task, to the whole team.
// A person's tasks are the ones assigned to them plus the ones they wrote:
// filtering on the assignee alone would hide the work someone delegated and
// still answers for.
export const TASK_OWNER_ALL = 'all';

export type TaskOwnerFilter = number | typeof TASK_OWNER_ALL;

type TaskOwnership = Pick<TaskSummary, 'assignee' | 'creator'>;

export function isTaskOwnedBy(task: TaskOwnership, userId: number): boolean {
    return task.assignee?.id === userId || task.creator?.id === userId;
}

export function filterTasksByOwner<T extends TaskOwnership>(tasks: T[], owner: TaskOwnerFilter): T[] {
    return owner === TASK_OWNER_ALL ? tasks : tasks.filter((task) => isTaskOwnedBy(task, owner));
}

// One task counts once per person even when they both wrote it and own it.
export function countTasksByOwner(tasks: TaskOwnership[]): Map<number, number> {
    const counts = new Map<number, number>();
    for (const task of tasks) {
        const owners = new Set<number>();
        if (task.assignee) owners.add(task.assignee.id);
        if (task.creator) owners.add(task.creator.id);
        for (const ownerId of owners) counts.set(ownerId, (counts.get(ownerId) ?? 0) + 1);
    }
    return counts;
}

export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
