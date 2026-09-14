import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getNotificationsByUser: vi.fn(),
  getUsers: vi.fn(),
  createNotifications: vi.fn(),
  createMessages: vi.fn(),
  createAuditLog: vi.fn(),
  markNotificationAsRead: vi.fn(),
  deleteNotification: vi.fn(),
  broadcast: vi.fn(),
}));

vi.mock('../server/storage', () => ({
  storage: {
    getNotificationsByUser: mocks.getNotificationsByUser,
    getUsers: mocks.getUsers,
    createNotifications: mocks.createNotifications,
    createMessages: mocks.createMessages,
    createAuditLog: mocks.createAuditLog,
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
  requireAdministration: (req: any, _res: any, next: () => void) => {
    req.user = { id: 7, module: 'administration', modules: ['administration'] };
    next();
  },
}));

vi.mock('../server/realtime/realtime-hub', () => ({
  publishRealtimeEvent: mocks.broadcast,
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
    mocks.getUsers.mockResolvedValue([
      { id: 7, fullName: 'Administrator', isActive: true, isArchived: false },
      { id: 8, fullName: 'First Employee', isActive: true, isArchived: false },
      { id: 9, fullName: 'Second Employee', isActive: true, isArchived: false },
    ]);
    mocks.createNotifications.mockImplementation(async (items: any[]) => (
      items.map((item, index) => ({ ...item, id: index + 1 }))
    ));
    mocks.createMessages.mockImplementation(async (items: any[]) => (
      items.map((item, index) => ({ ...item, id: index + 1 }))
    ));
    mocks.createAuditLog.mockResolvedValue({ id: 1 });
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

  it('broadcasts a system notification only to the selected active employees', async () => {
    const response = await request(await createApp())
      .post('/api/notifications/broadcast')
      .send({
        channel: 'notification',
        recipientIds: [8, 9],
        title: 'Schedule update',
        content: 'Tomorrow starts at 10:00.',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ channel: 'notification', sentCount: 2 });
    expect(mocks.createNotifications).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 8, title: 'Schedule update', isRead: false }),
      expect.objectContaining({ userId: 9, title: 'Schedule update', isRead: false }),
    ]);
    expect(mocks.broadcast).toHaveBeenCalledWith({
      type: 'NEW_NOTIFICATION',
      data: { count: 2 },
      audienceUserIds: [8, 9],
    });
  });

  it('creates ordinary direct messages so broadcasts appear in employee chat', async () => {
    const response = await request(await createApp())
      .post('/api/notifications/broadcast')
      .send({
        channel: 'message',
        recipientIds: [8, 9],
        content: 'Please check the new schedule.',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ channel: 'message', sentCount: 2 });
    expect(mocks.createMessages).toHaveBeenCalledWith([
      expect.objectContaining({ senderId: 7, receiverId: 8, isRead: false }),
      expect.objectContaining({ senderId: 7, receiverId: 9, isRead: false }),
    ]);
    expect(mocks.broadcast).toHaveBeenCalledTimes(2);
    expect(mocks.broadcast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'NEW_MESSAGE',
      audienceUserIds: [7, 8],
    }));
  });

  it('rejects unavailable recipients before creating any broadcast records', async () => {
    mocks.getUsers.mockResolvedValue([
      { id: 8, fullName: 'Inactive Employee', isActive: false, isArchived: false },
    ]);

    const response = await request(await createApp())
      .post('/api/notifications/broadcast')
      .send({ channel: 'message', recipientIds: [8], content: 'Hello' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'employeeBroadcastRecipientsUnavailable' });
    expect(mocks.createMessages).not.toHaveBeenCalled();
    expect(mocks.createNotifications).not.toHaveBeenCalled();
  });
});
