import { canAccessAcademyModule, hasLeadershipAccess } from '@shared/academy';
import type { SanitizedUser } from '@shared/auth';
import type { NotificationDto } from '@shared/contracts/notifications';

export function notificationDestination(notification: NotificationDto, user: SanitizedUser | null | undefined): string | null {
  const type = notification.relatedEntityType;
  const id = notification.relatedEntityId;
  if (type === 'lead_assignment' && canAccessAcademyModule(user, 'sales')) return '/sales/pipeline';
  if (!id || !Number.isSafeInteger(id) || id <= 0) return null;
  if (type === 'lead' || type === 'academy_lead') return canAccessAcademyModule(user, 'sales') ? `/sales/pipeline?lead=${id}` : null;
  if (type === 'student' || type === 'academy_student') return canAccessAcademyModule(user, 'sales') ? `/sales/clients?student=${id}` : null;
  if (type === 'group' || type === 'academy_group') return canAccessAcademyModule(user, 'teacher') ? `/teacher-module/groups?group=${id}` : null;
  if (type === 'task' || type === 'board_task' || type === 'academy_task') return `/tasks?task=${id}`;
  if (type === 'user') return hasLeadershipAccess(user) ? `/employees?employee=${id}` : null;
  return null;
}
