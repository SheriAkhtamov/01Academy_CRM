import { apiRequest } from '@/lib/queryClient';

export type CreateLeadTaskInput = {
  title: string;
  description: string;
  dueAt: string | null;
  assigneeId?: number;
  status: 'backlog';
  priority: 'normal';
  leadId: number;
};

export const boardQueryKeys = {
  tasks: ['/api/board/tasks'] as const,
};

export const boardApi = {
  createTask: <T>(input: CreateLeadTaskInput) => (
    apiRequest('POST', '/api/board/tasks', input) as Promise<T>
  ),
  updateTaskStatus: <T>(taskId: number, status: string) => (
    apiRequest('PATCH', `/api/board/tasks/${taskId}/status`, { status }) as Promise<T>
  ),
  /** `null` clears the deadline; the task keeps its status either way. */
  updateTaskDueAt: <T>(taskId: number, dueAt: string | null) => (
    apiRequest('PATCH', `/api/board/tasks/${taskId}`, { dueAt }) as Promise<T>
  ),
};
