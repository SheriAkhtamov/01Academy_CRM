import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresVoiceReminderRepository } from '../server/modules/voice-reminders/infrastructure/postgres-repository';
import { PostgresVoiceReminderTestCallRepository } from '../server/modules/voice-reminders/infrastructure/postgres-test-call-repository';
import type { StoredVoiceReminderAudio } from '../server/modules/voice-reminders/application/ports';

const url = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `voice_test_calls_${randomUUID().replace(/-/g, '')}`;
const now = new Date('2030-01-15T22:30:00Z');
const expiresAt = new Date(now.getTime() + 600_000);
const input = (phone = '+998901234567', clockTime = '11:00') => ({ requestId: randomUUID(), phone, clockTime });

describe.skipIf(!url)('durable actor-scoped one-shot test calls on PostgreSQL', () => {
  let admin: Pool;
  let database: Pool;
  let repository: PostgresVoiceReminderTestCallRepository;
  let library: PostgresVoiceReminderRepository;
  const audio = (): StoredVoiceReminderAudio => ({ id: randomUUID(), fileName: 'clip.wav', mimeType: 'audio/wav',
    sizeBytes: 24, durationSeconds: 1, uploadedAt: now.toISOString(), storageKey: `${randomUUID()}.wav`, sha256: 'a'.repeat(64) });
  beforeAll(async () => {
    if (!url || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname)) throw new Error('Local isolated PostgreSQL required');
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    database = new Pool({ connectionString: url, options: `-c search_path=${schema} -c timezone=America/New_York`, max: 12 });
    await database.query(`CREATE TABLE users(id integer PRIMARY KEY,module text,is_active boolean,is_archived boolean);
      CREATE TABLE user_modules(id serial PRIMARY KEY,user_id integer,module text);
      CREATE TABLE academy_leads(id integer PRIMARY KEY,language varchar(20),languages text[]);
      CREATE TABLE academy_students(id integer PRIMARY KEY,lead_id integer);
      CREATE TABLE academy_demo_lessons(id integer PRIMARY KEY,scheduled_at timestamp,status text);
      CREATE TABLE academy_demo_lesson_participants(id integer PRIMARY KEY,demo_lesson_id integer,student_id integer,status text);`);
    for (const name of ['0142_voice_reminders', '0143_crm_telephony_capacity', '0144_voice_reminder_audio_library',
      '0145_voice_reminder_clock_audio', '0146_voice_reminder_test_calls', '0147_voice_reminder_day_before', '0149_voice_reminder_confirmations', '0150_voice_reminder_languages']) {
      await database.query(readFileSync(`migrations/${name}.sql`, 'utf8'));
    }
    repository = new PostgresVoiceReminderTestCallRepository(database);
    library = new PostgresVoiceReminderRepository(database);
  });
  beforeEach(async () => {
    await database.query(`TRUNCATE voice_reminder_audio,voice_reminder_settings,voice_reminder_test_calls,
      user_modules,users RESTART IDENTITY CASCADE;
      INSERT INTO users VALUES(1,'administration',true,false),(2,'sales',true,false),(3,'sales',true,false),
        (4,'administration',false,false),(5,'administration',true,true),(6,'administration',true,false);
      INSERT INTO user_modules(user_id,module) VALUES(2,'administration');
      INSERT INTO voice_reminder_settings(id) VALUES(1);`);
    for (const target of [{ part: 'intro' }, { part: 'outro' }, { part: 'time', time: '11:00' },
      { part: 'hour', hour: '11' }, { part: 'minute', minute: '00' }] as const) {
      await library.saveLibraryAudio(target, audio(), 1);
    }
  });
  afterAll(async () => {
    await database?.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });

  const armConfirmationTest = async () => {
    for (const part of ['confirmationYes', 'confirmationNo'] as const) await library.saveLibraryAudio({ part }, audio(), 1);
    const { audio: _audio, audioLibrary: _library, timeZone: _zone, ...settings } = await library.settings();
    await library.saveSettings({ ...settings, enabled: false, confirmationEnabled: true }, 1);
    const request = input('+123456789');
    await repository.enqueue(1, request, now, expiresAt);
    const job = (await repository.claim(now, 300))!;
    expect(await repository.prepare(job, now)).toMatchObject({ confirmation: { promptDurationSeconds: 1 } });
    const callId = randomUUID();
    await database.query(`INSERT INTO voice_reminder_call_attempts(call_id,test_call_id,extension,phone,started_at)
      VALUES($1,$2,'100',$3,$4)`, [callId,job.id,request.phone,now]);
    await database.query('UPDATE voice_reminder_test_calls SET dial_started_at=$2,provider_call_id=$3 WHERE id=$1', [job.id,now,callId]);
    return { job, callId, request };
  };

  it('binds UZ into the immutable intent and pins only its own sources while preserving legacy RU defaults', async () => {
    const uzSources = [];
    for (const target of [{ part: 'intro' },{ part: 'outro' },{ part: 'hour',hour: '11' },{ part: 'minute',minute: '00' }] as const) {
      const source = { ...audio(),sha256: 'b'.repeat(64) }; uzSources.push(source);
      await library.saveLibraryAudio({ ...target,language: 'uz' },source,1,null);
    }
    const request = { ...input(),language: 'uz' as const };
    expect(await repository.enqueue(1,request,now,expiresAt)).toMatchObject({ language: 'uz' });
    await expect(repository.enqueue(1,{ ...request,language: 'ru' },now,expiresAt)).rejects.toMatchObject({ code: 'voiceReminderTestRequestChanged' });
    const job = (await repository.claim(now,300))!;
    expect(job.language).toBe('uz');
    const prepared = await repository.prepare(job,now);
    expect(prepared).toMatchObject({ language: 'uz',audioParts: { intro: uzSources[0],outro: uzSources[1],hour: uzSources[2],minute: uzSources[3] } });
    expect(await repository.canContinue({ ...job,language: 'ru' },now)).toBe(false);
    await library.saveLibraryAudio({ part: 'intro' },audio(),1,(await library.audioLibrary()).intro!.id);
    expect(await repository.canContinue(job,now)).toBe(true);
    await library.saveLibraryAudio({ part: 'intro',language: 'uz' },audio(),1,uzSources[0].id);
    expect(await repository.canContinue(job,now)).toBe(false);
    expect(await repository.canContinue(job,now,false)).toBe(true);
    await repository.finish(job,{ outcome: 'played',callStarted: true,callId: randomUUID() },now);
    expect(await repository.enqueue(1,request,now,expiresAt)).toMatchObject({ language: 'uz',status: 'played' });
    expect(await repository.enqueue(6,input(),now,expiresAt)).toMatchObject({ language: 'ru' });
  });

  it('never borrows Russian audio for a missing UZ test and validates UZ acknowledgement pins', async () => {
    await expect(repository.enqueue(1,{ ...input(),language: 'uz' },now,expiresAt)).rejects.toMatchObject({ code: 'voiceReminderAudioRequired' });
    for (const target of [{ part: 'intro' },{ part: 'outro' },{ part: 'time',time: '11:00' }] as const)
      await library.saveLibraryAudio({ ...target,language: 'uz' },audio(),1,null);
    for (const part of ['confirmationYes','confirmationNo'] as const) await library.saveLibraryAudio({ part },audio(),1,null);
    const { audio: _audio,audioLibrary: _library,timeZone: _zone,...settings } = await library.settings();
    await library.saveSettings({ ...settings,confirmationEnabled: true },1);
    await expect(repository.enqueue(1,{ ...input(),language: 'uz' },now,expiresAt)).rejects.toMatchObject({ code: 'voiceReminderConfirmationAudioRequired' });
    for (const part of ['confirmationYes','confirmationNo'] as const) await library.saveLibraryAudio({ part,language: 'uz' },audio(),1,null);
    const request = { ...input(),language: 'uz' as const };
    await repository.enqueue(1,request,now,expiresAt);
    const job = (await repository.claim(now,300))!;
    expect(await repository.prepare(job,now)).toMatchObject({ confirmation: { yesAudio: (await library.audioLibrary('uz')).confirmationYes } });
  });

  it('rechecks the database clock after waiting for the test row lock past expiry', async () => {
    const { job, callId, request } = await armConfirmationTest();
    const locked = await database.connect();
    try {
      await locked.query('BEGIN');
      await locked.query('SELECT id FROM voice_reminder_test_calls WHERE id=$1 FOR UPDATE', [job.id]);
      const timestamp = new Date();
      await locked.query('UPDATE voice_reminder_test_calls SET expires_at=$2 WHERE id=$1', [job.id,new Date(timestamp.getTime()+200)]);
      const pending = repository.recordResponse(job, request.phone, 'yes', timestamp, callId);
      await new Promise(resolve => setTimeout(resolve, 350));
      await locked.query('COMMIT');
      expect(await pending).toBe(false);
      expect((await repository.current(1))?.response).toBeNull();
    } finally { await locked.query('ROLLBACK'); locked.release(); }
  });

  it('persists an actor-scoped test answer once without touching any demo participant', async () => {
    const { job, callId, request } = await armConfirmationTest();
    expect(await repository.recordResponse(job, request.phone, 'no', now, callId)).toBe(true);
    const duplicate = await Promise.all(Array.from({ length: 10 }, () => repository.recordResponse(job, request.phone, 'yes', now, callId)));
    expect(duplicate).toEqual(Array(10).fill(false));
    expect(await repository.recordResponse(job, request.phone, 'no', now, callId)).toBe(true);
    expect(await repository.current(1)).toMatchObject({ id: job.id, status: 'calling', response: 'no', respondedAt: now.toISOString() });
    expect(await repository.current(2)).toBeNull();
    expect((await database.query('SELECT count(*)::int AS count FROM voice_reminder_jobs')).rows[0].count).toBe(0);
    await repository.finish(job, { outcome: 'failed', callStarted: true, callId }, now);
    expect(await repository.enqueue(1, request, now, expiresAt)).toMatchObject({ response: 'no', status: 'failed' });
    expect(await repository.recordResponse(job, request.phone, 'no', now, callId)).toBe(false);
  });

  it('keeps test confirmation pins immutable after INVITE and rejects actor/phone/call/expiry changes', async () => {
    const { job, callId, request } = await armConfirmationTest();
    await database.query('UPDATE voice_reminder_test_calls SET provider_call_id=NULL WHERE id=$1', [job.id]);
    expect(await repository.recordResponse(job, request.phone, 'yes', now, callId)).toBe(false);
    await database.query('UPDATE voice_reminder_test_calls SET provider_call_id=$2 WHERE id=$1', [job.id,callId]);
    expect(await repository.recordResponse(job, request.phone, 'yes', now, randomUUID())).toBe(false);
    expect(await repository.recordResponse(job, '+998901234567', 'yes', now, callId)).toBe(false);
    expect(await repository.recordResponse({ ...job, leaseToken: randomUUID() }, request.phone, 'yes', now, callId)).toBe(false);
    const before = await library.audioLibrary();
    await library.saveLibraryAudio({ part: 'confirmationNo' }, audio(), 1, before.confirmationNo!.id);
    expect(await repository.canContinue(job, now)).toBe(false);
    expect(await repository.canContinue(job, now, false)).toBe(true);
    await database.query(`UPDATE users SET is_active=false WHERE id=1`);
    expect(await repository.recordResponse(job, request.phone, 'yes', now, callId)).toBe(false);
    await database.query(`UPDATE users SET is_active=true WHERE id=1`);
    expect(await repository.recordResponse(job, request.phone, 'yes', expiresAt, callId)).toBe(false);
    const { audio: _audio, audioLibrary: _library, timeZone: _zone, ...settings } = await library.settings();
    await library.saveSettings({ ...settings, confirmationEnabled: false }, 1);
    expect(await repository.canContinue(job, now, false)).toBe(false);
    expect(await repository.recordResponse(job, request.phone, 'yes', now, callId)).toBe(false);
    expect((await repository.current(1))?.response).toBeNull();
  });

  it('keeps legacy omitted kind idempotent and rejects changing the kind of an accepted intent', async () => {
    const request = input();
    const accepted = await repository.enqueue(1, request, now, expiresAt);
    expect(accepted.reminderKind).toBe('same_day');
    expect(await repository.enqueue(1, { ...request, reminderKind: 'same_day' }, now, expiresAt)).toEqual(accepted);
    await expect(repository.enqueue(1, { ...request, reminderKind: 'day_before' }, now, expiresAt))
      .rejects.toMatchObject({ code: 'voiceReminderTestRequestChanged' });
    expect((await database.query('SELECT count(*)::int AS count FROM voice_reminder_test_calls')).rows[0].count).toBe(1);
  });

  it('tests the tomorrow introduction with automation off outside the automatic day/window, retaining active pins', async () => {
    const tomorrow = audio();
    await library.saveLibraryAudio({ part: 'dayBeforeIntro' }, tomorrow, 1, null);
    const request = { ...input(), reminderKind: 'day_before' as const };
    const accepted = await repository.enqueue(1, request, now, expiresAt);
    expect(accepted.reminderKind).toBe('day_before');
    const job = (await repository.claim(now, 300))!;
    expect(job.reminderKind).toBe('day_before');
    expect(await repository.prepare(job, now)).toMatchObject({ audioParts: { intro: tomorrow, clockTime: '11:00' } });
    expect(await repository.canContinue(job, now)).toBe(true);
    await library.saveLibraryAudio({ part: 'intro' }, audio(), 1);
    expect(await repository.canContinue(job, now)).toBe(true);
    await library.saveLibraryAudio({ part: 'dayBeforeIntro' }, audio(), 1, tomorrow.id);
    expect(await repository.canContinue(job, now)).toBe(false);
    expect(await repository.canContinue(job, now, false)).toBe(true);
    expect(await repository.prepare(job, now)).toMatchObject({ audioParts: { intro: (await library.audioLibrary()).dayBeforeIntro } });
    expect(await repository.canContinue(job, now)).toBe(true);
  });

  it('requires the selected introduction and does not starve another test kind after a missing exact clock', async () => {
    await expect(repository.enqueue(1, { ...input(), reminderKind: 'day_before' }, now, expiresAt))
      .rejects.toMatchObject({ code: 'voiceReminderAudioRequired' });
    await library.saveLibraryAudio({ part: 'dayBeforeIntro' }, audio(), 1, null);
    const first = await repository.enqueue(1, { ...input(), reminderKind: 'day_before' }, now, expiresAt);
    await library.removeLibraryAudio({ part: 'minute', minute: '00' }, 1);
    await library.removeTimeAudio('11:00', 1);
    await library.saveLibraryAudio({ part: 'time', time: '12:30' }, audio(), 1);
    const second = await repository.enqueue(2, input('+123456789', '12:30'), now, expiresAt);
    const claimed = (await repository.claim(now, 300))!;
    expect(claimed.id).toBe(second.id);
    expect(await repository.current(1)).toMatchObject({ id: first.id, status: 'waiting', reminderKind: 'day_before' });
  });

  it('runs with automatic reminders off outside their hours and returns only the current actor DTO', async () => {
    expect((await library.settings()).enabled).toBe(false);
    const request = input();
    const dto = await repository.enqueue(1, request, now, expiresAt);
    expect(dto).toEqual({ id: request.requestId, status: 'waiting', phone: request.phone, clockTime: request.clockTime, reminderKind: 'same_day', language: 'ru', response: null, respondedAt: null });
    expect(await repository.current(1)).toEqual(dto);
    expect(await repository.current(2)).toBeNull();
    const job = (await repository.claim(now, 300))!;
    expect(await repository.prepare(job, now)).toMatchObject({ phone: request.phone, clockTime: '11:00', audioParts: { kind: 'clock' } });
    expect(await repository.canContinue(job, now)).toBe(true);
  });

  it.each([['+123456789', '+123456789'], ['00123456789', '+123456789'], ['90 123 45 67', '+998901234567']])(
    'preserves the requested country prefix for %s', async (phone, expected) => {
      const dto = await repository.enqueue(1, input(phone), now, expiresAt);
      expect(dto.phone).toBe(expected);
      const job = (await repository.claim(now, 300))!;
      expect(await repository.prepare(job, now)).toMatchObject({ phone: expected });
    },
  );

  it('serializes repeat intents and binds their normalized phone/time payload without resetting terminal state', async () => {
    const request = input('90 123 45 67');
    const accepted = await Promise.all(Array.from({ length: 12 }, () => repository.enqueue(1, request, now, expiresAt)));
    expect(new Set(accepted.map(dto => dto.id))).toEqual(new Set([request.requestId]));
    expect((await database.query('SELECT count(*)::int AS count FROM voice_reminder_test_calls')).rows[0].count).toBe(1);
    expect(await repository.enqueue(1, { ...request, phone: '+998901234567' }, now, expiresAt)).toEqual(accepted[0]);
    await expect(repository.enqueue(1, { ...request, clockTime: '12:00' }, now, expiresAt)).rejects.toMatchObject({ code: 'voiceReminderTestRequestChanged' });
    await expect(repository.enqueue(2, request, now, expiresAt)).rejects.toMatchObject({ code: 'voiceReminderTestRequestChanged' });
    const job = (await repository.claim(now, 300))!;
    await repository.prepare(job, now);
    await repository.finish(job, { outcome: 'unanswered', callStarted: true, callId: 'provider-call' }, now);
    await library.removeLibraryAudio({ part: 'minute', minute: '00' }, 1);
    await library.removeTimeAudio('11:00', 1);
    expect(await repository.enqueue(1, request, now, expiresAt)).toMatchObject({ status: 'unanswered' });
    expect(await repository.claim(now, 300)).toBeNull();
  });

  it('allows only one active intent per actor and never hides it behind a newer terminal row', async () => {
    const requests = [input(), input()];
    const created = await Promise.allSettled(requests.map(request => repository.enqueue(1, request, now, expiresAt)));
    expect(created.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(created.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'voiceReminderTestAlreadyPending' } });
    const active = await repository.current(1);
    await database.query(`INSERT INTO voice_reminder_test_calls(id,actor_user_id,phone,clock_time,status,expires_at,created_at)
      VALUES($1,1,'+998911234567','12:00','played',$2,$2)`, [randomUUID(), expiresAt]);
    expect(await repository.current(1)).toEqual(active);
  });

  it('enforces current staff leadership, including assigned modules, at enqueue and before dispatch', async () => {
    for (const actor of [3, 4, 5]) {
      await expect(repository.enqueue(actor, input(), now, expiresAt)).rejects.toMatchObject({ code: 'accessDenied' });
    }
    await repository.enqueue(2, input(), now, expiresAt);
    const job = (await repository.claim(now, 300))!;
    await repository.prepare(job, now);
    expect(await repository.canContinue(job, now)).toBe(true);
    await database.query('DELETE FROM user_modules WHERE user_id=2');
    expect(await repository.canContinue(job, now, false)).toBe(false);
    await repository.recover(now);
    expect((await database.query('SELECT status FROM voice_reminder_test_calls')).rows[0].status).toBe('cancelled');
    await expect(repository.current(2)).rejects.toMatchObject({ code: 'accessDenied' });
  });

  it('rechecks selected mode before INVITE while preserving the frozen active library', async () => {
    await library.removeLibraryAudio({ part: 'minute', minute: '00' }, 1);
    await repository.enqueue(1, input(), now, expiresAt);
    const job = (await repository.claim(now, 300))!;
    expect(await repository.prepare(job, now)).toMatchObject({ audioParts: { kind: 'time' } });
    await library.saveLibraryAudio({ part: 'minute', minute: '00' }, audio(), 1);
    expect(await repository.canContinue(job, now)).toBe(false);
    expect(await repository.canContinue(job, now, false)).toBe(true);
    expect(await repository.prepare(job, now)).toMatchObject({ audioParts: { kind: 'clock' } });
    await library.removeLibraryAudio({ part: 'hour', hour: '11' }, 1);
    await library.removeTimeAudio('11:00', 1);
    expect(await repository.canContinue(job, now)).toBe(false);
    expect(await repository.canContinue(job, now, false)).toBe(true);
  });

  it('holds missing-audio jobs without starving another actor and never leases more than two tests', async () => {
    const first = await repository.enqueue(1, input('+998901234567', '11:00'), now, expiresAt);
    await library.saveLibraryAudio({ part: 'minute', minute: '30' }, audio(), 1);
    await repository.enqueue(2, input('+998911234567', '11:30'), now, expiresAt);
    await repository.enqueue(6, input('+998931234567', '11:30'), now, expiresAt);
    await library.removeLibraryAudio({ part: 'minute', minute: '00' }, 1);
    await library.removeTimeAudio('11:00', 1);
    const claims = await Promise.all(Array.from({ length: 8 }, () => repository.claim(now, 300)));
    expect(claims.filter(Boolean)).toHaveLength(2);
    expect(claims.filter(Boolean).map(job => job!.id)).not.toContain(first.id);
    expect(await repository.current(1)).toMatchObject({ status: 'waiting' });
  });

  it('recovers a lost preflight lease but never retries a marked or expired call and guards stale callbacks', async () => {
    const request = input();
    await repository.enqueue(1, request, now, expiresAt);
    const old = (await repository.claim(now, 10))!;
    await repository.prepare(old, now);
    const later = new Date(now.getTime() + 11_000);
    await repository.recover(later);
    const next = (await repository.claim(later, 10))!;
    expect(next.leaseToken).not.toBe(old.leaseToken);
    await repository.finish(old, { outcome: 'played', callStarted: true, callId: 'old' }, later);
    expect(await repository.current(1)).toMatchObject({ status: 'calling' });
    expect(await repository.renew(old, later, 300)).toBe(false);
    await database.query('UPDATE voice_reminder_test_calls SET dial_started_at=$1 WHERE id=$2', [later, next.id]);
    expect(await repository.defer(next, later)).toBe(false);
    await repository.recover(new Date(later.getTime() + 11_000));
    expect(await repository.current(1)).toMatchObject({ status: 'failed' });
    expect(await repository.claim(later, 300)).toBeNull();
    expect(await repository.enqueue(1, request, later, expiresAt)).toMatchObject({ status: 'failed' });
    const fresh = input();
    await repository.enqueue(1, fresh, later, expiresAt);
    await repository.recover(expiresAt);
    expect(await repository.current(1)).toMatchObject({ id: fresh.requestId, status: 'cancelled' });
    expect(await repository.claim(expiresAt, 300)).toBeNull();
  });
});
