export type TelegramTaskView = 'mine' | 'assigned' | 'archive';
export type TelegramTaskSection = 'comments' | 'attachments' | 'activity';
export type TelegramTaskDestination = {
  view?: TelegramTaskView;
  taskId?: number;
  section?: TelegramTaskSection;
  commentId?: number;
  attachmentId?: number;
  ownerId?: number;
};

const positiveId = (value: string | null): number | undefined => {
  if (!value || !/^[1-9]\d*$/.test(value)) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : undefined;
};

export function readTelegramTaskDestination(search: string): TelegramTaskDestination {
  const params = new URLSearchParams(search);
  const view = params.get('view');
  const section = params.get('section');
  const taskId = positiveId(params.get('task'));
  return {
    view: view === 'assigned' || view === 'archive' ? view : 'mine',
    ownerId: positiveId(params.get('owner')),
    ...(taskId ? {
      taskId,
      section: section === 'attachments' || section === 'activity' ? section : 'comments',
      commentId: positiveId(params.get('comment')),
      attachmentId: positiveId(params.get('attachment')),
    } : {}),
  };
}

export function telegramTaskUrl(appUrl: string, destination: TelegramTaskDestination = {}): string {
  const url = new URL(appUrl);
  url.search = '';
  url.hash = '';
  url.searchParams.set('view', destination.view ?? 'mine');
  if (destination.ownerId) url.searchParams.set('owner', String(destination.ownerId));
  if (destination.taskId) {
    url.searchParams.set('task', String(destination.taskId));
    if (destination.section) url.searchParams.set('section', destination.section);
    if (destination.commentId) url.searchParams.set('comment', String(destination.commentId));
    if (destination.attachmentId) url.searchParams.set('attachment', String(destination.attachmentId));
  }
  return url.href;
}
