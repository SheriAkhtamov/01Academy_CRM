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
import type { StoredVoiceReminderAudio, StoredVoiceReminderAudioLibrary, VoiceReminderRepository } from '../server/modules/voice-reminders/application/ports';

const snapshot = {
  settings: DEFAULT_VOICE_REMINDER_SETTINGS, readiness: { ready: false, code: 'audio_missing' },
  summary: { waiting: 0, calling: 0, played: 0, unanswered: 0, failed: 0, cancelled: 0 }, results: [],
};
const service = { snapshot: vi.fn(), save: vi.fn(), upload: vi.fn(), playback: vi.fn(),
  uploadPart: vi.fn(), playbackPart: vi.fn(), removeTime: vi.fn(), preview: vi.fn() };
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
  service.upload.mockResolvedValue(snapshot); service.uploadPart.mockResolvedValue(snapshot); service.removeTime.mockResolvedValue(snapshot); });

describe('voice reminder HTTP boundary', () => {
  it('requires leadership for settings, results and recording access before reading bytes', async () => {
    for (const module of [null, 'sales'] as const) {
      for (const endpoint of ['', '/audio', '/audio/intro', '/audio/outro', '/audio/times/11:00', '/preview/11:00']) {
        const response = await request(app(module)).get(`/api/academy/voice-reminders${endpoint}`);
        expect(response.status).toBe(module === null ? 401 : 403);
      }
      const upload = await request(app(module)).post('/api/academy/voice-reminders/audio').attach('file', Buffer.from('bytes'), 'demo.wav');
      expect(upload.status).toBe(module === null ? 401 : 403);
      for (const endpoint of ['intro', 'outro', 'times/11:00']) {
        expect((await request(app(module)).post(`/api/academy/voice-reminders/audio/${endpoint}`).attach('file', Buffer.from('bytes'), 'demo.wav')).status).toBe(module === null ? 401 : 403);
      }
      expect((await request(app(module)).delete('/api/academy/voice-reminders/audio/times/11:00')).status).toBe(module === null ? 401 : 403);
    }
    expect(service.snapshot).not.toHaveBeenCalled(); expect(service.upload).not.toHaveBeenCalled();
  });

  it('passes a normalized leadership actor and makes private results non-cacheable', async () => {
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
    for (const [endpoint, target] of [['intro', { part: 'intro' }], ['outro', { part: 'outro' }], ['times/11%3A00', { part: 'time', time: '11:00' }]] as const) {
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
      expect(service.preview).toHaveBeenCalledWith(expect.anything(), '11:00');
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
});

describe('voice reminder enablement', () => {
  it('requires audio and a ready transport while allowing disablement on transport failures', async () => {
    const repository = {
      currentAudio: vi.fn(async () => null), saveSettings: vi.fn(async () => undefined),
      audioLibrary: vi.fn(async (): Promise<StoredVoiceReminderAudioLibrary> => ({ intro: null, outro: null, times: [] })),
      settings: vi.fn(async () => DEFAULT_VOICE_REMINDER_SETTINGS),
      results: vi.fn(async () => ({ summary: snapshot.summary, results: [] })),
    };
    const gateway = { readiness: vi.fn(async () => ({ ready: true, code: 'ready' as const })), tryAcquireLine: vi.fn() };
    const useCase = new VoiceReminderSettingsService(repository as unknown as VoiceReminderRepository, { save: vi.fn(), resolve: vi.fn() }, gateway);
    const actor = { userId: 1, primaryModule: 'administration' as const, modules: ['administration' as const], isLeadership: true };
    const { audio: _audio, audioLibrary: _library, timeZone: _timeZone, ...input } = DEFAULT_VOICE_REMINDER_SETTINGS;
    await expect(useCase.save(actor, { ...input, enabled: true })).rejects.toMatchObject({ code: 'voiceReminderAudioRequired' });
    expect(repository.saveSettings).not.toHaveBeenCalled();
    const audio = { id: 'present', durationSeconds: 1 } as StoredVoiceReminderAudio;
    repository.audioLibrary.mockResolvedValue({ intro: audio, outro: audio, times: [{ time: '11:00', audio }] });
    gateway.readiness.mockRejectedValue(new Error('Provider offline'));
    await expect(useCase.save(actor, { ...input, enabled: true })).rejects.toMatchObject({ code: 'voiceReminderTransportUnavailable' });
    await useCase.save(actor, input);
    expect(repository.saveSettings).toHaveBeenCalledWith(input, 1);
  });

  it('previews immutable ordered parts and rejects combined duration before saving a replacement', async () => {
    const actor = { userId: 1, primaryModule: 'administration' as const, modules: ['administration' as const], isLeadership: true };
    const audio = (name: string, durationSeconds = 1): StoredVoiceReminderAudio => ({ id: randomUUID(), fileName: `${name}.wav`,
      mimeType: 'audio/wav', sizeBytes: 24, durationSeconds, uploadedAt: new Date().toISOString(), storageKey: `${name}.wav`, sha256: 'a'.repeat(64) });
    const library = { intro: audio('intro'), outro: audio('outro'), times: [{ time: '11:00', audio: audio('time') }] };
    const repository = { audioLibrary: vi.fn(async () => library), saveLibraryAudio: vi.fn() };
    const store = { save: vi.fn(async () => audio('large', 179)), resolve: vi.fn() };
    const composer = { compose: vi.fn(async () => ({ path: '/private/assembled.wav', mimeType: 'audio/wav' as const })) };
    const useCase = new VoiceReminderSettingsService(repository as unknown as VoiceReminderRepository, store, { readiness: vi.fn(), tryAcquireLine: vi.fn() }, composer);
    await expect(useCase.preview(actor, '11:00')).resolves.toEqual({ path: '/private/assembled.wav', mimeType: 'audio/wav' });
    expect(composer.compose).toHaveBeenCalledWith({ intro: library.intro, time: library.times[0].audio, outro: library.outro, clockTime: '11:00' });
    await expect(useCase.uploadPart(actor, { part: 'time', time: '11:00' }, { bytes: Buffer.from('audio'), originalName: 'long.wav', mimeType: 'audio/wav' }, library.times[0].audio.id)).rejects.toMatchObject({ code: 'voiceReminderAudioTooLong' });
    expect(repository.saveLibraryAudio).not.toHaveBeenCalled();
    await expect(useCase.preview(actor, '12:00')).rejects.toMatchObject({ code: 'voiceReminderAudioRequired' });
    expect(composer.compose).toHaveBeenCalledTimes(1);
  });
});
