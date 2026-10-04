type TaskActor = { id: number } | null | undefined;
type TaskOwnership = {
  creatorId?: number | null;
  creator?: { id: number } | null;
  assigneeId?: number | null;
  assignee?: { id: number } | null;
} | null | undefined;

/** Viewing the team board never grants permission to change someone else's work. */
export function canManageBoardTask(actor: TaskActor, task: TaskOwnership): boolean {
  if (!actor || !task) return false;
  const assigneeId = task.assigneeId !== undefined ? task.assigneeId : task.assignee?.id;
  return actor.id === assigneeId;
}

export function isSelfAssignedBoardTask(task: TaskOwnership): boolean {
  if (!task) return false;
  const creatorId = task.creatorId !== undefined ? task.creatorId : task.creator?.id;
  const assigneeId = task.assigneeId !== undefined ? task.assigneeId : task.assignee?.id;
  return creatorId != null && creatorId === assigneeId;
}

/** The author accepts delegated work or finalizes a task they created for themselves. */
export function canFinalizeBoardTask(actor: TaskActor, task: TaskOwnership): boolean {
  if (!actor || !task) return false;
  const creatorId = task.creatorId !== undefined ? task.creatorId : task.creator?.id;
  const assigneeId = task.assigneeId !== undefined ? task.assigneeId : task.assignee?.id;
  return actor.id === creatorId && assigneeId != null;
}
