import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  resolve: vi.fn(),
  viewer: { id: 7, module: 'sales', modules: ['sales'] } as { id: number; module: string; modules: string[] },
}));
vi.mock('../server/db', () => ({ pool: { query: mocks.query, connect: vi.fn() } }));
vi.mock('../server/services/telephony-recording', () => ({ resolveOnlinePbxRecording: mocks.resolve }));
vi.mock('../server/middleware/auth.middleware', () => ({
  requireAuth: ((req, _res, next) => { req.user = mocks.viewer as never; next(); }) satisfies RequestHandler,
}));
import telephonyRoutes from '../server/routes/telephony.routes';
import { loadAuthorizedRecordingCall } from '../server/routes/telephony-recording.routes';
import { telephonyCallVisibilityCondition } from '../server/services/telephony-notifications';

const app = express();
app.use(express.json());
app.use('/api/telephony', telephonyRoutes);
const call = {
  id: 71, userId: 16, providerCallId: 'known-call', direction: 'incoming',
  phone: '+998901234567', startedAt: '2026-10-08T10:00:00Z', talkSeconds: 60,
  recordingUrl: null, leadId: 123, leadManagerId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.viewer = { id: 7, module: 'sales', modules: ['sales'] };
  mocks.query.mockResolvedValue({ rows: [] });
});

describe('direct recording and note visibility', () => {
  it.each(['recording', 'recording/media', 'note'])('denies a journal-hidden call through %s', async (endpoint) => {
    const result = endpoint === 'note'
      ? await request(app).put('/api/telephony/calls/71/note').send({ note: 'Changed note' })
      : await request(app).get(`/api/telephony/calls/71/${endpoint}`);
    expect(result.status).toBe(404);
    expect(mocks.resolve).not.toHaveBeenCalled();
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toContain(`WHERE call.id = $1 AND ${telephonyCallVisibilityCondition(mocks.viewer, '$2')}`);
    expect(sql).toContain('assignment.funnel_id = lead.funnel_id');
    expect(sql).toContain('auto_lead_distribution_enabled = true');
    expect(params).toEqual([71, 7]);
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it('retains leadership access to team recordings', async () => {
    mocks.viewer = { id: 1, module: 'administration', modules: ['administration'] };
    mocks.query.mockResolvedValue({ rows: [call] });
    expect(await loadAuthorizedRecordingCall(71, mocks.viewer as never)).toEqual(call);
    expect(mocks.query.mock.calls[0][0]).toContain('WHERE call.id = $1 AND TRUE');
    expect(mocks.query.mock.calls[0][1]).toEqual([71]);
  });

  it('restricts a non-sales viewer to their own call instead of unassigned leads', async () => {
    mocks.viewer = { id: 3, module: 'teacher', modules: ['teacher'] };
    await expect(loadAuthorizedRecordingCall(71, mocks.viewer as never)).resolves.toBeNull();
    expect(mocks.query.mock.calls[0][0]).toContain('WHERE call.id = $1 AND call.user_id = $2');
    expect(mocks.query.mock.calls[0][0]).not.toContain('OR lead.manager_id');
  });

  it('does not return a resolved recording when its call identity changed during lookup', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [call] }).mockResolvedValueOnce({ rows: [] });
    mocks.resolve.mockResolvedValue({
      state: 'ready', providerCallId: 'known-call', history: null,
      url: 'https://api2.onlinepbx.ru/calls-records/download/known/rec.mp3',
    });
    const result = await request(app).get('/api/telephony/calls/71/recording');
    expect(result.status).toBe(404);
    expect(result.body.error).toBe('onlinePbxRecordingPending');
    const [sql, params] = mocks.query.mock.calls[1];
    expect(sql).toContain("NULLIF(BTRIM(provider_call_id), '') IS NULL OR BTRIM(provider_call_id) = $2");
    expect(params[1]).toBe('known-call');
  });
});
