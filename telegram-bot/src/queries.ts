import { pool } from './db.js';

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'done' | 'accepted';
export type TaskPriority = 'urgent' | 'normal' | 'low';

export interface ActiveTask {
    id: number;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    dueAt: Date | null;
    assigneeId: number | null;
    assigneeName: string | null;
    creatorId: number | null;
    creatorName: string | null;
}

// All tasks that are not yet closed (everything except "accepted"), with the
// assignee and creator names resolved. Categorisation happens in summary.ts.
export async function getActiveTasks(): Promise<ActiveTask[]> {
    const { rows } = await pool.query(`
        SELECT
            t.id,
            t.title,
            t.status,
            t.priority,
            t.due_at        AS "dueAt",
            t.assignee_id   AS "assigneeId",
            a.full_name     AS "assigneeName",
            t.creator_id    AS "creatorId",
            c.full_name     AS "creatorName"
        FROM board_tasks t
        LEFT JOIN users a ON a.id = t.assignee_id
        LEFT JOIN users c ON c.id = t.creator_id
        WHERE t.status <> 'accepted'
        ORDER BY t.due_at NULLS LAST, t.id
    `);
    return rows as ActiveTask[];
}
