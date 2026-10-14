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
      CREATE TABLE academy_leads(id integer PRIMARY KEY, phone text, is_archived boolean NOT NULL DEFAULT false);
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
    expect((await repository.results()).summary.waiting).toBe(3);
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
    expect((await repository.results()).summary.waiting).toBe(3);
    const demoDay = new Date('2030-01-14T19:05:00Z');
    const claim = (await repository.claim(demoDay, 2, 300))!;
    expect(await repository.prepare(claim, previousDay)).toBe('defer');
    const ready = await repository.prepare(claim, demoDay);
    expect(ready).toMatchObject({ audioParts: { clockTime: '00:30' } });
    expect(await repository.canContinue(claim, '+998901234567', previousDay, false)).toBe(false);
    expect(await repository.canContinue(claim, '+998901234567', demoDay)).toBe(true);
  });

  it('upgrades legacy enabled single recordings conservatively while retaining their metadata', async () => {
    const upgradeSchema = `voice_upgrade_${randomUUID().replace(/-/g, '')}`;
    await admin.query(`CREATE SCHEMA ${upgradeSchema}`);
    const upgrade = new Pool({ connectionString: url, options: `-c search_path=${upgradeSchema}` });
    try {
      await upgrade.query(`CREATE TABLE users(id integer PRIMARY KEY);
        CREATE TABLE academy_demo_lessons(id integer PRIMARY KEY,scheduled_at timestamp,status text);
        CREATE TABLE academy_demo_lesson_participants(id integer PRIMARY KEY,demo_lesson_id integer,student_id integer,status text);`);
      await upgrade.query(readFileSync('migrations/0142_voice_reminders.sql', 'utf8'));
      await upgrade.query(readFileSync('migrations/0143_crm_telephony_capacity.sql', 'utf8'));
      await upgrade.query(`INSERT INTO voice_reminder_audio(id,file_name,mime_type,size_bytes,duration_seconds,storage_key,sha256)
        VALUES($1,'legacy.wav','audio/wav',24,1,'legacy.wav',$2)`, [audio.id, audio.sha256]);
      await upgrade.query('UPDATE voice_reminder_settings SET audio_id=$1,enabled=true WHERE id=1', [audio.id]);
      await upgrade.query(readFileSync('migrations/0144_voice_reminder_audio_library.sql', 'utf8'));
      await upgrade.query(readFileSync('migrations/0145_voice_reminder_clock_audio.sql', 'utf8'));
      const upgraded = await new PostgresVoiceReminderRepository(upgrade).settings();
      expect(upgraded.enabled).toBe(false);
      expect(upgraded.audio?.id).toBe(audio.id);
      expect(upgraded.audioLibrary).toEqual({ intro: null, outro: null, times: [], hours: [], minutes: [] });
    } finally {
      await upgrade.end();
      await admin.query(`DROP SCHEMA ${upgradeSchema} CASCADE`);
    }
  });

  it('preserves enabled whole-clock settings and current/historical pins when upgrading 0144 to 0145', async () => {
    const upgradeSchema = `voice_clock_upgrade_${randomUUID().replace(/-/g, '')}`;
    await admin.query(`CREATE SCHEMA ${upgradeSchema}`);
    const upgrade = new Pool({ connectionString: url, options: `-c search_path=${upgradeSchema}` });
    const token = randomUUID();
    try {
      await upgrade.query(`CREATE TABLE users(id integer PRIMARY KEY);
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
      const settings = await new PostgresVoiceReminderRepository(upgrade).settings();
      expect(settings.enabled).toBe(true);
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
