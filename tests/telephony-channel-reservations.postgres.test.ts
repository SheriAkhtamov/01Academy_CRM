import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  TelephonyChannelReservations,
  type ChannelReservationInput,
  type ProviderChannelSnapshot,
} from '../server/infrastructure/voice-telephony/channel-reservations';

const url = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `channel_gate_${randomUUID().replace(/-/g, '')}`;

describe.skipIf(!url)('shared manager and robot channel reservations on PostgreSQL', () => {
  let admin: Pool;
  let database: Pool;
  let snapshot: ProviderChannelSnapshot;
  let channels: TelephonyChannelReservations;
  const reservation = (override: Partial<ChannelReservationInput> = {}): ChannelReservationInput => ({
    owner: 'robot', extensions: ['100', '101'], clientCallId: randomUUID(), phone: '+998901234567', ...override,
  });
  beforeAll(async () => {
    if (!url || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname)) throw new Error('Local isolated PostgreSQL required');
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    database = new Pool({ connectionString: url, options: `-c search_path=${schema} -c timezone=UTC`, max: 12 });
    await database.query(`CREATE TABLE users(id integer PRIMARY KEY);
      CREATE TABLE academy_demo_lessons(id integer PRIMARY KEY,scheduled_at timestamp,status text);
      CREATE TABLE academy_demo_lesson_participants(id integer PRIMARY KEY,demo_lesson_id integer,student_id integer,status text);
      CREATE TABLE telephony_calls(id serial PRIMARY KEY,provider_call_id text,client_call_id text,ended_at timestamptz,status text);`);
    await database.query(readFileSync('migrations/0142_voice_reminders.sql', 'utf8'));
    await database.query(readFileSync('migrations/0143_crm_telephony_capacity.sql', 'utf8'));
    await database.query(readFileSync('migrations/0144_voice_reminder_audio_library.sql', 'utf8'));
    await database.query(readFileSync('migrations/0145_voice_reminder_clock_audio.sql', 'utf8'));
    channels = new TelephonyChannelReservations(database, async () => snapshot);
  });
  beforeEach(async () => {
    await database.query('TRUNCATE telephony_line_reservations,telephony_calls,voice_reminder_jobs,academy_demo_lesson_participants,academy_demo_lessons,users RESTART IDENTITY CASCADE');
    await database.query('INSERT INTO users VALUES(1),(2)');
    snapshot = { known: true, occupiedChannels: 0, busyExtensions: [] };
  });
  afterAll(async () => {
    await database?.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });

  it('caps competing manager and robot admission at two distinct extensions', async () => {
    const inputs = Array.from({ length: 12 }, (_, index) => reservation({
      owner: index % 3 === 0 ? 'manager' : 'robot',
      ...(index % 3 === 0 ? { userId: index % 2 + 1 } : {}),
      phone: `+99890${String(index).padStart(7, '0')}`,
    }));
    const leases = await Promise.all(inputs.map(input => channels.acquire(input)));
    const granted = leases.filter(lease => lease !== null);
    expect(granted).toHaveLength(2);
    expect(new Set(granted.map(lease => lease!.extension)).size).toBe(2);
    expect((await database.query('SELECT count(*)::int AS count FROM telephony_line_reservations')).rows[0].count).toBe(2);
  });

  it.each([0, 1, 2])('admits only remaining capacity when %i provider channels are busy', async occupied => {
    snapshot = { known: true, occupiedChannels: occupied, busyExtensions: ['100', '101'].slice(0, occupied) };
    const leases = await Promise.all([channels.acquire(reservation()), channels.acquire(reservation({ phone: '+998911234567' }))]);
    expect(leases.filter(Boolean)).toHaveLength(2 - occupied);
    if (occupied === 1) expect(leases.find(Boolean)?.extension).toBe('101');
  });

  it('does not admit a robot or manager on unknown, failed or malformed provider status', async () => {
    snapshot = { known: false, occupiedChannels: 0, busyExtensions: [] };
    expect(await channels.acquire(reservation())).toBeNull();
    expect(await channels.acquire(reservation({ owner: 'manager', userId: 1 }))).toBeNull();
    const failed = new TelephonyChannelReservations(database, async () => { throw new Error('Monitor unavailable'); });
    expect(await failed.acquire(reservation())).toBeNull();
    snapshot = { known: true, occupiedChannels: -1, busyExtensions: [] };
    expect(await channels.acquire(reservation())).toBeNull();
    snapshot = { known: true, occupiedChannels: Number.NaN, busyExtensions: [] };
    expect(await channels.acquire(reservation())).toBeNull();
    expect((await database.query('SELECT count(*)::int AS count FROM telephony_line_reservations')).rows[0].count).toBe(0);
  });

  it('renews and releases leases only for their owner and makes admission retries idempotent', async () => {
    const input = reservation({ owner: 'manager', userId: 1, extensions: ['100'] });
    const lease = (await channels.acquire(input))!;
    expect(await channels.acquire(input)).toMatchObject({ id: lease.id, extension: '100' });
    expect(await channels.acquire({ ...input, userId: 2 })).toBeNull();
    expect(await channels.renew(lease.id, 'manager', 2)).toBe(false);
    expect(await channels.renew(lease.id, 'robot')).toBe(false);
    expect(await channels.renew(lease.id, 'manager', 1)).toBe(true);
    await channels.release(lease.id, 'manager', 2);
    expect((await database.query('SELECT count(*)::int AS count FROM telephony_line_reservations')).rows[0].count).toBe(1);
    await channels.release(lease.id, 'manager', 1);
    expect((await database.query('SELECT count(*)::int AS count FROM telephony_line_reservations')).rows[0].count).toBe(0);
  });

  it('prevents simultaneous calls to the same destination across owners', async () => {
    expect(await channels.acquire(reservation({ owner: 'manager', userId: 1, extensions: ['100'] }))).not.toBeNull();
    expect(await channels.acquire(reservation())).toBeNull();
    expect(await channels.acquire(reservation({ phone: '+998911234567' }))).toMatchObject({ extension: '101' });
  });

  it('requires fresh owned authorization and never resurrects an expired pending grant', async () => {
    const lease = (await channels.acquire(reservation({ owner: 'manager', userId: 1, extensions: ['100'] })))!;
    expect(await channels.authorizeManagerDial(lease.id, 2, '100')).toBe(false);
    expect(await channels.authorizeManagerDial(lease.id, 1, '101')).toBe(false);
    snapshot = { known: true, occupiedChannels: 2, busyExtensions: ['100', '101'] };
    expect(await channels.authorizeManagerDial(lease.id, 1, '100')).toBe(false);
    snapshot = { known: true, occupiedChannels: 0, busyExtensions: [] };
    expect(await channels.authorizeManagerDial(lease.id, 1, '100')).toBe(true);
    expect(await channels.authorizeManagerDial(lease.id, 1, '100')).toBe(true);
    const pending = (await channels.acquire(reservation({ owner: 'manager', userId: 2, extensions: ['101'], phone: '+998911234567' })))!;
    await database.query(`UPDATE telephony_line_reservations SET lease_until=now()-interval '1 second' WHERE id=$1`, [pending.id]);
    expect(await channels.authorizeManagerDial(pending.id, 2, '101')).toBe(false);
  });

  it('retains an issued manager intent after expiry until exact terminal proof', async () => {
    const lease = (await channels.acquire(reservation({ owner: 'manager', userId: 1, extensions: ['100'] })))!;
    expect(await channels.authorizeManagerDial(lease.id, 1, '100')).toBe(true);
    await database.query(`UPDATE telephony_line_reservations SET lease_until=now()-interval '1 second' WHERE id=$1`, [lease.id]);
    expect(await channels.release(lease.id, 'manager', 1)).toBe(false);
    const other = await channels.acquire(reservation({ phone: '+998911234567' }));
    expect(other?.extension).toBe('101');
    expect(await channels.acquire(reservation({ phone: '+998921234567' }))).toBeNull();
    await database.query(`INSERT INTO telephony_calls(client_call_id,status,ended_at) VALUES($1,'ended',now())`, [lease.clientCallId]);
    expect(await channels.release(lease.id, 'manager', 1)).toBe(true);
  });

  it('cancels an owned armed grant before INVITE but refuses to cancel an active ledger call', async () => {
    const lease = (await channels.acquire(reservation({ owner: 'manager', userId: 1, extensions: ['100'] })))!;
    expect(await channels.authorizeManagerDial(lease.id, 1, '100')).toBe(true);
    expect(await channels.release(lease.id, 'manager', 2, true)).toBe(false);
    expect(await channels.release(lease.id, 'manager', 1, true)).toBe(true);
    expect(await channels.release(lease.id, 'manager', 1, true)).toBe(true);
    const active = (await channels.acquire(reservation({ owner: 'manager', userId: 1, extensions: ['100'] })))!;
    expect(await channels.authorizeManagerDial(active.id, 1, '100')).toBe(true);
    await database.query(`INSERT INTO telephony_calls(client_call_id,status) VALUES($1,'connected')`, [active.clientCallId]);
    expect(await channels.release(active.id, 'manager', 1, true)).toBe(false);
  });

  it('reserves both unbound robot lines and allows only one to bind a shared destination', async () => {
    await database.query(`INSERT INTO academy_demo_lessons VALUES(1,timezone('UTC',now()+interval '1 hour'),'scheduled');
      INSERT INTO academy_demo_lesson_participants(id,demo_lesson_id,student_id,status) VALUES(1,1,1,'invited');
      INSERT INTO voice_reminder_jobs(demo_lesson_id,participant_id,scheduled_at,due_at)
        VALUES(1,1,now()+interval '1 hour',now())`);
    const first = (await channels.acquire(reservation({ phone: null })))!;
    const second = (await channels.acquire(reservation({ phone: null })))!;
    const binds = await Promise.all([first, second].map(lease => channels.bind(lease.id, {
      phone: '+998901234567', jobId: 1, clientCallId: lease.clientCallId,
    })));
    expect(binds.filter(Boolean)).toHaveLength(1);
  });

  it('cleans expired reservations while respecting an old call still busy at the provider', async () => {
    const expired = (await channels.acquire(reservation({ extensions: ['100'] })))!;
    await database.query(`UPDATE telephony_line_reservations SET lease_until=now()-interval '1 second' WHERE id=$1`, [expired.id]);
    expect(await channels.renew(expired.id, 'robot')).toBe(false);
    snapshot = { known: true, occupiedChannels: 1, busyExtensions: ['100'] };
    const next = (await channels.acquire(reservation({ phone: '+998911234567' })))!;
    expect(next.extension).toBe('101');
    expect((await database.query('SELECT id FROM telephony_line_reservations ORDER BY extension')).rows).toEqual([{ id: next.id }]);
    expect(await channels.acquire(reservation({ phone: '+998921234567' }))).toBeNull();
  });

  it('counts incoming calls before an extension is busy and ignores finished journal rows', async () => {
    await database.query(`INSERT INTO telephony_calls(provider_call_id,status) VALUES('incoming-one','ringing')`);
    const first = await channels.acquire(reservation());
    expect(first).not.toBeNull();
    expect(await channels.acquire(reservation({ phone: '+998911234567' }))).toBeNull();
    await channels.release(first!.id, 'robot');
    await database.query(`INSERT INTO telephony_calls(provider_call_id,status) VALUES('incoming-two','ringing')`);
    expect(await channels.acquire(reservation())).toBeNull();
    await database.query(`UPDATE telephony_calls SET ended_at=now(),status='completed'`);
    expect(await channels.acquire(reservation())).not.toBeNull();
  });

  it('deduplicates active journal provider identities instead of counting both copies as separate channels', async () => {
    await database.query(`INSERT INTO telephony_calls(provider_call_id,status) VALUES('same-incoming','ringing'),('same-incoming','connected')`);
    expect(await channels.acquire(reservation())).not.toBeNull();
  });
});
