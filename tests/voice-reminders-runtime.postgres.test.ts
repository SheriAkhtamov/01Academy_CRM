import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VOICE_REMINDER_SETTINGS, type VoiceReminderLanguage } from '../shared/contracts/voice-reminders';
import { createVoiceRemindersRuntime, type VoiceReminderCapacityProvider } from '../server/infrastructure/voice-reminders-runtime';
import { PostgresVoiceReminderRepository } from '../server/modules/voice-reminders/infrastructure/postgres-repository';
import { LocalVoiceReminderAudioStore, inspectReminderAudio } from '../server/modules/voice-reminders/infrastructure/audio-store';
import type { performVertoReminderCall } from '../server/infrastructure/voice-telephony/verto-call';
import type { OnlinePbxWebRtcCredentials } from '../server/services/onlinepbx';
import { logger } from '../server/lib/logger';

vi.mock('../server/db', () => ({ pool: null }));
const url = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `voice_runtime_${randomUUID().replace(/-/g, '')}`;
const credentials: OnlinePbxWebRtcCredentials = {
  extension: '100', username: '100', password: 'test-only', sipDomain: 'example.invalid',
  websocketUrl: 'wss://example.invalid', aor: '100@example.invalid',
};
const { audio: _audio, audioLibrary: _audioLibrary, timeZone: _timeZone, ...settings } = DEFAULT_VOICE_REMINDER_SETTINGS;
const testClock = new Date('2030-01-15T05:00:00Z').getTime();

describe.skipIf(!url)('voice reminder runtime on isolated PostgreSQL', () => {
  let admin: Pool;
  let database: Pool;
  let repository: PostgresVoiceReminderRepository;
  let directory: string;
  const provider = () => ({
    snapshot: vi.fn(async () => ({ known: true, occupiedChannels: 0, busyExtensions: [] as string[] })),
    getCredentials: vi.fn(async (extension: string) => ({
      ...credentials, extension, username: extension, aor: `${extension}@example.invalid`,
    })), close: vi.fn(async () => undefined),
  });
  const makeRuntime = (capacity: VoiceReminderCapacityProvider, performCall: typeof performVertoReminderCall, now = () => testClock) => (
    createVoiceRemindersRuntime(capacity, database, { audioDirectory: directory, performCall, now })
  );
  const enqueueTest = async (actorId = 1, phone = '+998901234567', language: VoiceReminderLanguage = 'ru') => {
    const id = randomUUID();
    await database.query(`INSERT INTO voice_reminder_test_calls(id,actor_user_id,phone,clock_time,not_before_at,expires_at,language)
      VALUES($1,$2,$3,'10:30',$4,$5,$6)`, [id, actorId, phone, new Date(testClock), new Date(testClock + 600_000), language]);
    return id;
  };
  const testStatus = async (id: string) => (await database.query('SELECT status,dial_started_at FROM voice_reminder_test_calls WHERE id=$1',[id])).rows[0];
  const mockCall = () => vi.fn<typeof performVertoReminderCall>(async (_credentials, input) => {
    expect(await input.shouldContinue()).toBe(true);
    expect(await inspectReminderAudio(input.audioPath)).toEqual({ mimeType: 'audio/wav', durationSeconds: 4 });
    await input.onStarted!();
    return { outcome: 'played', callStarted: true, callId: input.callId!, terminationConfirmed: true };
  });
  const prepareTomorrowAudio = async () => {
    const store = new LocalVoiceReminderAudioStore(directory);
    const library = await repository.audioLibrary();
    const audio = await store.save({ bytes: await fs.readFile(await store.resolve(library.intro!.storageKey)),
      originalName: 'tomorrow.wav', mimeType: 'audio/wav' });
    await repository.saveLibraryAudio({ part: 'dayBeforeIntro' },audio,1);
    await repository.saveSettings({ ...settings, enabled: true, dayBeforeEnabled: true,
      allowedStartTime: '00:00', allowedEndTime: '23:59' },1);
    return audio;
  };
  const prepareConfirmationAudio = async () => {
    const store = new LocalVoiceReminderAudioStore(directory);
    const library = await repository.audioLibrary();
    for (const part of ['confirmationYes', 'confirmationNo'] as const) {
      const audio = await store.save({ bytes: await fs.readFile(await store.resolve(library.outro!.storageKey)),
        originalName: `${part}.wav`, mimeType: 'audio/wav' });
      await repository.saveLibraryAudio({ part }, audio, 1);
    }
    await repository.saveSettings({ ...settings, confirmationEnabled: true, enabled: true,
      allowedStartTime: '00:00', allowedEndTime: '23:59' }, 1);
  };
  const prepareUzbekAudio = async () => {
    const store = new LocalVoiceReminderAudioStore(directory);
    const russian = await repository.audioLibrary();
    const source = await fs.readFile(await store.resolve(russian.intro!.storageKey));
    const targets = [
      { part: 'intro', amplitude: 1000 }, { part: 'dayBeforeIntro', amplitude: 2000 },
      { part: 'hour', hour: '10', amplitude: 3000 }, { part: 'minute', minute: '30', amplitude: 4000 },
      { part: 'outro', amplitude: 5000 }, { part: 'confirmationYes', amplitude: 6000 },
      { part: 'confirmationNo', amplitude: 7000 },
    ] as const;
    for (const { amplitude, ...target } of targets) {
      const bytes = Buffer.from(source);
      for (let offset = 44; offset < bytes.length; offset += 2) bytes.writeInt16LE(amplitude, offset);
      const audio = await store.save({ bytes, originalName: `${target.part}-uz.wav`, mimeType: 'audio/wav' });
      await repository.saveLibraryAudio({ ...target, language: 'uz' }, audio, 1);
    }
    await repository.saveSettings({ ...settings, confirmationEnabled: true, enabled: true,
      allowedStartTime: '00:00', allowedEndTime: '23:59' }, 1);
  };
  const expectUzbekComposition = async (input: Parameters<typeof performVertoReminderCall>[1], introAmplitude = 1000) => {
    const main = await fs.readFile(input.audioPath);
    expect(await inspectReminderAudio(input.audioPath)).toMatchObject({ durationSeconds: 4 });
    const amplitudes = [introAmplitude, 3000, 4000, 5000];
    for (let offset = 44; offset < main.length; offset += 2) {
      expect(main.readInt16LE(offset)).toBe(amplitudes[Math.floor((offset - 44) / 16000)]);
    }
    expect(input.confirmation).toBeDefined();
    const yes = await fs.readFile(input.confirmation!.yesAudioPath);
    const no = await fs.readFile(input.confirmation!.noAudioPath);
    expect(yes.readInt16LE(44)).toBe(6000);
    expect(no.readInt16LE(44)).toBe(7000);
  };
  beforeAll(async () => {
    if (!url || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname)) throw new Error('Local isolated PostgreSQL required');
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    database = new Pool({ connectionString: url, options: `-c search_path=${schema} -c timezone=UTC` });
    await database.query(`CREATE TABLE users(id integer PRIMARY KEY,module text NOT NULL DEFAULT 'administration',is_active boolean DEFAULT true,is_archived boolean DEFAULT false,
        is_online boolean DEFAULT false,online_pbx_extension text);
      CREATE TABLE user_modules(user_id integer,module text);
      CREATE TABLE academy_leads(id integer PRIMARY KEY, phone text, is_archived boolean NOT NULL DEFAULT false,
        language text NOT NULL DEFAULT 'ru', languages text[]);
      CREATE TABLE academy_lead_phones(id serial PRIMARY KEY, lead_id integer, phone text, is_primary boolean);
      CREATE TABLE academy_students(id integer PRIMARY KEY, lead_id integer, phone text, student_name text, contact_name text);
      CREATE TABLE academy_demo_lessons(id integer PRIMARY KEY, scheduled_at timestamp NOT NULL, status text NOT NULL);
      CREATE TABLE academy_demo_lesson_participants(id integer PRIMARY KEY, demo_lesson_id integer, student_id integer, status text NOT NULL);
      CREATE TABLE telephony_calls(id integer PRIMARY KEY, provider_call_id text,client_call_id text,user_id integer,ended_at timestamptz,status text);`);
    await database.query(readFileSync('migrations/0142_voice_reminders.sql', 'utf8'));
    await database.query(readFileSync('migrations/0143_crm_telephony_capacity.sql', 'utf8'));
    await database.query(readFileSync('migrations/0144_voice_reminder_audio_library.sql', 'utf8'));
    await database.query(readFileSync('migrations/0145_voice_reminder_clock_audio.sql', 'utf8'));
    await database.query(readFileSync('migrations/0146_voice_reminder_test_calls.sql', 'utf8'));
    await database.query(readFileSync('migrations/0147_voice_reminder_day_before.sql', 'utf8'));
    await database.query(readFileSync('migrations/0149_voice_reminder_confirmations.sql', 'utf8'));
    await database.query(readFileSync('migrations/0150_voice_reminder_languages.sql', 'utf8'));
    await database.query(readFileSync('migrations/0151_telephony_manager_line_priority.sql', 'utf8'));
    await database.query(readFileSync('migrations/0152_voice_reminder_response_retry.sql', 'utf8'));
    repository = new PostgresVoiceReminderRepository(database);
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-runtime-'));
  });
  beforeEach(async () => {
    await database.query(`TRUNCATE voice_reminder_provider_quarantine,voice_reminder_call_attempts,telephony_line_reservations,voice_reminder_jobs,
      voice_reminder_settings,voice_reminder_audio,academy_demo_lesson_participants,academy_demo_lessons,
      academy_students,academy_leads,users RESTART IDENTITY CASCADE`);
    await database.query(`INSERT INTO users(id) VALUES(1),(2);
      INSERT INTO academy_leads(id,phone) VALUES(1,'+998901234567');
      INSERT INTO academy_students(id,lead_id,phone,contact_name) VALUES(1,1,NULL,'Parent');
      INSERT INTO academy_demo_lesson_participants(id,demo_lesson_id,student_id,status) VALUES(1,1,1,'invited');
      INSERT INTO voice_reminder_settings(id) VALUES(1);`);
    await database.query("INSERT INTO academy_demo_lessons(id,scheduled_at,status) VALUES(1,$1::timestamptz AT TIME ZONE 'UTC','scheduled')", [new Date(testClock + 30 * 60_000)]);
    const bytes = Buffer.alloc(16_044);
    bytes.write('RIFF'); bytes.writeUInt32LE(16036, 4); bytes.write('WAVE', 8);
    bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28);
    bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(16000, 40);
    const store = new LocalVoiceReminderAudioStore(directory);
    for (const target of [{ part: 'intro' }, { part: 'hour', hour: '10' }, { part: 'minute', minute: '30' }, { part: 'outro' }] as const) {
      const audio = await store.save({ bytes, originalName: 'part.wav', mimeType: 'audio/wav' });
      await repository.saveLibraryAudio(target, audio, 1);
    }
    await repository.saveSettings({ ...settings, enabled: true, allowedStartTime: '00:00', allowedEndTime: '23:59' }, 1);
  });
  afterAll(async () => {
    await database?.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  });

  it.each(['ru', 'uz'] as const)('delivers exactly one standalone %s follow-up then ends without inventing attendance', async language => {
    if (language === 'uz') {
      await prepareUzbekAudio();
      await database.query("UPDATE academy_leads SET languages=ARRAY['uz','ru'] WHERE id=1");
    } else await prepareConfirmationAudio();
    const store = new LocalVoiceReminderAudioStore(directory);
    const library = await repository.audioLibrary(language);
    const bytes = await fs.readFile(await store.resolve(library.intro!.storageKey));
    for (let offset = 44; offset < bytes.length; offset += 2) bytes.writeInt16LE(9000, offset);
    const retry = await store.save({ bytes, originalName: 'retry.wav', mimeType: 'audio/wav' });
    await repository.saveLibraryAudio({ part: 'responseRetry', language }, retry, 1);
    let now = testClock;
    let attempts = 0;
    const call = vi.fn<typeof performVertoReminderCall>(async (_credentials, input) => {
      attempts++;
      expect(await input.shouldContinue()).toBe(true);
      await input.onStarted!();
      expect(input.confirmation).toBeDefined();
      const audio = await inspectReminderAudio(input.audioPath);
      expect(audio.durationSeconds).toBe(attempts === 1 ? 4 : 1);
      if (attempts === 2) {
        expect(input.confirmation!.promptDurationSeconds).toBe(1);
        const normalized = await fs.readFile(input.audioPath);
        for (let offset = 44; offset < normalized.length; offset += 2) expect(normalized.readInt16LE(offset)).toBe(9000);
      }
      return { outcome: 'delivered_no_response', callStarted: true, callId: input.callId!, terminationConfirmed: true };
    });
    const runtime = makeRuntime(provider(), call, () => now);
    try {
      await runtime.tick();
      expect(call).toHaveBeenCalledOnce();
      expect((await database.query('SELECT status,retry_phase,no_response_count FROM voice_reminder_jobs')).rows[0])
        .toMatchObject({ status: 'waiting', retry_phase: 'response_retry', no_response_count: 1 });
      expect((await database.query('SELECT * FROM voice_reminder_participant_delivery(1)')).rows).toEqual([]);
      now += 9 * 60_000;
      await runtime.tick();
      expect(call).toHaveBeenCalledOnce();
      now += 60_000;
      await runtime.tick();
      expect(call).toHaveBeenCalledTimes(2);
      expect((await database.query('SELECT status,attempts,no_response_count,response FROM voice_reminder_jobs')).rows[0])
        .toMatchObject({ status: 'delivered_no_response', attempts: 2, no_response_count: 2, response: null });
      expect((await database.query('SELECT * FROM voice_reminder_participant_delivery(1)')).rows[0])
        .toMatchObject({ delivery_status: 'delivered_no_response' });
      expect((await database.query('SELECT status FROM academy_demo_lesson_participants WHERE id=1')).rows[0].status).toBe('invited');
      now += 10 * 60_000;
      await runtime.tick();
      expect(call).toHaveBeenCalledTimes(2);
    } finally { await runtime.close(); }
  });

  it('composes an Uzbek lead call and its acknowledgements entirely from the Uzbek library', async () => {
    await prepareUzbekAudio();
    await database.query("UPDATE academy_leads SET languages=ARRAY['uz','ru'] WHERE id=1");
    const call = vi.fn<typeof performVertoReminderCall>(async (_credentials, input) => {
      await expectUzbekComposition(input);
      expect(await input.shouldContinue()).toBe(true);
      await input.onStarted!();
      expect(await input.confirmation!.onResponse('no', input.callId!)).toBe(true);
      return { outcome: 'played', callStarted: true, callId: input.callId!, terminationConfirmed: true, response: 'no' };
    });
    const runtime = makeRuntime(provider(), call);
    try {
      await runtime.tick();
      expect(call).toHaveBeenCalledOnce();
      expect((await database.query('SELECT language,status,response FROM voice_reminder_jobs')).rows[0])
        .toMatchObject({ language: 'uz', status: 'played', response: 'no' });
      expect((await database.query('SELECT * FROM voice_reminder_participant_response(1)')).rows[0].response).toBe('no');
      expect((await database.query('SELECT status FROM academy_demo_lesson_participants WHERE id=1')).rows[0].status).toBe('invited');
    } finally { await runtime.close(); }
  });

  it('delivers and releases the line even when diagnostic logging throws', async () => {
    const logging = vi.spyOn(logger, 'log').mockImplementation(() => { throw new Error('Log transport unavailable'); });
    const call = mockCall();
    const runtime = makeRuntime(provider(), call);
    try {
      await runtime.tick();
      expect(call).toHaveBeenCalledOnce();
      expect((await database.query('SELECT status FROM voice_reminder_jobs')).rows[0].status).toBe('played');
      expect((await database.query('SELECT count(*)::int AS count FROM telephony_line_reservations')).rows[0].count).toBe(0);
    } finally { await runtime.close(); logging.mockRestore(); }
  });

  it.each(['automatic', 'manual'] as const)('prefers the offline manager line for an %s reminder', async mode => {
    await database.query(`UPDATE users SET online_pbx_extension=CASE id WHEN 1 THEN '100' ELSE '101' END,
      is_online=(id=1)`);
    if (mode === 'manual') {
      await database.query('UPDATE voice_reminder_settings SET enabled=false WHERE id=1');
      await enqueueTest();
    }
    const capacity = provider();
    const call = mockCall();
    const runtime = makeRuntime(capacity, call);
    try {
      await runtime.tick();
      expect(call).toHaveBeenCalledOnce();
      expect(capacity.getCredentials).toHaveBeenCalledExactlyOnceWith('101');
      expect((await database.query('SELECT extension FROM voice_reminder_call_attempts')).rows).toEqual([{ extension: '101' }]);
    } finally { await runtime.close(); }
  });

  it('finishes the current robot call, protects the waiting manager line, and continues on the other line', async () => {
    await database.query(`UPDATE users SET online_pbx_extension=CASE id WHEN 1 THEN '100' ELSE '101' END,is_online=true`);
    let releaseFirst!: () => void;
    const firstMayFinish = new Promise<void>(resolve => { releaseFirst = resolve; });
    let firstStarted!: () => void;
    const firstIsStarted = new Promise<void>(resolve => { firstStarted = resolve; });
    let calls = 0;
    const call = vi.fn<typeof performVertoReminderCall>(async (credentials, input) => {
      calls += 1;
      await input.onStarted!();
      if (calls === 1) {
        expect(credentials.extension).toBe('100');
        firstStarted();
        await firstMayFinish;
        // A manager's demand must never cut off an already issued call.
        expect(await input.shouldContinue()).toBe(true);
        expect(input.signal?.aborted).toBe(false);
      } else expect(credentials.extension).toBe('101');
      return { outcome: 'played', callStarted: true, callId: input.callId!, terminationConfirmed: true };
    });
    const runtime = makeRuntime(provider(), call);
    const running = runtime.tick();
    try {
      await firstIsStarted;
      await expect(runtime.channels.acquire({ owner: 'manager', userId: 1, extensions: ['100'],
        clientCallId: randomUUID(), phone: '+998909876543' })).rejects.toMatchObject({ code: 'onlinePbxLineBusyWithReminder' });
      expect((await database.query('SELECT ended_at,priority_until FROM telephony_manager_line_priorities')).rows[0])
        .toMatchObject({ ended_at: null, priority_until: null });
      await database.query(`INSERT INTO academy_leads(id,phone) VALUES(2,'+998901234568');
        INSERT INTO academy_students(id,lead_id,contact_name) VALUES(2,2,'Second parent');
        INSERT INTO academy_demo_lesson_participants(id,demo_lesson_id,student_id,status) VALUES(2,1,2,'invited');`);
      await repository.synchronize(new Date(testClock), await repository.settings());
      releaseFirst();
      await running;
      expect(call).toHaveBeenCalledTimes(2);
      expect((await database.query("SELECT count(*)::int AS count FROM voice_reminder_jobs WHERE status='played'")).rows[0].count).toBe(2);
      const priority = (await database.query(`SELECT extension,EXTRACT(EPOCH FROM priority_until-ended_at)::int AS seconds,
        priority_until>now() AS protected FROM telephony_manager_line_priorities`)).rows[0];
      expect(priority).toEqual({ extension: '100', seconds: 180, protected: true });
      const manager = await runtime.channels.acquire({ owner: 'manager', userId: 1, extensions: ['100'],
        clientCallId: randomUUID(), phone: '+998909876543' });
      expect(manager?.extension).toBe('100');
      await runtime.channels.release(manager!.id, 'manager', 1);
      const nextRobot = await runtime.channels.acquire({ owner: 'robot', extensions: ['100', '101'],
        clientCallId: randomUUID(), phone: '+998901234569' });
      expect(nextRobot?.extension).toBe('101');
      await runtime.channels.release(nextRobot!.id, 'robot');
    } finally { releaseFirst(); await running; await runtime.close(); }
  });

  it('uses the explicit Uzbek manual-test language and saves its response without changing demo data', async () => {
    await prepareUzbekAudio();
    await database.query('UPDATE voice_reminder_settings SET enabled=false WHERE id=1');
    const id = await enqueueTest(1, '+998901234567', 'uz');
    const call = vi.fn<typeof performVertoReminderCall>(async (_credentials, input) => {
      await expectUzbekComposition(input);
      await input.onStarted!();
      expect(await input.confirmation!.onResponse('yes', input.callId!)).toBe(true);
      return { outcome: 'played', callStarted: true, callId: input.callId!, terminationConfirmed: true, response: 'yes' };
    });
    const runtime = makeRuntime(provider(), call);
    try {
      await runtime.tick();
      expect(call).toHaveBeenCalledOnce();
      expect((await database.query('SELECT language,status,response FROM voice_reminder_test_calls WHERE id=$1', [id])).rows[0])
        .toMatchObject({ language: 'uz', status: 'played', response: 'yes' });
      expect((await database.query('SELECT count(*)::int AS count FROM voice_reminder_jobs')).rows[0].count).toBe(0);
      expect((await database.query('SELECT status FROM academy_demo_lesson_participants WHERE id=1')).rows[0].status).toBe('invited');
    } finally { await runtime.close(); }
  });

  it.each(['same_day', 'day_before'] as const)('delivers a %s Uzbek reminder when the Russian library is empty', async reminderKind => {
    await prepareUzbekAudio();
    await database.query(`UPDATE academy_leads SET languages=ARRAY['uz'] WHERE id=1;
      UPDATE voice_reminder_settings SET intro_audio_id=NULL,day_before_intro_audio_id=NULL,outro_audio_id=NULL,
        confirmation_yes_audio_id=NULL,confirmation_no_audio_id=NULL WHERE id=1;
      DELETE FROM voice_reminder_hour_audio;
      DELETE FROM voice_reminder_minute_audio;`);
    await repository.saveSettings({ ...settings, confirmationEnabled: true, enabled: true, dayBeforeEnabled: true,
      leadMinutes: 120, allowedStartTime: '00:00', allowedEndTime: '23:59' }, 1);
    expect(await repository.audioLibrary()).toMatchObject({ intro: null, outro: null, hours: [], minutes: [] });
    let clock = testClock;
    if (reminderKind === 'day_before') {
      const scheduledAt = new Date(testClock + 24 * 60 * 60_000 + 30 * 60_000);
      await database.query("UPDATE academy_demo_lessons SET scheduled_at=$1::timestamptz AT TIME ZONE 'UTC' WHERE id=1", [scheduledAt]);
      clock += 30 * 60_000;
    }
    const call = vi.fn<typeof performVertoReminderCall>(async (_credentials, input) => {
      await expectUzbekComposition(input, reminderKind === 'day_before' ? 2000 : 1000);
      expect(await input.shouldContinue()).toBe(true);
      await input.onStarted!();
      expect(await input.confirmation!.onResponse('yes', input.callId!)).toBe(true);
      return { outcome: 'played', callStarted: true, callId: input.callId!, terminationConfirmed: true, response: 'yes' };
    });
    const runtime = createVoiceRemindersRuntime(provider(), database,
      { audioDirectory: directory, performCall: call, now: () => clock });
    try {
      await runtime.tick();
      expect(call).toHaveBeenCalledOnce();
      expect((await database.query('SELECT language,status,response FROM voice_reminder_jobs WHERE reminder_kind=$1', [reminderKind])).rows[0])
        .toMatchObject({ language: 'uz', status: 'played', response: 'yes' });
      await runtime.tick();
      expect(call).toHaveBeenCalledOnce();
      expect((await database.query('SELECT count(*)::int AS count FROM telephony_line_reservations')).rows[0].count).toBe(0);
    } finally { await runtime.close(); }
  });

  it('lets a ready Russian lead call proceed while the earlier Uzbek job waits for its own recordings', async () => {
    await database.query("UPDATE academy_leads SET languages=ARRAY['uz'] WHERE id=1");
    await database.query(`INSERT INTO academy_leads(id,phone,languages) VALUES(2,'+998909876543',ARRAY['ru']);
      INSERT INTO academy_students(id,lead_id,contact_name) VALUES(2,2,'Second parent');
      INSERT INTO academy_demo_lesson_participants(id,demo_lesson_id,student_id,status) VALUES(2,1,2,'invited');`);
    const call = mockCall();
    const capacity = provider();
    const runtime = makeRuntime(capacity, call);
    try {
      await runtime.tick();
      expect(call).toHaveBeenCalledOnce();
      expect(call.mock.calls[0][1].phone).toBe('+998909876543');
      expect((await database.query("SELECT status,attempts FROM voice_reminder_jobs WHERE language='uz'")).rows[0])
        .toMatchObject({ status: 'waiting', attempts: 0 });
      expect((await database.query("SELECT status FROM voice_reminder_jobs WHERE language='ru'")).rows[0].status).toBe('played');
      expect(capacity.getCredentials).toHaveBeenCalledOnce();
    } finally { await runtime.close(); }
  });

  it('routes a committed auto response through the runtime after the provider binds its own UUID', async () => {
    await prepareConfirmationAudio();
    const call = vi.fn<typeof performVertoReminderCall>(async (_credentials, input) => {
      expect(input.confirmation).toMatchObject({ promptDurationSeconds: 1 });
      expect(await inspectReminderAudio(input.confirmation!.yesAudioPath)).toMatchObject({ durationSeconds: 1 });
      expect(await inspectReminderAudio(input.confirmation!.noAudioPath)).toMatchObject({ durationSeconds: 1 });
      await input.onStarted!();
      const attempt = (await database.query('SELECT extension,phone,started_at FROM voice_reminder_call_attempts WHERE call_id=$1',[input.callId])).rows[0];
      const providerId = randomUUID();
      expect(await runtime.observeRobotCall({ uuid: providerId, direction: 'outgoing', caller: attempt.extension,
        callee: attempt.phone.replace(/\D/g,''), date: Math.floor(attempt.started_at.getTime()/1000), event: 'call_start' })).toBe(true);
      expect(await input.confirmation!.onResponse('yes', randomUUID())).toBe(false);
      expect(await input.confirmation!.onResponse('yes', input.callId!)).toBe(true);
      expect(await input.confirmation!.onResponse('yes', input.callId!)).toBe(true);
      expect(await input.confirmation!.onResponse('no', input.callId!)).toBe(false);
      const committed = (await database.query('SELECT response,response_call_id FROM voice_reminder_jobs')).rows[0];
      expect(committed).toMatchObject({ response: 'yes', response_call_id: input.callId });
      return { outcome: 'played', callStarted: true, callId: input.callId!, terminationConfirmed: true, response: 'yes' };
    });
    const runtime = makeRuntime(provider(), call);
    await runtime.tick();
    expect(call).toHaveBeenCalledTimes(1);
    expect((await database.query('SELECT status FROM academy_demo_lesson_participants WHERE id=1')).rows[0].status).toBe('invited');
    expect((await database.query('SELECT * FROM voice_reminder_participant_response(1)')).rows[0].response).toBe('yes');
    expect((await database.query('SELECT count(*)::int AS count FROM telephony_line_reservations')).rows[0].count).toBe(0);
    await runtime.close();
  });

  it('saves the manual no answer without changing the actual demo participant', async () => {
    await prepareConfirmationAudio();
    await database.query('UPDATE voice_reminder_settings SET enabled=false WHERE id=1');
    const id = await enqueueTest();
    const call = vi.fn<typeof performVertoReminderCall>(async (_credentials, input) => {
      await input.onStarted!();
      expect(await input.confirmation!.onResponse('no', input.callId!)).toBe(true);
      return { outcome: 'played', callStarted: true, callId: input.callId!, terminationConfirmed: true, response: 'no' };
    });
    const runtime = makeRuntime(provider(), call);
    await runtime.tick();
    expect(call).toHaveBeenCalledTimes(1);
    expect((await database.query('SELECT response,status FROM voice_reminder_test_calls WHERE id=$1',[id])).rows[0])
      .toMatchObject({ response: 'no', status: 'played' });
    expect((await database.query('SELECT count(*)::int AS count FROM voice_reminder_jobs WHERE response IS NOT NULL')).rows[0].count).toBe(0);
    expect((await database.query('SELECT status FROM academy_demo_lesson_participants WHERE id=1')).rows[0].status).toBe('invited');
    await runtime.close();
  });

  it('delivers independent day-before and two-hour reminders with their own intro and deadline', async () => {
    const tomorrowAudio = await prepareTomorrowAudio();
    const scheduledAt = new Date(testClock + 24 * 60 * 60_000 + 30 * 60_000);
    await database.query("UPDATE academy_demo_lessons SET scheduled_at=$1::timestamptz AT TIME ZONE 'UTC' WHERE id=1",[scheduledAt]);
    await repository.saveSettings({ ...settings, enabled: true, dayBeforeEnabled: true, leadMinutes: 120,
      allowedStartTime: '00:00', allowedEndTime: '23:59' },1);
    let clock = scheduledAt.getTime() - 24 * 60 * 60_000;
    const call = mockCall();
    const runtime = createVoiceRemindersRuntime(provider(),database,{ audioDirectory: directory, performCall: call, now: () => clock });
    await runtime.tick();
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][1].deadline.toISOString()).toBe('2030-01-15T15:00:00.000Z');
    const jobs = (await database.query('SELECT id,reminder_kind,status,intro_audio_id FROM voice_reminder_jobs ORDER BY reminder_kind')).rows;
    expect(jobs).toHaveLength(2);
    expect(jobs.find(row => row.reminder_kind === 'day_before')).toMatchObject({ status: 'played', intro_audio_id: tomorrowAudio.id });
    expect(jobs.find(row => row.reminder_kind === 'same_day')).toMatchObject({ status: 'waiting' });
    await runtime.tick();
    expect(call).toHaveBeenCalledTimes(1);
    clock = scheduledAt.getTime() - 120 * 60_000;
    await runtime.tick();
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[1][1].deadline).toEqual(scheduledAt);
    const todayAudio = (await repository.audioLibrary()).intro!;
    expect((await database.query("SELECT status,intro_audio_id FROM voice_reminder_jobs WHERE reminder_kind='same_day'")).rows[0])
      .toMatchObject({ status: 'played', intro_audio_id: todayAudio.id });
    expect((await database.query('SELECT count(*)::int AS count FROM voice_reminder_call_attempts')).rows[0].count).toBe(2);
    await runtime.tick();
    expect(call).toHaveBeenCalledTimes(2);
    await runtime.close();
  });

  it('stops a day-before call at 20:00 without reusing its tomorrow intro on the demo day', async () => {
    await prepareTomorrowAudio();
    const scheduledAt = new Date('2030-01-16T05:30:00Z');
    await database.query("UPDATE academy_demo_lessons SET scheduled_at=$1::timestamptz AT TIME ZONE 'UTC' WHERE id=1",[scheduledAt]);
    let clock = new Date('2030-01-15T14:59:00Z').getTime();
    const call = vi.fn<typeof performVertoReminderCall>(async (_credentials,input) => {
      expect(input.deadline.toISOString()).toBe('2030-01-15T15:00:00.000Z');
      await input.onStarted!();
      clock = input.deadline.getTime();
      expect(await input.shouldContinue(false)).toBe(false);
      return { outcome: 'cancelled', callStarted: true, callId: input.callId!, terminationConfirmed: true };
    });
    const runtime = createVoiceRemindersRuntime(provider(),database,{ audioDirectory: directory, performCall: call, now: () => clock });
    await runtime.tick();
    expect((await database.query("SELECT status,attempts FROM voice_reminder_jobs WHERE reminder_kind='day_before'")).rows[0])
      .toMatchObject({ status: 'cancelled', attempts: 1 });
    await runtime.tick();
    expect(call).toHaveBeenCalledTimes(1);
    clock = new Date('2030-01-15T19:00:00Z').getTime();
    await runtime.tick();
    expect(call).toHaveBeenCalledTimes(1);
    await runtime.close();
  });

  it('pins the tomorrow intro for a manual test outside the automatic reminder window', async () => {
    const tomorrowAudio = await prepareTomorrowAudio();
    await database.query('UPDATE voice_reminder_settings SET enabled=false WHERE id=1');
    const id = await enqueueTest();
    const clock = new Date('2030-01-15T15:00:00Z').getTime();
    await database.query("UPDATE voice_reminder_test_calls SET reminder_kind='day_before',not_before_at=$2,expires_at=$3 WHERE id=$1",
      [id,new Date(clock),new Date(clock+600_000)]);
    const call = mockCall();
    const runtime = createVoiceRemindersRuntime(provider(),database,{ audioDirectory: directory, performCall: call, now: () => clock });
    await runtime.tick();
    expect(call).toHaveBeenCalledTimes(1);
    expect((await database.query('SELECT status,intro_audio_id FROM voice_reminder_test_calls WHERE id=$1',[id])).rows[0])
      .toMatchObject({ status: 'played', intro_audio_id: tomorrowAudio.id });
    expect((await database.query('SELECT test_call_id,job_id FROM voice_reminder_call_attempts')).rows[0])
      .toMatchObject({ test_call_id: id, job_id: null });
    await runtime.close();
  });

  it('plays an actor-owned test while automatic reminders are off without creating demo jobs or manager KPIs', async () => {
    await database.query('UPDATE voice_reminder_settings SET enabled=false WHERE id=1');
    const id = await enqueueTest();
    const call = mockCall();
    const runtime = makeRuntime(provider(), call);
    expect(await runtime.channels.enabled()).toBe(true);
    await runtime.tick();
    expect(call).toHaveBeenCalledTimes(1);
    expect(await testStatus(id)).toMatchObject({ status: 'played', dial_started_at: expect.any(Date) });
    const attempt = (await database.query('SELECT call_id,job_id,test_call_id FROM voice_reminder_call_attempts')).rows[0];
    expect(attempt).toMatchObject({ job_id: null, test_call_id: id });
    expect(await runtime.observeRobotCall({ uuid: attempt.call_id, event: 'call_end' })).toBe(true);
    expect((await database.query('SELECT count(*)::int AS count FROM voice_reminder_jobs')).rows[0].count).toBe(0);
    expect((await database.query('SELECT count(*)::int AS count FROM telephony_calls')).rows[0].count).toBe(0);
    expect((await database.query('SELECT termination_confirmed_at FROM voice_reminder_call_attempts')).rows[0].termination_confirmed_at).toEqual(expect.any(Date));
    await runtime.close();
  });

  it('waits with both manager lines busy and uses the free line when one becomes available', async () => {
    await database.query('UPDATE voice_reminder_settings SET enabled=false WHERE id=1');
    const id = await enqueueTest();
    const capacity = provider();
    capacity.snapshot.mockResolvedValue({ known: true, occupiedChannels: 2, busyExtensions: ['100','101'] });
    const call = mockCall();
    const runtime = makeRuntime(capacity, call);
    await runtime.tick();
    expect(call).not.toHaveBeenCalled();
    expect(await testStatus(id)).toMatchObject({ status: 'waiting', dial_started_at: null });
    expect((await database.query('SELECT count(*)::int AS count FROM voice_reminder_call_attempts')).rows[0].count).toBe(0);
    capacity.snapshot.mockResolvedValue({ known: true, occupiedChannels: 1, busyExtensions: ['101'] });
    await database.query('UPDATE voice_reminder_test_calls SET not_before_at=$1 WHERE id=$2',[new Date(testClock),id]);
    await runtime.tick();
    expect(call).toHaveBeenCalledTimes(1);
    expect(capacity.getCredentials).toHaveBeenCalledWith('100');
    expect(await testStatus(id)).toMatchObject({ status: 'played' });
    await runtime.close();
  });

  it('keeps short international test destinations intact and recognizes their provider callback', async () => {
    await database.query('UPDATE voice_reminder_settings SET enabled=false WHERE id=1');
    const id = await enqueueTest(1,'+642123456');
    const call = mockCall();
    const runtime = makeRuntime(provider(),call);
    await runtime.tick();
    expect(call.mock.calls[0][1].phone).toBe('+642123456');
    const attempt = (await database.query('SELECT extension,phone,started_at FROM voice_reminder_call_attempts WHERE test_call_id=$1',[id])).rows[0];
    const providerId = randomUUID();
    expect(await runtime.observeRobotCall({ uuid: providerId, direction: 'outgoing', caller: attempt.extension,
      callee: '642123456', date: Math.floor(attempt.started_at.getTime()/1000), event: 'call_end' })).toBe(true);
    expect((await database.query('SELECT provider_id FROM voice_reminder_call_attempts WHERE test_call_id=$1',[id])).rows[0].provider_id).toBe(providerId);
    expect((await database.query('SELECT count(*)::int AS count FROM telephony_calls')).rows[0].count).toBe(0);
    await runtime.close();
  });

  it('allows two different actors to test in parallel while using only the two shared lines', async () => {
    await database.query('UPDATE voice_reminder_settings SET enabled=false WHERE id=1');
    const ids = [await enqueueTest(), await enqueueTest(2,'+998911234567')];
    let joined!: () => void;
    const both = new Promise<void>(resolve => { joined = resolve; });
    let started = 0;
    const call = vi.fn<typeof performVertoReminderCall>(async (_credentials,input) => {
      await input.onStarted!();
      started += 1;
      if (started === 2) {
        expect((await database.query('SELECT count(*)::int AS count FROM telephony_line_reservations')).rows[0].count).toBe(2);
        joined();
      }
      await both;
      return { outcome: 'played', callStarted: true, callId: input.callId!, terminationConfirmed: true };
    });
    const capacity = provider();
    const runtime = makeRuntime(capacity,call);
    await runtime.tick();
    expect(call).toHaveBeenCalledTimes(2);
    expect(capacity.getCredentials.mock.calls.map(args => args[0]).sort()).toEqual(['100','101']);
    for (const id of ids) expect(await testStatus(id)).toMatchObject({ status: 'played' });
    await runtime.close();
  });

  it('never redials an ambiguous test and keeps channel admission active after the job ends', async () => {
    await database.query('UPDATE voice_reminder_settings SET enabled=false WHERE id=1');
    const id = await enqueueTest();
    const call = vi.fn<typeof performVertoReminderCall>(async (_credentials,input) => {
      await input.onStarted!();
      throw new Error('Socket lost after dial marker');
    });
    const runtime = makeRuntime(provider(),call);
    await runtime.tick();
    expect(await testStatus(id)).toMatchObject({ status: 'failed', dial_started_at: expect.any(Date) });
    const attempt = (await database.query('SELECT completed_at,termination_confirmed_at FROM voice_reminder_call_attempts')).rows[0];
    expect(attempt).toMatchObject({ completed_at: expect.any(Date), termination_confirmed_at: null });
    expect(await runtime.channels.enabled()).toBe(true);
    await runtime.tick();
    expect(call).toHaveBeenCalledTimes(1);
    await runtime.close();
    const restarted = makeRuntime(provider(),call);
    await restarted.tick();
    expect(call).toHaveBeenCalledTimes(1);
    await restarted.close();
  });

  it('refuses the final test dial marker when a manager takes the line after admission', async () => {
    await database.query('UPDATE voice_reminder_settings SET enabled=false WHERE id=1');
    const id = await enqueueTest();
    let managerBusy = false;
    const capacity = provider();
    const reader = vi.fn(async () => ({ known: true, occupiedChannels: managerBusy ? 2 : 0,
      busyExtensions: managerBusy ? ['100','101'] : [] }));
    const call = vi.fn<typeof performVertoReminderCall>(async (_credentials,input) => {
      managerBusy = true;
      await input.onStarted!();
      throw new Error('Must not authorize a third call');
    });
    const runtime = makeRuntime({ ...capacity, readLocked: reader },call);
    await runtime.tick();
    expect(await testStatus(id)).toMatchObject({ status: 'waiting', dial_started_at: null });
    expect((await database.query('SELECT count(*)::int AS count FROM voice_reminder_call_attempts')).rows[0].count).toBe(0);
    expect((await database.query('SELECT count(*)::int AS count FROM telephony_line_reservations')).rows[0].count).toBe(0);
    await runtime.close();
  });

  it('rebuilds a test safely when the transport proves no INVITE followed its audio marker', async () => {
    await database.query('UPDATE voice_reminder_settings SET enabled=false WHERE id=1');
    const id = await enqueueTest();
    const call = mockCall();
    call.mockImplementationOnce(async (_credentials,input) => {
      await input.onStarted!();
      const library = await repository.audioLibrary();
      const store = new LocalVoiceReminderAudioStore(directory);
      const audio = await store.save({ bytes: await fs.readFile(await store.resolve(library.intro!.storageKey)),
        originalName: 'new-intro.wav', mimeType: 'audio/wav' });
      await repository.saveLibraryAudio({ part: 'intro' },audio,1,library.intro!.id);
      expect(await input.shouldContinue(true)).toBe(false);
      return { outcome: 'cancelled', callStarted: false, callId: null };
    });
    const runtime = makeRuntime(provider(),call);
    await runtime.tick();
    expect(await testStatus(id)).toMatchObject({ status: 'waiting', dial_started_at: null });
    expect((await database.query('SELECT count(*)::int AS count FROM voice_reminder_call_attempts')).rows[0].count).toBe(0);
    await database.query('UPDATE voice_reminder_test_calls SET not_before_at=$1 WHERE id=$2',[new Date(testClock),id]);
    await runtime.tick();
    expect(call).toHaveBeenCalledTimes(2);
    expect(await testStatus(id)).toMatchObject({ status: 'played' });
    expect((await database.query('SELECT count(*)::int AS count FROM voice_reminder_call_attempts WHERE test_call_id=$1',[id])).rows[0].count).toBe(1);
    await runtime.close();
  });

  it('records robot attempts before transport, preserves callback identity and avoids ordinary call KPIs', async () => {
    const call = mockCall();
    const runtime = makeRuntime(provider(), call);
    await runtime.tick();
    expect(call, JSON.stringify((await database.query('SELECT status,attempts FROM voice_reminder_jobs')).rows)).toHaveBeenCalledTimes(1);
    const calls = (await database.query('SELECT call_id FROM voice_reminder_call_attempts')).rows;
    expect(calls).toHaveLength(1);
    expect(await runtime.observeRobotCall({ uuid: calls[0].call_id })).toBe(true);
    expect((await database.query('SELECT count(*)::int AS count FROM telephony_calls')).rows[0].count).toBe(0);
    expect((await database.query('SELECT count(*)::int AS count FROM telephony_line_reservations')).rows[0].count).toBe(0);
    expect((await database.query("SELECT count(*)::int AS count FROM voice_reminder_jobs WHERE status='played'")).rows[0].count).toBe(1);
    await runtime.close();
  });

  it('does not dial when the bound destination belongs to a manager reservation', async () => {
    await database.query(`INSERT INTO telephony_line_reservations(id,extension,owner_type,owner_user_id,client_call_id,phone,lease_until)
      VALUES($1,'101','manager',1,$2,'+998901234567',now()+interval '90 seconds')`, [randomUUID(), randomUUID()]);
    const call = mockCall();
    const runtime = makeRuntime(provider(), call);
    await runtime.tick();
    expect(call).not.toHaveBeenCalled();
    expect((await database.query('SELECT status,attempts FROM voice_reminder_jobs ORDER BY id')).rows[0]).toMatchObject({ status: 'waiting', attempts: 0 });
    expect((await database.query(`SELECT count(*)::int AS count FROM telephony_line_reservations WHERE owner_type='robot'`)).rows[0].count).toBe(0);
    await runtime.close();
  });

  it('waits without an attempt or channel when the exact minute clip is missing', async () => {
    await repository.removeLibraryAudio({ part: 'minute', minute: '30' }, 1);
    const capacity = provider();
    const call = mockCall();
    const runtime = makeRuntime(capacity, call);
    await runtime.tick();
    expect(call).not.toHaveBeenCalled();
    expect(capacity.getCredentials).not.toHaveBeenCalled();
    expect((await database.query('SELECT status,attempts FROM voice_reminder_jobs ORDER BY id')).rows[0]).toMatchObject({ status: 'waiting', attempts: 0 });
    expect((await database.query('SELECT count(*)::int AS count FROM telephony_line_reservations')).rows[0].count).toBe(0);
    await runtime.close();
  });

  it('requires zero-zero minutes at a whole hour and resumes once that recording is uploaded', async () => {
    await database.query("UPDATE academy_demo_lessons SET scheduled_at=$1::timestamptz AT TIME ZONE 'UTC' WHERE id=1", [new Date(testClock + 60 * 60_000)]);
    const library = await repository.audioLibrary();
    const store = new LocalVoiceReminderAudioStore(directory);
    const bytes = await fs.readFile(await store.resolve(library.hours[0].audio.storageKey));
    const hour = await store.save({ bytes, originalName: 'hour-11.wav', mimeType: 'audio/wav' });
    await repository.saveLibraryAudio({ part: 'hour', hour: '11' }, hour, 1);
    const call = mockCall();
    const runtime = makeRuntime(provider(), call);
    await runtime.tick();
    expect(call).not.toHaveBeenCalled();
    expect((await database.query('SELECT status,attempts FROM voice_reminder_jobs ORDER BY id')).rows[0]).toMatchObject({ status: 'waiting', attempts: 0 });
    const minute = await store.save({ bytes, originalName: 'minute-00.wav', mimeType: 'audio/wav' });
    await repository.saveLibraryAudio({ part: 'minute', minute: '00' }, minute, 1);
    await runtime.tick();
    expect(call).toHaveBeenCalledTimes(1);
    expect((await database.query("SELECT count(*)::int AS count FROM voice_reminder_jobs WHERE status='played'")).rows[0].count).toBe(1);
    await runtime.close();
  });

  it('releases a line after credential failures without consuming a dial attempt', async () => {
    const capacity = provider();
    capacity.getCredentials.mockRejectedValue(new Error('Credential lookup unavailable'));
    const call = mockCall();
    const runtime = makeRuntime(capacity, call);
    await runtime.tick();
    expect(call).not.toHaveBeenCalled();
    expect((await database.query('SELECT status,attempts FROM voice_reminder_jobs ORDER BY id')).rows[0]).toMatchObject({ status: 'waiting', attempts: 0 });
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
    expect((await database.query("SELECT count(*)::int AS count FROM voice_reminder_jobs WHERE status='calling'")).rows[0].count).toBe(0);
    expect(capacity.close).toHaveBeenCalledTimes(1);
  });

  it('keeps readiness false and postpones calls on an unknown provider snapshot', async () => {
    const capacity = provider(); capacity.snapshot.mockResolvedValue({ known: false, occupiedChannels: 0, busyExtensions: [] });
    const call = mockCall();
    const runtime = makeRuntime(capacity, call);
    expect(await runtime.gateway.readiness()).toEqual({ ready: false, code: 'transport_unavailable' });
    await runtime.tick();
    expect(call).not.toHaveBeenCalled();
    expect((await database.query("SELECT count(*)::int AS count FROM voice_reminder_jobs WHERE status='waiting'")).rows[0].count).toBe(1);
    await runtime.close();
  });

  it('waits for robot startup recovery without delaying manager reservations', async () => {
    let clock = testClock;
    const call = mockCall();
    const runtime = createVoiceRemindersRuntime(provider(), database, {
      audioDirectory: directory, performCall: call, startupRecoveryMs: 45_000, now: () => clock,
    });
    expect(await runtime.gateway.readiness()).toEqual({ ready: false, code: 'transport_unavailable' });
    expect(await runtime.gateway.tryAcquireLine()).toBeNull();
    const manager = await runtime.channels.acquire({ owner: 'manager', userId: 1,
      extensions: ['100'], clientCallId: randomUUID(), phone: '+998911234567' });
    expect(manager).not.toBeNull();
    clock += 44_999;
    expect(await runtime.gateway.tryAcquireLine()).toBeNull();
    clock += 1;
    expect(await runtime.gateway.readiness()).toEqual({ ready: true, code: 'ready' });
    const line = await runtime.gateway.tryAcquireLine();
    expect(line).not.toBeNull();
    await line!.release();
    await runtime.channels.release(manager!.id, 'manager', 1);
    await runtime.close();
  });

  it('drains the other worker and releases resources even when one shutdown rejects', async () => {
    const capacity = provider();
    const runtime = makeRuntime(capacity,mockCall());
    const line = await runtime.gateway.tryAcquireLine();
    expect(line).not.toBeNull();
    let drained!: () => void;
    const drain = new Promise<void>(resolve => { drained = resolve; });
    vi.spyOn(runtime.worker,'close').mockRejectedValue(new Error('Automatic worker failed during shutdown'));
    vi.spyOn(runtime.testWorker,'close').mockReturnValue(drain);
    const closing = runtime.close();
    expect(capacity.close).not.toHaveBeenCalled();
    expect((await database.query('SELECT count(*)::int AS count FROM telephony_line_reservations')).rows[0].count).toBe(1);
    drained();
    await expect(closing).rejects.toThrow('Automatic worker failed during shutdown');
    expect(capacity.close).toHaveBeenCalledTimes(1);
    expect((await database.query('SELECT count(*)::int AS count FROM telephony_line_reservations')).rows[0].count).toBe(0);
  });
});
