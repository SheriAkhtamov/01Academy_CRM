import express from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VOICE_REMINDER_SETTINGS } from '../shared/contracts/voice-reminders';
import { createVoiceReminderRouter } from '../server/modules/voice-reminders/http/voice-reminders.router';
import { VoiceReminderSettingsService } from '../server/modules/voice-reminders/application/settings-service';
import type { StoredVoiceReminderAudio, StoredVoiceReminderAudioLibrary, VoiceReminderRepository, VoiceReminderTestCallRepository } from '../server/modules/voice-reminders/application/ports';

const snapshot = {
  settings: DEFAULT_VOICE_REMINDER_SETTINGS, readiness: { ready: false, code: 'audio_missing' },
};
const service = { snapshot: vi.fn(), save: vi.fn(), upload: vi.fn(), playback: vi.fn(),
  uploadPart: vi.fn(), playbackPart: vi.fn(), removeTime: vi.fn(), removePart: vi.fn(), preview: vi.fn(),
  requestTestCall: vi.fn(), currentTestCall: vi.fn() };
const app = (module: 'administration' | 'sales' | null = 'administration') => {
  const application = express();
  application.use(express.json());
  application.use((req, _res, next) => {
    if (module) req.user = { id: 1, module, modules: [module] } as typeof req.user;
    next();
  });
  application.use('/api/academy', createVoiceReminderRouter(service as unknown as VoiceReminderSettingsService));
  return application;
};
beforeEach(() => { vi.clearAllMocks(); service.snapshot.mockResolvedValue(snapshot); service.save.mockResolvedValue(snapshot);
  service.upload.mockResolvedValue(snapshot); service.uploadPart.mockResolvedValue(snapshot);
  service.removeTime.mockResolvedValue(snapshot); service.removePart.mockResolvedValue(snapshot);
  service.currentTestCall.mockResolvedValue(null); });

describe('voice reminder HTTP boundary', () => {
  it('requires leadership for settings, test calls and recording access before reading bytes', async () => {
    for (const module of [null, 'sales'] as const) {
      for (const endpoint of ['', '/test-calls/current', '/audio', '/audio/intro', '/audio/day-before-intro', '/audio/confirmation-yes', '/audio/confirmation-no', '/audio/outro', '/audio/times/11:00', '/audio/hours/00', '/audio/minutes/00', '/preview/11:00']) {
        const response = await request(app(module)).get(`/api/academy/voice-reminders${endpoint}`);
        expect(response.status).toBe(module === null ? 401 : 403);
      }
      const upload = await request(app(module)).post('/api/academy/voice-reminders/audio').attach('file', Buffer.from('bytes'), 'demo.wav');
      expect(upload.status).toBe(module === null ? 401 : 403);
      for (const endpoint of ['intro', 'day-before-intro', 'confirmation-yes', 'confirmation-no', 'outro', 'times/11:00', 'hours/00', 'minutes/00']) {
        expect((await request(app(module)).post(`/api/academy/voice-reminders/audio/${endpoint}`).attach('file', Buffer.from('bytes'), 'demo.wav')).status).toBe(module === null ? 401 : 403);
      }
      expect((await request(app(module)).delete('/api/academy/voice-reminders/audio/times/11:00')).status).toBe(module === null ? 401 : 403);
      expect((await request(app(module)).delete('/api/academy/voice-reminders/audio/hours/00')).status).toBe(module === null ? 401 : 403);
      expect((await request(app(module)).delete('/api/academy/voice-reminders/audio/minutes/00')).status).toBe(module === null ? 401 : 403);
      expect((await request(app(module)).post('/api/academy/voice-reminders/test-calls').send({})).status).toBe(module === null ? 401 : 403);
    }
    expect(service.snapshot).not.toHaveBeenCalled(); expect(service.upload).not.toHaveBeenCalled();
  });

  it('passes a normalized leadership actor and makes private settings non-cacheable', async () => {
    const response = await request(app()).get('/api/academy/voice-reminders');
    expect(response.status).toBe(200); expect(response.body).toEqual(snapshot);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(service.snapshot).toHaveBeenCalledWith(expect.objectContaining({ userId: 1, isLeadership: true }));
  });

  it('validates editable settings without accepting credentials', async () => {
    const { audio: _audio, audioLibrary: _library, timeZone: _timeZone, ...input } = DEFAULT_VOICE_REMINDER_SETTINGS;
    const valid = await request(app()).put('/api/academy/voice-reminders/settings').send(input);
    expect(valid.status).toBe(200);
    expect(service.save).toHaveBeenCalledWith(expect.anything(), input);
    const invalid = await request(app()).put('/api/academy/voice-reminders/settings').send({ ...input, password: 'unwanted' });
    expect(invalid.status).toBe(400); expect(service.save).toHaveBeenCalledTimes(1);
  });

  it('validates day-before settings within the confirmed 10:00–20:00 bounds', async () => {
    const { audio: _audio, audioLibrary: _library, timeZone: _zone, ...input } = DEFAULT_VOICE_REMINDER_SETTINGS;
    const valid = await request(app()).put('/api/academy/voice-reminders/settings').send({ ...input, dayBeforeEnabled: true });
    expect(valid.status).toBe(200);
    for (const change of [{ dayBeforeStartTime: '09:59' }, { dayBeforeEndTime: '20:01' }, { dayBeforeStartTime: '20:00' }, { dayBeforeEndTime: '11:00\n' }]) {
      expect((await request(app()).put('/api/academy/voice-reminders/settings').send({ ...input, ...change })).status).toBe(400);
    }
    expect(service.save).toHaveBeenCalledTimes(1);
  });

  it('passes the selected kind to test calls and rejects unknown kinds before enqueue', async () => {
    const input = { requestId: randomUUID(), phone: '+123456789', clockTime: '11:00', reminderKind: 'day_before' };
    service.requestTestCall.mockResolvedValue({ id: input.requestId, ...input, status: 'waiting' });
    expect((await request(app()).post('/api/academy/voice-reminders/test-calls').send(input)).status).toBe(200);
    expect(service.requestTestCall).toHaveBeenLastCalledWith(expect.anything(), input);
    for (const kind of ['tomorrow', '', 'day_before\n']) {
      expect((await request(app()).post('/api/academy/voice-reminders/test-calls').send({ ...input, reminderKind: kind })).status).toBe(400);
    }
    expect(service.requestTestCall).toHaveBeenCalledTimes(1);
  });

  it('accepts a single bounded recording and rejects missing/multiple files', async () => {
    const valid = await request(app()).post('/api/academy/voice-reminders/audio').attach('file', Buffer.from('fake-bytes'), { filename: 'demo.mp3', contentType: 'audio/mpeg' });
    expect(valid.status).toBe(200);
    expect(service.upload).toHaveBeenCalledWith(expect.anything(), { bytes: Buffer.from('fake-bytes'), originalName: 'demo.mp3', mimeType: 'audio/mpeg' });
    const missing = await request(app()).post('/api/academy/voice-reminders/audio');
    const multiple = await request(app()).post('/api/academy/voice-reminders/audio')
      .attach('file', Buffer.from('1'), '1.wav').attach('file', Buffer.from('2'), '2.wav');
    expect(missing.status).toBe(400); expect(multiple.status).toBe(400); expect(service.upload).toHaveBeenCalledTimes(1);
  });

  it('returns a public error instead of leaking storage paths, provider details or SQL', async () => {
    service.snapshot.mockRejectedValue(new Error('SQL SELECT password FROM provider at /private/config'));
    const response = await request(app()).get('/api/academy/voice-reminders');
    expect(response.status).toBe(500); expect(response.body).toEqual({ error: 'voiceReminderSaveFailed' });
  });

  it('uploads each modular part and deletes only an exact validated time relation', async () => {
    for (const [endpoint, target] of [['intro', { part: 'intro' }], ['day-before-intro', { part: 'dayBeforeIntro' }], ['confirmation-yes', { part: 'confirmationYes' }], ['confirmation-no', { part: 'confirmationNo' }], ['outro', { part: 'outro' }], ['times/11%3A00', { part: 'time', time: '11:00' }]] as const) {
      expect((await request(app()).post(`/api/academy/voice-reminders/audio/${endpoint}`).attach('file', Buffer.from('recording'), 'part.wav')).body).toEqual(snapshot);
      expect(service.uploadPart).toHaveBeenLastCalledWith(expect.anything(), target, expect.objectContaining({ originalName: 'part.wav' }), null);
    }
    const expectedId = randomUUID();
    const removed = await request(app()).delete(`/api/academy/voice-reminders/audio/times/11%3A00?expectedId=${expectedId}`);
    expect(removed.body).toEqual(snapshot);
    expect(service.removeTime).toHaveBeenCalledWith(expect.anything(), '11:00', expectedId);
  });

  it('rejects malformed clock values before consuming multipart audio', async () => {
    for (const time of ['24:00', '7:30', '09:99', '11:00:00', '11:00\n']) {
      const endpoint = `/api/academy/voice-reminders/audio/times/${encodeURIComponent(time)}`;
      expect((await request(app()).post(endpoint).attach('file', Buffer.from('bad'), 'part.wav')).body).toEqual({ error: 'voiceReminderInvalidTime' });
      expect((await request(app()).get(endpoint)).status).toBe(400);
      expect((await request(app()).delete(endpoint)).status).toBe(400);
      expect((await request(app()).get(`/api/academy/voice-reminders/preview/${encodeURIComponent(time)}`)).status).toBe(400);
    }
    expect(service.uploadPart).not.toHaveBeenCalled(); expect(service.preview).not.toHaveBeenCalled();
  });

  it('passes exact replacement IDs and requires an explicit expected ID before deleting a time', async () => {
    const expectedId = randomUUID();
    expect((await request(app()).post(`/api/academy/voice-reminders/audio/intro?expectedId=${expectedId}`)
      .attach('file', Buffer.from('replacement'), 'part.wav')).status).toBe(200);
    expect(service.uploadPart).toHaveBeenCalledWith(expect.anything(), { part: 'intro' }, expect.anything(), expectedId);
    expect((await request(app()).delete('/api/academy/voice-reminders/audio/times/11:00')).status).toBe(400);
    expect(service.removeTime).not.toHaveBeenCalled();
    expect((await request(app()).post('/api/academy/voice-reminders/audio/intro?expectedId=invalid')
      .attach('file', Buffer.from('replacement'), 'part.wav')).status).toBe(400);
    expect(service.uploadPart).toHaveBeenCalledTimes(1);
  });

  it('uploads hour and minute clips including 00 and enforces confirmed deletion IDs', async () => {
    const expectedId = randomUUID();
    for (const [endpoint, target] of [['hours/00', { part: 'hour', hour: '00' }], ['hours/23', { part: 'hour', hour: '23' }], ['minutes/00', { part: 'minute', minute: '00' }], ['minutes/05', { part: 'minute', minute: '05' }], ['minutes/59', { part: 'minute', minute: '59' }]] as const) {
      expect((await request(app()).post(`/api/academy/voice-reminders/audio/${endpoint}`)
        .attach('file', Buffer.from('audio'), 'clip.wav')).body).toEqual(snapshot);
      expect(service.uploadPart).toHaveBeenLastCalledWith(expect.anything(), target, expect.anything(), null);
      expect((await request(app()).post(`/api/academy/voice-reminders/audio/${endpoint}?expectedId=${expectedId}`)
        .attach('file', Buffer.from('replacement'), 'clip.wav')).status).toBe(200);
      expect(service.uploadPart).toHaveBeenLastCalledWith(expect.anything(), target, expect.anything(), expectedId);
      expect((await request(app()).delete(`/api/academy/voice-reminders/audio/${endpoint}`)).status).toBe(400);
      expect((await request(app()).delete(`/api/academy/voice-reminders/audio/${endpoint}?expectedId=${expectedId}`)).body).toEqual(snapshot);
      expect(service.removePart).toHaveBeenLastCalledWith(expect.anything(), target, expectedId);
    }
  });

  it('rejects invalid hour/minute ranges and non-two-digit indexes before reading multipart bytes', async () => {
    for (const endpoint of ['hours/24', 'hours/1', 'hours/01%0A', 'minutes/60', 'minutes/5', 'minutes/00%0A']) {
      const path = `/api/academy/voice-reminders/audio/${endpoint}`;
      expect((await request(app()).post(path).attach('file', Buffer.from('audio'), 'clip.wav')).body).toEqual({ error: 'voiceReminderInvalidTime' });
      expect((await request(app()).get(path)).status).toBe(400);
      expect((await request(app()).delete(path)).status).toBe(400);
    }
    expect(service.uploadPart).not.toHaveBeenCalled(); expect(service.playbackPart).not.toHaveBeenCalled(); expect(service.removePart).not.toHaveBeenCalled();
    expect((await request(app()).post('/api/academy/voice-reminders/audio/hours/01')
      .attach('file', Buffer.from('audio'), 'clip.wav').field('unexpected', 'value')).status).toBe(400);
    expect(service.uploadPart).not.toHaveBeenCalled();
  });

  it('streams individual private hour/minute recordings with range support', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-clock-route-'));
    try {
      const file = path.join(directory, 'clock.wav');
      await fs.writeFile(file, Buffer.from('RIFF private clip'));
      service.playbackPart.mockResolvedValue({ path: file, mimeType: 'audio/wav' });
      for (const [endpoint, target] of [['hours/01', { part: 'hour', hour: '01' }], ['minutes/00', { part: 'minute', minute: '00' }]] as const) {
        const response = await request(app()).get(`/api/academy/voice-reminders/audio/${endpoint}`).set('Range', 'bytes=0-3');
        expect(response.status).toBe(206); expect(response.headers['cache-control']).toBe('no-store');
        expect(Buffer.from(response.body).toString()).toBe('RIFF');
        expect(service.playbackPart).toHaveBeenLastCalledWith(expect.anything(), target);
      }
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });

  it('streams a private assembled preview and accepts audio ranges without exposing its path', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-preview-route-'));
    try {
      const file = path.join(directory, 'preview.wav');
      await fs.writeFile(file, Buffer.from('RIFF private audio bytes'));
      service.preview.mockResolvedValue({ path: file, mimeType: 'audio/wav' });
      const response = await request(app()).get('/api/academy/voice-reminders/preview/11%3A00').set('Range', 'bytes=0-3');
      expect(response.status).toBe(206); expect(response.headers['content-type']).toContain('audio/wav');
      expect(response.headers['cache-control']).toBe('no-store'); expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(Buffer.from(response.body).toString()).toBe('RIFF');
      expect(service.preview).toHaveBeenCalledWith(expect.anything(), '11:00', 'same_day');
      expect((await request(app()).get('/api/academy/voice-reminders/preview/11%3A00?reminderKind=day_before')).status).toBe(200);
      expect(service.preview).toHaveBeenLastCalledWith(expect.anything(), '11:00', 'day_before');
      expect((await request(app()).get('/api/academy/voice-reminders/preview/11%3A00?reminderKind=invalid')).status).toBe(400);
      expect((await request(app()).get('/api/academy/voice-reminders/preview/24%3A00?reminderKind=invalid')).body).toEqual({ error: 'voiceReminderInvalidTime' });
      expect(service.preview).toHaveBeenCalledTimes(2);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
});

describe('voice reminder enablement', () => {
  it('requires audio and a ready transport while allowing disablement on transport failures', async () => {
    const repository = {
      currentAudio: vi.fn(async () => null), saveSettings: vi.fn(async () => undefined),
      audioLibrary: vi.fn(async (): Promise<StoredVoiceReminderAudioLibrary> => ({ intro: null, dayBeforeIntro: null, confirmationYes: null, confirmationNo: null, outro: null, times: [], hours: [], minutes: [] })),
      settings: vi.fn(async () => DEFAULT_VOICE_REMINDER_SETTINGS),
    };
    const gateway = { readiness: vi.fn(async () => ({ ready: true, code: 'ready' as const })), tryAcquireLine: vi.fn() };
    const useCase = new VoiceReminderSettingsService(repository as unknown as VoiceReminderRepository, { save: vi.fn(), resolve: vi.fn() }, gateway);
    const actor = { userId: 1, primaryModule: 'administration' as const, modules: ['administration' as const], isLeadership: true };
    const { audio: _audio, audioLibrary: _library, timeZone: _timeZone, ...input } = DEFAULT_VOICE_REMINDER_SETTINGS;
    await expect(useCase.save(actor, { ...input, enabled: true })).rejects.toMatchObject({ code: 'voiceReminderAudioRequired' });
    expect(repository.saveSettings).not.toHaveBeenCalled();
    const audio = { id: 'present', durationSeconds: 1 } as StoredVoiceReminderAudio;
    repository.audioLibrary.mockResolvedValue({ intro: audio, dayBeforeIntro: null, confirmationYes: null, confirmationNo: null, outro: audio, times: [{ time: '11:00', audio }], hours: [], minutes: [] });
    gateway.readiness.mockRejectedValue(new Error('Provider offline'));
    await expect(useCase.save(actor, { ...input, enabled: true })).rejects.toMatchObject({ code: 'voiceReminderTransportUnavailable' });
    await useCase.save(actor, input);
    expect(repository.saveSettings).toHaveBeenCalledWith(input, 1);
  });

  it('previews immutable ordered parts and rejects combined duration before saving a replacement', async () => {
    const actor = { userId: 1, primaryModule: 'administration' as const, modules: ['administration' as const], isLeadership: true };
    const audio = (name: string, durationSeconds = 1): StoredVoiceReminderAudio => ({ id: randomUUID(), fileName: `${name}.wav`,
      mimeType: 'audio/wav', sizeBytes: 24, durationSeconds, uploadedAt: new Date().toISOString(), storageKey: `${name}.wav`, sha256: 'a'.repeat(64) });
    const library = { intro: audio('intro'), dayBeforeIntro: null, confirmationYes: null, confirmationNo: null, outro: audio('outro'), times: [{ time: '11:00', audio: audio('time') }], hours: [], minutes: [] };
    const repository = { audioLibrary: vi.fn(async () => library), saveLibraryAudio: vi.fn() };
    const store = { save: vi.fn(async () => audio('large', 179)), resolve: vi.fn() };
    const composer = { compose: vi.fn(async () => ({ path: '/private/assembled.wav', mimeType: 'audio/wav' as const })) };
    const useCase = new VoiceReminderSettingsService(repository as unknown as VoiceReminderRepository, store, { readiness: vi.fn(), tryAcquireLine: vi.fn() }, composer);
    await expect(useCase.preview(actor, '11:00')).resolves.toEqual({ path: '/private/assembled.wav', mimeType: 'audio/wav' });
    expect(composer.compose).toHaveBeenCalledWith({ kind: 'time', intro: library.intro, time: library.times[0].audio, outro: library.outro, clockTime: '11:00' });
    await expect(useCase.uploadPart(actor, { part: 'time', time: '11:00' }, { bytes: Buffer.from('audio'), originalName: 'long.wav', mimeType: 'audio/wav' }, library.times[0].audio.id)).rejects.toMatchObject({ code: 'voiceReminderAudioTooLong' });
    expect(repository.saveLibraryAudio).not.toHaveBeenCalled();
    await expect(useCase.preview(actor, '12:00')).rejects.toMatchObject({ code: 'voiceReminderAudioRequired' });
    expect(composer.compose).toHaveBeenCalledTimes(1);
  });

  it('previews required digital 00 minutes and falls back to a legacy whole clock when one split part is absent', async () => {
    const actor = { userId: 1, primaryModule: 'administration' as const, modules: ['administration' as const], isLeadership: true };
    const audio = (name: string): StoredVoiceReminderAudio => ({ id: randomUUID(), fileName: `${name}.wav`,
      mimeType: 'audio/wav', sizeBytes: 24, durationSeconds: 1, uploadedAt: new Date().toISOString(), storageKey: `${name}.wav`, sha256: 'a'.repeat(64) });
    const library: StoredVoiceReminderAudioLibrary = { intro: audio('intro'), dayBeforeIntro: null, confirmationYes: null, confirmationNo: null, outro: audio('outro'),
      times: [{ time: '11:00', audio: audio('whole') }], hours: [{ hour: '11', audio: audio('hour') }],
      minutes: [{ minute: '00', audio: audio('zero-zero') }] };
    const repository = { audioLibrary: vi.fn(async () => library) };
    const composer = { compose: vi.fn(async () => ({ path: '/private/clock.wav', mimeType: 'audio/wav' as const })) };
    const useCase = new VoiceReminderSettingsService(repository as unknown as VoiceReminderRepository, { save: vi.fn(), resolve: vi.fn() },
      { readiness: vi.fn(), tryAcquireLine: vi.fn() }, composer);
    await useCase.preview(actor, '11:00');
    expect(composer.compose).toHaveBeenLastCalledWith({ kind: 'clock', intro: library.intro, outro: library.outro,
      clockTime: '11:00', hour: library.hours[0].audio, minute: library.minutes[0].audio });
    library.minutes = [];
    await useCase.preview(actor, '11:00');
    expect(composer.compose).toHaveBeenLastCalledWith({ kind: 'time', intro: library.intro, outro: library.outro,
      clockTime: '11:00', time: library.times[0].audio });
    library.times = [];
    await expect(useCase.preview(actor, '11:00')).rejects.toMatchObject({ code: 'voiceReminderAudioRequired' });
    expect(composer.compose).toHaveBeenCalledTimes(2);
  });
});

describe('tomorrow audio application boundaries', () => {
  const actor = { userId: 1, primaryModule: 'administration' as const, modules: ['administration' as const], isLeadership: true };
  const audio = (name: string): StoredVoiceReminderAudio => ({ id: randomUUID(), fileName: name, mimeType: 'audio/wav',
    durationSeconds: 1, sizeBytes: 24, uploadedAt: new Date().toISOString(), storageKey: `${name}.wav`, sha256: 'a'.repeat(64) });
  it('requires the tomorrow intro before enabling its kind and previews the selected intro with shared clock/outro', async () => {
    const library: StoredVoiceReminderAudioLibrary = { intro: audio('today'), dayBeforeIntro: null, confirmationYes: null, confirmationNo: null, outro: audio('outro'),
      hours: [{ hour: '11', audio: audio('hour') }], minutes: [{ minute: '00', audio: audio('minute') }], times: [] };
    const { audio: _audio, audioLibrary: _library, timeZone: _zone, ...input } = DEFAULT_VOICE_REMINDER_SETTINGS;
    const repository = { settings: vi.fn(async () => ({ ...DEFAULT_VOICE_REMINDER_SETTINGS, dayBeforeEnabled: true, audioLibrary: library })),
      audioLibrary: vi.fn(async () => library), saveSettings: vi.fn() };
    const gateway = { readiness: vi.fn(async () => ({ ready: true, code: 'ready' as const })), tryAcquireLine: vi.fn() };
    const composer = { compose: vi.fn(async () => ({ path: '/private/composed.wav', mimeType: 'audio/wav' as const })) };
    const useCase = new VoiceReminderSettingsService(repository as unknown as VoiceReminderRepository, { save: vi.fn(), resolve: vi.fn() }, gateway, composer);
    expect((await useCase.snapshot(actor)).readiness.code).toBe('audio_missing');
    await expect(useCase.save(actor, { ...input, enabled: true, dayBeforeEnabled: true })).rejects.toMatchObject({ code: 'voiceReminderAudioRequired' });
    await expect(useCase.preview(actor, '11:00', 'day_before')).rejects.toMatchObject({ code: 'voiceReminderAudioRequired' });
    library.dayBeforeIntro = audio('tomorrow');
    expect((await useCase.snapshot(actor)).readiness.code).toBe('ready');
    await useCase.preview(actor, '11:00', 'day_before');
    expect(composer.compose).toHaveBeenCalledWith({ kind: 'clock', intro: library.dayBeforeIntro, outro: library.outro,
      clockTime: '11:00', hour: library.hours[0].audio, minute: library.minutes[0].audio });
    await useCase.save(actor, { ...input, enabled: true, dayBeforeEnabled: true });
    expect(repository.saveSettings).toHaveBeenCalledTimes(1);
  });
});

describe('confirmation audio application boundary', () => {
  const actor = { userId: 1, primaryModule: 'administration' as const, modules: ['administration' as const], isLeadership: true };
  it('returns an exact missing-replies error while automatic reminders are off and then enables both private assets', async () => {
    const library: StoredVoiceReminderAudioLibrary = { intro: null, dayBeforeIntro: null, outro: null,
      confirmationYes: null, confirmationNo: null, times: [], hours: [], minutes: [] };
    const repository = { audioLibrary: vi.fn(async () => library), settings: vi.fn(async () => ({ ...DEFAULT_VOICE_REMINDER_SETTINGS, audioLibrary: library })), saveSettings: vi.fn() };
    const gateway = { readiness: vi.fn(async () => ({ ready: false, code: 'transport_unavailable' as const })), tryAcquireLine: vi.fn() };
    const useCase = new VoiceReminderSettingsService(repository as unknown as VoiceReminderRepository, { save: vi.fn(), resolve: vi.fn() }, gateway);
    const { audio: _audio, audioLibrary: _library, timeZone: _zone, ...input } = DEFAULT_VOICE_REMINDER_SETTINGS;
    await expect(useCase.save(actor, { ...input, confirmationEnabled: true })).rejects.toMatchObject({ code: 'voiceReminderConfirmationAudioRequired', statusCode: 409 });
    const clip: StoredVoiceReminderAudio = { id: randomUUID(), fileName: 'reply.wav', mimeType: 'audio/wav', durationSeconds: 1,
      sizeBytes: 24, uploadedAt: new Date().toISOString(), storageKey: 'reply.wav', sha256: 'a'.repeat(64) };
    library.confirmationYes=clip;
    await expect(useCase.save(actor, { ...input, confirmationEnabled: true })).rejects.toMatchObject({ code: 'voiceReminderConfirmationAudioRequired' });
    library.confirmationNo={ ...clip, id: randomUUID() };
    await useCase.save(actor, { ...input, confirmationEnabled: true });
    expect(repository.saveSettings).toHaveBeenCalledWith({ ...input, confirmationEnabled: true }, actor.userId);
  });
});

describe('test-call HTTP and application boundary', () => {
  const actor = { userId: 1, primaryModule: 'administration' as const, modules: ['administration' as const], isLeadership: true };
  it('validates immutable intent UUID, selected clock and external phone while returning an actor-scoped DTO', async () => {
    const requestId = randomUUID();
    const dto = { id: requestId, status: 'waiting', phone: '+123456789', clockTime: '11:00', reminderKind: 'same_day' };
    service.requestTestCall.mockResolvedValue(dto);
    service.currentTestCall.mockResolvedValue(dto);
    const response = await request(app()).post('/api/academy/voice-reminders/test-calls').send({ requestId, phone: '+123456789', clockTime: '11:00' });
    expect(response.status).toBe(200); expect(response.body).toEqual(dto);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(service.requestTestCall).toHaveBeenCalledWith(expect.objectContaining({ userId: 1, isLeadership: true }),
      { requestId, phone: '+123456789', clockTime: '11:00' });
    expect((await request(app()).get('/api/academy/voice-reminders/test-calls/current')).body).toEqual(dto);
    expect(service.currentTestCall).toHaveBeenCalledWith(expect.objectContaining({ userId: 1 }));
    for (const body of [{ requestId: 'invalid', phone: '+123456789', clockTime: '11:00' },
      { requestId, phone: '+123456789', clockTime: '11:00:00' }, { requestId, phone: 'invalid', clockTime: '11:00' },
      { requestId, phone: '+123456789', clockTime: '11:00', password: 'unwanted' }]) {
      expect((await request(app()).post('/api/academy/voice-reminders/test-calls').send(body)).body).toEqual({ error: 'voiceReminderInvalidTestCall' });
    }
    expect(service.requestTestCall).toHaveBeenCalledTimes(1);
  });

  it('keeps snapshot free of summary/history and queues tests even when automation and transport are unavailable', async () => {
    const repository = { settings: vi.fn(async () => DEFAULT_VOICE_REMINDER_SETTINGS), results: vi.fn() };
    const gateway = { readiness: vi.fn(async () => ({ ready: false, code: 'transport_unavailable' as const })), tryAcquireLine: vi.fn() };
    const requestId = randomUUID();
    const testCalls = {
      enqueue: vi.fn(async (_actor: number, input: { requestId: string; phone: string; clockTime: string }) => ({
        id: input.requestId, phone: input.phone, clockTime: input.clockTime, status: 'waiting' as const,
      })), recover: vi.fn(async () => undefined), current: vi.fn(async () => null),
    };
    const instant = new Date('2030-01-15T22:30:00Z');
    const useCase = new VoiceReminderSettingsService(repository as unknown as VoiceReminderRepository,
      { save: vi.fn(), resolve: vi.fn() }, gateway, undefined, testCalls as unknown as VoiceReminderTestCallRepository, () => instant);
    const visible = await useCase.snapshot(actor);
    expect(Object.keys(visible).sort()).toEqual(['readiness', 'settings']);
    expect(repository.results).not.toHaveBeenCalled();
    gateway.readiness.mockClear();
    for (const [phone, normalized] of [['+123456789', '+123456789'], ['00123456789', '+123456789'], ['90 123 45 67', '+998901234567']]) {
      expect(await useCase.requestTestCall(actor, { requestId, phone, clockTime: '11:00' })).toMatchObject({ id: requestId, phone: normalized });
      expect(testCalls.enqueue).toHaveBeenLastCalledWith(1, { requestId, phone: normalized, clockTime: '11:00', reminderKind: 'same_day' },
        instant, new Date(instant.getTime() + 600_000));
    }
    expect(gateway.readiness).not.toHaveBeenCalled(); expect(gateway.tryAcquireLine).not.toHaveBeenCalled();
    expect(await useCase.currentTestCall(actor)).toBeNull();
    expect(testCalls.current).toHaveBeenCalledWith(1);
    await expect(useCase.requestTestCall({ ...actor, isLeadership: false }, { requestId, phone: '+123456789', clockTime: '11:00' }))
      .rejects.toMatchObject({ code: 'accessDenied' });
  });
});
