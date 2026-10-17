import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  TelephonyChannelReservations,
  TelephonyReminderLineBusyError,
  type ChannelReservationInput,
  type ProviderChannelSnapshot,
} from '../server/infrastructure/voice-telephony/channel-reservations';
import { RobotCallReceipts } from '../server/infrastructure/voice-telephony/robot-call-receipts';

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
    await database.query(`CREATE TABLE users(id integer PRIMARY KEY,online_pbx_extension text,is_online boolean DEFAULT false,
      is_active boolean DEFAULT true,is_archived boolean DEFAULT false);
      CREATE TABLE academy_demo_lessons(id integer PRIMARY KEY,scheduled_at timestamp,status text);
      CREATE TABLE academy_demo_lesson_participants(id integer PRIMARY KEY,demo_lesson_id integer,student_id integer,status text);
      CREATE TABLE telephony_calls(id serial PRIMARY KEY,provider_call_id text,client_call_id text,ended_at timestamptz,status text);`);
    await database.query(readFileSync('migrations/0142_voice_reminders.sql', 'utf8'));
    await database.query(readFileSync('migrations/0143_crm_telephony_capacity.sql', 'utf8'));
    await database.query(readFileSync('migrations/0144_voice_reminder_audio_library.sql', 'utf8'));
    await database.query(readFileSync('migrations/0145_voice_reminder_clock_audio.sql', 'utf8'));
    await database.query(readFileSync('migrations/0146_voice_reminder_test_calls.sql', 'utf8'));
    await database.query(readFileSync('migrations/0147_voice_reminder_day_before.sql', 'utf8'));
    await database.query(readFileSync('migrations/0151_telephony_manager_line_priority.sql', 'utf8'));
    await database.query('CREATE TABLE academy_leads(id integer PRIMARY KEY)');
    await database.query(readFileSync('migrations/0154_voice_reminder_call_history.sql','utf8').split('-- Older receipts')[0]);
    channels = new TelephonyChannelReservations(database, async () => snapshot);
  });
  beforeEach(async () => {
    await database.query('TRUNCATE telephony_line_reservations,telephony_calls,voice_reminder_jobs,academy_demo_lesson_participants,academy_demo_lessons,users RESTART IDENTITY CASCADE');
    await database.query(`INSERT INTO users(id,online_pbx_extension) VALUES(1,'100'),(2,'101')`);
    snapshot = { known: true, occupiedChannels: 0, busyExtensions: [] };
    channels = new TelephonyChannelReservations(database,async () => snapshot);
  });
  afterAll(async () => {
    await database?.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });

  const priority = async () => (await database.query(`SELECT extension,blocking_client_call_id,blocking_reservation_id,
    requested_at,ended_at,priority_until FROM telephony_manager_line_priorities ORDER BY extension`)).rows;
  const manager = (extension = '100', userId = 1) => reservation({ owner: 'manager',userId,extensions: [extension],
    phone: userId===1 ? '+998909998877' : '+998909998878' });
  const issuedRobot = async () => {
    const lease = (await channels.acquire(reservation({ extensions: ['100'] })))!;
    await database.query(`INSERT INTO voice_reminder_call_attempts(call_id,extension,phone)
      VALUES($1,'100','+998901234567')`, [lease.clientCallId]);
    await database.query('UPDATE telephony_line_reservations SET dial_authorized_at=now() WHERE id=$1', [lease.id]);
    return lease;
  };
  const lockedRobotAdmission = async (id: string, extension = '100') => {
    const connection = await database.connect();
    try {
      await connection.query('BEGIN');
      await connection.query(`SELECT pg_advisory_xact_lock(hashtext('onlinepbx:shared-external-channels'))`);
      const result = await channels.canAuthorizeRobotLocked(connection,id,extension);
      await connection.query('COMMIT');
      return result;
    } catch (error) { await connection.query('ROLLBACK'); throw error; }
    finally { connection.release(); }
  };

  it('reads own robot status in a read-only connection without reconciling, refreshing priority or cleaning leases', async () => {
    const robot = await issuedRobot();
    expect(await channels.requestManagerLinePriority(1,'100')).toEqual({ busyWithReminder: true });
    await database.query('UPDATE voice_reminder_call_attempts SET termination_confirmed_at=clock_timestamp() WHERE call_id=$1', [robot.clientCallId]);
    const state = async () => ({ priorities: await priority(),
      leases: (await database.query('SELECT * FROM telephony_line_reservations ORDER BY id')).rows,
      attempts: (await database.query('SELECT * FROM voice_reminder_call_attempts ORDER BY call_id')).rows });
    const before = await state();
    const readonly = new Pool({ connectionString: url,options: `-c search_path=${schema} -c default_transaction_read_only=on` });
    try {
      const view = new TelephonyChannelReservations(readonly,async () => { throw new Error('Status must not call the provider'); });
      for (let index=0;index<3;index+=1) expect(await view.managerLineStatus(1,'100')).toEqual({ busyWithReminder: false });
      expect(await view.managerLineStatus(2,'101')).toEqual({ busyWithReminder: false });
      expect(await state()).toEqual(before);
      expect(before.priorities[0].ended_at).toBeNull();
      expect(before.leases).toHaveLength(1);
    } finally { await readonly.end(); }
  });

  it('reports only the assigned own line and differentiates active robot leases from manager leases and cooldowns', async () => {
    const robot = (await channels.acquire(reservation({ extensions: ['101'] })))!;
    expect(await channels.managerLineStatus(1,'100')).toEqual({ busyWithReminder: false });
    expect(await channels.managerLineStatus(2,'101')).toEqual({ busyWithReminder: true });
    expect(await channels.managerLineStatus(1,'101')).toBeNull();
    expect(await channels.managerLineStatus(99,'101')).toBeNull();
    expect(await priority()).toEqual([]);
    expect(await channels.requestManagerLinePriority(2,'101')).toEqual({ busyWithReminder: true });
    await channels.release(robot.id,'robot');
    expect(await channels.managerLineStatus(2,'101')).toEqual({ busyWithReminder: false });
    expect((await priority())[0].priority_until).toBeInstanceOf(Date);
    const managerLease = (await channels.acquire(manager('101',2)))!;
    expect(managerLease.extension).toBe('101');
    expect(await channels.managerLineStatus(2,'101')).toEqual({ busyWithReminder: false });
    expect(await channels.requestManagerLinePriority(2,'101')).toEqual({ busyWithReminder: false });
    expect(await channels.acquire(reservation({ extensions: ['101'] }))).toBeNull();
  });

  it('ignores an expired no-INVITE lease but retains an ambiguous native receipt after lease removal', async () => {
    const robot = (await channels.acquire(reservation({ extensions: ['100'] })))!;
    await database.query('UPDATE telephony_line_reservations SET lease_until=now()-interval \'1 second\' WHERE id=$1', [robot.id]);
    expect(await channels.managerLineStatus(1,'100')).toEqual({ busyWithReminder: false });
    expect(await channels.requestManagerLinePriority(1,'100')).toEqual({ busyWithReminder: false });
    expect((await database.query('SELECT count(*)::int AS count FROM telephony_line_reservations')).rows[0].count).toBe(1);
    await database.query(`INSERT INTO voice_reminder_call_attempts(call_id,extension,phone,completed_at)
      VALUES($1,'100','+998901234567',now())`, [robot.clientCallId]);
    await database.query('DELETE FROM telephony_line_reservations');
    expect(await channels.managerLineStatus(1,'100')).toEqual({ busyWithReminder: true });
    expect(await channels.requestManagerLinePriority(1,'100')).toEqual({ busyWithReminder: true });
    expect((await priority())[0]).toMatchObject({ ended_at: null,priority_until: null });
  });

  it('commits one automatic priority episode and immediately re-enables the manager on confirmed native end', async () => {
    const robot = await issuedRobot();
    expect(await channels.managerLineStatus(1,'100')).toEqual({ busyWithReminder: true });
    expect(await priority()).toEqual([]);
    const results = await Promise.all(Array.from({ length: 8 },() => channels.requestManagerLinePriority(1,'100')));
    expect(results).toEqual(Array(8).fill({ busyWithReminder: true }));
    const first = (await priority())[0];
    for (let index=0;index<3;index+=1) expect(await channels.managerLineStatus(1,'100')).toEqual({ busyWithReminder: true });
    expect((await priority())[0]).toEqual(first);
    expect(await channels.renew(robot.id,'robot')).toBe(true);
    await new RobotCallReceipts(database).complete(robot.clientCallId,true,true);
    expect(await channels.managerLineStatus(1,'100')).toEqual({ busyWithReminder: false });
    expect((await database.query('SELECT count(*)::int AS count FROM telephony_line_reservations')).rows[0].count).toBe(1);
    const granted = await channels.acquire(manager());
    expect(granted?.extension).toBe('100');
    const fixed = (await priority())[0];
    expect(fixed.priority_until.getTime()-fixed.ended_at.getTime()).toBe(180_000);
    expect(fixed.requested_at).toEqual(first.requested_at);
    expect(await channels.requestManagerLinePriority(1,'100')).toEqual({ busyWithReminder: false });
    expect((await priority())[0]).toEqual(fixed);
    expect((await channels.acquire(reservation({ extensions: ['101'],phone: '+998911234567' })))?.extension).toBe('101');
  });

  it('keeps status and priority local and actor-scoped on unknown provider state and reassigned users', async () => {
    await issuedRobot();
    channels=new TelephonyChannelReservations(database,async () => { throw new Error('No provider call allowed'); });
    expect(await channels.managerLineStatus(1,'100')).toEqual({ busyWithReminder: true });
    expect(await channels.requestManagerLinePriority(1,'100')).toEqual({ busyWithReminder: true });
    const first = await priority();
    expect(await channels.requestManagerLinePriority(2,'100')).toBeNull();
    await database.query(`UPDATE users SET online_pbx_extension='101' WHERE id=1`);
    expect(await channels.managerLineStatus(1,'100')).toBeNull();
    expect(await channels.requestManagerLinePriority(1,'100')).toBeNull();
    await database.query(`UPDATE users SET is_active=false WHERE id=2`);
    expect(await channels.managerLineStatus(2,'101')).toBeNull();
    expect(await priority()).toEqual(first);
  });

  it.each([
    [true,false,'101'], [false,true,'100'], [true,true,'100'], [false,false,'100'],
  ])('prefers free offline owners (100:%s,101:%s) without forbidding online robot calls', async (firstOnline,secondOnline,expected) => {
    await database.query('UPDATE users SET is_online=CASE id WHEN 1 THEN $1::boolean ELSE $2::boolean END', [firstOnline,secondOnline]);
    const first = (await channels.acquire(reservation()))!;
    expect(first.extension).toBe(expected);
    const second = (await channels.acquire(reservation({ phone: '+998911234567' })))!;
    expect(second.extension).not.toBe(first.extension);
    expect(await channels.acquire(reservation({ phone: '+998921234567' }))).toBeNull();
  });

  it('treats a shared extension as online if any active owner is online and ignores archived/inactive owners', async () => {
    await database.query(`INSERT INTO users(id,online_pbx_extension,is_online) VALUES(3,'100',true)`);
    const first = (await channels.acquire(reservation()))!;
    expect(first.extension).toBe('101');
    await channels.release(first.id,'robot');
    await database.query(`UPDATE users SET is_archived=true WHERE id=3`);
    const archived = (await channels.acquire(reservation()))!;
    expect(archived.extension).toBe('100');
    await channels.release(archived.id,'robot');
    await database.query(`UPDATE users SET is_archived=false,is_active=false WHERE id=3`);
    expect((await channels.acquire(reservation()))?.extension).toBe('100');
  });

  it('does not prefer an offline extension that fresh occupancy says is busy', async () => {
    await database.query('UPDATE users SET is_online=true WHERE id=1');
    snapshot={ known: true,occupiedChannels: 1,busyExtensions: ['101'] };
    expect((await channels.acquire(reservation()))?.extension).toBe('100');
  });

  it('persists a denied manager demand before returning the specific conflict and fences an unissued robot', async () => {
    const robot = (await channels.acquire(reservation({ extensions: ['100'] })))!;
    expect(await lockedRobotAdmission(robot.id)).toBe(true);
    await expect(channels.acquire(manager())).rejects.toMatchObject({ code: 'onlinePbxLineBusyWithReminder',statusCode: 409 });
    expect(await priority()).toEqual([expect.objectContaining({ extension: '100',blocking_client_call_id: robot.clientCallId,
      blocking_reservation_id: robot.id,ended_at: null,priority_until: null })]);
    expect(await lockedRobotAdmission(robot.id)).toBe(false);
    expect(await channels.renew(robot.id,'robot')).toBe(true);
    const other = (await channels.acquire(reservation({ phone: '+998911234567' })))!;
    expect(other.extension).toBe('101');
    await channels.release(robot.id,'robot');
    const held = (await priority())[0];
    expect(held.priority_until.getTime()-held.ended_at.getTime()).toBe(180_000);
    expect(await channels.acquire(reservation({ extensions: ['100'] }))).toBeNull();
    const handoff = await channels.acquire(manager());
    expect(handoff?.extension).toBe('100');
    expect(await channels.authorizeManagerDial(handoff!.id,1,'100')).toBe(true);
    await channels.release(other.id,'robot');
    expect((await priority())[0]).toEqual(held);
  });

  it('starts three minutes at confirmed bot termination, never at a manager click or bookkeeping completion', async () => {
    const robot = await issuedRobot();
    await expect(channels.acquire(manager())).rejects.toBeInstanceOf(TelephonyReminderLineBusyError);
    const first = (await priority())[0];
    await database.query(`UPDATE voice_reminder_call_attempts SET completed_at=now() WHERE call_id=$1`, [robot.clientCallId]);
    await expect(channels.acquire(manager())).rejects.toBeInstanceOf(TelephonyReminderLineBusyError);
    expect((await priority())[0]).toEqual(first);
    expect(await channels.renew(robot.id,'robot')).toBe(true);
    const ended = (await database.query(`UPDATE voice_reminder_call_attempts SET termination_confirmed_at=clock_timestamp()
      WHERE call_id=$1 RETURNING termination_confirmed_at`, [robot.clientCallId])).rows[0].termination_confirmed_at;
    expect(await channels.acquire(reservation({ extensions: ['100'] }))).toBeNull();
    const fixed = (await priority())[0];
    expect(fixed.ended_at).toEqual(ended);
    expect(fixed.priority_until.getTime()-ended.getTime()).toBe(180_000);
    await channels.release(robot.id,'robot');
    await channels.release(robot.id,'robot');
    expect(await channels.acquire(reservation({ extensions: ['100'] }))).toBeNull();
    const other = await channels.acquire(reservation({ extensions: ['101'],phone: '+998911234567' }));
    expect(other?.extension).toBe('101');
    expect((await priority())[0]).toEqual(fixed);
    expect((await channels.acquire(manager()))?.extension).toBe('100');
  });

  it('retains pending demand through lease cleanup, restart and unknown capacity until exact end proof', async () => {
    const robot = await issuedRobot();
    await expect(channels.acquire(manager())).rejects.toBeInstanceOf(TelephonyReminderLineBusyError);
    await database.query(`UPDATE telephony_line_reservations SET lease_until=now()-interval '1 hour' WHERE id=$1`, [robot.id]);
    await database.query(`UPDATE voice_reminder_call_attempts SET completed_at=now() WHERE call_id=$1`, [robot.clientCallId]);
    channels=new TelephonyChannelReservations(database,async () => snapshot);
    snapshot={ known: false,occupiedChannels: 0,busyExtensions: [] };
    await expect(channels.acquire(manager())).rejects.toBeInstanceOf(TelephonyReminderLineBusyError);
    expect((await priority())[0]).toMatchObject({ ended_at: null,priority_until: null });
    expect((await database.query('SELECT count(*)::int AS count FROM telephony_line_reservations')).rows[0].count).toBe(0);
    snapshot={ known: true,occupiedChannels: 0,busyExtensions: [] };
    expect((await channels.acquire(reservation({ phone: '+998911234567' })))?.extension).toBe('101');
    expect(await channels.acquire(reservation({ extensions: ['100'] }))).toBeNull();
    const receipts = new RobotCallReceipts(database);
    await receipts.observe({ uuid: robot.clientCallId,event: 'call_end' });
    await channels.acquire(reservation({ extensions: ['100'] }));
    expect((await priority())[0].ended_at).toBeInstanceOf(Date);
    expect((await channels.acquire(manager()))?.extension).toBe('100');
  });

  it('records manager demand even when a provider snapshot fails before admission', async () => {
    const robot = await issuedRobot();
    channels=new TelephonyChannelReservations(database,async () => { throw new Error('unavailable'); });
    await expect(channels.acquire(manager())).rejects.toMatchObject({ code: 'onlinePbxLineBusyWithReminder' });
    expect((await priority())[0].blocking_client_call_id).toBe(robot.clientCallId);
    expect(await channels.acquire(reservation({ extensions: ['101'],phone: '+998911234567' }))).toBeNull();
  });

  it('finishes an abandoned pre-INVITE demand once at lease expiry without dispatching a bot', async () => {
    const robot = (await channels.acquire(reservation({ extensions: ['100'] })))!;
    await expect(channels.acquire(manager())).rejects.toBeInstanceOf(TelephonyReminderLineBusyError);
    expect(await channels.acquire({ ...reservation(),clientCallId: robot.clientCallId })).toBeNull();
    const expiredAt = (await database.query(`UPDATE telephony_line_reservations SET lease_until=clock_timestamp()-interval '1 second'
      WHERE id=$1 RETURNING lease_until`, [robot.id])).rows[0].lease_until;
    expect(await channels.acquire(reservation({ extensions: ['100'] }))).toBeNull();
    const fixed = (await priority())[0];
    expect(fixed.ended_at.getTime()).toBe(Math.max(expiredAt.getTime(),fixed.requested_at.getTime()));
    expect(fixed.priority_until.getTime()-fixed.ended_at.getTime()).toBe(180_000);
    await channels.release(robot.id,'robot');
    expect((await channels.acquire(manager()))?.extension).toBe('100');
    expect((await priority())[0]).toEqual(fixed);
  });

  it('keeps independent pending demands on both extensions without adding a third channel', async () => {
    const first = (await channels.acquire(reservation({ extensions: ['100'] })))!;
    const second = (await channels.acquire(reservation({ extensions: ['101'],phone: '+998911234567' })))!;
    await Promise.all([expect(channels.acquire(manager())).rejects.toBeInstanceOf(TelephonyReminderLineBusyError),
      expect(channels.acquire(manager('101',2))).rejects.toBeInstanceOf(TelephonyReminderLineBusyError)]);
    expect((await priority()).map(row => row.extension)).toEqual(['100','101']);
    expect(await channels.renew(first.id,'robot')).toBe(true); expect(await channels.renew(second.id,'robot')).toBe(true);
    await channels.release(first.id,'robot'); await channels.release(second.id,'robot');
    expect(await channels.acquire(reservation())).toBeNull();
    expect((await channels.acquire(manager()))?.extension).toBe('100');
    expect((await channels.acquire(manager('101',2)))?.extension).toBe('101');
    expect(await channels.acquire(reservation())).toBeNull();
  });

  it('gives a fresh denied manager three minutes when an old terminal proof is discovered', async () => {
    const robot = await issuedRobot();
    await expect(channels.acquire(manager())).rejects.toBeInstanceOf(TelephonyReminderLineBusyError);
    await database.query(`UPDATE voice_reminder_call_attempts SET termination_confirmed_at=now()-interval '10 minutes' WHERE call_id=$1`, [robot.clientCallId]);
    expect(await channels.acquire(reservation({ extensions: ['100'] }))).toBeNull();
    const fixed = (await priority())[0];
    expect(fixed.ended_at).toEqual(fixed.requested_at);
    expect(fixed.priority_until.getTime()-fixed.requested_at.getTime()).toBe(180_000);
    expect(await channels.requestManagerLinePriority(1,'100')).toEqual({ busyWithReminder: false });
    expect((await priority())[0]).toEqual(fixed);
  });

  it('expires one cooldown without extending it on polls and admits a new demand for a later bot call', async () => {
    const first = await issuedRobot();
    await expect(channels.acquire(manager())).rejects.toBeInstanceOf(TelephonyReminderLineBusyError);
    await database.query(`UPDATE telephony_manager_line_priorities SET requested_at=now()-interval '10 minutes' WHERE extension='100'`);
    await database.query(`UPDATE voice_reminder_call_attempts SET termination_confirmed_at=now()-interval '5 minutes' WHERE call_id=$1`, [first.clientCallId]);
    await channels.release(first.id,'robot');
    const old = (await priority())[0];
    const second = (await channels.acquire(reservation({ extensions: ['100'] })))!;
    expect(second.extension).toBe('100');
    expect(await lockedRobotAdmission(second.id)).toBe(true);
    expect((await priority())[0]).toEqual(old);
    await expect(channels.acquire(manager())).rejects.toBeInstanceOf(TelephonyReminderLineBusyError);
    expect((await priority())[0]).toMatchObject({ blocking_client_call_id: second.clientCallId,ended_at: null,priority_until: null });
  });

  it('cannot create priority for a spoofed, reassigned, inactive or other-manager extension', async () => {
    await channels.acquire(reservation({ extensions: ['101'] }));
    expect(await channels.acquire(manager('101',1))).toBeNull();
    expect(await priority()).toEqual([]);
    await database.query(`UPDATE users SET online_pbx_extension='100' WHERE id=2`);
    expect(await channels.acquire(manager('101',2))).toBeNull();
    expect(await priority()).toEqual([]);
    await database.query(`UPDATE users SET online_pbx_extension='101',is_active=false WHERE id=2`);
    expect(await channels.acquire(manager('101',2))).toBeNull();
    expect(await priority()).toEqual([]);
  });

  it('uses the real durable marker fence when an automatic manager priority command wins the shared mutex', async () => {
    const robot = (await channels.acquire(reservation({ extensions: ['100'] })))!;
    await database.query(`INSERT INTO academy_demo_lessons VALUES(1,timezone('UTC',now()+interval '1 hour'),'scheduled');
      INSERT INTO academy_demo_lesson_participants(id,demo_lesson_id,student_id,status) VALUES(1,1,1,'invited')`);
    const token = randomUUID();
    const job = (await database.query(`INSERT INTO voice_reminder_jobs(demo_lesson_id,participant_id,scheduled_at,due_at,status,lease_token,lease_until)
      VALUES(1,1,now()+interval '1 hour',now(),'calling',$1,now()+interval '5 minutes') RETURNING id`, [token])).rows[0].id;
    expect(await channels.bind(robot.id,{ jobId: Number(job),clientCallId: robot.clientCallId,phone: '+998901234567' })).toBe(true);
    expect(await channels.requestManagerLinePriority(1,'100')).toEqual({ busyWithReminder: true });
    const receipts = new RobotCallReceipts(database,(client,id,extension) => channels.canAuthorizeRobotLocked(client,id,extension));
    expect(await receipts.start({ callId: robot.clientCallId,jobId: Number(job),jobLeaseToken: token,
      extension: '100',phone: '+998901234567',reservationId: robot.id })).toBe(false);
    expect((await database.query('SELECT count(*)::int AS count FROM voice_reminder_call_attempts')).rows[0].count).toBe(0);
    await channels.release(robot.id,'robot');
    expect((await channels.acquire(reservation({ extensions: ['101'],phone: '+998911234567' })))?.extension).toBe('101');
  });

  it('requires manager reservations before any library upload and while reminders are off', async () => {
    expect((await database.query('SELECT count(*)::int AS count FROM voice_reminder_settings')).rows[0].count).toBe(0);
    expect(await channels.enabled()).toBe(true);
    const first = await channels.acquire(reservation({ owner: 'manager', userId: 1, extensions: ['100'] }));
    expect(first).not.toBeNull();
    const robot = await channels.acquire(reservation({ phone: '+998911234567' }));
    expect(robot?.extension).toBe('101');
    expect(await channels.acquire(reservation({ phone: '+998921234567' }))).toBeNull();
    expect(await channels.authorizeManagerDial(first!.id,1,'100')).toBe(true);
  });

  it('caps competing manager and robot admission at two distinct extensions', async () => {
    const inputs = Array.from({ length: 12 }, (_, index) => reservation({
      owner: index % 3 === 0 ? 'manager' : 'robot',
      ...(index % 3 === 0 ? { userId: index % 2 + 1 } : {}),
      phone: `+99890${String(index).padStart(7, '0')}`,
    }));
    const leases = await Promise.all(inputs.map(input => channels.acquire(input).catch(error => {
      if (error instanceof TelephonyReminderLineBusyError) return null;
      throw error;
    })));
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
