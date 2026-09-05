// Files stay in this tab's memory across session reauthentication. They are
// never serialized to storage or exposed to a different signed-in account.
const pending = new Map<string, File>();
const key = (userId: number, taskId: number) => `${userId}:${taskId}`;

export function getPendingAttachment(userId: number, taskId: number) {
  return pending.get(key(userId, taskId)) ?? null;
}
export function retainPendingAttachment(userId: number, taskId: number, file: File) {
  pending.set(key(userId, taskId), file);
}
export function clearPendingAttachment(userId: number, taskId: number, file?: File) {
  const id = key(userId, taskId);
  if (!file || pending.get(id) === file) pending.delete(id);
}
