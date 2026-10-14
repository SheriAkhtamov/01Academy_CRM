import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CrmCapacitySource } from '../server/infrastructure/voice-telephony/crm-capacity';
import { TelephonyChannelReservations } from '../server/infrastructure/voice-telephony/channel-reservations';
import { RobotCallReceipts } from '../server/infrastructure/voice-telephony/robot-call-receipts';
import type { OnlinePbxCallHistoryItem, OnlinePbxClient } from '../server/services/onlinepbx';

const url = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `crm_capacity_${randomUUID().replace(/-/g, '')}`;

describe.skipIf(!url)('CRM-only capacity and exact end reconciliation on PostgreSQL', () => {
  let admin: Pool;
  let database: Pool;
  let source: CrmCapacitySource;
  let history: ReturnType<typeof vi.fn<OnlinePbxClient['getCallHistory']>>;
  const insertCall = async (input: {
    clientId?: string | null; providerId?: string | null; extension?: string | null; userId?: number | null;
    status?: string; direction?: string; stale?: boolean; ended?: boolean;
  } = {}) => {
    const id = input.clientId === undefined ? randomUUID() : input.clientId;
    await database.query(`INSERT INTO telephony_calls(client_call_id,provider_call_id,extension,user_id,status,direction,phone,
      started_at,created_at,updated_at,ended_at) VALUES($1,$2,$3,$4,$5,$6,'+998901234567',
      timezone('UTC',now()-interval '5 minutes'),timezone('UTC',now()-interval '5 minutes'),timezone('UTC',now()-make_interval(secs=>$7)),
      CASE WHEN $8 THEN timezone('UTC',now()-interval '1 minute') ELSE NULL END)`, [
      id, input.providerId ?? null, input.extension === undefined ? '100' : input.extension,
      input.userId === undefined ? 1 : input.userId, input.status ?? 'connected', input.direction ?? 'outgoing',
      input.stale ? 180 : 0, input.ended ?? false,
    ]);
    return id;
  };
  const insertLease = async (input: {
    callId?: string; extension?: string; owner?: 'manager' | 'robot'; expired?: boolean; issued?: boolean;
  } = {}) => {
    const id = randomUUID();
    const callId = input.callId ?? randomUUID();
    await database.query(`INSERT INTO telephony_line_reservations(id,extension,owner_type,owner_user_id,client_call_id,phone,
      created_at,lease_until,dial_authorized_at) VALUES($1,$2,$3,$4,$5,'+998901234567',now()-interval '5 minutes',
      now()+make_interval(secs=>$6),CASE WHEN $7 THEN now()-interval '5 minutes' ELSE NULL END)`, [
      id, input.extension ?? '100', input.owner ?? 'manager', input.owner === 'robot' ? null : 1,
      callId, input.expired ? -30 : 90, input.issued ?? false,
    ]);
    return { id, callId };
  };
  const insertRobot = async (input: { callId?: string; completed?: boolean; confirmed?: boolean; stale?: boolean } = {}) => {
    const callId = input.callId ?? randomUUID();
    await database.query(`INSERT INTO voice_reminder_call_attempts(call_id,extension,phone,started_at,completed_at,termination_confirmed_at)
      VALUES($1,'100','+998901234567',now()-make_interval(secs=>$2),
      CASE WHEN $3 THEN now() ELSE NULL END,CASE WHEN $4 THEN now() ELSE NULL END)`, [
      callId, input.stale ? 300 : 0, input.completed ?? false, input.confirmed ?? false,
    ]);
    return callId;
  };
  const endedCall = (uuid: string, input: Partial<OnlinePbxCallHistoryItem> = {}): OnlinePbxCallHistoryItem => ({
    uuid, callerIdNumber: '100', destinationNumber: '998901234567', startStamp: Math.floor(Date.now() / 1000) - 300,
    endStamp: Math.floor(Date.now() / 1000) - 60, duration: 240, talkTime: 180,
    hangupCause: 'NORMAL_CLEARING', direction: 'outgoing', gateway: 'test', events: [], ...input,
  });
  const gate = () => new TelephonyChannelReservations(database, () => source.snapshot(), (client, excludeId) => source.readLocked(client, excludeId));
  const robotInput = () => ({ owner: 'robot' as const, extensions: ['100', '101'], clientCallId: randomUUID(), phone: null });

  beforeAll(async () => {
    if (!url || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname)) throw new Error('Local isolated PostgreSQL required');
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    database = new Pool({ connectionString: url, options: `-c search_path=${schema} -c timezone=America/New_York`, max: 12 });
    await database.query(`CREATE TABLE users(id integer PRIMARY KEY,online_pbx_extension text);
      CREATE TABLE academy_demo_lessons(id integer PRIMARY KEY,scheduled_at timestamp,status text);
      CREATE TABLE academy_demo_lesson_participants(id integer PRIMARY KEY,demo_lesson_id integer,student_id integer,status text);
      CREATE TABLE telephony_calls(id serial PRIMARY KEY,client_call_id text UNIQUE,provider_call_id text UNIQUE,extension text,
        user_id integer,direction text,status text,phone text,started_at timestamp NOT NULL,created_at timestamp,updated_at timestamp,ended_at timestamp,
        duration_seconds integer DEFAULT 0,talk_seconds integer DEFAULT 0);`);
    await database.query(readFileSync('migrations/0142_voice_reminders.sql', 'utf8'));
    await database.query(readFileSync('migrations/0143_crm_telephony_capacity.sql', 'utf8'));
    await database.query(readFileSync('migrations/0144_voice_reminder_audio_library.sql', 'utf8'));
    await database.query(readFileSync('migrations/0145_voice_reminder_clock_audio.sql', 'utf8'));
    await database.query(readFileSync('migrations/0146_voice_reminder_test_calls.sql', 'utf8'));
    await database.query(readFileSync('migrations/0147_voice_reminder_day_before.sql', 'utf8'));
  });
  beforeEach(async () => {
    await database.query(`TRUNCATE voice_reminder_call_attempts,voice_reminder_provider_quarantine,telephony_line_reservations,
      telephony_calls,users RESTART IDENTITY CASCADE`);
    await database.query(`INSERT INTO users VALUES(1,'100'),(2,'101')`);
    history = vi.fn<OnlinePbxClient['getCallHistory']>(async () => []);
    source = new CrmCapacitySource(database, { getCallHistory: history });
  });
  afterAll(async () => {
    await database?.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });

  it('projects empty CRM scope and deduplicates exact journal/lease identities', async () => {
    expect(await source.snapshot()).toEqual({ known: true, occupiedChannels: 0, busyExtensions: [] });
    const callId = (await insertCall({ providerId: 'provider-1' }))!;
    await insertLease({ callId, issued: true });
    expect(await source.snapshot()).toEqual({ known: true, occupiedChannels: 1, busyExtensions: ['100'] });
    await insertCall({ extension: '101', userId: 2 });
    expect(await source.snapshot()).toMatchObject({ known: true, occupiedChannels: 2 });
    expect(await gate().acquire(robotInput())).toBeNull();
  });

  it('keeps an inconsistent active record occupied even when its ended timestamp is populated', async () => {
    await insertCall({ status: 'connected', ended: true });
    expect(await source.snapshot()).toEqual({ known: true, occupiedChannels: 1, busyExtensions: ['100'] });
  });
  it('uses the answered manager extension when the provider retains the original ringing destination', async () => {
    await insertCall({ direction: 'incoming', status: 'connected', providerId: 'incoming-parent', extension: '100', userId: 2 });
    expect(await source.snapshot()).toEqual({ known: true, occupiedChannels: 1, busyExtensions: ['101'] });
    expect(await gate().acquire(robotInput())).toMatchObject({ extension: '100' });
  });
  it('waits conservatively when incoming parent and answering fork have no proven common identity', async () => {
    await insertCall({ clientId: 'ringing-fork', providerId: 'incoming-parent', direction: 'incoming', extension: '100', userId: 2 });
    await insertCall({ clientId: 'answering-fork', direction: 'incoming', extension: '101', userId: 2 });
    expect(await source.snapshot()).toMatchObject({ known: true, occupiedChannels: 2, busyExtensions: ['101'] });
    expect(await gate().acquire(robotInput())).toBeNull();
  });

  it('reports more active identities than physical channels as inconsistent without freeing old rows', async () => {
    await insertCall();
    await insertCall({ extension: '101', userId: 2 });
    await insertCall();
    expect(await source.snapshot()).toMatchObject({ known: false, occupiedChannels: 3 });
    expect(await gate().acquire(robotInput())).toBeNull();
    expect((await database.query('SELECT count(*)::int AS count FROM telephony_calls WHERE ended_at IS NULL')).rows[0].count).toBe(3);
  });

  it('blocks both extensions for incoming ringing before ownership, then uses the connected owner', async () => {
    await insertCall({ clientId: null, providerId: 'incoming-before-user', extension: '10', userId: null, status: 'ringing', direction: 'incoming' });
    expect(await source.snapshot()).toEqual({ known: true, occupiedChannels: 1, busyExtensions: ['100', '101'] });
    expect(await gate().acquire(robotInput())).toBeNull();
    await database.query(`UPDATE telephony_calls SET status='connected',user_id=2,extension=NULL,updated_at=timezone('UTC',now())`);
    expect(await source.snapshot()).toEqual({ known: true, occupiedChannels: 1, busyExtensions: ['101'] });
    expect(await gate().acquire(robotInput())).toMatchObject({ extension: '100' });
  });

  it('reads fresh extension occupancy under admission lock after an obsolete empty snapshot', async () => {
    const old = await source.snapshot();
    await insertCall({ extension: '100' });
    const channels = new TelephonyChannelReservations(database, async () => old, client => source.readLocked(client));
    expect(await channels.acquire(robotInput())).toMatchObject({ extension: '101' });
  });

  it('counts two pending leases once and authorizes each while excluding only its own lease', async () => {
    const channels = gate();
    const first = (await channels.acquire({ owner: 'manager', userId: 1, extensions: ['100'], clientCallId: randomUUID(), phone: null }))!;
    const second = (await channels.acquire({ owner: 'manager', userId: 2, extensions: ['101'], clientCallId: randomUUID(), phone: null }))!;
    expect(await source.snapshot()).toMatchObject({ known: true, occupiedChannels: 2 });
    expect(await channels.authorizeManagerDial(first.id, 1, '100')).toBe(true);
    expect(await channels.authorizeManagerDial(second.id, 2, '101')).toBe(true);
    expect(await channels.acquire(robotInput())).toBeNull();
  });

  it('rejects a pending authorization when an incoming call occupied the line in the meantime', async () => {
    const channels = gate();
    const first = (await channels.acquire({ owner: 'manager', userId: 1, extensions: ['100'], clientCallId: randomUUID(), phone: null }))!;
    await insertCall({ clientId: null, providerId: 'new-incoming', extension: null, userId: null, status: 'ringing', direction: 'incoming' });
    expect(await channels.authorizeManagerDial(first.id, 1, '100')).toBe(false);
  });

  it('discards expired pending grants but keeps expired issued intents unresolved', async () => {
    await insertLease({ expired: true });
    expect(await source.snapshot()).toMatchObject({ known: true, occupiedChannels: 0 });
    expect(await gate().acquire(robotInput())).toMatchObject({ extension: '100' });
    await database.query('DELETE FROM telephony_line_reservations');
    const issued = await insertLease({ expired: true, issued: true });
    expect(await source.snapshot()).toEqual({ known: false, occupiedChannels: 1, busyExtensions: ['100'] });
    expect(await gate().acquire(robotInput())).toBeNull();
    expect((await database.query('SELECT id FROM telephony_line_reservations')).rows[0].id).toBe(issued.id);
  });

  it('upgrades pre-authorization manager reservations conservatively without arming robot grants', async () => {
    const manager = await insertLease();
    const robot = await insertLease({ extension: '101', owner: 'robot' });
    await database.query(readFileSync('migrations/0143_crm_telephony_capacity.sql', 'utf8'));
    const rows = (await database.query('SELECT id,dial_authorized_at FROM telephony_line_reservations')).rows;
    expect(rows.find(row => row.id === manager.id).dial_authorized_at).not.toBeNull();
    expect(rows.find(row => row.id === robot.id).dial_authorized_at).toBeNull();
  });

  it('keeps ambiguous robot attempts occupied after their worker and lease finish', async () => {
    const callId = await insertRobot();
    await insertLease({ callId, owner: 'robot', issued: true });
    expect(await source.snapshot()).toEqual({ known: true, occupiedChannels: 1, busyExtensions: ['100'] });
    await new RobotCallReceipts(database).complete(callId, true);
    await database.query('DELETE FROM telephony_line_reservations');
    expect(await source.snapshot()).toEqual({ known: false, occupiedChannels: 1, busyExtensions: ['100'] });
    expect(await gate().acquire(robotInput())).toBeNull();
  });

  it('frees a confirmed robot without counting its still-present lease as an orphan', async () => {
    const callId = await insertRobot({ confirmed: true, completed: true });
    await insertLease({ callId, owner: 'robot', issued: true });
    expect(await source.snapshot()).toEqual({ known: true, occupiedChannels: 0, busyExtensions: [] });
  });

  it('accepts only documented call_end, keeping bookkeeping and nonterminal events separate', async () => {
    const callId = await insertRobot();
    const receipts = new RobotCallReceipts(database);
    for (const event of ['pending', 'bridge_end', 'hangup', 'call_start']) {
      expect(await receipts.observe({ uuid: callId, event })).toBe(true);
      expect((await database.query('SELECT termination_confirmed_at FROM voice_reminder_call_attempts')).rows[0].termination_confirmed_at).toBeNull();
    }
    expect(await receipts.observe({ uuid: callId, event: 'call_end' })).toBe(true);
    expect(await source.snapshot()).toEqual({ known: true, occupiedChannels: 0, busyExtensions: [] });
  });

  it('reconciles an exact completed UUID, preserving UTC stamps in a non-UTC session', async () => {
    const callId = (await insertCall({ stale: true }))!;
    await insertLease({ callId, issued: true, expired: true });
    const ended = endedCall(callId);
    history.mockResolvedValue([ended]);
    expect(await source.snapshot()).toEqual({ known: true, occupiedChannels: 0, busyExtensions: [] });
    const row = (await database.query(`SELECT status,EXTRACT(EPOCH FROM ended_at AT TIME ZONE 'UTC')::float8 AS stamp FROM telephony_calls`)).rows[0];
    expect(row.status).toBe('ended');
    expect(row.stamp).toBe(ended.endStamp);
    expect((await database.query('SELECT count(*)::int AS count FROM telephony_line_reservations')).rows[0].count).toBe(0);
  });

  it('recovers an issued orphan or crashed robot only with exact completed history', async () => {
    const issued = await insertLease({ issued: true, expired: true });
    history.mockResolvedValue([endedCall(issued.callId)]);
    expect(await source.snapshot()).toMatchObject({ known: true, occupiedChannels: 0 });
    const robotId = await insertRobot({ stale: true, completed: true });
    history.mockResolvedValue([endedCall(robotId)]);
    expect(await source.snapshot()).toMatchObject({ known: true, occupiedChannels: 0 });
    expect((await database.query('SELECT termination_confirmed_at FROM voice_reminder_call_attempts')).rows[0].termination_confirmed_at).not.toBeNull();
  });

  it('uses actual call start when an active replay created the journal after the real call ended', async () => {
    const callId = (await insertCall())!;
    await database.query(`UPDATE telephony_calls SET created_at=timezone('UTC',now()),updated_at=timezone('UTC',now())`);
    history.mockResolvedValue([endedCall(callId)]);
    source = new CrmCapacitySource(database, { getCallHistory: history }, { now: () => Date.now() + 180_000 });
    expect(await source.snapshot()).toEqual({ known: true, occupiedChannels: 0, busyExtensions: [] });
    expect((await database.query('SELECT ended_at FROM telephony_calls')).rows[0].ended_at).not.toBeNull();
  });

  it('handles second-granularity history for a dial which ended in its authorization second', async () => {
    const issued = await insertLease({ issued: true, expired: true });
    const second = Math.floor(Date.now() / 1000) - 60;
    await database.query(`UPDATE telephony_line_reservations SET dial_authorized_at=to_timestamp($1)+interval '500 milliseconds'`, [second]);
    history.mockResolvedValue([endedCall(issued.callId, { startStamp: second, endStamp: second, duration: 0, talkTime: 0 })]);
    expect(await source.snapshot()).toMatchObject({ known: true, occupiedChannels: 0 });
    expect((await database.query('SELECT count(*)::int AS count FROM telephony_line_reservations')).rows[0].count).toBe(0);
  });

  it('never treats a related transfer successor or a nearby same-phone call as ended', async () => {
    const callId = (await insertCall({ stale: true }))!;
    history.mockResolvedValue([endedCall('completed-parent', { events: [{ event: 'transfer', to_uuid: callId }, { event: 'bridge', uuid: callId }] })]);
    expect(await source.snapshot()).toEqual({ known: true, occupiedChannels: 1, busyExtensions: ['100'] });
    expect((await database.query('SELECT ended_at FROM telephony_calls')).rows[0].ended_at).toBeNull();
  });

  it('does not use an older correlated end as proof for a newer issued dial', async () => {
    const callId = (await insertCall({ stale: true, providerId: 'old-correlated-provider' }))!;
    await insertLease({ callId, issued: true });
    await database.query(`UPDATE telephony_line_reservations SET dial_authorized_at=now()`);
    history.mockResolvedValue([endedCall('old-correlated-provider')]);
    expect(await source.snapshot()).toEqual({ known: false, occupiedChannels: 1, busyExtensions: ['100'] });
    expect((await database.query('SELECT ended_at FROM telephony_calls')).rows[0].ended_at).toBeNull();
    expect((await database.query('SELECT count(*)::int AS count FROM telephony_line_reservations')).rows[0].count).toBe(1);
  });

  it.each([
    { startStamp: Number.NaN }, { endStamp: Number.NaN }, { endStamp: Math.floor(Date.now() / 1000) + 120 },
    { startStamp: Math.floor(Date.now() / 1000), endStamp: Math.floor(Date.now() / 1000) - 60 },
    { duration: -1 }, { duration: Number.POSITIVE_INFINITY }, { talkTime: -1 }, { talkTime: Number.NaN },
  ])('fails closed on malformed completed history %j', async invalid => {
    const callId = (await insertCall({ stale: true }))!;
    history.mockResolvedValue([endedCall(callId, invalid)]);
    expect(await source.snapshot()).toEqual({ known: false, occupiedChannels: 1, busyExtensions: ['100'] });
    expect((await database.query('SELECT ended_at FROM telephony_calls')).rows[0].ended_at).toBeNull();
  });

  it('preserves an ongoing stale call with empty history and fails closed on history errors', async () => {
    await insertCall({ stale: true });
    expect(await source.snapshot()).toEqual({ known: true, occupiedChannels: 1, busyExtensions: ['100'] });
    history.mockRejectedValue(new Error('History unavailable'));
    source = new CrmCapacitySource(database, { getCallHistory: history });
    expect(await source.snapshot()).toMatchObject({ known: false, occupiedChannels: 1 });
    expect(await source.readLocked(database)).toMatchObject({ known: false, occupiedChannels: 1 });
    expect(await gate().acquire(robotInput())).toBeNull();
  });

  it('fails closed when durable ledger cannot be read', async () => {
    const failed = new CrmCapacitySource({ query: vi.fn(async () => { throw new Error('Database unavailable'); }), connect: database.connect.bind(database) } as Pick<Pool, 'query' | 'connect'>, { getCallHistory: history });
    expect(await failed.snapshot()).toEqual({ known: false, occupiedChannels: 0, busyExtensions: [] });
  });
});
