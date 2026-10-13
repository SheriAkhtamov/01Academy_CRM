import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock('../server/storage', () => ({ storage: { getUser: mocks.getUser } }));
vi.mock('../server/modules/academy', () => ({ default: express.Router() }));
vi.mock('../server/routes/auth.routes', () => ({ default: express.Router() }));
vi.mock('../server/routes/client-errors.routes', () => ({ default: express.Router() }));
vi.mock('../server/routes/board.routes', () => ({ default: express.Router() }));
vi.mock('../server/routes/finance.routes', () => ({ default: express.Router() }));
vi.mock('../server/routes/incoming.routes', () => ({ default: express.Router() }));
vi.mock('../server/routes/instagram.routes', () => ({ default: express.Router() }));
vi.mock('../server/routes/message.routes', () => ({ default: express.Router() }));
vi.mock('../server/services/chat-groups', () => ({ default: express.Router() }));
vi.mock('../server/infrastructure/platform-updates', () => ({ updatesRouter: express.Router() }));
vi.mock('../server/routes/notifications.routes', () => ({ default: express.Router() }));
vi.mock('../server/routes/telephony.routes', () => ({ default: express.Router(), createTelephonyRouter: () => express.Router() }));
vi.mock('../server/routes/user.routes', () => ({ default: express.Router() }));
vi.mock('../server/routes/public-attendance.routes', () => ({ default: express.Router() }));

import { registerApiRoutes } from '../server/routes';
import { createVoiceReminderRouter } from '../server/modules/voice-reminders/http/voice-reminders.router';
import type { createVoiceRemindersRuntime } from '../server/infrastructure/voice-reminders-runtime';
import type { VoiceReminderSettingsService } from '../server/modules/voice-reminders/application/settings-service';

describe('voice routes resolve the active CRM session before domain admission', () => {
  const leader = { id: 7, module: 'administration', modules: ['administration', 'sales'], isActive: true,
    isArchived: false, onlinePbxIncomingEnabled: true, onlinePbxExtension: '100' };
  const snapshot = vi.fn(async () => ({ readiness: { ready: false } }));
  const channels = { enabled: vi.fn(async () => false), acquire: vi.fn(), renew: vi.fn(), release: vi.fn(), authorizeManagerDial: vi.fn() };
  const destroy = vi.fn();
  const app = (sessionUserId?: number) => {
    const application = express(); application.use(express.json());
    application.use((req, _res, next) => {
      req.session = { userId: sessionUserId, destroy } as unknown as typeof req.session; next();
    });
    const runtime = { channels, observeRobotCall: async () => false,
      router: createVoiceReminderRouter({ snapshot } as unknown as VoiceReminderSettingsService) };
    registerApiRoutes(application, runtime as unknown as ReturnType<typeof createVoiceRemindersRuntime>);
    return application;
  };
  beforeEach(() => { vi.clearAllMocks(); mocks.getUser.mockResolvedValue(leader); channels.enabled.mockResolvedValue(false); });

  it('rejects requests without a session before touching settings or provider admission', async () => {
    expect((await request(app()).get('/api/academy/voice-reminders')).status).toBe(401);
    expect((await request(app()).post('/api/telephony/lines/reserve').send({})).status).toBe(401);
    expect(mocks.getUser).not.toHaveBeenCalled(); expect(snapshot).not.toHaveBeenCalled();
    expect(channels.enabled).not.toHaveBeenCalled();
  });
  it('loads the leadership actor from a session that has no prepopulated req.user', async () => {
    expect((await request(app(7)).get('/api/academy/voice-reminders')).status).toBe(200);
    expect(mocks.getUser).toHaveBeenCalledWith(7);
    expect(snapshot).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, isLeadership: true }));
  });
  it('preserves normal manager dialing when reminders are disabled', async () => {
    mocks.getUser.mockResolvedValue({ ...leader, module: 'sales', modules: ['sales'] });
    expect((await request(app(7)).get('/api/academy/voice-reminders')).status).toBe(403);
    const response = await request(app(7)).post('/api/telephony/lines/reserve').send({ clientCallId: randomUUID(), phone: '+998901234567' });
    expect(response.status).toBe(200); expect(response.body).toEqual({ id: null });
    expect(channels.acquire).not.toHaveBeenCalled();
  });
  it('does not accept an actor or extension supplied by the browser', async () => {
    channels.enabled.mockResolvedValue(true);
    const response = await request(app(7)).post('/api/telephony/lines/reserve').send({
      clientCallId: randomUUID(), phone: '+998901234567', userId: 999, extension: '101', owner: 'robot',
    });
    expect(response.status).toBe(400); expect(channels.acquire).not.toHaveBeenCalled();
  });
  it('binds reservation ownership to the authenticated manager and assigned extension', async () => {
    channels.enabled.mockResolvedValue(true); channels.acquire.mockResolvedValue({ id: 'owned-lease' });
    const clientCallId = randomUUID();
    const response = await request(app(7)).post('/api/telephony/lines/reserve').send({ clientCallId, phone: '+998901234567' });
    expect(response.status).toBe(200);
    expect(channels.acquire).toHaveBeenCalledWith({ owner: 'manager', userId: 7, extensions: ['100'], clientCallId, phone: '+998901234567' });
  });
  it('rejects inactive sessions and unassigned staff', async () => {
    mocks.getUser.mockResolvedValue({ ...leader, isActive: false });
    expect((await request(app(7)).get('/api/academy/voice-reminders')).status).toBe(401);
    expect(destroy).toHaveBeenCalled();
    mocks.getUser.mockResolvedValue({ ...leader, module: 'education', modules: ['education'] });
    expect((await request(app(7)).get('/api/academy/voice-reminders')).status).toBe(403);
    expect((await request(app(7)).post('/api/telephony/lines/reserve').send({})).status).toBe(403);
    expect(snapshot).not.toHaveBeenCalled(); expect(channels.enabled).not.toHaveBeenCalled();
  });
  it('authorizes and cancels only the authenticated manager intent', async () => {
    const id = randomUUID();
    channels.authorizeManagerDial.mockResolvedValue(true); channels.release.mockResolvedValue(true);
    expect((await request(app(7)).post('/api/telephony/lines/authorize').send({ id })).body).toEqual({ authorized: true });
    expect(channels.authorizeManagerDial).toHaveBeenCalledWith(id, 7, '100');
    expect((await request(app(7)).post('/api/telephony/lines/release').send({ id, beforeInvite: true })).body).toEqual({ released: true });
    expect(channels.release).toHaveBeenCalledWith(id, 'manager', 7, true);
    expect((await request(app(7)).post('/api/telephony/lines/authorize').send({ id, extension: '101' })).status).toBe(400);
  });
});
