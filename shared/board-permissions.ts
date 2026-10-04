type TaskActor = { id: number } | null | undefined;
type TaskAssignee = {
  assigneeId?: number | null;
  assignee?: { id: number } | null;
} | null | undefined;

/** Viewing the team board never grants permission to change someone else's work. */
export function canManageBoardTask(actor: TaskActor, task: TaskAssignee): boolean {
  if (!actor || !task) return false;
  const assigneeId = task.assigneeId !== undefined ? task.assigneeId : task.assignee?.id;
  return actor.id === assigneeId;
}
