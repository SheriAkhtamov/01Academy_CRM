import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getNotificationsByUser: vi.fn(),
  markNotificationAsRead: vi.fn(),
  deleteNotification: vi.fn(),
}));

vi.mock('../server/storage', () => ({
  storage: {
    getNotificationsByUser: mocks.getNotificationsByUser,
    markAllNotificationsAsRead: vi.fn(async () => undefined),
    markNotificationAsRead: mocks.markNotificationAsRead,
    deleteNotification: mocks.deleteNotification,
  },
}));

vi.mock('../server/middleware/auth.middleware', () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.user = { id: 7 };
    next();
  },
}));

vi.mock('../server/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

const createApp = async () => {
  const { default: routes } = await import('../server/routes/notifications.routes');
  const app = express();
  app.use(express.json());
  app.use('/api/notifications', routes);
  return app;
};

describe('notification route boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getNotificationsByUser.mockResolvedValue([]);
  });

  it('lists notifications only for the authenticated user', async () => {
    mocks.getNotificationsByUser.mockResolvedValue([{ id: 9, userId: 7 }]);

    const response = await request(await createApp()).get('/api/notifications');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 9, userId: 7 }]);
    expect(mocks.getNotificationsByUser).toHaveBeenCalledWith(7);
  });

  it('rejects partially numeric IDs instead of targeting another notification', async () => {
    const response = await request(await createApp()).put('/api/notifications/12oops/read');

    expect(response.status).toBe(400);
    expect(mocks.markNotificationAsRead).not.toHaveBeenCalled();
  });

  it('returns not found when the notification is not owned by the current user', async () => {
    mocks.markNotificationAsRead.mockResolvedValue(undefined);

    const response = await request(await createApp()).put('/api/notifications/12/read');

    expect(response.status).toBe(404);
    expect(mocks.markNotificationAsRead).toHaveBeenCalledWith(12, 7);
  });

  it('does not report a successful delete when no owned row was deleted', async () => {
    mocks.deleteNotification.mockResolvedValue(false);

    const response = await request(await createApp()).delete('/api/notifications/12');

    expect(response.status).toBe(404);
    expect(mocks.deleteNotification).toHaveBeenCalledWith(12, 7);
  });
});
