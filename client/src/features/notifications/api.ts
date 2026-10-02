import { apiRequest } from '@/lib/queryClient';
import type { NotificationPage } from '@shared/contracts/notifications';

export const notificationQueryKeys = {
  all: ['/api/notifications'] as const,
  pages: ['/api/notifications', 'pages'] as const,
  unread: ['/api/notifications', 'unread-count'] as const,
};
export const notificationsApi = {
  page: (offset: number): Promise<NotificationPage> => apiRequest('GET', `/api/notifications/page?offset=${offset}&limit=25`),
  unread: (): Promise<{ count: number }> => apiRequest('GET', '/api/notifications/unread-count'),
  markRead: (id: number) => apiRequest('PUT', `/api/notifications/${id}/read`),
  markAllRead: () => apiRequest('PUT', '/api/notifications/read-all'),
  remove: (id: number) => apiRequest('DELETE', `/api/notifications/${id}`),
};
