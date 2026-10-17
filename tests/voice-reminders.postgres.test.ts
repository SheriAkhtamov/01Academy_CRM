import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresVoiceReminderRepository } from '../server/modules/voice-reminders/infrastructure/postgres-repository';
import { DEFAULT_VOICE_REMINDER_SETTINGS, resolveVoiceReminderLanguage } from '../shared/contracts/voice-reminders';
import type { StoredVoiceReminderAudio } from '../server/modules/voice-reminders/application/ports';
import { RobotCallReceipts } from '../server/infrastructure/voice-telephony/robot-call-receipts';
import { readVoiceReminderJobs } from './helpers/voice-reminder-jobs';
import { demoReminderProgressJoinSql } from '../server/modules/academy/demo-reminder-progress';

const url = process.env.PORTAL_TEST_DATABASE_URL;
const schema = `voice_${randomUUID().replace(/-/g, '')}`;
const now = new Date('2030-01-15T05:00:00Z');
const scheduledAt = new Date('2030-01-15T06:00:00Z');
const audio: StoredVoiceReminderAudio = {
  id: randomUUID(), fileName: 'demo.wav', mimeType: 'audio/wav', sizeBytes: 16044,
  durationSeconds: 1, uploadedAt: now.toISOString(), storageKey: `${randomUUID()}.wav`, sha256: 'a'.repeat(64),
};
const { audio: _defaultAudio, audioLibrary: _defaultLibrary, timeZone: _defaultZone, ...input } = DEFAULT_VOICE_REMINDER_SETTINGS;

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
      CREATE TABLE academy_leads(id integer PRIMARY KEY, phone text, is_archived boolean NOT NULL DEFAULT false, language varchar(20),languages text[]);
      CREATE TABLE academy_lead_phones(id serial PRIMARY KEY, lead_id integer REFERENCES academy_leads(id), phone text, is_primary boolean);
      CREATE TABLE academy_students(id integer PRIMARY KEY, lead_id integer REFERENCES academy_leads(id), phone text, student_name text, contact_name text);
      CREATE TABLE academy_demo_lessons(id integer PRIMARY KEY, scheduled_at timestamp NOT NULL, status text NOT NULL);
      CREATE TABLE academy_demo_lesson_participants(id integer PRIMARY KEY, demo_lesson_id integer REFERENCES academy_demo_lessons(id),
        student_id integer REFERENCES academy_students(id), status text NOT NULL);
      CREATE TABLE telephony_calls(id serial PRIMARY KEY, client_call_id text, provider_call_id text, user_id integer);`);
    await pool.query(readFileSync('migrations/0142_voice_reminders.sql', 'utf8'));
    await pool.query(readFileSync('migrations/0143_crm_telephony_capacity.sql', 'utf8'));
    await pool.query(readFileSync('migrations/0144_voice_reminder_audio_library.sql', 'utf8'));
    await pool.query(readFileSync('migrations/0145_voice_reminder_clock_audio.sql', 'utf8'));
    await pool.query(readFileSync('migrations/0146_voice_reminder_test_calls.sql', 'utf8'));
    await pool.query(readFileSync('migrations/0147_voice_reminder_day_before.sql', 'utf8'));
    await pool.query(readFileSync('migrations/0149_voice_reminder_confirmations.sql', 'utf8'));
    await pool.query(readFileSync('migrations/0150_voice_reminder_languages.sql', 'utf8'));
    await pool.query(readFileSync('migrations/0152_voice_reminder_response_retry.sql', 'utf8'));
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
    for (const target of [{ part: 'intro' }, { part: 'outro' }, { part: 'time', time: '11:00' }, { part: 'time', time: '12:00' }] as const) {
      await repository.saveLibraryAudio(target, { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav` }, 1);
    }
    await repository.saveSettings({ ...input, enabled: true }, 1);
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });

  const enableDayBefore = async () => {
    const intro = { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav` };
    await repository.saveLibraryAudio({ part: 'dayBeforeIntro' }, intro, 1, null);
    await repository.saveSettings({ ...input, enabled: true, leadMinutes: 120, dayBeforeEnabled: true }, 1);
    return intro;
  };

  it.each([
    ['08:00', '03:00:00', '05:00:00'],
    ['10:00', '05:00:00', '05:00:00'],
    ['19:59', '14:59:00', '14:59:00'],
    ['20:00', '15:00:00', '14:59:00'],
    ['22:00', '17:00:00', '14:59:00'],
  ])('clamps the 24-hour reminder for %s to the previous Tashkent day window', async (clock, demoUtc, dueUtc) => {
    await enableDayBefore();
    await pool.query('UPDATE academy_demo_lessons SET scheduled_at=$1 WHERE id=1', [`2030-01-16 ${demoUtc}`]);
    const earlier = new Date('2030-01-15T04:00:00Z');
    await repository.synchronize(earlier, await repository.settings());
    const jobs = (await pool.query(`SELECT reminder_kind,due_at,scheduled_at FROM voice_reminder_jobs ORDER BY id`)).rows;
    expect(jobs.filter(row => row.reminder_kind === 'day_before')).toHaveLength(3);
    expect(jobs.filter(row => row.reminder_kind === 'day_before').every(row => row.due_at.toISOString() === `2030-01-15T${dueUtc}.000Z`)).toBe(true);
    expect(jobs.filter(row => row.reminder_kind === 'same_day').every(row => row.due_at.getTime() === row.scheduled_at.getTime()-120*60_000)).toBe(true);
    expect(await repository.claim(earlier, 2, 300)).toBeNull();
    expect(clock).toMatch(/^\d{2}:\d{2}$/);
  });

  it('keeps the two reminder kinds independent and never replays a completed day-before job', async () => {
    const tomorrowIntro = await enableDayBefore();
    await pool.query(`UPDATE academy_demo_lessons SET scheduled_at='2030-01-16 06:00:00' WHERE id=1;
      UPDATE academy_demo_lesson_participants SET status='cancelled' WHERE id IN (2,3)`);
    const previousDay = new Date('2030-01-15T06:00:00Z');
    await Promise.all([repository.synchronize(previousDay, await repository.settings()), repository.synchronize(previousDay, await repository.settings())]);
    const tomorrow = (await repository.claim(previousDay, 2, 300))!;
    expect(tomorrow.reminderKind).toBe('day_before');
    expect(await repository.prepare(tomorrow, previousDay)).toMatchObject({
      reminderKind: 'day_before', deadline: new Date('2030-01-15T15:00:00Z'),
      audioParts: { intro: tomorrowIntro, clockTime: '11:00' },
    });
    await repository.finish(tomorrow, { outcome: 'played', callStarted: true, callId: 'tomorrow-call' }, previousDay, null);
    await repository.synchronize(previousDay, await repository.settings());
    expect(await repository.claim(previousDay, 2, 300)).toBeNull();
    const demoDay = new Date('2030-01-16T04:00:00Z');
    const today = (await repository.claim(demoDay, 2, 300))!;
    expect(today.reminderKind).toBe('same_day'); expect(today.id).not.toBe(tomorrow.id);
    expect(await repository.prepare(today, demoDay)).toMatchObject({ deadline: new Date('2030-01-16T06:00:00Z'),
      audioParts: { intro: (await repository.audioLibrary()).intro, clockTime: '11:00' } });
    expect((await pool.query('SELECT reminder_kind,status,attempts FROM voice_reminder_jobs ORDER BY reminder_kind')).rows)
      .toEqual([{ reminder_kind: 'day_before', status: 'played', attempts: 1 }, { reminder_kind: 'same_day', status: 'calling', attempts: 0 }]);
  });

  it('checks day-before window and calendar fences before INVITE and during pinned playback', async () => {
    await enableDayBefore();
    await pool.query(`UPDATE academy_demo_lessons SET scheduled_at='2030-01-16 03:00:00' WHERE id=1`);
    await repository.saveLibraryAudio({ part: 'time', time: '08:00' }, { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav` }, 1);
    const before = new Date('2030-01-15T04:59:59Z');
    await repository.synchronize(before, await repository.settings());
    expect(await repository.claim(before, 2, 300)).toBeNull();
    const open = new Date('2030-01-15T05:00:00Z');
    const first = (await repository.claim(open, 2, 300))!;
    const prepared = await repository.prepare(first, open);
    expect(prepared).toMatchObject({ deadline: new Date('2030-01-15T15:00:00Z') });
    expect(await repository.prepare(first, before)).toBe('defer');
    expect(await repository.canContinue(first, '+998901234567', before, false)).toBe(false);
    await repository.defer(first, open);
    const last = new Date('2030-01-15T14:59:59Z');
    const job = (await repository.claim(last, 2, 300))!;
    await repository.prepare(job, last);
    expect(await repository.canContinue(job, '+998901234567', last, false)).toBe(true);
    for (const forbidden of ['2030-01-15T15:00:00Z', '2030-01-15T19:00:00Z']) {
      expect(await repository.canContinue(job, '+998901234567', new Date(forbidden), false)).toBe(false);
    }
    await repository.defer(job, new Date('2030-01-15T15:00:00Z'));
    await repository.synchronize(new Date('2030-01-15T15:00:00Z'), await repository.settings());
    expect((await pool.query(`SELECT status,attempts FROM voice_reminder_jobs WHERE reminder_kind='day_before'`)).rows)
      .toEqual(Array(3).fill({ status: 'cancelled', attempts: 0 }));
    expect(await repository.claim(new Date('2030-01-16T04:00:00Z'), 2, 300)).toBeNull();
  });

  it('pins the selected introduction and freezes it only after INVITE while preserving enablement guards', async () => {
    const original = await enableDayBefore();
    await pool.query(`UPDATE academy_demo_lessons SET scheduled_at='2030-01-16 06:00:00' WHERE id=1`);
    const previousDay = new Date('2030-01-15T06:00:00Z');
    await repository.synchronize(previousDay, await repository.settings());
    const job = (await repository.claim(previousDay, 2, 300))!;
    await repository.prepare(job, previousDay);
    const replacement = { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav` };
    await repository.saveLibraryAudio({ part: 'dayBeforeIntro' }, replacement, 1, original.id);
    expect(await repository.canContinue(job, '+998901234567', previousDay)).toBe(false);
    expect(await repository.canContinue(job, '+998901234567', previousDay, false)).toBe(true);
    expect(await repository.prepare(job, previousDay)).toMatchObject({ audioParts: { intro: replacement } });
    expect(await repository.canContinue(job, '+998901234567', previousDay)).toBe(true);
    await repository.saveSettings({ ...input, enabled: true, dayBeforeEnabled: false }, 1);
    expect(await repository.canContinue(job, '+998901234567', previousDay, false)).toBe(false);
    expect((await pool.query('SELECT count(*)::int AS count FROM voice_reminder_audio WHERE id=$1', [original.id])).rows[0].count).toBe(1);
  });

  it('does not let missing day-before clock parts starve a due same-day job', async () => {
    await enableDayBefore();
    await pool.query(`INSERT INTO academy_demo_lessons(id,scheduled_at,status) VALUES(2,'2030-01-16 06:30:00','scheduled');
      INSERT INTO academy_demo_lesson_participants(id,demo_lesson_id,student_id,status) VALUES(4,2,1,'invited')`);
    const current = new Date('2030-01-15T06:30:00Z');
    await repository.synchronize(current, await repository.settings());
    expect(await repository.claim(current, 2, 300)).toBeNull();
    await pool.query(`UPDATE academy_demo_lessons SET scheduled_at='2030-01-15 07:00:00' WHERE id=1`);
    await repository.synchronize(current, await repository.settings());
    const playable = (await repository.claim(current, 2, 300))!;
    expect(playable.reminderKind).toBe('same_day');
    expect(await repository.prepare(playable, current)).toMatchObject({ audioParts: { clockTime: '12:00' } });
    expect((await pool.query(`SELECT status,attempts FROM voice_reminder_jobs WHERE demo_lesson_id=2 AND reminder_kind='day_before'`)).rows[0])
      .toEqual({ status: 'waiting', attempts: 0 });
  });

  it('serializes tomorrow intro replacement CAS and applies the longest-intro duration bound', async () => {
    const original = await enableDayBefore();
    await repository.saveLibraryAudio({ part: 'intro' }, { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav`, durationSeconds: 160 }, 1);
    await expect(repository.saveLibraryAudio({ part: 'dayBeforeIntro' }, { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav`, durationSeconds: 179 }, 1, original.id))
      .rejects.toMatchObject({ code: 'voiceReminderAudioTooLong' });
    const replacements = await Promise.allSettled(Array.from({ length: 2 }, () => repository.saveLibraryAudio({ part: 'dayBeforeIntro' },
      { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav`, durationSeconds: 170 }, 1, original.id)));
    expect(replacements.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(replacements.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await repository.audioLibrary()).dayBeforeIntro?.durationSeconds).toBe(170);
    await expect(pool.query(`UPDATE voice_reminder_settings SET day_before_start_time='09:59' WHERE id=1`)).rejects.toMatchObject({ code: '23514' });
  });

  const enableConfirmation = async () => {
    for (const part of ['confirmationYes', 'confirmationNo'] as const) {
      await repository.saveLibraryAudio({ part }, { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav` }, 1, null);
    }
    await repository.saveSettings({ ...input, enabled: true, confirmationEnabled: true }, 1);
  };
  const armedResponse = async (at = now) => {
    await repository.synchronize(at, await repository.settings());
    const job = (await repository.claim(at, 2, 300))!;
    const prepared = await repository.prepare(job, at);
    expect(prepared).toMatchObject({ confirmation: { promptDurationSeconds: 1 } });
    const callId = randomUUID();
    await pool.query(`INSERT INTO voice_reminder_call_attempts(call_id,job_id,extension,phone,started_at)
      VALUES($1,$2,'100','+998901234567',$3)`, [callId,job.id,at]);
    await pool.query('UPDATE voice_reminder_jobs SET provider_call_id=$2 WHERE id=$1', [job.id,callId]);
    return { job, callId };
  };
  const currentResponse = async (participantId = 1) => (await pool.query('SELECT * FROM voice_reminder_participant_response($1)', [participantId])).rows;
  const reminderProgress = async (at = now) => (await pool.query(`SELECT reminder_progress.progress_status
    FROM academy_demo_lesson_participants participant
    JOIN academy_demo_lessons demo ON demo.id=participant.demo_lesson_id
    ${demoReminderProgressJoinSql('$1::timestamptz')}
    WHERE participant.id=1`, [at])).rows[0].progress_status;
  const progressJob = async (options: { status?: string; kind?: 'same_day' | 'day_before'; attempted?: boolean } = {}) => {
    const status = options.status ?? 'waiting';
    const callId = randomUUID();
    const jobId = (await pool.query(`INSERT INTO voice_reminder_jobs
      (demo_lesson_id,participant_id,scheduled_at,due_at,lesson_revision,participant_revision,
       reminder_kind,language,language_revision,status,phone,attempts,last_call_at,lease_token,lease_until,
       delivery_lesson_revision,delivery_participant_revision)
      SELECT demo.id,participant.id,demo.scheduled_at AT TIME ZONE 'UTC',
        (demo.scheduled_at AT TIME ZONE 'UTC')-CASE WHEN $2::text='day_before' THEN interval '1 day' ELSE interval '2 hours' END,
        demo.voice_reminder_revision,participant.voice_reminder_revision,$2::text,
        voice_reminder_contact_language(participant.student_id),voice_reminder_contact_language_revision(participant.student_id),
        $1::text,CASE WHEN $3::boolean THEN voice_reminder_contact_phone(participant.student_id) END,CASE WHEN $3::boolean THEN 1 ELSE 0 END,
        CASE WHEN $3::boolean THEN $4::timestamptz END,CASE WHEN $1::text='calling' THEN $5::uuid END,
        CASE WHEN $1::text='calling' THEN $4::timestamptz+interval '5 minutes' END,
        CASE WHEN $3::boolean THEN demo.voice_response_revision END,CASE WHEN $3::boolean THEN participant.voice_response_revision END
      FROM academy_demo_lesson_participants participant JOIN academy_demo_lessons demo ON demo.id=participant.demo_lesson_id
      WHERE participant.id=1 RETURNING id`, [status,options.kind ?? 'same_day',Boolean(options.attempted),now,callId])).rows[0].id;
    if (options.attempted) await pool.query(`INSERT INTO voice_reminder_call_attempts
      (call_id,job_id,extension,phone,started_at,completed_at,termination_confirmed_at)
      VALUES($1,$2,'100','+998901234567',$3,CASE WHEN $4 THEN NULL ELSE $3::timestamptz END,
        CASE WHEN $4 THEN NULL ELSE $3::timestamptz END)`, [callId,jobId,now,status==='calling']);
    return { jobId,callId };
  };

  it('projects queued work and claimed preparation separately from a live call, then a pending retry', async () => {
    const { jobId } = await progressJob();
    expect(await reminderProgress()).toBe('waiting');
    await pool.query(`UPDATE voice_reminder_jobs SET status='calling',lease_token=$2,
      lease_until=$3::timestamptz+interval '5 minutes' WHERE id=$1`, [jobId,randomUUID(),now]);
    expect(await reminderProgress()).toBe('waiting');
    await pool.query(`UPDATE voice_reminder_jobs SET phone='+998901234567',delivery_lesson_revision=0,
      delivery_participant_revision=0 WHERE id=$1`, [jobId]);
    const callId = randomUUID();
    await pool.query(`INSERT INTO voice_reminder_call_attempts(call_id,job_id,extension,phone,started_at)
      VALUES($1,$2,'100','+998901234567',$3)`, [callId,jobId,now]);
    expect(await reminderProgress()).toBe('calling');
    await pool.query('UPDATE voice_reminder_call_attempts SET completed_at=$2,termination_confirmed_at=$2 WHERE call_id=$1', [callId,now]);
    await pool.query(`UPDATE voice_reminder_jobs SET status='waiting',lease_token=NULL,lease_until=NULL,
      attempts=1,last_call_at=$2,not_before_at=$2::timestamptz+interval '10 minutes' WHERE id=$1`, [jobId,now]);
    expect(await reminderProgress()).toBe('retry');
  });

  it.each(['unanswered','failed','played'])('keeps the real %s report ahead of a future unattempted reminder and after attendance changes', async (status) => {
    await enableDayBefore();
    await pool.query("UPDATE academy_demo_lessons SET scheduled_at='2030-01-16 06:00:00' WHERE id=1");
    await progressJob({ status,kind:'day_before',attempted:true });
    await progressJob();
    expect(await reminderProgress()).toBe(status);
    await pool.query("UPDATE academy_demo_lesson_participants SET status='no_show' WHERE id=1");
    expect(await reminderProgress()).toBe(status);
    await pool.query('UPDATE voice_reminder_settings SET enabled=false WHERE id=1');
    expect(await reminderProgress()).toBe(status);
  });

  it('shows a current pre-call failure while never claiming an unattempted played job was delivered', async () => {
    const { jobId } = await progressJob({ status:'failed' });
    expect(await reminderProgress()).toBe('failed');
    await pool.query("UPDATE voice_reminder_jobs SET status='played' WHERE id=$1", [jobId]);
    expect(await reminderProgress()).toBe('not_started');
  });

  it('orders actual outcomes by the latest call rather than preferring an older failure', async () => {
    await enableDayBefore();
    await pool.query("UPDATE academy_demo_lessons SET scheduled_at='2030-01-16 06:00:00' WHERE id=1");
    const failed = await progressJob({ status:'failed',kind:'day_before',attempted:true });
    const unanswered = await progressJob({ status:'unanswered',attempted:true });
    await pool.query("UPDATE voice_reminder_call_attempts SET started_at=$2::timestamptz-interval '1 minute' WHERE call_id=$1", [failed.callId,now]);
    expect(await reminderProgress()).toBe('unanswered');
    await pool.query("UPDATE voice_reminder_call_attempts SET started_at=$2::timestamptz-interval '2 minutes' WHERE call_id=$1", [unanswered.callId,now]);
    expect(await reminderProgress()).toBe('failed');
  });

  it('does not keep calling after an expired lease and does not promise a retry after its deadline', async () => {
    await progressJob({ status:'calling',attempted:true });
    expect(await reminderProgress(new Date(now.getTime()+301_000))).toBe('failed');
    await pool.query(`UPDATE voice_reminder_jobs SET status='waiting',lease_token=NULL,lease_until=NULL,
      not_before_at=scheduled_at+interval '1 minute'`);
    expect(await reminderProgress()).toBe('unanswered');
  });

  it.each(['phone','schedule','cancel','reinvite'])('hides an obsolete attempted report after %s changes', async (change) => {
    await progressJob({ status:'unanswered',attempted:true });
    if (change==='phone') await pool.query("UPDATE academy_leads SET phone='+998901111111' WHERE id=1");
    if (change==='schedule') await pool.query("UPDATE academy_demo_lessons SET scheduled_at=scheduled_at+interval '1 hour' WHERE id=1");
    if (change==='cancel') await pool.query("UPDATE academy_demo_lesson_participants SET status='cancelled' WHERE id=1");
    if (change==='reinvite') {
      await pool.query("UPDATE academy_demo_lesson_participants SET status='no_show' WHERE id=1");
      await pool.query("UPDATE academy_demo_lesson_participants SET status='invited' WHERE id=1");
    }
    expect(await reminderProgress()).toBe(change==='cancel' ? 'cancelled' : 'not_started');
  });

  it('keeps a real attempt across a language-only change but rejects queued work in the old language epoch', async () => {
    await enableDayBefore();
    await pool.query("UPDATE academy_demo_lessons SET scheduled_at='2030-01-16 06:00:00' WHERE id=1");
    const attempted = await progressJob({ status:'unanswered',kind:'day_before',attempted:true });
    await progressJob();
    await pool.query("UPDATE academy_leads SET languages=ARRAY['uz'] WHERE id=1");
    expect(await reminderProgress()).toBe('unanswered');
    await pool.query('DELETE FROM voice_reminder_jobs WHERE id=$1', [attempted.jobId]);
    expect(await reminderProgress()).toBe('not_started');
  });

  it('uses truthful fallbacks and suppresses archived contacts rather than treating them as missing phones', async () => {
    expect(await reminderProgress()).toBe('not_started');
    await pool.query('UPDATE voice_reminder_settings SET enabled=false WHERE id=1');
    expect(await reminderProgress()).toBe('disabled');
    await pool.query('UPDATE academy_leads SET phone=NULL WHERE id=1');
    expect(await reminderProgress()).toBe('no_phone');
    await pool.query('UPDATE academy_leads SET is_archived=true WHERE id=1');
    expect(await reminderProgress()).toBeNull();
  });

  it.each(['disabled','day_before_disabled','past_demo','past_window','obsolete'])('does not present %s queue rows as pending calls', async (state) => {
    await enableDayBefore();
    await pool.query("UPDATE academy_demo_lessons SET scheduled_at='2030-01-16 06:00:00' WHERE id=1");
    const { jobId } = await progressJob({ kind:'day_before' });
    let at = now;
    if (state==='disabled') await pool.query('UPDATE voice_reminder_settings SET enabled=false WHERE id=1');
    if (state==='day_before_disabled') await pool.query('UPDATE voice_reminder_settings SET day_before_enabled=false WHERE id=1');
    if (state==='past_demo') at = new Date('2030-01-16T07:00:00Z');
    if (state==='past_window') at = new Date('2030-01-15T15:00:00Z');
    if (state==='obsolete') await pool.query('UPDATE voice_reminder_jobs SET participant_revision=participant_revision+1 WHERE id=$1', [jobId]);
    expect(await reminderProgress(at)).toBe(state==='disabled' ? 'disabled' : 'not_started');
  });

  it('does not promise a reminder when the demo begins before allowed calling hours', async () => {
    await pool.query("UPDATE academy_demo_lessons SET scheduled_at='2030-01-15 03:30:00' WHERE id=1");
    await progressJob();
    expect(await reminderProgress(new Date('2030-01-15T00:00:00Z'))).toBe('not_started');
  });

  const addUzLibrary = async (confirmation = false) => {
    for (const target of [{ part: 'intro' }, { part: 'outro' }, { part: 'hour', hour: '11' },
      { part: 'minute', minute: '00' }, ...(confirmation ? [{ part: 'confirmationYes' }, { part: 'confirmationNo' }] as const : [])] as const) {
      await repository.saveLibraryAudio({ ...target, language: 'uz' },
        { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav`, sha256: 'b'.repeat(64) }, 1, null);
    }
    return repository.audioLibrary('uz');
  };
  const onlyFirstParticipant = async () => pool.query(`UPDATE academy_demo_lesson_participants SET status='cancelled' WHERE id IN (2,3)`);

  const deliveryRows = async () => (await pool.query('SELECT * FROM voice_reminder_participant_delivery(1)')).rows;
  const prepareDeliveredQuestion = async (options: { language?: 'ru' | 'uz'; maxAttempts?: number; termination?: boolean } = {}) => {
    await onlyFirstParticipant();
    await enableConfirmation();
    if (options.language==='uz') {
      await addUzLibrary(true);
      await pool.query("UPDATE academy_leads SET languages=ARRAY['uz'] WHERE id=1");
    }
    if (options.maxAttempts) await repository.saveSettings({ ...input, enabled: true, confirmationEnabled: true, maxAttempts: options.maxAttempts },1);
    const { job,callId } = await armedResponse();
    await pool.query(`UPDATE voice_reminder_call_attempts SET completed_at=$2::timestamptz,termination_confirmed_at=CASE WHEN $3::boolean THEN $2::timestamptz ELSE NULL END WHERE call_id=$1`, [callId,now,options.termination!==false]);
    await repository.finish(job,{ outcome:'delivered_no_response',callStarted:true,callId,terminationConfirmed:options.termination!==false },now,new Date(now.getTime()+600_000));
    return { job,callId };
  };
  const retryClip = async (language: 'ru' | 'uz'='ru',durationSeconds=1) => {
    const clip = { ...audio,id:randomUUID(),storageKey:`${randomUUID()}.wav`,durationSeconds };
    await repository.saveLibraryAudio({ part:'responseRetry',language },clip,1,null);
    return clip;
  };
  const retryTime = new Date(now.getTime()+600_000);

  it('schedules one standalone no-response follow-up independently of the ordinary attempt limit and makes duplicate finish idempotent',async () => {
    const clip = await retryClip();
    const { job,callId } = await prepareDeliveredQuestion({ maxAttempts:1 });
    await Promise.all(Array.from({ length:8 },() => repository.finish(job,{ outcome:'delivered_no_response',callStarted:true,callId,terminationConfirmed:true },now,retryTime)));
    expect((await pool.query('SELECT status,attempts,no_response_count,retry_phase FROM voice_reminder_jobs WHERE id=$1',[job.id])).rows[0])
      .toEqual({ status:'waiting',attempts:1,no_response_count:1,retry_phase:'response_retry' });
    expect(await deliveryRows()).toEqual([]);
    expect(await repository.claim(new Date(retryTime.getTime()-1),2,300)).toBeNull();
    const retry = (await repository.claim(retryTime,2,300))!;
    expect(retry).toMatchObject({ id:job.id,attempts:1,noResponseCount:1,retryPhase:'response_retry' });
    expect(await repository.prepare(retry,retryTime)).toMatchObject({ audioParts:{ kind:'standalone',audio:clip },confirmation:{ promptDurationSeconds:1 } });
    await repository.finish(retry,{ outcome:'delivered_no_response',callStarted:true,callId:randomUUID(),terminationConfirmed:true },retryTime,new Date(retryTime.getTime()+600_000));
    expect((await pool.query('SELECT status,attempts,no_response_count,last_retry_outcome FROM voice_reminder_jobs WHERE id=$1',[job.id])).rows[0])
      .toEqual({ status:'delivered_no_response',attempts:2,no_response_count:2,last_retry_outcome:'delivered_no_response' });
    expect(await deliveryRows()).toEqual([{ delivery_status:'delivered_no_response',delivered_at:now }]);
    await repository.synchronize(retryTime,await repository.settings());
    expect(await repository.claim(new Date(retryTime.getTime()+600_000),2,300)).toBeNull();
  });

  it.each(['unanswered','failed'] as const)('preserves delivered fact when the only follow-up is %s',async outcome => {
    await retryClip(); const { job } = await prepareDeliveredQuestion();
    const retry = (await repository.claim(retryTime,2,300))!;
    await repository.prepare(retry,retryTime);
    await repository.finish(retry,{ outcome,callStarted:true,callId:randomUUID() },retryTime,new Date(retryTime.getTime()+600_000));
    expect((await pool.query('SELECT status,no_response_count,last_retry_outcome FROM voice_reminder_jobs WHERE id=$1',[job.id])).rows[0])
      .toEqual({ status:'delivered_no_response',no_response_count:1,last_retry_outcome:outcome });
    expect(await deliveryRows()).toHaveLength(1);
    expect(await repository.claim(new Date(retryTime.getTime()+600_000),2,300)).toBeNull();
  });

  it('does not redial an unresolved delivered call or an ambiguous crashed follow-up',async () => {
    await retryClip(); const { job } = await prepareDeliveredQuestion({ termination:false });
    expect((await pool.query('SELECT status,no_response_count FROM voice_reminder_jobs WHERE id=$1',[job.id])).rows[0])
      .toEqual({ status:'delivered_no_response',no_response_count:1 });
    expect(await repository.claim(retryTime,2,300)).toBeNull();
    await pool.query(`UPDATE voice_reminder_jobs SET status='waiting',retry_phase='response_retry',due_at=$2 WHERE id=$1`,[job.id,retryTime]);
    expect(await repository.claim(retryTime,2,300)).toBeNull();
    await pool.query('UPDATE voice_reminder_call_attempts SET termination_confirmed_at=$1',[retryTime]);
    const retry = (await repository.claim(retryTime,2,300))!;
    await repository.prepare(retry,retryTime);
    await pool.query(`INSERT INTO voice_reminder_call_attempts(call_id,job_id,extension,phone,started_at) VALUES($1,$2,'100','+998901234567',$3)`,[randomUUID(),job.id,retryTime]);
    const recoveredAt = new Date(retryTime.getTime()+301_000);
    await repository.synchronize(recoveredAt,await repository.settings());
    expect((await pool.query('SELECT status,last_retry_outcome FROM voice_reminder_jobs WHERE id=$1',[job.id])).rows[0])
      .toEqual({ status:'delivered_no_response',last_retry_outcome:'failed' });
    expect(await repository.claim(recoveredAt,2,300)).toBeNull();
  });

  it('waits only for the matching language follow-up clip and freezes it after INVITE',async () => {
    await retryClip('ru'); const { job } = await prepareDeliveredQuestion({ language:'uz' });
    expect(await repository.claim(retryTime,2,300)).toBeNull();
    const clip = await retryClip('uz');
    const retry = (await repository.claim(retryTime,2,300))!;
    expect(await repository.prepare(retry,retryTime)).toMatchObject({ language:'uz',audioParts:{ kind:'standalone',audio:clip } });
    const replacement = { ...audio,id:randomUUID(),storageKey:`${randomUUID()}.wav` };
    await repository.saveLibraryAudio({ part:'responseRetry',language:'uz' },replacement,1,clip.id);
    expect(await repository.canContinue(retry,'+998901234567',retryTime)).toBe(false);
    expect(await repository.canContinue(retry,'+998901234567',retryTime,false)).toBe(true);
    await repository.prepare(retry,retryTime);
    expect(await repository.canContinue(retry,'+998901234567',retryTime)).toBe(true);
    await pool.query("DELETE FROM voice_reminder_localized_audio WHERE part IN ('hour','minute','intro')");
    expect(await repository.canContinue(retry,'+998901234567',retryTime)).toBe(true);
    expect((await pool.query('SELECT id FROM voice_reminder_audio WHERE id=$1',[clip.id])).rowCount).toBe(1);
    expect(job.id).toBe(retry.id);
  });

  it('cancels a queued follow-up after a destination change without retargeting its immutable delivered phone',async () => {
    await retryClip(); const { job } = await prepareDeliveredQuestion();
    await pool.query("UPDATE academy_leads SET phone='+998909999999' WHERE id=1");
    // Cover a contact edit between the worker synchronization and claim.
    const retry = (await repository.claim(retryTime,2,300))!;
    expect(retry).not.toBeNull();
    expect(await repository.prepare(retry,retryTime)).toBeNull();
    expect(await repository.canContinue(retry,'+998909999999',retryTime,false)).toBe(false);
    await repository.finish(retry,{ outcome:'cancelled',callStarted:false,callId:null },retryTime,null);
    expect((await pool.query('SELECT status,phone,attempts,no_response_count FROM voice_reminder_jobs WHERE id=$1',[job.id])).rows[0])
      .toEqual({ status:'cancelled',phone:'+998901234567',attempts:1,no_response_count:1 });
    expect(await deliveryRows()).toEqual([]);
    await repository.synchronize(retryTime,await repository.settings());
    expect(await repository.claim(retryTime,2,300)).toBeNull();
    expect((await pool.query('SELECT count(*)::int AS count FROM voice_reminder_jobs')).rows[0].count).toBe(1);
  });

  it('keeps an already prepared follow-up bound to its original phone and cancels pending changed destinations during synchronization',async () => {
    await retryClip(); const { job } = await prepareDeliveredQuestion();
    const retry = (await repository.claim(retryTime,2,300))!;
    await repository.prepare(retry,retryTime);
    await pool.query("UPDATE academy_leads SET phone='+998909999999' WHERE id=1");
    expect(await repository.canContinue(retry,'+998901234567',retryTime,false)).toBe(false);
    expect(await repository.prepare(retry,retryTime)).toBeNull();
    await repository.defer(retry,retryTime);
    await repository.synchronize(retryTime,await repository.settings());
    expect((await pool.query('SELECT status,phone,attempts FROM voice_reminder_jobs WHERE id=$1',[job.id])).rows[0])
      .toEqual({ status:'cancelled',phone:'+998901234567',attempts:1 });
    expect(await repository.claim(new Date(retryTime.getTime()+30_000),2,300)).toBeNull();
  });

  it('keeps first delivery across language oscillation and never starts a new locale epoch',async () => {
    await retryClip(); const { job } = await prepareDeliveredQuestion();
    await pool.query("UPDATE academy_leads SET languages=ARRAY['uz'] WHERE id=1");
    await pool.query("UPDATE academy_leads SET languages=ARRAY['ru'] WHERE id=1");
    await repository.synchronize(retryTime,await repository.settings());
    expect((await pool.query('SELECT id,status,no_response_count FROM voice_reminder_jobs')).rows)
      .toEqual([{ id:String(job.id),status:'delivered_no_response',no_response_count:1 }]);
    expect(await deliveryRows()).toHaveLength(1);
    expect(await repository.claim(retryTime,2,300)).toBeNull();
  });

  it('preserves delivery at a retry deadline, but hides it after schedule or contact identity changes',async () => {
    const { job } = await prepareDeliveredQuestion();
    await repository.synchronize(scheduledAt,await repository.settings());
    expect((await pool.query('SELECT status FROM voice_reminder_jobs WHERE id=$1',[job.id])).rows[0].status).toBe('delivered_no_response');
    expect(await deliveryRows()).toHaveLength(1);
    await pool.query("UPDATE academy_demo_lesson_participants SET status='attended' WHERE id=1; UPDATE academy_demo_lessons SET status='completed' WHERE id=1");
    expect(await deliveryRows()).toHaveLength(1);
    await pool.query("UPDATE academy_leads SET phone='+998909999999' WHERE id=1");
    expect(await deliveryRows()).toEqual([]);
    await pool.query("UPDATE academy_leads SET phone='+998901234567' WHERE id=1; UPDATE academy_demo_lessons SET scheduled_at='2030-01-15 07:00:00' WHERE id=1");
    expect(await deliveryRows()).toEqual([]);
  });

  it('finalizes missing-clip follow-up at the same-day 20:00 boundary before a later demo',async () => {
    await onlyFirstParticipant(); await enableConfirmation();
    await pool.query("UPDATE academy_demo_lessons SET scheduled_at='2030-01-15 16:00:00' WHERE id=1");
    await repository.saveLibraryAudio({ part:'time',time:'21:00' },{ ...audio,id:randomUUID(),storageKey:`${randomUUID()}.wav` },1);
    const at = new Date('2030-01-15T14:40:00Z');
    const { job,callId } = await armedResponse(at);
    await pool.query('UPDATE voice_reminder_call_attempts SET completed_at=$2::timestamptz,termination_confirmed_at=$2::timestamptz WHERE call_id=$1',[callId,at]);
    await repository.finish(job,{ outcome:'delivered_no_response',callStarted:true,callId,terminationConfirmed:true },at,new Date('2030-01-15T14:50:00Z'));
    await repository.synchronize(new Date('2030-01-15T14:59:59Z'),await repository.settings());
    expect(await deliveryRows()).toEqual([]);
    await repository.synchronize(new Date('2030-01-15T15:00:00Z'),await repository.settings());
    expect(await deliveryRows()).toEqual([{ delivery_status:'delivered_no_response',delivered_at:at }]);
    expect(await repository.claim(new Date('2030-01-15T15:00:00Z'),2,300)).toBeNull();
  });

  it('lets a committed valid response beat a concurrent no-response finish and rejects the old attempt after follow-up claim',async () => {
    await onlyFirstParticipant(); await enableConfirmation(); await retryClip();
    const { job,callId } = await armedResponse();
    expect(await repository.recordResponse(job,'+998901234567','yes',now,callId)).toBe(true);
    await repository.finish(job,{ outcome:'delivered_no_response',callStarted:true,callId,terminationConfirmed:true },now,retryTime);
    expect((await pool.query('SELECT status,no_response_count,response FROM voice_reminder_jobs WHERE id=$1',[job.id])).rows[0])
      .toEqual({ status:'played',no_response_count:0,response:'yes' });
    expect(await repository.claim(retryTime,2,300)).toBeNull();
    expect(await deliveryRows()).toEqual([]);
  });

  it('reuses the same response provenance for a valid follow-up and suppresses an older native callback',async () => {
    await retryClip(); const { job,callId:oldCall } = await prepareDeliveredQuestion();
    const retry = (await repository.claim(retryTime,2,300))!; await repository.prepare(retry,retryTime);
    const native = randomUUID();
    await pool.query(`INSERT INTO voice_reminder_call_attempts(call_id,job_id,extension,phone,started_at) VALUES($1,$2,'100','+998901234567',$3)`,[native,job.id,retryTime]);
    await pool.query('UPDATE voice_reminder_jobs SET provider_call_id=$2 WHERE id=$1',[job.id,native]);
    expect(await repository.canContinue(retry,'+998901234567',retryTime,false)).toBe(true);
    expect(await repository.recordResponse(job,'+998901234567','no',retryTime,oldCall)).toBe(false);
    expect(await repository.recordResponse(retry,'+998901234567','yes',retryTime,oldCall)).toBe(false);
    expect(await repository.recordResponse(retry,'+998901234567','no',retryTime,native)).toBe(true);
    // Its own saved response must allow the acknowledgement to play. A fresh
    // response from a different reminder still stops an unanswered follow-up.
    expect(await repository.canContinue(retry,'+998901234567',retryTime,false)).toBe(true);
    await repository.finish(retry,{ outcome:'played',callStarted:true,callId:native,response:'no' },retryTime,null);
    expect(await currentResponse()).toMatchObject([{ response:'no',response_at:retryTime }]);
    expect(await deliveryRows()).toEqual([]);
    expect((await pool.query('SELECT status FROM academy_demo_lesson_participants WHERE id=1')).rows[0].status).toBe('invited');
  });

  it.each(['queued','calling'] as const)('suppresses a %s follow-up after a fresh valid response while ignoring a pre-delivery answer',async stage => {
    await retryClip(); const { job } = await prepareDeliveredQuestion();
    await pool.query(`INSERT INTO voice_reminder_jobs(demo_lesson_id,participant_id,scheduled_at,due_at,status,reminder_kind,phone,
      response,response_at,response_call_id,response_lesson_revision,response_participant_revision)
      SELECT demo_lesson_id,participant_id,scheduled_at,due_at,'played','day_before',phone,'yes',$2,$3,
        delivery_lesson_revision,delivery_participant_revision FROM voice_reminder_jobs WHERE id=$1`,[job.id,new Date(now.getTime()-1),randomUUID()]);
    const oldAnswer = (await pool.query("SELECT id FROM voice_reminder_jobs WHERE reminder_kind='day_before'")).rows[0].id;
    expect((await pool.query('SELECT voice_reminder_job_fresh_response($1) AS fresh',[job.id])).rows[0].fresh).toBe(false);
    const active = stage==='calling' ? await repository.claim(retryTime,2,300) : null;
    if (stage==='calling') {
      expect(active).not.toBeNull();
      await repository.prepare(active!,retryTime);
      expect(await repository.canContinue(active!,'+998901234567',retryTime,false)).toBe(true);
    }
    await pool.query('UPDATE voice_reminder_jobs SET response_at=$2 WHERE id=$1',[oldAnswer,retryTime]);
    if (active) {
      expect(await repository.canContinue(active,'+998901234567',retryTime,false)).toBe(false);
      await repository.finish(active,{ outcome:'cancelled',callStarted:false,callId:null },retryTime,null);
    } else expect(await repository.claim(retryTime,2,300)).toBeNull();
    await repository.synchronize(retryTime,await repository.settings());
    expect((await pool.query('SELECT status FROM voice_reminder_jobs WHERE id=$1',[job.id])).rows[0].status).toBe('played');
    expect(await deliveryRows()).toEqual([]);
  });

  it.each(['ru','uz'] as const)('serializes %s follow-up CAS and bounds standalone plus wait and acknowledgement to 180 seconds',async language => {
    if (language==='uz') await addUzLibrary(true); else await enableConfirmation();
    const clip = await retryClip(language,164);
    const replacements = await Promise.allSettled(Array.from({ length:2 },() => repository.saveLibraryAudio({ part:'responseRetry',language },
      { ...audio,id:randomUUID(),storageKey:`${randomUUID()}.wav`,durationSeconds:163 },1,clip.id)));
    expect(replacements.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    await expect(repository.saveLibraryAudio({ part:'responseRetry',language },{ ...audio,id:randomUUID(),storageKey:`${randomUUID()}.wav`,durationSeconds:165 },1,(await repository.audioLibrary(language)).responseRetry!.id))
      .rejects.toMatchObject({ code:'voiceReminderAudioTooLong' });
    const long = { ...audio,id:randomUUID(),storageKey:`${randomUUID()}.wav`,durationSeconds:170 };
    await repository.saveAudio(long,1);
    const direct = language==='ru'
      ? pool.query('UPDATE voice_reminder_settings SET response_retry_audio_id=$1 WHERE id=1',[long.id])
      : pool.query("UPDATE voice_reminder_localized_audio SET audio_id=$1 WHERE language='uz' AND part='responseRetry'",[long.id]);
    await expect(direct).rejects.toMatchObject({ code:'23514' });
  });

  it.each([
    [null, 'uz', 'uz'], [[], 'uz', 'ru'], [null, 'en', 'ru'], [null, null, 'ru'],
    [['xx', 'uz'], 'ru', 'uz'], [['en', 'uz'], 'uz', 'ru'], [['ru', 'uz'], 'uz', 'ru'],
    [['uz', 'uz', 'ru'], 'ru', 'uz'], [['xx', 'en', 'uz'], 'uz', 'ru'],
  ] as const)('matches CRM selected-language semantics for %j and legacy %s', async (languages, legacy, expected) => {
    const selected = languages === null ? null : [...languages];
    expect(resolveVoiceReminderLanguage(selected, legacy)).toBe(expected);
    expect((await pool.query('SELECT resolve_voice_reminder_language($1::text[],$2::text) AS language', [selected,legacy])).rows[0].language).toBe(expected);
    await pool.query('UPDATE academy_leads SET languages=$1,language=$2 WHERE id=1', [selected,legacy]);
    expect((await pool.query('SELECT voice_reminder_contact_language(1) AS language')).rows[0].language).toBe(expected);
    await pool.query('UPDATE academy_students SET lead_id=NULL WHERE id=1');
    expect((await pool.query('SELECT voice_reminder_contact_language(1) AS language')).rows[0].language).toBe('ru');
  });

  it('replans RU to UZ to RU before dialing without reviving an old epoch or lease', async () => {
    await onlyFirstParticipant(); await addUzLibrary();
    await repository.synchronize(now, await repository.settings());
    const ru = (await repository.claim(now, 2, 300))!;
    await repository.prepare(ru, now);
    await pool.query(`UPDATE academy_leads SET languages=ARRAY['uz'] WHERE id=1`);
    expect(await repository.canContinue(ru, '+998901234567', now, false)).toBe(false);
    expect(await repository.renew(ru, now, 300)).toBe(false);
    await repository.synchronize(now, await repository.settings());
    const uz = (await repository.claim(now, 2, 300))!;
    expect(uz.language).toBe('uz');
    expect(await repository.prepare(uz, now)).toMatchObject({ language: 'uz', audioParts: { intro: (await repository.audioLibrary('uz')).intro } });
    await pool.query(`UPDATE academy_leads SET languages=ARRAY['ru'] WHERE id=1`);
    expect(await repository.canContinue(uz, '+998901234567', now, false)).toBe(false);
    await repository.synchronize(now, await repository.settings());
    const again = (await repository.claim(now, 2, 300))!;
    expect(again.language).toBe('ru'); expect(again.id).not.toBe(ru.id);
    expect((await pool.query('SELECT language,language_revision,status,attempts FROM voice_reminder_jobs ORDER BY id')).rows)
      .toEqual([{ language: 'ru', language_revision: 0, status: 'cancelled', attempts: 0 },
        { language: 'uz', language_revision: 1, status: 'cancelled', attempts: 0 },
        { language: 'ru', language_revision: 2, status: 'calling', attempts: 0 }]);
  });

  it('leaves missing UZ audio waiting without starving a complete Russian job', async () => {
    await pool.query(`INSERT INTO academy_leads(id,phone,languages) VALUES(2,'+998901112233',ARRAY['uz']);
      UPDATE academy_students SET lead_id=2 WHERE id=1;
      UPDATE academy_demo_lesson_participants SET status='cancelled' WHERE id=3`);
    await repository.synchronize(now, await repository.settings());
    const ru = (await repository.claim(now, 2, 300))!;
    expect(ru.language).toBe('ru');
    expect((await pool.query(`SELECT participant_id,status,attempts FROM voice_reminder_jobs WHERE language='uz'`)).rows)
      .toEqual([{ participant_id: 1, status: 'waiting', attempts: 0 }]);
    expect((await repository.settings()).audioLibraries?.uz.intro).toBeNull();
    const uzLibrary = await addUzLibrary();
    const uz = (await repository.claim(now, 2, 300))!;
    expect(await repository.prepare(uz, now)).toMatchObject({ language: 'uz', audioParts: { kind: 'clock',
      intro: uzLibrary.intro, outro: uzLibrary.outro, hour: uzLibrary.hours[0].audio, minute: uzLibrary.minutes[0].audio } });
  });

  it('rejects a stale live language answer but preserves an already accepted answer and prevents replay', async () => {
    await onlyFirstParticipant(); await enableConfirmation(); await addUzLibrary(true);
    const { job, callId } = await armedResponse();
    await pool.query(`UPDATE academy_leads SET languages=ARRAY['uz'] WHERE id=1`);
    expect(await repository.recordResponse(job, '+998901234567', 'yes', now, callId)).toBe(false);
    expect(await currentResponse()).toEqual([]);
    await repository.synchronize(now, await repository.settings());
    expect((await pool.query('SELECT count(*)::int AS count FROM voice_reminder_jobs')).rows[0].count).toBe(1);
    // Another original reminder accepts a response before a later language edit.
    await pool.query(`DELETE FROM voice_reminder_call_attempts; DELETE FROM voice_reminder_jobs;
      UPDATE academy_leads SET languages=ARRAY['ru'] WHERE id=1`);
    const accepted = await armedResponse();
    expect(await repository.recordResponse(accepted.job, '+998901234567', 'no', now, accepted.callId)).toBe(true);
    await pool.query(`UPDATE academy_leads SET languages=ARRAY['uz'] WHERE id=1`);
    expect(await currentResponse()).toEqual([{ response: 'no', response_at: now }]);
    expect(await repository.canContinue(accepted.job, '+998901234567', now, false)).toBe(false);
    await repository.synchronize(now, await repository.settings());
    expect((await pool.query('SELECT count(*)::int AS count FROM voice_reminder_jobs')).rows[0].count).toBe(1);
  });

  it('blocks a new language epoch after an ambiguous INVITE even with zero counted attempts', async () => {
    await onlyFirstParticipant(); await addUzLibrary();
    await repository.synchronize(now, await repository.settings());
    const job = (await repository.claim(now, 2, 300))!;
    await repository.prepare(job, now);
    const callId = randomUUID();
    await pool.query(`INSERT INTO voice_reminder_call_attempts(call_id,job_id,extension,phone,started_at)
      VALUES($1,$2,'100','+998901234567',$3)`, [callId,job.id,now]);
    await pool.query(`UPDATE academy_leads SET languages=ARRAY['uz'] WHERE id=1`);
    await repository.synchronize(now, await repository.settings());
    expect(await repository.claim(now, 2, 300)).toBeNull();
    expect((await pool.query('SELECT status,attempts,lease_token FROM voice_reminder_jobs')).rows)
      .toEqual([{ status: 'cancelled', attempts: 0, lease_token: null }]);
    await new RobotCallReceipts(pool).complete(callId, false);
    await repository.synchronize(now, await repository.settings());
    expect((await repository.claim(now, 2, 300))?.language).toBe('uz');
  });

  it.each(['played', 'unanswered', 'failed'] as const)('does not reset a terminal %s reminder by changing its language', async status => {
    await onlyFirstParticipant(); await addUzLibrary();
    await repository.synchronize(now, await repository.settings());
    const job = (await repository.claim(now, 2, 300))!;
    await repository.finish(job, { outcome: status, callStarted: true, callId: randomUUID() }, now, null);
    await pool.query(`UPDATE academy_leads SET languages=ARRAY['uz'] WHERE id=1`);
    await repository.synchronize(now, await repository.settings());
    expect((await pool.query('SELECT count(*)::int AS count FROM voice_reminder_jobs')).rows[0].count).toBe(1);
    expect(await repository.claim(now, 2, 300)).toBeNull();
  });

  it('avoids the reservation/job lock inversion during a concurrent native marker and language edit', async () => {
    await onlyFirstParticipant(); await repository.synchronize(now, await repository.settings());
    const job = (await repository.claim(now, 2, 300))!;
    await repository.prepare(job, now);
    const callId = randomUUID(); const reservationId = randomUUID();
    await pool.query(`INSERT INTO telephony_line_reservations(id,extension,owner_type,client_call_id,phone,job_id,lease_until)
      VALUES($1,'100','robot',$2,'+998901234567',$3,$4)`, [reservationId,callId,job.id,scheduledAt]);
    let releaseMarker!: () => void; let reservationLocked!: () => void;
    const paused = new Promise<void>(resolve => { releaseMarker=resolve; });
    const reached = new Promise<void>(resolve => { reservationLocked=resolve; });
    const connection = await pool.connect();
    const query = connection.query.bind(connection);
    connection.query = (async (...args: Parameters<typeof query>) => {
      const result = await query(...args);
      if (typeof args[0] === 'string' && args[0].startsWith('UPDATE telephony_line_reservations SET dial_authorized_at')) {
        reservationLocked(); await paused;
      }
      return result;
    }) as typeof connection.query;
    const receipts = new RobotCallReceipts({ query: pool.query.bind(pool), connect: async () => connection } as Pool);
    const pending = receipts.start({ callId,jobId: job.id,jobLeaseToken: job.leaseToken,extension: '100',
      phone: '+998901234567',reservationId });
    await reached;
    const editing = await pool.connect();
    try {
      await editing.query(`SET lock_timeout='1s'`);
      await editing.query(`UPDATE academy_leads SET languages=ARRAY['uz'] WHERE id=1`);
    } finally { releaseMarker(); editing.release(); }
    expect(await pending).toBe(true);
    expect((await pool.query('SELECT status,lease_token FROM voice_reminder_jobs')).rows[0])
      .toEqual({ status: 'cancelled', lease_token: null });
    expect((await pool.query('SELECT count(*)::int AS count FROM telephony_line_reservations WHERE id=$1', [reservationId])).rows[0].count).toBe(1);
    await repository.synchronize(now, await repository.settings());
    expect((await pool.query('SELECT count(*)::int AS count FROM voice_reminder_jobs')).rows[0].count).toBe(1);
    await pool.query('DELETE FROM telephony_line_reservations WHERE id=$1', [reservationId]);
  });

  it('scopes CAS and longest-composition duration to each complete language without mixing readiness', async () => {
    const ru = await repository.audioLibrary(); const uz = await addUzLibrary();
    await expect(repository.saveLibraryAudio({ part: 'intro',language: 'uz' }, { ...audio,id: randomUUID(),storageKey: `${randomUUID()}.wav` }, 1,ru.intro!.id))
      .rejects.toMatchObject({ code: 'voiceReminderAudioChanged' });
    const replacements = await Promise.allSettled(Array.from({ length: 2 }, () => repository.saveLibraryAudio({ part: 'intro',language: 'uz' },
      { ...audio,id: randomUUID(),storageKey: `${randomUUID()}.wav` }, 1,uz.intro!.id)));
    expect(replacements.filter(result => result.status==='fulfilled')).toHaveLength(1);
    expect((await repository.audioLibrary()).intro?.id).toBe(ru.intro!.id);
    await repository.saveLibraryAudio({ part: 'dayBeforeIntro',language: 'uz' }, { ...audio,id: randomUUID(),storageKey: `${randomUUID()}.wav` }, 1,null);
    await expect(repository.saveSettings({ ...input,enabled: true,dayBeforeEnabled: true }, 1)).resolves.toBeUndefined();
    await pool.query('UPDATE voice_reminder_settings SET intro_audio_id=NULL WHERE id=1');
    expect((await repository.settings()).audioLibrary.intro).toBeNull();
    await expect(repository.saveSettings({ ...input,enabled: true,dayBeforeEnabled: true }, 1)).resolves.toBeUndefined();
    const durations = await Promise.allSettled([
      repository.saveLibraryAudio({ part: 'hour',hour: '12',language: 'uz' }, { ...audio,id: randomUUID(),storageKey: `${randomUUID()}.wav`,durationSeconds: 100 }, 1,null),
      repository.saveLibraryAudio({ part: 'minute',minute: '30',language: 'uz' }, { ...audio,id: randomUUID(),storageKey: `${randomUUID()}.wav`,durationSeconds: 100 }, 1,null),
    ]);
    expect(durations.filter(result => result.status==='fulfilled')).toHaveLength(1);
    expect(durations.filter(result => result.status==='rejected')).toHaveLength(1);
    const publicSettings = await repository.settings();
    expect(JSON.stringify(publicSettings)).not.toContain('storageKey'); expect(JSON.stringify(publicSettings)).not.toContain('sha256');
    // Neither language now supplies both enabled introductions.
    await pool.query('UPDATE voice_reminder_settings SET intro_audio_id=$1 WHERE id=1', [ru.intro!.id]);
    await pool.query(`DELETE FROM voice_reminder_localized_audio WHERE part='intro'`);
    await expect(repository.saveSettings({ ...input,enabled: true,dayBeforeEnabled: true }, 1)).rejects.toMatchObject({ code: 'voiceReminderAudioRequired' });
  });

  it('accepts its native attempt after an actual webhook binds a distinct provider UUID', async () => {
    await enableConfirmation();
    const { job, callId } = await armedResponse();
    const providerId = randomUUID();
    await pool.query('UPDATE voice_reminder_jobs SET provider_call_id=NULL WHERE id=$1', [job.id]);
    expect(await repository.recordResponse(job, '+998901234567', 'yes', now, callId)).toBe(false);
    await pool.query('UPDATE voice_reminder_jobs SET provider_call_id=$2 WHERE id=$1', [job.id,callId]);
    const receipts = new RobotCallReceipts(pool);
    expect(await receipts.observe({ uuid: providerId, caller: '100', callee: '998901234567', direction: 'outbound',
      event: 'call_start', date: Math.floor(now.getTime()/1000) })).toBe(true);
    expect((await pool.query('SELECT provider_call_id FROM voice_reminder_jobs WHERE id=$1', [job.id])).rows[0].provider_call_id).toBe(providerId);
    expect(await repository.recordResponse(job, '+998901234567', 'yes', now, randomUUID())).toBe(false);
    expect(await repository.recordResponse(job, '+998901234567', 'yes', now, providerId)).toBe(false);
    expect(await repository.recordResponse(job, '+998901234567', 'yes', now, callId)).toBe(true);
    expect((await currentResponse())[0].response).toBe('yes');
  });

  it('never invents a response from a completed transport result without a durable digit callback', async () => {
    await enableConfirmation();
    const { job, callId } = await armedResponse();
    await repository.finish(job, { outcome: 'played', callStarted: true, callId, response: 'yes' }, now, null);
    expect(await currentResponse()).toEqual([]);
    expect((await pool.query('SELECT response,response_at FROM voice_reminder_jobs WHERE id=$1', [job.id])).rows[0])
      .toEqual({ response: null, response_at: null });
  });

  it('requires both acknowledgements and serializes main-plus-wait-plus-ack duration under the settings lock', async () => {
    await expect(repository.saveSettings({ ...input, enabled: true, confirmationEnabled: true }, 1))
      .rejects.toMatchObject({ code: 'voiceReminderConfirmationAudioRequired' });
    await repository.saveLibraryAudio({ part: 'confirmationYes' }, { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav` }, 1);
    await expect(repository.saveSettings({ ...input, enabled: false, confirmationEnabled: true }, 1))
      .rejects.toMatchObject({ code: 'voiceReminderConfirmationAudioRequired' });
    await repository.saveLibraryAudio({ part: 'confirmationNo' }, { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav` }, 1);
    await repository.saveSettings({ ...input, enabled: true, confirmationEnabled: true }, 1);
    const concurrent = await Promise.allSettled([
      repository.saveLibraryAudio({ part: 'intro' }, { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav`, durationSeconds: 161 }, 1),
      repository.saveLibraryAudio({ part: 'confirmationYes' }, { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav`, durationSeconds: 5 }, 1),
    ]);
    expect(concurrent.filter(result => result.status==='fulfilled')).toHaveLength(1);
    expect(concurrent.filter(result => result.status==='rejected')).toHaveLength(1);
    const library = await repository.audioLibrary();
    await expect(repository.saveLibraryAudio({ part: 'confirmationYes' }, { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav` }, 1, randomUUID()))
      .rejects.toMatchObject({ code: 'voiceReminderAudioChanged' });
    expect(library.confirmationYes).toBeTruthy(); expect(library.confirmationNo).toBeTruthy();
  });

  it('persists the first real answer immediately, serializes duplicates and never changes attendance', async () => {
    await enableConfirmation();
    const { job, callId } = await armedResponse();
    expect(await repository.recordResponse(job, '+998901234567', 'yes', now, callId)).toBe(true);
    const concurrent = await Promise.all(Array.from({ length: 12 }, (_, index) => repository.recordResponse(job, '+998901234567', index%2 ? 'yes' : 'no', now, callId)));
    expect(concurrent).toEqual(Array.from({ length: 12 }, (_, index) => Boolean(index%2)));
    expect((await pool.query('SELECT status,response,response_call_id FROM voice_reminder_jobs WHERE id=$1', [job.id])).rows[0])
      .toEqual({ status: 'calling', response: 'yes', response_call_id: callId });
    expect(await currentResponse()).toEqual([{ response: 'yes', response_at: now }]);
    expect((await pool.query('SELECT status FROM academy_demo_lesson_participants ORDER BY id')).rows.map(row => row.status)).toEqual(['invited','confirmed','invited']);
    expect((await pool.query('SELECT status FROM academy_demo_lessons')).rows[0].status).toBe('scheduled');
    await repository.finish(job, { outcome: 'failed', callStarted: true, callId }, now, null);
    expect((await currentResponse())[0].response).toBe('yes');
    expect(await repository.recordResponse(job, '+998901234567', 'yes', now, callId)).toBe(false);
  });

  it.each(['attended', 'no_show'])('keeps the expected answer beside %s after lesson completion', async status => {
    await enableConfirmation();
    const { job, callId } = await armedResponse();
    expect(await repository.recordResponse(job, '+998901234567', 'no', now, callId)).toBe(true);
    await pool.query('UPDATE academy_demo_lesson_participants SET status=$1 WHERE id=1', [status]);
    expect((await currentResponse())[0].response).toBe('no');
    await pool.query(`UPDATE academy_demo_lessons SET status='completed' WHERE id=1`);
    expect((await currentResponse())[0].response).toBe('no');
    expect(await repository.recordResponse(job, '+998901234567', 'yes', now, callId)).toBe(false);
  });

  it('does not revive old answers after moving a demo away/back or cancelling/re-inviting a participant', async () => {
    await enableConfirmation();
    const { job, callId } = await armedResponse();
    await repository.recordResponse(job, '+998901234567', 'yes', now, callId);
    await pool.query(`UPDATE academy_demo_lessons SET scheduled_at='2030-01-15 07:00:00' WHERE id=1`);
    expect(await currentResponse()).toEqual([]);
    await pool.query(`UPDATE academy_demo_lessons SET scheduled_at='2030-01-15 06:00:00' WHERE id=1`);
    expect(await currentResponse()).toEqual([]);
    const renewed = await armedResponse();
    await repository.recordResponse(renewed.job, '+998901234567', 'no', now, renewed.callId);
    expect((await currentResponse())[0].response).toBe('no');
    await pool.query(`UPDATE academy_demo_lesson_participants SET status='cancelled' WHERE id=1`);
    expect(await currentResponse()).toEqual([]);
    await pool.query(`UPDATE academy_demo_lesson_participants SET status='confirmed' WHERE id=1`);
    expect(await currentResponse()).toEqual([]);
  });

  it('shows the latest valid answer across the two independent reminder kinds', async () => {
    await enableDayBefore(); await enableConfirmation();
    await repository.saveSettings({ ...input, enabled: true, confirmationEnabled: true, dayBeforeEnabled: true }, 1);
    const previousDay = new Date('2030-01-14T06:00:00Z');
    const first = await armedResponse(previousDay);
    expect(first.job.reminderKind).toBe('day_before');
    await repository.recordResponse(first.job, '+998901234567', 'yes', previousDay, first.callId);
    await repository.finish(first.job, { outcome: 'played', callStarted: true, callId: first.callId }, previousDay, null);
    const second = await armedResponse();
    expect(second.job.reminderKind).toBe('same_day');
    await repository.recordResponse(second.job, '+998901234567', 'no', now, second.callId);
    expect(await currentResponse()).toEqual([{ response: 'no', response_at: now }]);
    expect((await pool.query('SELECT response FROM voice_reminder_jobs WHERE response IS NOT NULL ORDER BY response_at')).rows.map(row => row.response)).toEqual(['yes','no']);
  });

  it('rejects wrong call/token/phone, terminated attempts, archived leads and window rollover', async () => {
    await enableConfirmation();
    const { job, callId } = await armedResponse();
    expect(await repository.recordResponse(job, '+998901234567', 'yes', now, randomUUID())).toBe(false);
    expect(await repository.recordResponse({ ...job, leaseToken: randomUUID() }, '+998901234567', 'yes', now, callId)).toBe(false);
    expect(await repository.recordResponse(job, '+998991111111', 'yes', now, callId)).toBe(false);
    await pool.query(`UPDATE academy_leads SET phone='+998901111111' WHERE id=1`);
    expect(await repository.recordResponse(job, '+998901234567', 'yes', now, callId)).toBe(false);
    await pool.query(`UPDATE academy_leads SET phone='+998901234567',is_archived=true WHERE id=1`);
    expect(await repository.recordResponse(job, '+998901234567', 'yes', now, callId)).toBe(false);
    await pool.query(`UPDATE academy_leads SET is_archived=false WHERE id=1`);
    await pool.query('UPDATE voice_reminder_call_attempts SET termination_confirmed_at=$2 WHERE call_id=$1', [callId,now]);
    expect(await repository.recordResponse(job, '+998901234567', 'yes', now, callId)).toBe(false);
    expect(await repository.recordResponse(job, '+998901234567', 'yes', new Date('2030-01-15T15:00:00Z'), callId)).toBe(false);
    expect((await pool.query('SELECT response FROM voice_reminder_jobs WHERE id=$1', [job.id])).rows[0].response).toBeNull();
  });

  it('invalidates changed confirmation pins before INVITE, freezes active clips and stops on flag changes', async () => {
    await enableConfirmation();
    const { job } = await armedResponse();
    const library = await repository.audioLibrary();
    const oldYes = library.confirmationYes!.id;
    await repository.saveLibraryAudio({ part: 'confirmationYes' }, { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav` }, 1, oldYes);
    expect(await repository.canContinue(job, '+998901234567', now)).toBe(false);
    expect(await repository.canContinue(job, '+998901234567', now, false)).toBe(true);
    await repository.saveSettings({ ...input, enabled: true, confirmationEnabled: false }, 1);
    expect(await repository.canContinue(job, '+998901234567', now, false)).toBe(false);
    expect((await pool.query('SELECT count(*)::int AS count FROM voice_reminder_audio WHERE id=$1', [oldYes])).rows[0].count).toBe(1);
  });

  it('defaults to disabled and stores only public audio metadata in settings', async () => {
    await repository.saveSettings({ ...input, enabled: false }, 1);
    const setting = await repository.settings();
    expect(setting.enabled).toBe(false);
    expect(setting.audio).toMatchObject({ id: audio.id, fileName: 'demo.wav' });
    expect(setting.audio).not.toHaveProperty('storageKey');
    expect(setting.audio).not.toHaveProperty('sha256');
    expect(setting.audioLibrary.times.map(entry => entry.time)).toEqual(['11:00', '12:00']);
    expect(setting.audioLibrary.intro).not.toHaveProperty('storageKey');
    expect(setting.audioLibrary.times[0].audio).not.toHaveProperty('sha256');
  });

  it('selects the exact Tashkent demo clock and pins all immutable audio parts', async () => {
    await repository.synchronize(now, await repository.settings());
    const claim = (await repository.claim(now, 2, 300))!;
    const ready = await repository.prepare(claim, now);
    const library = await repository.audioLibrary();
    expect(ready).toMatchObject({ phone: '+998901234567', audioParts: {
      intro: library.intro, time: library.times[0].audio, outro: library.outro, clockTime: '11:00',
    } });
    const pinned = (await pool.query('SELECT intro_audio_id,time_audio_id,outro_audio_id,audio_clock_time FROM voice_reminder_jobs WHERE id=$1', [claim.id])).rows[0];
    expect(pinned).toEqual({ intro_audio_id: library.intro!.id, time_audio_id: library.times[0].audio.id,
      outro_audio_id: library.outro!.id, audio_clock_time: '11:00' });
  });

  it('prefers separate hour and minute clips including 00 over an exact legacy recording', async () => {
    const hour = { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav` };
    const minute = { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav` };
    await repository.saveLibraryAudio({ part: 'hour', hour: '11' }, hour, 1, null);
    await repository.saveLibraryAudio({ part: 'minute', minute: '00' }, minute, 1, null);
    await repository.synchronize(now, await repository.settings());
    const claim = (await repository.claim(now, 2, 300))!;
    expect(await repository.prepare(claim, now)).toMatchObject({ audioParts: { kind: 'clock', clockTime: '11:00', hour, minute } });
    const pinned = (await pool.query('SELECT audio_mode,time_audio_id,hour_audio_id,minute_audio_id FROM voice_reminder_jobs WHERE id=$1', [claim.id])).rows[0];
    expect(pinned).toEqual({ audio_mode: 'clock', time_audio_id: null, hour_audio_id: hour.id, minute_audio_id: minute.id });
    const settings = await repository.settings();
    expect(settings.audioLibrary.hours).toEqual([{ hour: '11', audio: expect.objectContaining({ id: hour.id }) }]);
    expect(settings.audioLibrary.minutes[0].minute).toBe('00');
    expect(settings.audioLibrary.hours[0].audio).not.toHaveProperty('storageKey');
    expect(settings.audioLibrary.minutes[0].audio).not.toHaveProperty('sha256');
  });

  it('waits for a required 00 minute clip without claiming a line and resumes after it is uploaded', async () => {
    await repository.removeTimeAudio('11:00', 1);
    await repository.saveLibraryAudio({ part: 'hour', hour: '11' }, { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav` }, 1);
    await repository.synchronize(now, await repository.settings());
    expect(await repository.claim(now, 2, 300)).toBeNull();
    expect((await readVoiceReminderJobs(pool)).summary.waiting).toBe(3);
    expect((await pool.query('SELECT attempts FROM voice_reminder_jobs')).rows.every(row => row.attempts === 0)).toBe(true);
    await repository.saveLibraryAudio({ part: 'minute', minute: '00' }, { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav` }, 1);
    const claim = (await repository.claim(now, 2, 300))!;
    expect(await repository.prepare(claim, now)).toMatchObject({ audioParts: { kind: 'clock', clockTime: '11:00', minute: expect.anything() } });
  });

  it('does not starve a later playable split clock when an earlier demo minute has no recording', async () => {
    await pool.query(`UPDATE academy_demo_lessons SET scheduled_at='2030-01-15 06:30:00' WHERE id=1;
      INSERT INTO academy_demo_lessons(id,scheduled_at,status) VALUES(2,'2030-01-15 06:45:00','scheduled');
      INSERT INTO academy_demo_lesson_participants(id,demo_lesson_id,student_id,status) VALUES(4,2,1,'invited');`);
    await repository.saveLibraryAudio({ part: 'hour', hour: '11' }, { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav` }, 1);
    await repository.saveLibraryAudio({ part: 'minute', minute: '45' }, { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav` }, 1);
    const due = new Date('2030-01-15T05:50:00Z');
    await repository.synchronize(due, await repository.settings());
    const claim = (await repository.claim(due, 2, 300))!;
    expect(claim.scheduledAt.toISOString()).toBe('2030-01-15T06:45:00.000Z');
    expect(await repository.prepare(claim, due)).toMatchObject({ audioParts: { kind: 'clock', clockTime: '11:45' } });
    expect((await pool.query("SELECT status,attempts FROM voice_reminder_jobs WHERE demo_lesson_id=1")).rows)
      .toEqual(Array(3).fill({ status: 'waiting', attempts: 0 }));
  });

  it('invalidates before-invite mode switches and replacements while preserving frozen active parts', async () => {
    await repository.synchronize(now, await repository.settings());
    const claim = (await repository.claim(now, 2, 300))!;
    expect(await repository.prepare(claim, now)).toMatchObject({ audioParts: { kind: 'time' } });
    const hour = { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav` };
    const minute = { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav` };
    await repository.saveLibraryAudio({ part: 'hour', hour: '11' }, hour, 1);
    await repository.saveLibraryAudio({ part: 'minute', minute: '00' }, minute, 1);
    expect(await repository.canContinue(claim, '+998901234567', now)).toBe(false);
    expect(await repository.canContinue(claim, '+998901234567', now, false)).toBe(true);
    expect(await repository.prepare(claim, now)).toMatchObject({ audioParts: { kind: 'clock', hour, minute } });
    const replaced = { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav` };
    await repository.saveLibraryAudio({ part: 'minute', minute: '00' }, replaced, 1, minute.id);
    expect(await repository.canContinue(claim, '+998901234567', now)).toBe(false);
    expect(await repository.canContinue(claim, '+998901234567', now, false)).toBe(true);
    await repository.removeLibraryAudio({ part: 'hour', hour: '11' }, 1, hour.id);
    expect(await repository.prepare(claim, now)).toMatchObject({ audioParts: { kind: 'time' } });
    const pinned = (await pool.query('SELECT audio_mode,hour_audio_id,minute_audio_id FROM voice_reminder_jobs WHERE id=$1', [claim.id])).rows[0];
    expect(pinned).toEqual({ audio_mode: 'time', hour_audio_id: null, minute_audio_id: null });
    expect((await pool.query('SELECT id FROM voice_reminder_audio WHERE id=ANY($1::uuid[])', [[hour.id, minute.id]])).rowCount).toBe(2);
  });

  it.each([{ part: 'hour', hour: '11' }, { part: 'minute', minute: '00' }] as const)(
    'enforces create-only and stale confirmation guards for %j under the shared settings lock', async target => {
      const uploaded = () => ({ ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav` });
      const changes = await Promise.allSettled([
        repository.saveLibraryAudio(target, uploaded(), 1, null), repository.saveLibraryAudio(target, uploaded(), 1, null),
      ]);
      expect(changes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(changes.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'voiceReminderAudioChanged' } });
      const library = await repository.audioLibrary();
      const original = target.part === 'hour' ? library.hours[0].audio : library.minutes[0].audio;
      const replacement = uploaded();
      await repository.saveLibraryAudio(target, replacement, 1, original.id);
      await expect(repository.removeLibraryAudio(target, 1, original.id)).rejects.toMatchObject({ code: 'voiceReminderAudioChanged' });
      await expect(repository.saveLibraryAudio(target, uploaded(), 1, original.id)).rejects.toMatchObject({ code: 'voiceReminderAudioChanged' });
      await repository.removeLibraryAudio(target, 1, replacement.id);
      const after = await repository.audioLibrary();
      expect(target.part === 'hour' ? after.hours : after.minutes).toEqual([]);
      expect((await pool.query('SELECT id FROM voice_reminder_audio WHERE id=$1', [original.id])).rowCount).toBe(1);
    },
  );

  it('guards every hour/minute combination against concurrent duration increases', async () => {
    const uploaded = (durationSeconds: number) => ({ ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav`, durationSeconds });
    await repository.saveLibraryAudio({ part: 'hour', hour: '00' }, uploaded(1), 1);
    await repository.saveLibraryAudio({ part: 'minute', minute: '00' }, uploaded(1), 1);
    await repository.saveLibraryAudio({ part: 'hour', hour: '23' }, uploaded(85), 1);
    await repository.saveLibraryAudio({ part: 'minute', minute: '59' }, uploaded(92), 1);
    const changes = await Promise.allSettled([
      repository.saveLibraryAudio({ part: 'hour', hour: '23' }, uploaded(86), 1),
      repository.saveLibraryAudio({ part: 'minute', minute: '59' }, uploaded(93), 1),
    ]);
    expect(changes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(changes.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'voiceReminderAudioTooLong' } });
    const library = await repository.audioLibrary();
    expect(library.intro!.durationSeconds + library.outro!.durationSeconds + library.hours[1].audio.durationSeconds + library.minutes[1].audio.durationSeconds).toBe(180);
    await expect(pool.query(`INSERT INTO voice_reminder_minute_audio(minute,audio_id) VALUES('60',$1)`, [audio.id])).rejects.toMatchObject({ code: '23514' });
    await expect(repository.saveLibraryAudio({ part: 'hour', hour: '24' }, uploaded(1), 1)).rejects.toMatchObject({ code: 'voiceReminderInvalidTime' });
  });

  it('requires both clock groups for enablement while allowing legacy fallback to remain enabled', async () => {
    await repository.removeTimeAudio('11:00', 1);
    await repository.removeTimeAudio('12:00', 1);
    await repository.saveSettings({ ...input, enabled: false }, 1);
    await repository.saveLibraryAudio({ part: 'hour', hour: '11' }, { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav` }, 1);
    await expect(repository.saveSettings({ ...input, enabled: true }, 1)).rejects.toMatchObject({ code: 'voiceReminderAudioRequired' });
    await expect(pool.query('UPDATE voice_reminder_settings SET enabled=true WHERE id=1')).rejects.toMatchObject({ code: '23514' });
    await repository.saveLibraryAudio({ part: 'minute', minute: '00' }, { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav` }, 1);
    await repository.saveSettings({ ...input, enabled: true }, 1);
    expect((await repository.settings()).enabled).toBe(true);
  });

  it('does not claim missing-clock jobs and does not let them starve a later playable demo', async () => {
    await pool.query(`UPDATE academy_demo_lessons SET scheduled_at='2030-01-15 06:30:00' WHERE id=1;
      INSERT INTO academy_demo_lessons(id,scheduled_at,status) VALUES(2,'2030-01-15 06:45:00','scheduled');
      INSERT INTO academy_demo_lesson_participants(id,demo_lesson_id,student_id,status) VALUES(4,2,1,'invited');`);
    await repository.saveLibraryAudio({ part: 'time', time: '11:45' }, { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav` }, 1);
    const due = new Date('2030-01-15T05:50:00Z');
    await repository.synchronize(due, await repository.settings());
    const claim = (await repository.claim(due, 2, 300))!;
    expect(claim.scheduledAt.toISOString()).toBe('2030-01-15T06:45:00.000Z');
    expect(await repository.prepare(claim, due)).toMatchObject({ audioParts: { clockTime: '11:45' } });
    expect((await pool.query("SELECT status,attempts FROM voice_reminder_jobs WHERE demo_lesson_id=1")).rows)
      .toEqual(Array(3).fill({ status: 'waiting', attempts: 0 }));
  });

  it('defers if the exact clock is removed between claim and prepare without using legacy audio', async () => {
    await repository.synchronize(now, await repository.settings());
    const claim = (await repository.claim(now, 2, 300))!;
    await repository.removeTimeAudio('11:00', 1);
    expect(await repository.prepare(claim, now)).toBe('defer');
    await repository.defer(claim, now);
    expect((await pool.query('SELECT status,attempts FROM voice_reminder_jobs WHERE id=$1', [claim.id])).rows[0])
      .toEqual({ status: 'waiting', attempts: 0 });
    expect(await repository.currentAudio()).not.toBeNull();
    expect(await repository.claim(new Date(now.getTime() + 31_000), 2, 300)).toBeNull();
  });

  it('rechecks replacements before invite while allowing already dispatched immutable playback', async () => {
    await repository.synchronize(now, await repository.settings());
    const claim = (await repository.claim(now, 2, 300))!;
    const ready = await repository.prepare(claim, now);
    if (!ready || ready === 'defer' || ready.audioParts.kind !== 'time') throw new Error('Expected prepared whole-clock reminder');
    const oldId = ready.audioParts.time.id;
    await repository.saveLibraryAudio({ part: 'time', time: '11:00' }, { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav` }, 1);
    expect(await repository.canContinue(claim, ready.phone, now)).toBe(false);
    expect(await repository.canContinue(claim, ready.phone, now, false)).toBe(true);
    expect((await pool.query('SELECT id FROM voice_reminder_audio WHERE id=$1', [oldId])).rowCount).toBe(1);
    await pool.query(`UPDATE academy_demo_lessons SET scheduled_at='2030-01-15 07:00:00' WHERE id=1`);
    expect(await repository.canContinue(claim, ready.phone, now, false)).toBe(false);
  });

  it('removes only time relations and keeps an active pinned asset when the library becomes empty', async () => {
    await repository.synchronize(now, await repository.settings());
    const claim = (await repository.claim(now, 2, 300))!;
    const ready = await repository.prepare(claim, now);
    if (!ready || ready === 'defer') throw new Error('Expected prepared reminder');
    const before = (await pool.query('SELECT count(*)::int AS count FROM voice_reminder_audio')).rows[0].count;
    await repository.removeTimeAudio('11:00', 1);
    await repository.removeTimeAudio('12:00', 1);
    expect((await repository.settings()).enabled).toBe(true);
    expect((await repository.audioLibrary()).times).toEqual([]);
    expect(await repository.canContinue(claim, ready.phone, now)).toBe(false);
    expect(await repository.canContinue(claim, ready.phone, now, false)).toBe(true);
    expect(await repository.claim(now, 2, 300)).toBeNull();
    expect((await pool.query('SELECT count(*)::int AS count FROM voice_reminder_audio')).rows[0].count).toBe(before);
    await repository.saveSettings({ ...input, enabled: false }, 1);
    await expect(repository.saveSettings({ ...input, enabled: true }, 1)).rejects.toMatchObject({ code: 'voiceReminderAudioRequired' });
    await expect(pool.query('UPDATE voice_reminder_settings SET enabled=true WHERE id=1')).rejects.toMatchObject({ code: '23514' });
  });

  it('prioritizes usable primary lead phones before the linked student fallback', async () => {
    await pool.query(`INSERT INTO academy_lead_phones(lead_id,phone,is_primary) VALUES
      (1,'invalid 998901111111',true),(1,'+998902222222',true),(1,'+998903333333',false);
      UPDATE academy_students SET phone='+998904444444' WHERE id=1;`);
    await repository.synchronize(now, await repository.settings());
    const claim = (await repository.claim(now, 2, 300))!;
    expect(await repository.prepare(claim, now)).toMatchObject({ phone: '+998902222222' });
    await pool.query(`DELETE FROM academy_lead_phones WHERE lead_id=1; UPDATE academy_leads SET phone='invalid' WHERE id=1;`);
    expect(await repository.prepare(claim, now)).toMatchObject({ phone: '+998904444444' });
  });

  it('serializes concurrent replacements so the assembled duration cannot exceed the limit', async () => {
    await repository.saveLibraryAudio({ part: 'intro' }, { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav`, durationSeconds: 89 }, 1);
    await repository.saveLibraryAudio({ part: 'outro' }, { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav`, durationSeconds: 89 }, 1);
    const changes = await Promise.allSettled([
      repository.saveLibraryAudio({ part: 'intro' }, { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav`, durationSeconds: 90 }, 1),
      repository.saveLibraryAudio({ part: 'outro' }, { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav`, durationSeconds: 90 }, 1),
    ]);
    expect(changes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(changes.filter(result => result.status === 'rejected')).toHaveLength(1);
    const library = await repository.audioLibrary();
    expect(library.intro!.durationSeconds + library.outro!.durationSeconds + library.times[0].audio.durationSeconds).toBe(180);
    await expect(repository.saveLibraryAudio({ part: 'time', time: '24:00' }, { ...audio, id: randomUUID() }, 1)).rejects.toMatchObject({ code: 'voiceReminderInvalidTime' });
  });

  it('admits one create-only upload per clock and refuses stale replacement and deletion confirmations', async () => {
    const uploaded = () => ({ ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav` });
    const created = await Promise.allSettled([
      repository.saveLibraryAudio({ part: 'time', time: '10:15' }, uploaded(), 1, null),
      repository.saveLibraryAudio({ part: 'time', time: '10:15' }, uploaded(), 1, null),
    ]);
    expect(created.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(created.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'voiceReminderAudioChanged' } });
    const library = await repository.audioLibrary();
    const original = library.times.find(entry => entry.time === '10:15')!.audio;
    const replacement = uploaded();
    await repository.saveLibraryAudio({ part: 'time', time: '10:15' }, replacement, 1, original.id);
    await expect(repository.saveLibraryAudio({ part: 'time', time: '10:15' }, uploaded(), 1, original.id)).rejects.toMatchObject({ code: 'voiceReminderAudioChanged' });
    await expect(repository.removeTimeAudio('10:15', 1, original.id)).rejects.toMatchObject({ code: 'voiceReminderAudioChanged' });
    expect((await repository.audioLibrary()).times.find(entry => entry.time === '10:15')!.audio.id).toBe(replacement.id);
    await expect(repository.saveLibraryAudio({ part: 'intro' }, uploaded(), 1, null)).rejects.toMatchObject({ code: 'voiceReminderAudioChanged' });
    await repository.removeTimeAudio('10:15', 1, replacement.id);
    expect((await repository.audioLibrary()).times.some(entry => entry.time === '10:15')).toBe(false);
  });

  it('waits for the demo calendar day in Tashkent even when the lead interval is already due', async () => {
    await repository.saveSettings({ ...input, enabled: true, leadMinutes: 120, allowedStartTime: '00:00', allowedEndTime: '23:59' }, 1);
    await pool.query(`UPDATE academy_demo_lessons SET scheduled_at='2030-01-14 19:30:00' WHERE id=1`);
    await repository.saveLibraryAudio({ part: 'time', time: '00:30' }, { ...audio, id: randomUUID(), storageKey: `${randomUUID()}.wav` }, 1);
    const previousDay = new Date('2030-01-14T18:30:00Z');
    await repository.synchronize(previousDay, await repository.settings());
    expect(await repository.claim(previousDay, 2, 300)).toBeNull();
    expect((await readVoiceReminderJobs(pool)).summary.waiting).toBe(3);
    const demoDay = new Date('2030-01-14T19:05:00Z');
    const claim = (await repository.claim(demoDay, 2, 300))!;
    expect(await repository.prepare(claim, previousDay)).toBe('defer');
    const ready = await repository.prepare(claim, demoDay);
    expect(ready).toMatchObject({ audioParts: { clockTime: '00:30' } });
    expect(await repository.canContinue(claim, '+998901234567', previousDay, false)).toBe(false);
    expect(await repository.canContinue(claim, '+998901234567', demoDay)).toBe(true);
  });

  it('preserves legacy Russian answers, active receipts, leases and test intents on the language upgrade', async () => {
    const upgradeSchema = `voice_language_upgrade_${randomUUID().replace(/-/g, '')}`;
    await admin.query(`CREATE SCHEMA ${upgradeSchema}`);
    const upgrade = new Pool({ connectionString: url,options: `-c search_path=${upgradeSchema}` });
    const callId = randomUUID(); const token = randomUUID(); const testId = randomUUID(); const reservationId = randomUUID();
    try {
      await upgrade.query(`CREATE TABLE users(id integer PRIMARY KEY);
        CREATE TABLE academy_leads(id integer PRIMARY KEY,phone text,is_archived boolean DEFAULT false,language varchar(20),languages text[]);
        CREATE TABLE academy_students(id integer PRIMARY KEY,lead_id integer,phone text);
        CREATE TABLE academy_lead_phones(id integer PRIMARY KEY,lead_id integer,phone text,is_primary boolean);
        CREATE TABLE academy_demo_lessons(id integer PRIMARY KEY,scheduled_at timestamp,status text);
        CREATE TABLE academy_demo_lesson_participants(id integer PRIMARY KEY,demo_lesson_id integer,student_id integer,status text);`);
      for (const name of ['0142_voice_reminders','0143_crm_telephony_capacity','0144_voice_reminder_audio_library',
        '0145_voice_reminder_clock_audio','0146_voice_reminder_test_calls','0147_voice_reminder_day_before','0149_voice_reminder_confirmations'])
        await upgrade.query(readFileSync(`migrations/${name}.sql`,'utf8'));
      await upgrade.query(`INSERT INTO users VALUES(1);
        INSERT INTO academy_leads(id,phone,language,languages) VALUES(1,'+998901234567','uz',NULL);
        INSERT INTO academy_students(id,lead_id) VALUES(1,1);
        INSERT INTO academy_demo_lessons(id,scheduled_at,status) VALUES(1,'2030-01-15 06:00:00','scheduled');
        INSERT INTO academy_demo_lesson_participants(id,demo_lesson_id,student_id,status) VALUES(1,1,1,'confirmed'),(2,1,1,'invited');`);
      await upgrade.query(`INSERT INTO voice_reminder_audio(id,file_name,mime_type,size_bytes,duration_seconds,storage_key,sha256)
        VALUES($1,'legacy.wav','audio/wav',24,1,'legacy.wav',$2)`,[audio.id,audio.sha256]);
      await upgrade.query(`UPDATE voice_reminder_settings SET intro_audio_id=$1,outro_audio_id=$1,
        confirmation_yes_audio_id=$1,confirmation_no_audio_id=$1 WHERE id=1`,[audio.id]);
      await upgrade.query(`INSERT INTO voice_reminder_time_audio(time,audio_id) VALUES('11:00',$1)`,[audio.id]);
      await upgrade.query(`UPDATE voice_reminder_settings SET enabled=true,confirmation_enabled=true WHERE id=1`);
      await upgrade.query(`INSERT INTO voice_reminder_jobs(demo_lesson_id,participant_id,scheduled_at,due_at,status,phone,
        attempts,response,response_at,response_call_id,response_lesson_revision,response_participant_revision)
        VALUES(1,1,$1,$2,'played','+998901234567',1,'yes',$2,$3,0,0)`,[scheduledAt,now,randomUUID()]);
      const activeId = (await upgrade.query(`INSERT INTO voice_reminder_jobs(demo_lesson_id,participant_id,scheduled_at,due_at,status,phone,
        lease_token,lease_until,provider_call_id,intro_audio_id,time_audio_id,outro_audio_id,audio_clock_time,audio_mode)
        VALUES(1,2,$1,$2,'calling','+998901234567',$3,$1,$4,$5,$5,$5,'11:00','time') RETURNING id`,
      [scheduledAt,now,token,callId,audio.id])).rows[0].id;
      await upgrade.query(`INSERT INTO voice_reminder_call_attempts(call_id,job_id,extension,phone,started_at)
        VALUES($1,$2,'100','+998901234567',$3)`,[callId,activeId,now]);
      await upgrade.query(`INSERT INTO telephony_line_reservations(id,extension,owner_type,client_call_id,phone,job_id,lease_until,dial_authorized_at)
        VALUES($1,'100','robot',$2,'+998901234567',$3,$4,$5)`,[reservationId,callId,activeId,scheduledAt,now]);
      await upgrade.query(`INSERT INTO voice_reminder_test_calls(id,actor_user_id,phone,clock_time,expires_at)
        VALUES($1,1,'+123456789','11:00',$2)`,[testId,scheduledAt]);
      await upgrade.query(readFileSync('migrations/0150_voice_reminder_languages.sql','utf8'));
      await upgrade.query(readFileSync('migrations/0151_telephony_manager_line_priority.sql','utf8'));
      const before = {
        settings: (await upgrade.query('SELECT * FROM voice_reminder_settings')).rows,
        jobs: (await upgrade.query('SELECT * FROM voice_reminder_jobs ORDER BY id')).rows,
        tests: (await upgrade.query('SELECT * FROM voice_reminder_test_calls')).rows,
        attempts: (await upgrade.query('SELECT * FROM voice_reminder_call_attempts')).rows,
        reservations: (await upgrade.query('SELECT * FROM telephony_line_reservations')).rows,
      };
      await upgrade.query(readFileSync('migrations/0152_voice_reminder_response_retry.sql','utf8'));
      expect((await upgrade.query('SELECT * FROM voice_reminder_settings')).rows).toEqual(before.settings.map(row=>({ ...row,response_retry_audio_id:null })));
      expect((await upgrade.query('SELECT * FROM voice_reminder_jobs ORDER BY id')).rows)
        .toEqual(before.jobs.map(row => ({ ...row,language: 'ru',language_revision: 0,retry_phase:'primary',no_response_count:0,response_retry_audio_id:null,delivered_at:null,delivery_lesson_revision:null,delivery_participant_revision:null,last_retry_outcome:null })));
      expect((await upgrade.query('SELECT * FROM voice_reminder_test_calls')).rows)
        .toEqual(before.tests.map(row => ({ ...row,language: 'ru' })));
      expect((await upgrade.query('SELECT * FROM voice_reminder_call_attempts')).rows).toEqual(before.attempts);
      expect((await upgrade.query('SELECT * FROM telephony_line_reservations')).rows).toEqual(before.reservations);
      expect((await upgrade.query('SELECT * FROM voice_reminder_participant_response(1)')).rows)
        .toEqual([{ response: 'yes',response_at: now }]);
      const migrated = new PostgresVoiceReminderRepository(upgrade);
      await migrated.synchronize(now,await migrated.settings());
      expect((await upgrade.query('SELECT count(*)::int AS count FROM voice_reminder_jobs')).rows[0].count).toBe(2);
      expect((await upgrade.query('SELECT * FROM voice_reminder_participant_response(1)')).rows[0].response).toBe('yes');
    } finally { await upgrade.end(); await admin.query(`DROP SCHEMA ${upgradeSchema} CASCADE`); }
  });

  it('upgrades legacy enabled single recordings conservatively while retaining their metadata', async () => {
    const upgradeSchema = `voice_upgrade_${randomUUID().replace(/-/g, '')}`;
    await admin.query(`CREATE SCHEMA ${upgradeSchema}`);
    const upgrade = new Pool({ connectionString: url, options: `-c search_path=${upgradeSchema}` });
    try {
      await upgrade.query(`CREATE TABLE users(id integer PRIMARY KEY);
        CREATE TABLE academy_leads(id integer PRIMARY KEY,phone text,is_archived boolean DEFAULT false,language varchar(20),languages text[]);
        CREATE TABLE academy_students(id integer PRIMARY KEY,lead_id integer,phone text);
        CREATE TABLE academy_lead_phones(id integer PRIMARY KEY,lead_id integer,phone text,is_primary boolean);
        CREATE TABLE academy_demo_lessons(id integer PRIMARY KEY,scheduled_at timestamp,status text);
        CREATE TABLE academy_demo_lesson_participants(id integer PRIMARY KEY,demo_lesson_id integer,student_id integer,status text);`);
      await upgrade.query(readFileSync('migrations/0142_voice_reminders.sql', 'utf8'));
      await upgrade.query(readFileSync('migrations/0143_crm_telephony_capacity.sql', 'utf8'));
      await upgrade.query(`INSERT INTO voice_reminder_audio(id,file_name,mime_type,size_bytes,duration_seconds,storage_key,sha256)
        VALUES($1,'legacy.wav','audio/wav',24,1,'legacy.wav',$2)`, [audio.id, audio.sha256]);
      await upgrade.query('UPDATE voice_reminder_settings SET audio_id=$1,enabled=true WHERE id=1', [audio.id]);
      await upgrade.query(readFileSync('migrations/0144_voice_reminder_audio_library.sql', 'utf8'));
      await upgrade.query(readFileSync('migrations/0145_voice_reminder_clock_audio.sql', 'utf8'));
      await upgrade.query(readFileSync('migrations/0146_voice_reminder_test_calls.sql', 'utf8'));
      await upgrade.query(readFileSync('migrations/0147_voice_reminder_day_before.sql', 'utf8'));
      await upgrade.query(readFileSync('migrations/0149_voice_reminder_confirmations.sql', 'utf8'));
      await upgrade.query(readFileSync('migrations/0150_voice_reminder_languages.sql', 'utf8'));
      await upgrade.query(readFileSync('migrations/0152_voice_reminder_response_retry.sql', 'utf8'));
      const upgraded = await new PostgresVoiceReminderRepository(upgrade).settings();
      expect(upgraded.enabled).toBe(false);
      expect(upgraded.audio?.id).toBe(audio.id);
      expect(upgraded.audioLibrary).toEqual({ intro: null, dayBeforeIntro: null, confirmationYes: null, confirmationNo: null, outro: null, responseRetry:null, times: [], hours: [], minutes: [] });
    } finally {
      await upgrade.end();
      await admin.query(`DROP SCHEMA ${upgradeSchema} CASCADE`);
    }
  });

  it('preserves enabled settings, current/historical pins and test intents through 0145 and 0147', async () => {
    const upgradeSchema = `voice_clock_upgrade_${randomUUID().replace(/-/g, '')}`;
    await admin.query(`CREATE SCHEMA ${upgradeSchema}`);
    const upgrade = new Pool({ connectionString: url, options: `-c search_path=${upgradeSchema}` });
    const token = randomUUID();
    try {
      await upgrade.query(`CREATE TABLE users(id integer PRIMARY KEY);
        CREATE TABLE academy_leads(id integer PRIMARY KEY,phone text,is_archived boolean DEFAULT false,language varchar(20),languages text[]);
        CREATE TABLE academy_students(id integer PRIMARY KEY,lead_id integer,phone text);
        CREATE TABLE academy_lead_phones(id integer PRIMARY KEY,lead_id integer,phone text,is_primary boolean);
        CREATE TABLE academy_demo_lessons(id integer PRIMARY KEY,scheduled_at timestamp,status text);
        CREATE TABLE academy_demo_lesson_participants(id integer PRIMARY KEY,demo_lesson_id integer,student_id integer,status text);`);
      for (const name of ['0142_voice_reminders', '0143_crm_telephony_capacity', '0144_voice_reminder_audio_library']) {
        await upgrade.query(readFileSync(`migrations/${name}.sql`, 'utf8'));
      }
      await upgrade.query(`INSERT INTO voice_reminder_audio(id,file_name,mime_type,size_bytes,duration_seconds,storage_key,sha256)
        VALUES($1,'whole-clock.wav','audio/wav',24,1,'whole-clock.wav',$2)`, [audio.id, audio.sha256]);
      await upgrade.query('UPDATE voice_reminder_settings SET intro_audio_id=$1,outro_audio_id=$1 WHERE id=1', [audio.id]);
      await upgrade.query(`INSERT INTO voice_reminder_time_audio(time,audio_id) VALUES('11:00',$1)`, [audio.id]);
      await upgrade.query('UPDATE voice_reminder_settings SET enabled=true WHERE id=1');
      await upgrade.query(`INSERT INTO academy_demo_lessons(id,scheduled_at,status) VALUES(1,'2030-01-15 06:00:00','scheduled');
        INSERT INTO academy_demo_lesson_participants(id,demo_lesson_id,student_id,status) VALUES(1,1,1,'invited'),(2,1,1,'confirmed');`);
      await upgrade.query(`INSERT INTO voice_reminder_jobs(demo_lesson_id,participant_id,scheduled_at,due_at,status,lease_token,lease_until,
        intro_audio_id,time_audio_id,outro_audio_id,audio_clock_time)
        VALUES(1,1,'2030-01-15T06:00:00Z','2030-01-15T05:00:00Z','calling',$2,'2030-01-15T05:05:00Z',$1,$1,$1,'11:00'),
          (1,2,'2030-01-15T06:00:00Z','2030-01-15T05:00:00Z','played',NULL,NULL,$1,$1,$1,'11:00')`, [audio.id, token]);
      await upgrade.query(readFileSync('migrations/0145_voice_reminder_clock_audio.sql', 'utf8'));
      await upgrade.query(readFileSync('migrations/0146_voice_reminder_test_calls.sql', 'utf8'));
      const testId = randomUUID();
      await upgrade.query(`INSERT INTO voice_reminder_test_calls(id,phone,clock_time,expires_at) VALUES($1,'+123456789','11:00','2030-01-15T06:10:00Z')`, [testId]);
      const previousJobs = (await upgrade.query('SELECT * FROM voice_reminder_jobs ORDER BY id')).rows;
      const previousTests = (await upgrade.query('SELECT * FROM voice_reminder_test_calls')).rows;
      await upgrade.query(readFileSync('migrations/0147_voice_reminder_day_before.sql', 'utf8'));
      await upgrade.query(readFileSync('migrations/0149_voice_reminder_confirmations.sql', 'utf8'));
      await upgrade.query(readFileSync('migrations/0150_voice_reminder_languages.sql', 'utf8'));
      await upgrade.query(readFileSync('migrations/0152_voice_reminder_response_retry.sql', 'utf8'));
      const migratedJobs = (await upgrade.query('SELECT * FROM voice_reminder_jobs ORDER BY id')).rows;
      const migratedTests = (await upgrade.query('SELECT * FROM voice_reminder_test_calls')).rows;
      expect(migratedJobs.map(({ retry_phase,no_response_count,response_retry_audio_id,delivered_at,delivery_lesson_revision,delivery_participant_revision,last_retry_outcome,language, language_revision, reminder_kind, confirmation_enabled, confirmation_yes_audio_id, confirmation_no_audio_id, response, response_at, response_call_id, response_lesson_revision, response_participant_revision, ...row }) => row)).toEqual(previousJobs);
      expect(migratedJobs.every(row => row.reminder_kind === 'same_day')).toBe(true);
      expect(migratedTests.map(({ language, language_revision, reminder_kind, confirmation_enabled, confirmation_yes_audio_id, confirmation_no_audio_id, response, response_at, response_call_id, response_lesson_revision, response_participant_revision, ...row }) => row)).toEqual(previousTests);
      expect(migratedTests[0].reminder_kind).toBe('same_day');
      const settings = await new PostgresVoiceReminderRepository(upgrade).settings();
      expect(settings.enabled).toBe(true); expect(settings.dayBeforeEnabled).toBe(false);
      expect(settings.audioLibrary.dayBeforeIntro).toBeNull();
      expect(settings.audioLibrary.times[0].audio.id).toBe(audio.id);
      expect(settings.audioLibrary.hours).toEqual([]); expect(settings.audioLibrary.minutes).toEqual([]);
      const rows = (await upgrade.query(`SELECT status,lease_token,audio_mode,time_audio_id,hour_audio_id,minute_audio_id
        FROM voice_reminder_jobs ORDER BY id`)).rows;
      expect(rows).toEqual([
        { status: 'calling', lease_token: token, audio_mode: 'time', time_audio_id: audio.id, hour_audio_id: null, minute_audio_id: null },
        { status: 'played', lease_token: null, audio_mode: 'time', time_audio_id: audio.id, hour_audio_id: null, minute_audio_id: null },
      ]);
      expect((await upgrade.query('SELECT count(*)::int AS count FROM voice_reminder_audio')).rows[0].count).toBe(1);
    } finally {
      await upgrade.end(); await admin.query(`DROP SCHEMA ${upgradeSchema} CASCADE`);
    }
  });

  it('deduplicates schedule participants and uses UTC instants in a non-UTC session', async () => {
    const settings = await repository.settings();
    await Promise.all([repository.synchronize(now, settings), repository.synchronize(now, settings)]);
    const result = await readVoiceReminderJobs(pool);
    expect(result.summary.waiting).toBe(3);
    expect(result.results.every(row => row.scheduledAt === '2030-01-15T06:00:00.000Z' && row.dueAt === '2030-01-15T04:00:00.000Z')).toBe(true);
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
    expect((await readVoiceReminderJobs(pool)).summary.calling).toBe(2);
    await repository.finish(first, { outcome: 'played', callStarted: true, callId: 'real' }, now, null);
    const finished = (await readVoiceReminderJobs(pool)).results.find(value => value.id === first.id)!;
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
    const history = await readVoiceReminderJobs(pool);
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
    expect((await readVoiceReminderJobs(pool)).results.find(value => value.id === first.id)?.status).toBe('cancelled');
    await pool.query(`UPDATE academy_leads SET is_archived=true WHERE id=1`);
    const second = (await repository.claim(now, 2, 300))!;
    expect(await repository.prepare(second, now)).toBeNull();
  });

  it('retries known no-answer but recovers crashed in-flight jobs as terminal failed', async () => {
    await repository.synchronize(now, await repository.settings());
    const first = (await repository.claim(now, 2, 300))!;
    await repository.finish(first, { outcome: 'unanswered', callStarted: true, callId: 'first' }, now, new Date('2030-01-15T05:10:00Z'));
    expect((await readVoiceReminderJobs(pool)).results.find(value => value.id === first.id)).toMatchObject({ status: 'waiting', attempts: 1 });
    const crashed = (await repository.claim(now, 2, 300))!;
    const later = new Date('2030-01-15T05:06:00Z');
    await repository.synchronize(later, await repository.settings());
    expect((await readVoiceReminderJobs(pool)).results.find(value => value.id === crashed.id)?.status).toBe('failed');
    expect(await repository.renew(crashed, later, 300)).toBe(false);
    await repository.finish(crashed, { outcome: 'played', callStarted: true, callId: 'late' }, later, null);
    expect((await readVoiceReminderJobs(pool)).results.find(value => value.id === crashed.id)?.status).toBe('failed');
  });

  it('defers temporary disablement and never claims expired demos', async () => {
    await repository.synchronize(now, await repository.settings());
    const first = (await repository.claim(now, 2, 300))!;
    await repository.saveSettings({ ...input, enabled: false }, 1);
    expect(await repository.prepare(first, now)).toBe('defer');
    await repository.defer(first, now);
    await repository.synchronize(scheduledAt, await repository.settings());
    expect((await readVoiceReminderJobs(pool)).summary.cancelled).toBe(3);
    expect(await repository.claim(scheduledAt, 2, 300)).toBeNull();
  });

  it('creates a new reminder revision when a lesson returns to an earlier date', async () => {
    await repository.synchronize(now, await repository.settings());
    await pool.query(`UPDATE academy_demo_lessons SET scheduled_at='2030-01-15 07:00:00' WHERE id=1`);
    await repository.synchronize(now, await repository.settings());
    await pool.query(`UPDATE academy_demo_lessons SET scheduled_at='2030-01-15 06:00:00' WHERE id=1`);
    await repository.synchronize(now, await repository.settings());
    expect((await readVoiceReminderJobs(pool)).summary).toMatchObject({ waiting: 3, cancelled: 6 });
    const first = (await repository.claim(now, 2, 300))!;
    expect(await repository.prepare(first, now)).toMatchObject({ scheduledAt });
    expect((await pool.query(`SELECT lesson_revision FROM voice_reminder_jobs WHERE id=$1`, [first.id])).rows[0].lesson_revision).toBe(2);
  });

  it('reminds a reinvited participant but does not duplicate ordinary confirmation', async () => {
    await repository.synchronize(now, await repository.settings());
    await pool.query(`UPDATE academy_demo_lesson_participants SET status='confirmed' WHERE id=1`);
    await repository.synchronize(now, await repository.settings());
    expect((await readVoiceReminderJobs(pool)).summary.waiting).toBe(3);
    await pool.query(`UPDATE academy_demo_lesson_participants SET status='cancelled' WHERE id=1`);
    await pool.query(`UPDATE academy_demo_lesson_participants SET status='confirmed' WHERE id=1`);
    await repository.synchronize(now, await repository.settings());
    expect((await readVoiceReminderJobs(pool)).summary).toMatchObject({ waiting: 3, cancelled: 1 });
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
