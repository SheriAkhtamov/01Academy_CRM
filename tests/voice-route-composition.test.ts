import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), warn: vi.fn() }));
vi.mock('../server/lib/logger', () => ({ logger: { warn: mocks.warn } }));
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
import { TelephonyReminderLineBusyError } from '../server/infrastructure/voice-telephony/channel-reservations';

describe('voice routes resolve the active CRM session before domain admission', () => {
  const leader = { id: 7, module: 'administration', modules: ['administration', 'sales'], isActive: true,
    isArchived: false, onlinePbxIncomingEnabled: true, onlinePbxExtension: '100' };
  const snapshot = vi.fn(async () => ({ readiness: { ready: false } }));
  const channels = { enabled: vi.fn(async () => false), acquire: vi.fn(), renew: vi.fn(), release: vi.fn(), authorizeManagerDial: vi.fn(),
    managerLineStatus: vi.fn(),requestManagerLinePriority: vi.fn() };
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
  it('reads only the current authenticated line status and requests priority with an empty command', async () => {
    channels.managerLineStatus.mockResolvedValue({ busyWithReminder: true });
    channels.requestManagerLinePriority.mockResolvedValue({ busyWithReminder: true });
    const status = await request(app(7)).get('/api/telephony/lines/status');
    expect(status.status).toBe(200); expect(status.body).toEqual({ busyWithReminder: true });
    expect(status.headers['cache-control']).toBe('no-store');
    expect(channels.managerLineStatus).toHaveBeenCalledExactlyOnceWith(7,'100');
    expect(channels.requestManagerLinePriority).not.toHaveBeenCalled();
    const requested = await request(app(7)).post('/api/telephony/lines/request-priority').send({});
    expect(requested.status).toBe(200); expect(requested.body).toEqual({ busyWithReminder: true });
    expect(channels.requestManagerLinePriority).toHaveBeenCalledExactlyOnceWith(7,'100');
    expect(channels.acquire).not.toHaveBeenCalled(); expect(channels.enabled).not.toHaveBeenCalled();
    channels.requestManagerLinePriority.mockResolvedValue({ busyWithReminder: false });
    expect((await request(app(7)).post('/api/telephony/lines/request-priority')).body).toEqual({ busyWithReminder: false });
  });
  it('rejects unauthenticated, unassigned or spoofed status and priority requests before repository access', async () => {
    expect((await request(app()).get('/api/telephony/lines/status')).status).toBe(401);
    expect((await request(app()).post('/api/telephony/lines/request-priority').send({})).status).toBe(401);
    for (const query of ['extension=101','userId=8','phone=%2B998901234567'])
      expect((await request(app(7)).get(`/api/telephony/lines/status?${query}`)).status).toBe(400);
    for (const body of [{ extension: '101' },{ userId: 8 },{ phone: '+998901234567' },[]])
      expect((await request(app(7)).post('/api/telephony/lines/request-priority').send(body)).status).toBe(400);
    expect((await request(app(7)).post('/api/telephony/lines/request-priority?extension=101').send({})).status).toBe(400);
    mocks.getUser.mockResolvedValue({ ...leader,onlinePbxIncomingEnabled: false });
    expect((await request(app(7)).get('/api/telephony/lines/status')).status).toBe(403);
    expect((await request(app(7)).post('/api/telephony/lines/request-priority').send({})).status).toBe(403);
    expect(channels.managerLineStatus).not.toHaveBeenCalled(); expect(channels.requestManagerLinePriority).not.toHaveBeenCalled();
  });
  it('keeps stale assignments and unavailable status distinct from a free line without leaking diagnostics', async () => {
    channels.managerLineStatus.mockResolvedValue(null); channels.requestManagerLinePriority.mockResolvedValue(null);
    expect((await request(app(7)).get('/api/telephony/lines/status')).body).toEqual({ error: 'onlinePbxManagerNotAssigned' });
    expect((await request(app(7)).post('/api/telephony/lines/request-priority').send({})).status).toBe(403);
    channels.managerLineStatus.mockRejectedValue(new Error('Private SQL/provider secret'));
    channels.requestManagerLinePriority.mockRejectedValue(new Error('Private SQL/provider secret'));
    const status = await request(app(7)).get('/api/telephony/lines/status');
    expect(status.status).toBe(503); expect(status.body).toEqual({ error: 'onlinePbxUnavailable' });
    const priority = await request(app(7)).post('/api/telephony/lines/request-priority').send({});
    expect(priority.status).toBe(503); expect(priority.body).toEqual({ error: 'onlinePbxUnavailable' });
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
  it('returns a specific committed reminder conflict for reserve and authorization without leaking internal details', async () => {
    channels.enabled.mockResolvedValue(true);
    channels.acquire.mockRejectedValueOnce(new TelephonyReminderLineBusyError());
    const response = await request(app(7)).post('/api/telephony/lines/reserve')
      .send({ clientCallId: randomUUID(),phone: '+998901234567' });
    expect(response.status).toBe(409); expect(response.body).toEqual({ error: 'onlinePbxLineBusyWithReminder' });
    expect(response.headers['cache-control']).toBe('no-store');
    channels.authorizeManagerDial.mockRejectedValueOnce(new TelephonyReminderLineBusyError());
    expect((await request(app(7)).post('/api/telephony/lines/authorize').send({ id: randomUUID() })).body)
      .toEqual({ error: 'onlinePbxLineBusyWithReminder' });
    channels.acquire.mockRejectedValueOnce(new Error('private SQL or storage path'));
    const unavailable = await request(app(7)).post('/api/telephony/lines/reserve')
      .send({ clientCallId: randomUUID(),phone: '+998901234567' });
    expect(unavailable.status).toBe(503); expect(unavailable.body).toEqual({ error: 'onlinePbxUnavailable' });
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
  it('records the authenticated line and safe refusal reason without phone or provider details', async () => {
    channels.enabled.mockResolvedValue(true);
    const clientCallId = randomUUID();
    channels.acquire.mockResolvedValueOnce(null);
    expect((await request(app(7)).post('/api/telephony/lines/reserve')
      .send({ clientCallId, phone: '+998901234567' })).status).toBe(409);
    expect(mocks.warn).toHaveBeenLastCalledWith('Telephony line admission denied', {
      phase: 'reserve', reason: 'onlinePbxTooManyCalls', userId: 7, extension: '100', clientCallId,
    });
    const reservationId = randomUUID();
    channels.authorizeManagerDial.mockResolvedValueOnce(false);
    expect((await request(app(7)).post('/api/telephony/lines/authorize')
      .send({ id: reservationId })).body).toEqual({ authorized: false });
    expect(mocks.warn).toHaveBeenLastCalledWith('Telephony line admission denied', {
      phase: 'authorize', reason: 'onlinePbxTooManyCalls', userId: 7, extension: '100', reservationId,
    });
    channels.acquire.mockRejectedValueOnce(new Error('private provider payload'));
    expect((await request(app(7)).post('/api/telephony/lines/reserve')
      .send({ clientCallId, phone: '+998901234567' })).status).toBe(503);
    expect(mocks.warn).toHaveBeenLastCalledWith('Telephony line admission denied', {
      phase: 'reserve', reason: 'onlinePbxUnavailable', userId: 7, extension: '100', clientCallId,
    });
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toMatch(/private provider payload|998901234567/);
  });
  it('preserves the refusal response even if diagnostic logging fails', async () => {
    channels.enabled.mockResolvedValue(true);
    channels.acquire.mockRejectedValueOnce(new TelephonyReminderLineBusyError());
    mocks.warn.mockImplementationOnce(() => { throw new Error('Log transport failed'); });
    const response = await request(app(7)).post('/api/telephony/lines/reserve')
      .send({ clientCallId: randomUUID(), phone: '+998901234567' });
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'onlinePbxLineBusyWithReminder' });
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
