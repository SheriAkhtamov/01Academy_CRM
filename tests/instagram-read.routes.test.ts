import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ read: vi.fn(), viewer: { id: 7, module: 'sales', modules: ['sales'] } }));
vi.mock('../server/services/instagram', () => ({
  markInstagramConversationRead: mocks.read,
  buildInstagramAuthorizationUrl: vi.fn(), disconnectInstagramAccount: vi.fn(),
  exchangeInstagramAuthorizationCode: vi.fn(), getInstagramIntegrationConfig: vi.fn(),
  getInstagramConversationSyncStatus: vi.fn(), listInstagramAccounts: vi.fn(),
  listInstagramConversations: vi.fn(), listInstagramMessages: vi.fn(), sendInstagramTextMessage: vi.fn(),
  startInstagramConversationHistorySync: vi.fn(),
}));
vi.mock('../server/middleware/auth.middleware', () => ({
  requireAuth: ((req, _res, next) => { req.user = mocks.viewer as never; next(); }) satisfies RequestHandler,
}));
import instagramRoutes from '../server/routes/instagram.routes';

const app = express();
app.use(express.json());
app.use('/api/instagram', instagramRoutes);
beforeEach(() => { vi.clearAllMocks(); mocks.viewer = { id: 7, module: 'sales', modules: ['sales'] }; });

describe('Instagram received-message read cursor API', () => {
  it('passes the client received boundary through to the authorized service', async () => {
    mocks.read.mockResolvedValue({ id: 9, unreadCount: 1 });
    const response = await request(app).post('/api/instagram/conversations/9/read').send({ lastReadMessageId: 31 });
    expect(response.status).toBe(200);
    expect(response.body.unreadCount).toBe(1);
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(9, mocks.viewer, 31);
  });

  it.each([{}, { lastReadMessageId: 0 }, { lastReadMessageId: -1 }, { lastReadMessageId: 1.5 }, { lastReadMessageId: '31' }])(
    'rejects invalid or missing boundaries %j without changing unread state', async (body) => {
      const response = await request(app).post('/api/instagram/conversations/9/read').send(body);
      expect(response.status).toBe(400);
      expect(mocks.read).not.toHaveBeenCalled();
    },
  );
});
