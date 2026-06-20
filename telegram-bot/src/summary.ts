import { config } from './config.js';
import type { ActiveTask, TaskPriority } from './queries.js';

export type SummaryKind = 'morning' | 'afternoon';

const PRIORITY_EMOJI: Record<TaskPriority, string> = {
    urgent: '🔴',
    normal: '🟡',
    low: '🟢',
};

// YYYY-MM-DD for a date in the team timezone.
function dayKey(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: config.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
}

function daysBetweenKeys(fromKey: string, toKey: string): number {
    const a = Date.parse(`${fromKey}T00:00:00Z`);
    const b = Date.parse(`${toKey}T00:00:00Z`);
    return Math.round((b - a) / 86_400_000);
}

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtDate(date: Date): string {
    return new Intl.DateTimeFormat('ru-RU', {
        timeZone: config.timezone,
        day: '2-digit',
        month: 'long',
    }).format(date);
}

function pluralDays(n: number): string {
    const abs = Math.abs(n) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20) return 'дней';
    if (last === 1) return 'день';
    if (last >= 2 && last <= 4) return 'дня';
    return 'дней';
}

function assignee(task: ActiveTask): string {
    return task.assigneeName ? escapeHtml(task.assigneeName) : '— не назначен';
}

function line(task: ActiveTask): string {
    return `${PRIORITY_EMOJI[task.priority]} ${escapeHtml(task.title)}`;
}

interface Categorised {
    overdue: ActiveTask[];
    dueToday: ActiveTask[];
    awaitingAcceptance: ActiveTask[];
    todoByAssignee: Map<string, ActiveTask[]>;
    todoCount: number;
}

export function categorise(tasks: ActiveTask[], now: Date): Categorised {
    const today = dayKey(now);

    const isOverdue = (t: ActiveTask) =>
        t.dueAt != null &&
        ['backlog', 'todo', 'in_progress'].includes(t.status) &&
        dayKey(new Date(t.dueAt)) < today;

    const overdue = tasks.filter(isOverdue);
    const dueToday = tasks.filter(
        (t) => !isOverdue(t) && t.status === 'in_progress' && t.dueAt != null && dayKey(new Date(t.dueAt)) === today,
    );
    const awaitingAcceptance = tasks.filter((t) => t.status === 'done');

    // To-Do that is not already surfaced in the overdue section.
    const todo = tasks.filter((t) => t.status === 'todo' && !isOverdue(t));
    const todoByAssignee = new Map<string, ActiveTask[]>();
    for (const t of todo) {
        const key = t.assigneeName ?? '— не назначен';
        const list = todoByAssignee.get(key) ?? [];
        list.push(t);
        todoByAssignee.set(key, list);
    }

    return { overdue, dueToday, awaitingAcceptance, todoByAssignee, todoCount: todo.length };
}

export function buildSummary(tasks: ActiveTask[], kind: SummaryKind, now: Date = new Date()): string {
    const c = categorise(tasks, now);
    const today = dayKey(now);

    const heading = kind === 'morning'
        ? `☀️ <b>Утренняя сводка задач</b> — ${fmtDate(now)}`
        : `🌆 <b>Дневная сводка задач</b> — ${fmtDate(now)}`;

    const parts: string[] = [heading, ''];

    const nothing =
        c.overdue.length === 0 &&
        c.dueToday.length === 0 &&
        c.awaitingAcceptance.length === 0 &&
        c.todoCount === 0;

    if (nothing) {
        parts.push('Все задачи под контролем 🎉');
        parts.push('', `🔗 <a href="${config.boardUrl}">Открыть доску</a>`);
        return parts.join('\n');
    }

    // 🔴 Overdue — most important first.
    if (c.overdue.length > 0) {
        parts.push(`🔴 <b>Просроченные (${c.overdue.length})</b>`);
        for (const t of c.overdue) {
            const dueKey = dayKey(new Date(t.dueAt!));
            const overdueDays = daysBetweenKeys(dueKey, today);
            parts.push(
                `${line(t)} — ${assignee(t)} <i>(просрочено на ${overdueDays} ${pluralDays(overdueDays)})</i>`,
            );
        }
        parts.push('');
    }

    // ⏰ In progress, deadline today.
    if (c.dueToday.length > 0) {
        parts.push(`⏰ <b>Дедлайн сегодня — в процессе (${c.dueToday.length})</b>`);
        for (const t of c.dueToday) {
            parts.push(`${line(t)} — ${assignee(t)}`);
        }
        parts.push('');
    }

    // ✅ Done, awaiting acceptance by the creator.
    if (c.awaitingAcceptance.length > 0) {
        parts.push(`✅ <b>Выполнены, ждут принятия (${c.awaitingAcceptance.length})</b>`);
        for (const t of c.awaitingAcceptance) {
            const by = t.assigneeName ? escapeHtml(t.assigneeName) : '—';
            const accept = t.creatorName ? escapeHtml(t.creatorName) : '—';
            parts.push(`${line(t)} — выполнил(а) ${by}, принять: <b>${accept}</b>`);
        }
        parts.push('');
    }

    // 📋 To-Do grouped by assignee.
    if (c.todoCount > 0) {
        parts.push(`📋 <b>To-Do по сотрудникам (${c.todoCount})</b>`);
        const names = [...c.todoByAssignee.keys()].sort((a, b) => a.localeCompare(b, 'ru'));
        for (const name of names) {
            const list = c.todoByAssignee.get(name)!;
            parts.push(`<b>${escapeHtml(name)}</b>:`);
            for (const t of list) parts.push(`  ${line(t)}`);
        }
        parts.push('');
    }

    parts.push(`🔗 <a href="${config.boardUrl}">Открыть доску</a>`);
    return parts.join('\n').trim();
}
