import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresVoiceReminderRepository } from '../server/modules/voice-reminders/infrastructure/postgres-repository';
import { DEFAULT_VOICE_REMINDER_SETTINGS } from '../shared/contracts/voice-reminders';
import type { StoredVoiceReminderAudio } from '../server/modules/voice-reminders/application/ports';
import { RobotCallReceipts } from '../server/infrastructure/voice-telephony/robot-call-receipts';

const url = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `voice_${randomUUID().replace(/-/g, '')}`;
const now = new Date('2030-01-15T05:00:00Z');
const scheduledAt = new Date('2030-01-15T06:00:00Z');
const audio: StoredVoiceReminderAudio = {
  id: randomUUID(), fileName: 'demo.wav', mimeType: 'audio/wav', sizeBytes: 16044,
  durationSeconds: 1, uploadedAt: now.toISOString(), storageKey: `${randomUUID()}.wav`, sha256: 'a'.repeat(64),
};
const { audio: _defaultAudio, timeZone: _defaultZone, ...input } = DEFAULT_VOICE_REMINDER_SETTINGS;

describe.skipIf(!url)('voice reminders PostgreSQL queue and cancellation', () => {
  let admin: Pool;
  let pool: Pool;
  let repository: PostgresVoiceReminderRepository;
  beforeAll(async () => {
    if (!url || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname)) {
      throw new Error('Local isolated PostgreSQL required');
    }
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    // Legacy demo timestamps are UTC even when the PostgreSQL session is not.
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema} -c timezone=America/New_York`, max: 10 });
    await pool.query(`CREATE TABLE users(id integer PRIMARY KEY);
      CREATE TABLE academy_leads(id integer PRIMARY KEY, phone text, is_archived boolean NOT NULL DEFAULT false);
      CREATE TABLE academy_lead_phones(id serial PRIMARY KEY, lead_id integer REFERENCES academy_leads(id), phone text, is_primary boolean);
      CREATE TABLE academy_students(id integer PRIMARY KEY, lead_id integer REFERENCES academy_leads(id), phone text, student_name text, contact_name text);
      CREATE TABLE academy_demo_lessons(id integer PRIMARY KEY, scheduled_at timestamp NOT NULL, status text NOT NULL);
      CREATE TABLE academy_demo_lesson_participants(id integer PRIMARY KEY, demo_lesson_id integer REFERENCES academy_demo_lessons(id),
        student_id integer REFERENCES academy_students(id), status text NOT NULL);
      CREATE TABLE telephony_calls(id serial PRIMARY KEY, client_call_id text, provider_call_id text, user_id integer);`);
    await pool.query(readFileSync('migrations/0142_voice_reminders.sql', 'utf8'));
    await pool.query(readFileSync('migrations/0143_crm_telephony_capacity.sql', 'utf8'));
    repository = new PostgresVoiceReminderRepository(pool);
  });
  beforeEach(async () => {
    await pool.query(`TRUNCATE voice_reminder_jobs,voice_reminder_settings,voice_reminder_audio,voice_reminder_provider_quarantine,telephony_calls,
      academy_demo_lesson_participants,academy_demo_lessons,academy_lead_phones,academy_students,academy_leads,users RESTART IDENTITY CASCADE`);
    await pool.query(`INSERT INTO users VALUES(1);
      INSERT INTO academy_leads(id,phone) VALUES(1,'+998 90 123 45 67');
      INSERT INTO academy_students(id,lead_id,phone,contact_name) VALUES(1,1,NULL,'Parent1'),(2,1,'(91) 123-45-67','Parent2'),(3,1,NULL,'Parent3');
      INSERT INTO academy_demo_lessons(id,scheduled_at,status) VALUES(1,'2030-01-15 06:00:00','scheduled');
      INSERT INTO academy_demo_lesson_participants VALUES(1,1,1,'invited'),(2,1,2,'confirmed'),(3,1,3,'invited');
      INSERT INTO voice_reminder_settings(id) VALUES(1);`);
    await repository.saveAudio(audio, 1);
    await repository.saveSettings({ ...input, enabled: true }, 1);
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });

  it('defaults to disabled and stores only public audio metadata in settings', async () => {
    await repository.saveSettings({ ...input, enabled: false }, 1);
    const setting = await repository.settings();
    expect(setting.enabled).toBe(false);
    expect(setting.audio).toMatchObject({ id: audio.id, fileName: 'demo.wav' });
    expect(setting.audio).not.toHaveProperty('storageKey');
    expect(setting.audio).not.toHaveProperty('sha256');
  });

  it('deduplicates schedule participants and uses UTC instants in a non-UTC session', async () => {
    const settings = await repository.settings();
    await Promise.all([repository.synchronize(now, settings), repository.synchronize(now, settings)]);
    const result = await repository.results();
    expect(result.summary.waiting).toBe(3);
    expect(result.results.every(row => row.scheduledAt === '2030-01-15T06:00:00.000Z' && row.dueAt === now.toISOString())).toBe(true);
    const first = await repository.claim(now, 2, 300);
    expect(first).not.toBeNull();
    const prepared = await repository.prepare(first!, now);
    expect(prepared).toMatchObject({ phone: '+998901234567', scheduledAt });
    expect(await repository.canContinue(first!, '+998901234567', now)).toBe(true);
    expect(await repository.canContinue(first!, '+998901234567', scheduledAt)).toBe(false);
  });

  it('reserves at most two jobs under competing workers and ignores stale tokens', async () => {
    await repository.synchronize(now, await repository.settings());
    const claims = await Promise.all(Array.from({ length: 8 }, () => repository.claim(now, 2, 300)));
    const jobs = claims.filter(value => value !== null);
    expect(jobs).toHaveLength(2);
    expect(new Set(jobs.map(value => value!.id)).size).toBe(2);
    const first = jobs[0]!;
    await repository.finish({ ...first, leaseToken: randomUUID() }, { outcome: 'played', callStarted: true, callId: 'stale' }, now, null);
    expect((await repository.results()).summary.calling).toBe(2);
    await repository.finish(first, { outcome: 'played', callStarted: true, callId: 'real' }, now, null);
    const finished = (await repository.results()).results.find(value => value.id === first.id)!;
    expect(finished.status).toBe('played');
    expect(finished.attempts).toBe(1);
  });

  it('cancels a rescheduled in-flight lesson transactionally and creates fresh schedule jobs', async () => {
    await repository.synchronize(now, await repository.settings());
    const first = (await repository.claim(now, 2, 300))!;
    await repository.prepare(first, now);
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query(`UPDATE academy_demo_lessons SET scheduled_at='2030-01-15 07:00:00' WHERE id=1`);
      expect((await connection.query(`SELECT status FROM voice_reminder_jobs WHERE id=$1`, [first.id])).rows[0].status).toBe('cancelled');
      await connection.query('COMMIT');
    } finally { connection.release(); }
    expect(await repository.canContinue(first, '+998901234567', now)).toBe(false);
    await repository.finish(first, { outcome: 'played', callStarted: true, callId: 'late' }, now, null);
    await repository.synchronize(now, await repository.settings());
    const history = await repository.results();
    expect(history.summary.cancelled).toBe(3);
    expect(history.summary.waiting).toBe(3);
    expect(history.summary.played).toBe(0);
  });

  it('cancels removed participants and refuses changed phones or archived contacts before dialing', async () => {
    await repository.synchronize(now, await repository.settings());
    const first = (await repository.claim(now, 2, 300))!;
    const ready = await repository.prepare(first, now);
    expect(ready).toMatchObject({ phone: '+998901234567' });
    await pool.query(`UPDATE academy_leads SET phone='+998931234567' WHERE id=1`);
    expect(await repository.canContinue(first, '+998901234567', now)).toBe(false);
    await pool.query(`UPDATE academy_demo_lesson_participants SET status='cancelled' WHERE id=1`);
    expect((await repository.results()).results.find(value => value.id === first.id)?.status).toBe('cancelled');
    await pool.query(`UPDATE academy_leads SET is_archived=true WHERE id=1`);
    const second = (await repository.claim(now, 2, 300))!;
    expect(await repository.prepare(second, now)).toBeNull();
  });

  it('retries known no-answer but recovers crashed in-flight jobs as terminal failed', async () => {
    await repository.synchronize(now, await repository.settings());
    const first = (await repository.claim(now, 2, 300))!;
    await repository.finish(first, { outcome: 'unanswered', callStarted: true, callId: 'first' }, now, new Date('2030-01-15T05:10:00Z'));
    expect((await repository.results()).results.find(value => value.id === first.id)).toMatchObject({ status: 'waiting', attempts: 1 });
    const crashed = (await repository.claim(now, 2, 300))!;
    const later = new Date('2030-01-15T05:06:00Z');
    await repository.synchronize(later, await repository.settings());
    expect((await repository.results()).results.find(value => value.id === crashed.id)?.status).toBe('failed');
    expect(await repository.renew(crashed, later, 300)).toBe(false);
    await repository.finish(crashed, { outcome: 'played', callStarted: true, callId: 'late' }, later, null);
    expect((await repository.results()).results.find(value => value.id === crashed.id)?.status).toBe('failed');
  });

  it('defers temporary disablement and never claims expired demos', async () => {
    await repository.synchronize(now, await repository.settings());
    const first = (await repository.claim(now, 2, 300))!;
    await repository.saveSettings({ ...input, enabled: false }, 1);
    expect(await repository.prepare(first, now)).toBe('defer');
    await repository.defer(first, now);
    await repository.synchronize(scheduledAt, await repository.settings());
    expect((await repository.results()).summary.cancelled).toBe(3);
    expect(await repository.claim(scheduledAt, 2, 300)).toBeNull();
  });

  it('creates a new reminder revision when a lesson returns to an earlier date', async () => {
    await repository.synchronize(now, await repository.settings());
    await pool.query(`UPDATE academy_demo_lessons SET scheduled_at='2030-01-15 07:00:00' WHERE id=1`);
    await repository.synchronize(now, await repository.settings());
    await pool.query(`UPDATE academy_demo_lessons SET scheduled_at='2030-01-15 06:00:00' WHERE id=1`);
    await repository.synchronize(now, await repository.settings());
    expect((await repository.results()).summary).toMatchObject({ waiting: 3, cancelled: 6 });
    const first = (await repository.claim(now, 2, 300))!;
    expect(await repository.prepare(first, now)).toMatchObject({ scheduledAt });
    expect((await pool.query(`SELECT lesson_revision FROM voice_reminder_jobs WHERE id=$1`, [first.id])).rows[0].lesson_revision).toBe(2);
  });

  it('reminds a reinvited participant but does not duplicate ordinary confirmation', async () => {
    await repository.synchronize(now, await repository.settings());
    await pool.query(`UPDATE academy_demo_lesson_participants SET status='confirmed' WHERE id=1`);
    await repository.synchronize(now, await repository.settings());
    expect((await repository.results()).summary.waiting).toBe(3);
    await pool.query(`UPDATE academy_demo_lesson_participants SET status='cancelled' WHERE id=1`);
    await pool.query(`UPDATE academy_demo_lesson_participants SET status='confirmed' WHERE id=1`);
    await repository.synchronize(now, await repository.settings());
    expect((await repository.results()).summary).toMatchObject({ waiting: 3, cancelled: 1 });
    const participant = await pool.query(`SELECT participant_revision FROM voice_reminder_jobs WHERE participant_id=1 ORDER BY id`);
    expect(participant.rows.map(row => row.participant_revision)).toEqual([0, 2]);
  });

  const markedAttempt = async () => {
    await repository.synchronize(now, await repository.settings());
    const claimed = (await repository.claim(now, 2, 300))!;
    await repository.prepare(claimed, now);
    const callId = randomUUID();
    const reservationId = randomUUID();
    await pool.query(`INSERT INTO telephony_line_reservations(id,extension,owner_type,client_call_id,phone,job_id,lease_until)
      VALUES($1,'100','robot',$2,'+998901234567',$3,now()+interval '90 seconds')`, [reservationId, callId, claimed.id]);
    const receipts = new RobotCallReceipts(pool);
    const marker = { callId, reservationId, jobId: claimed.id, jobLeaseToken: claimed.leaseToken, extension: '100', phone: '+998901234567' };
    expect(await receipts.start(marker)).toBe(true);
    return { receipts, marker, claimed };
  };

  it('persists the robot identity before dialing and recognizes delayed callbacks after channel release', async () => {
    const { receipts, marker } = await markedAttempt();
    expect(await receipts.observe({ uuid: marker.callId })).toBe(true);
    const payload = { uuid: 'provider-robot-1', caller: '100', callee: '998901234567', direction: 'outbound', date: Math.floor(Date.now() / 1000) };
    expect(await receipts.observe(payload)).toBe(true);
    await receipts.complete(marker.callId, true);
    await pool.query('DELETE FROM telephony_line_reservations WHERE id=$1', [marker.reservationId]);
    expect(await receipts.observe({ uuid: payload.uuid, event: 'call_end' })).toBe(true);
    await pool.query('DELETE FROM voice_reminder_jobs WHERE id=$1', [marker.jobId]);
    expect(await receipts.observe({ uuid: payload.uuid })).toBe(true);
  });

  it('does not absorb incoming calls, a later manual callback or incomplete phone-only matches', async () => {
    const { receipts } = await markedAttempt();
    const payload = { uuid: 'manager-call', caller: '100', callee: '998901234567', direction: 'outbound', date: Math.floor(Date.now() / 1000) };
    expect(await receipts.observe({ ...payload, direction: 'inbound' })).toBe(false);
    expect(await receipts.observe({ ...payload, date: payload.date + 60 })).toBe(false);
    expect(await receipts.observe({ ...payload, caller: '101' })).toBe(false);
    expect(await receipts.observe({ ...payload, caller: '', date: undefined })).toBe(false);
  });

  it('quarantines ambiguous robot identities without choosing a job and refuses stale start tokens', async () => {
    const { receipts, marker } = await markedAttempt();
    expect(await receipts.start({ ...marker, callId: randomUUID(), jobLeaseToken: randomUUID() })).toBe(false);
    await pool.query(`INSERT INTO voice_reminder_call_attempts(call_id,extension,phone) VALUES($1,'100','+998901234567')`, [randomUUID()]);
    const payload = { uuid: 'ambiguous', caller: '100', callee: '998901234567', direction: 'outbound', date: Math.floor(Date.now() / 1000) };
    expect(await receipts.observe(payload)).toBe(true);
    expect(await receipts.observe({ uuid: payload.uuid, event: 'call_end' })).toBe(true);
    expect((await pool.query('SELECT provider_id FROM voice_reminder_call_attempts')).rows.every(row => row.provider_id === null)).toBe(true);
    await pool.query(`INSERT INTO telephony_calls(provider_call_id,user_id) VALUES('known-manual',1)`);
    expect(await receipts.observe({ ...payload, uuid: 'known-manual' })).toBe(false);
    await receipts.complete(marker.callId, false);
    expect(await receipts.observe({ uuid: marker.callId })).toBe(false);
  });

  it('recognizes every concurrent duplicate provider callback after the first identity bind', async () => {
    const { receipts, marker } = await markedAttempt();
    const payload = { uuid: 'concurrent-provider-robot', caller: '100', callee: '998901234567', direction: 'outbound', date: Math.floor(Date.now() / 1000) };
    const observed = await Promise.all(Array.from({ length: 20 }, () => receipts.observe(payload)));
    expect(observed).toEqual(Array(20).fill(true));
    expect((await pool.query('SELECT provider_id FROM voice_reminder_call_attempts WHERE call_id=$1', [marker.callId])).rows[0].provider_id).toBe(payload.uuid);
    expect(await receipts.observe({ uuid: payload.uuid, event: 'call_end' })).toBe(true);
  });

  it('preserves exact manual ownership before a single close robot metadata match', async () => {
    const { receipts, marker } = await markedAttempt();
    await pool.query(`INSERT INTO telephony_calls(provider_call_id,user_id) VALUES('single-known-manual',1)`);
    const payload = { uuid: 'single-known-manual', caller: '100', callee: '998901234567', direction: 'outbound', date: Math.floor(Date.now() / 1000) };
    expect(await receipts.observe(payload)).toBe(false);
    expect((await pool.query('SELECT provider_id FROM voice_reminder_call_attempts WHERE call_id=$1', [marker.callId])).rows[0].provider_id).toBeNull();
    expect((await pool.query('SELECT count(*)::int AS count FROM voice_reminder_provider_quarantine')).rows[0].count).toBe(0);
  });
});
