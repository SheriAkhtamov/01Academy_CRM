import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock('../server/config', () => ({ appConfig: { integrations: { onlinePbx: { webhookSecret: 'fixture-token' } } },
  isDevelopmentEnvironment: false, isProductionEnvironment: false }));
vi.mock('../server/db', () => ({ pool: { query: mocks.query, connect: mocks.connect } }));
vi.mock('../server/realtime/realtime-hub', () => ({ publishRealtimeEvent: vi.fn() }));
vi.mock('express-rate-limit', () => ({ default: () => (_req: express.Request,_res: express.Response,next: express.NextFunction) => next(),
  ipKeyGenerator: (ip: string) => ip }));
vi.mock('../server/middleware/auth.middleware', () => ({ requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
  req.user = { id: 7, module: 'sales', modules: ['sales'], onlinePbxIncomingEnabled: true, onlinePbxExtension: '100' } as typeof req.user;
  next();
} }));
vi.mock('../server/services/onlinepbx', () => ({ onlinePbxClient: {},
  normalizeOnlinePbxPhone: (value: unknown) => `+${String(value).replace(/\D/g, '')}`, OnlinePbxError: class extends Error {} }));

import { createTelephonyRouter, findCallHandledInCrm, findCallReportedByProvider } from '../server/routes/telephony.routes';

const url = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `call_identity_${randomUUID().replace(/-/g, '')}`;

describe.skipIf(!url)('incoming call correlation on PostgreSQL', () => {
  let admin: Pool;
  let database: Pool;
  const startedAt = new Date();
  const input = { direction: 'incoming' as const, phone: '+998901234567',
    startedAt, extension: '100', status: 'ringing' as const };

  beforeAll(async () => {
    if (!url || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname)) {
      throw new Error('Local isolated PostgreSQL required');
    }
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    database = new Pool({ connectionString: url, options: `-c search_path=${schema} -c timezone=UTC` });
    await database.query(`CREATE TABLE users(id integer PRIMARY KEY, online_pbx_extension text, is_active boolean);
      CREATE TABLE telephony_calls(id serial PRIMARY KEY,client_call_id text,provider_call_id text,
      direction text,phone text,status text,extension text,user_id integer,started_at timestamp,
      created_at timestamp DEFAULT timezone('UTC',now()),ended_at timestamp,
      contact_type text,contact_id integer,contact_name text,lead_id integer,answered_at timestamp,
      duration_seconds integer DEFAULT 0,talk_seconds integer DEFAULT 0,hangup_cause text,
      recording_url text,metadata jsonb DEFAULT '{}',updated_at timestamp DEFAULT timezone('UTC',now()))`);
  });
  beforeEach(async () => {
    await database.query('TRUNCATE telephony_calls RESTART IDENTITY');
    mocks.connect.mockImplementation(async () => {
      const connection = await database.connect();
      return {
        query: (sql: string, parameters?: unknown[]) => sql.includes('WITH matched_contacts')
          ? Promise.resolve({ rows: [{ type: 'lead', id: 1, leadId: null, name: 'Fixture', phone: input.phone }] })
          : connection.query(sql, parameters),
        release: () => connection.release(),
      };
    });
    mocks.query.mockImplementation((sql: string, parameters: unknown[]) => {
      if (sql.includes('WITH matched_contacts')) return Promise.resolve({ rows: [{ type: 'lead', id: 1, leadId: null, name: 'Fixture', phone: input.phone }] });
      if (sql.includes('FROM users manager')) return Promise.resolve({ rows: [] });
      return database.query(sql, parameters);
    });
  });
  afterAll(async () => {
    await database?.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });
  const insert = (clientId: string | null, providerId: string | null, status = 'ringing', start = startedAt, extension = '100') => (
    database.query(`INSERT INTO telephony_calls(client_call_id,provider_call_id,direction,phone,status,extension,started_at,ended_at)
      VALUES($1,$2,'incoming',$3,$4,$5,$6,CASE WHEN $4='missed' THEN $6::timestamp+interval '1 second' ELSE NULL END)`,
    [clientId, providerId, input.phone, status, extension, start])
  );
  const app = () => {
    const application = express(); application.use(express.json());
    application.use('/telephony', createTelephonyRouter(async () => false));
    application.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: error instanceof Error ? error.message : 'Fixture failure' }));
    return application;
  };

  it.each(['ended','failed','declined','missed'])('rejects a malformed %s end proof without changing the live call', async status => {
    const callId = randomUUID();
    await insert(callId,null,'connected');
    await database.query(`UPDATE telephony_calls SET direction='outgoing',user_id=7`);
    const body = { clientCallId: callId,direction: 'outgoing',phone: input.phone,status,startedAt: startedAt.toISOString() };
    mocks.query.mockClear(); mocks.connect.mockClear();
    for (const endedAt of [undefined,null,'invalid',{},new Date(startedAt.getTime()-1).toISOString()]) {
      const response = await request(app()).post('/telephony/calls/events').send({ ...body,endedAt });
      expect(response.status).toBe(400); expect(response.body).toEqual({ error: 'onlinePbxInvalidCallEvent' });
    }
    expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.connect).not.toHaveBeenCalled();
    expect((await database.query('SELECT status,ended_at FROM telephony_calls')).rows).toEqual([{ status: 'connected',ended_at: null }]);
  });

  it('does not create an inconsistent active row with a terminal timestamp or fabricate an end proof', async () => {
    const body = { clientCallId: randomUUID(),direction: 'outgoing',phone: input.phone,status: 'dialing',startedAt: startedAt.toISOString(),
      endedAt: new Date(startedAt.getTime()+1000).toISOString() };
    expect((await request(app()).post('/telephony/calls/events').send(body)).status).toBe(400);
    expect((await database.query('SELECT count(*)::int AS count FROM telephony_calls')).rows[0].count).toBe(0);
  });

  it('rejects invalid source timestamps and a terminal time before the answered time before any contact lookup', async () => {
    const body = { clientCallId: randomUUID(),direction: 'outgoing',phone: input.phone,status: 'ended',
      startedAt: startedAt.toISOString(),endedAt: new Date(startedAt.getTime()+1000).toISOString() };
    mocks.query.mockClear(); mocks.connect.mockClear();
    for (const invalid of [{ startedAt: 'invalid' },{ answeredAt: 'invalid' },
      { answeredAt: new Date(startedAt.getTime()+2000).toISOString() }]) {
      expect((await request(app()).post('/telephony/calls/events').send({ ...body,...invalid })).status).toBe(400);
    }
    expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.connect).not.toHaveBeenCalled();
    expect((await database.query('SELECT count(*)::int AS count FROM telephony_calls')).rows[0].count).toBe(0);
  });

  it('accepts a valid exact terminal proof and never reopens it when an older active report arrives later', async () => {
    const callId = randomUUID();
    await insert(callId,null,'dialing');
    await database.query(`UPDATE telephony_calls SET direction='outgoing',user_id=7`);
    const terminalAt = new Date(startedAt.getTime()+1000).toISOString();
    const body = { clientCallId: callId,direction: 'outgoing',phone: input.phone,startedAt: startedAt.toISOString() };
    expect((await request(app()).post('/telephony/calls/events').send({ ...body,status: 'failed',endedAt: terminalAt })).status).toBe(202);
    expect((await request(app()).post('/telephony/calls/events').send({ ...body,status: 'dialing',endedAt: null })).status).toBe(202);
    expect((await database.query('SELECT status,ended_at FROM telephony_calls')).rows)
      .toEqual([{ status: 'failed',ended_at: new Date(terminalAt) }]);
  });

  it('preserves exact closed metrics against late active elapsed time while allowing a later terminal refinement', async () => {
    const callId = randomUUID();
    await insert(callId,null,'connected');
    await database.query(`UPDATE telephony_calls SET direction='outgoing',user_id=7`);
    const body = { clientCallId: callId,direction: 'outgoing',phone: input.phone,startedAt: startedAt.toISOString() };
    const endedAt = new Date(startedAt.getTime()+10_000).toISOString();
    expect((await request(app()).post('/telephony/calls/events').send({ ...body,status: 'failed',endedAt,
      durationSeconds: 10,talkSeconds: 0,hangupCause: 'NORMAL_CLEARING' })).status).toBe(202);
    expect((await request(app()).post('/telephony/calls/events').send({ ...body,status: 'connected',endedAt: null,
      answeredAt: startedAt.toISOString(),durationSeconds: 600,talkSeconds: 590,hangupCause: 'STALE_BROWSER' })).status).toBe(202);
    expect((await database.query('SELECT status,ended_at,answered_at,duration_seconds,talk_seconds,hangup_cause FROM telephony_calls')).rows[0])
      .toEqual({ status: 'failed',ended_at: new Date(endedAt),answered_at: null,duration_seconds: 10,talk_seconds: 0,hangup_cause: 'NORMAL_CLEARING' });
    expect((await request(app()).post('/telephony/calls/events').send({ ...body,status: 'ended',endedAt,
      answeredAt: startedAt.toISOString(),durationSeconds: 10,talkSeconds: 9,hangupCause: 'NORMAL_CLEARING' })).status).toBe(202);
    expect((await database.query('SELECT status,duration_seconds,talk_seconds FROM telephony_calls')).rows[0])
      .toEqual({ status: 'ended',duration_seconds: 10,talk_seconds: 9 });
  });

  it('does not adopt an ended same-phone call when a new incoming call starts seconds later', async () => {
    await insert(null, 'old-provider', 'missed', new Date(startedAt.getTime() - 2_000));
    expect(await findCallReportedByProvider(database, input)).toBeNull();
    await insert('old-browser', null, 'missed', new Date(startedAt.getTime() - 2_000));
    expect(await findCallHandledInCrm(database, input)).toBeNull();
    await insert(null, 'new-provider');
    expect(await findCallReportedByProvider(database, input)).toBe(3);
  });
  it('does not assign delayed end replay to a currently active same-phone call', async () => {
    await insert(null, 'new-provider');
    expect(await findCallReportedByProvider(database, { ...input, status: 'ended' })).toBeNull();
    const rows = (await database.query('SELECT provider_call_id,status,ended_at FROM telephony_calls')).rows;
    expect(rows).toEqual([{ provider_call_id: 'new-provider', status: 'ringing', ended_at: null }]);
  });
  it('requires a unique live candidate with matching arrival time and extension', async () => {
    await insert(null, 'different-extension', 'ringing', startedAt, '101');
    await insert(null, 'older-call', 'ringing', new Date(startedAt.getTime() - 20_000));
    expect(await findCallReportedByProvider(database, input)).toBeNull();
    await insert(null, 'first-match');
    expect(await findCallReportedByProvider(database, input)).toBe(3);
    await insert(null, 'second-match');
    expect(await findCallReportedByProvider(database, input)).toBeNull();
  });
  it('records both concurrent provider UUIDs when they selected the same unbound browser fork', async () => {
    await insert('browser-fork', null);
    const original = mocks.query.getMockImplementation()!;
    let lookups = 0;
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    mocks.query.mockImplementation(async (sql: string, parameters: unknown[]) => {
      const result = await original(sql, parameters);
      if (sql.includes('call.client_call_id IS NOT NULL') && sql.includes('LIMIT 2')) {
        if (++lookups === 2) release();
        await barrier;
      }
      return result;
    });
    const application = app();
    const responses = await Promise.all(['provider-one', 'provider-two'].map(uuid => request(application)
      .post('/telephony/webhook').set('x-webhook-secret', 'fixture-token')
      .send({ uuid, caller: input.phone, callee: '100', direction: 'incoming', event: 'call_start', date: Math.floor(startedAt.getTime() / 1000) })));
    expect(responses.map(response => response.status), JSON.stringify(responses.map(response => response.body))).toEqual([200, 200]);
    const rows = (await database.query('SELECT client_call_id,provider_call_id FROM telephony_calls ORDER BY provider_call_id')).rows;
    expect(rows.map(row => row.provider_call_id)).toEqual(['provider-one', 'provider-two']);
    expect(rows.filter(row => row.client_call_id === 'browser-fork')).toHaveLength(1);
  });
  it('ends an anonymous standalone browser fork while retaining its separate active parent and answered owner', async () => {
    await insert('anonymous-fork', null);
    await insert(null, 'active-parent');
    await insert('answered-fork', null, 'connected');
    await database.query("UPDATE telephony_calls SET user_id=8 WHERE client_call_id='answered-fork'");
    const application = app();
    for (const clientCallId of ['anonymous-fork', 'answered-fork']) {
      const response = await request(application).post('/telephony/calls/events').send({
        ...input, clientCallId, status: 'missed', endedAt: new Date().toISOString(), talkSeconds: 0,
      });
      expect(response.status, JSON.stringify(response.body)).toBe(202);
    }
    const rows = (await database.query('SELECT client_call_id,provider_call_id,status,ended_at FROM telephony_calls ORDER BY id')).rows;
    expect(rows[0]).toMatchObject({ client_call_id: 'anonymous-fork', status: 'missed' });
    expect(rows[0].ended_at).not.toBeNull();
    expect(rows[1]).toMatchObject({ provider_call_id: 'active-parent', status: 'ringing', ended_at: null });
    expect(rows[2]).toMatchObject({ client_call_id: 'answered-fork', status: 'connected', ended_at: null });
  });
});
