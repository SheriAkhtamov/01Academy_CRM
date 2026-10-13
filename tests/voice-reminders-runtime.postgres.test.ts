import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VOICE_REMINDER_SETTINGS } from '../shared/contracts/voice-reminders';
import { createVoiceRemindersRuntime, type VoiceReminderCapacityProvider } from '../server/infrastructure/voice-reminders-runtime';
import { PostgresVoiceReminderRepository } from '../server/modules/voice-reminders/infrastructure/postgres-repository';
import type { performVertoReminderCall } from '../server/infrastructure/voice-telephony/verto-call';
import type { OnlinePbxWebRtcCredentials } from '../server/services/onlinepbx';

vi.mock('../server/db', () => ({ pool: null }));
const url = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `voice_runtime_${randomUUID().replace(/-/g, '')}`;
const credentials: OnlinePbxWebRtcCredentials = {
  extension: '100', username: '100', password: 'test-only', sipDomain: 'example.invalid',
  websocketUrl: 'wss://example.invalid', aor: '100@example.invalid',
};
const { audio: _audio, timeZone: _timeZone, ...settings } = DEFAULT_VOICE_REMINDER_SETTINGS;

describe.skipIf(!url)('voice reminder runtime on isolated PostgreSQL', () => {
  let admin: Pool;
  let database: Pool;
  let repository: PostgresVoiceReminderRepository;
  let directory: string;
  let storageKey: string;
  const provider = () => ({
    snapshot: vi.fn(async () => ({ known: true, occupiedChannels: 0, busyExtensions: [] as string[] })),
    getCredentials: vi.fn(async () => credentials), close: vi.fn(async () => undefined),
  });
  const makeRuntime = (capacity: VoiceReminderCapacityProvider, performCall: typeof performVertoReminderCall) => (
    createVoiceRemindersRuntime(capacity, database, { audioDirectory: directory, performCall })
  );
  const mockCall = () => vi.fn<typeof performVertoReminderCall>(async (_credentials, input) => {
    expect(await input.shouldContinue()).toBe(true);
    await input.onStarted!();
    return { outcome: 'played', callStarted: true, callId: input.callId! };
  });
  beforeAll(async () => {
    if (!url || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname)) throw new Error('Local isolated PostgreSQL required');
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    database = new Pool({ connectionString: url, options: `-c search_path=${schema} -c timezone=UTC` });
    await database.query(`CREATE TABLE users(id integer PRIMARY KEY);
      CREATE TABLE academy_leads(id integer PRIMARY KEY, phone text, is_archived boolean NOT NULL DEFAULT false);
      CREATE TABLE academy_lead_phones(id serial PRIMARY KEY, lead_id integer, phone text, is_primary boolean);
      CREATE TABLE academy_students(id integer PRIMARY KEY, lead_id integer, phone text, student_name text, contact_name text);
      CREATE TABLE academy_demo_lessons(id integer PRIMARY KEY, scheduled_at timestamp NOT NULL, status text NOT NULL);
      CREATE TABLE academy_demo_lesson_participants(id integer PRIMARY KEY, demo_lesson_id integer, student_id integer, status text NOT NULL);
      CREATE TABLE telephony_calls(id integer PRIMARY KEY, provider_call_id text,client_call_id text,user_id integer,ended_at timestamptz,status text);`);
    await database.query(readFileSync('migrations/0142_voice_reminders.sql', 'utf8'));
    repository = new PostgresVoiceReminderRepository(database);
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-runtime-'));
    storageKey = `${randomUUID()}.wav`;
    await fs.writeFile(path.join(directory, storageKey), Buffer.from('private recording fixture'));
  });
  beforeEach(async () => {
    await database.query(`TRUNCATE voice_reminder_provider_quarantine,voice_reminder_call_attempts,telephony_line_reservations,voice_reminder_jobs,
      voice_reminder_settings,voice_reminder_audio,academy_demo_lesson_participants,academy_demo_lessons,
      academy_students,academy_leads,users RESTART IDENTITY CASCADE`);
    await database.query(`INSERT INTO users VALUES(1);
      INSERT INTO academy_leads(id,phone) VALUES(1,'+998901234567');
      INSERT INTO academy_students(id,lead_id,phone,contact_name) VALUES(1,1,NULL,'Parent');
      INSERT INTO academy_demo_lessons(id,scheduled_at,status) VALUES(1,timezone('UTC',now()+interval '30 minutes'),'scheduled');
      INSERT INTO academy_demo_lesson_participants(id,demo_lesson_id,student_id,status) VALUES(1,1,1,'invited');
      INSERT INTO voice_reminder_settings(id) VALUES(1);`);
    await repository.saveAudio({
      id: randomUUID(), fileName: 'demo.wav', mimeType: 'audio/wav', sizeBytes: 24, durationSeconds: 1,
      uploadedAt: new Date().toISOString(), storageKey, sha256: 'a'.repeat(64),
    }, 1);
    await repository.saveSettings({ ...settings, enabled: true, allowedStartTime: '00:00', allowedEndTime: '23:59' }, 1);
  });
  afterAll(async () => {
    await database?.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  });

  it('records robot attempts before transport, preserves callback identity and avoids ordinary call KPIs', async () => {
    const call = mockCall();
    const runtime = makeRuntime(provider(), call);
    await runtime.tick();
    expect(call).toHaveBeenCalledTimes(1);
    const calls = (await database.query('SELECT call_id FROM voice_reminder_call_attempts')).rows;
    expect(calls).toHaveLength(1);
    expect(await runtime.observeRobotCall({ uuid: calls[0].call_id })).toBe(true);
    expect((await database.query('SELECT count(*)::int AS count FROM telephony_calls')).rows[0].count).toBe(0);
    expect((await database.query('SELECT count(*)::int AS count FROM telephony_line_reservations')).rows[0].count).toBe(0);
    expect((await repository.results()).summary.played).toBe(1);
    await runtime.close();
  });

  it('does not dial when the bound destination belongs to a manager reservation', async () => {
    await database.query(`INSERT INTO telephony_line_reservations(id,extension,owner_type,owner_user_id,client_call_id,phone,lease_until)
      VALUES($1,'101','manager',1,$2,'+998901234567',now()+interval '90 seconds')`, [randomUUID(), randomUUID()]);
    const call = mockCall();
    const runtime = makeRuntime(provider(), call);
    await runtime.tick();
    expect(call).not.toHaveBeenCalled();
    expect((await repository.results()).results[0]).toMatchObject({ status: 'waiting', attempts: 0 });
    expect((await database.query(`SELECT count(*)::int AS count FROM telephony_line_reservations WHERE owner_type='robot'`)).rows[0].count).toBe(0);
    await runtime.close();
  });

  it('releases a line after credential failures without consuming a dial attempt', async () => {
    const capacity = provider();
    capacity.getCredentials.mockRejectedValue(new Error('Credential lookup unavailable'));
    const call = mockCall();
    const runtime = makeRuntime(capacity, call);
    await runtime.tick();
    expect(call).not.toHaveBeenCalled();
    expect((await repository.results()).results[0]).toMatchObject({ status: 'failed', attempts: 0 });
    expect((await database.query('SELECT count(*)::int AS count FROM telephony_line_reservations')).rows[0].count).toBe(0);
    await runtime.close();
  });

  it('aborts active playback and releases both jobs and reservations during shutdown', async () => {
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const call = vi.fn<typeof performVertoReminderCall>(async (_credentials, input) => {
      await input.onStarted!(); started();
      await new Promise<void>(resolve => input.signal!.addEventListener('abort', () => resolve(), { once: true }));
      expect(await input.shouldContinue()).toBe(false);
      return { outcome: 'cancelled', callStarted: true, callId: input.callId! };
    });
    const capacity = provider();
    const runtime = makeRuntime(capacity, call);
    const running = runtime.tick();
    await entered;
    await runtime.close(); await running;
    expect((await database.query('SELECT count(*)::int AS count FROM telephony_line_reservations')).rows[0].count).toBe(0);
    expect((await repository.results()).summary.calling).toBe(0);
    expect(capacity.close).toHaveBeenCalledTimes(1);
  });

  it('keeps readiness false and postpones calls on an unknown provider snapshot', async () => {
    const capacity = provider(); capacity.snapshot.mockResolvedValue({ known: false, occupiedChannels: 0, busyExtensions: [] });
    const call = mockCall();
    const runtime = makeRuntime(capacity, call);
    expect(await runtime.gateway.readiness()).toEqual({ ready: false, code: 'transport_unavailable' });
    await runtime.tick();
    expect(call).not.toHaveBeenCalled();
    expect((await repository.results()).summary.waiting).toBe(1);
    await runtime.close();
  });
});
