import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VOICE_REMINDER_SETTINGS } from '../shared/contracts/voice-reminders';
import { createVoiceReminderRouter } from '../server/modules/voice-reminders/http/voice-reminders.router';
import { VoiceReminderSettingsService } from '../server/modules/voice-reminders/application/settings-service';
import type { VoiceReminderRepository } from '../server/modules/voice-reminders/application/ports';

const snapshot = {
  settings: DEFAULT_VOICE_REMINDER_SETTINGS, readiness: { ready: false, code: 'audio_missing' },
  summary: { waiting: 0, calling: 0, played: 0, unanswered: 0, failed: 0, cancelled: 0 }, results: [],
};
const service = { snapshot: vi.fn(), save: vi.fn(), upload: vi.fn(), playback: vi.fn() };
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
beforeEach(() => { vi.clearAllMocks(); service.snapshot.mockResolvedValue(snapshot); service.save.mockResolvedValue(snapshot); service.upload.mockResolvedValue(snapshot); });

describe('voice reminder HTTP boundary', () => {
  it('requires leadership for settings, results and recording access before reading bytes', async () => {
    for (const module of [null, 'sales'] as const) {
      for (const endpoint of ['', '/audio']) {
        const response = await request(app(module)).get(`/api/academy/voice-reminders${endpoint}`);
        expect(response.status).toBe(module === null ? 401 : 403);
      }
      const upload = await request(app(module)).post('/api/academy/voice-reminders/audio').attach('file', Buffer.from('bytes'), 'demo.wav');
      expect(upload.status).toBe(module === null ? 401 : 403);
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
    const { audio: _audio, timeZone: _timeZone, ...input } = DEFAULT_VOICE_REMINDER_SETTINGS;
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
});

describe('voice reminder enablement', () => {
  it('requires audio and a ready transport while allowing disablement on transport failures', async () => {
    const repository = {
      currentAudio: vi.fn(async () => null), saveSettings: vi.fn(async () => undefined),
      settings: vi.fn(async () => DEFAULT_VOICE_REMINDER_SETTINGS),
      results: vi.fn(async () => ({ summary: snapshot.summary, results: [] })),
    };
    const gateway = { readiness: vi.fn(async () => ({ ready: true, code: 'ready' as const })), tryAcquireLine: vi.fn() };
    const useCase = new VoiceReminderSettingsService(repository as unknown as VoiceReminderRepository, { save: vi.fn(), resolve: vi.fn() }, gateway);
    const actor = { userId: 1, primaryModule: 'administration' as const, modules: ['administration' as const], isLeadership: true };
    const { audio: _audio, timeZone: _timeZone, ...input } = DEFAULT_VOICE_REMINDER_SETTINGS;
    await expect(useCase.save(actor, { ...input, enabled: true })).rejects.toMatchObject({ code: 'voiceReminderAudioRequired' });
    expect(repository.saveSettings).not.toHaveBeenCalled();
    repository.currentAudio.mockResolvedValue({ id: 'present' } as never);
    gateway.readiness.mockRejectedValue(new Error('Provider offline'));
    await expect(useCase.save(actor, { ...input, enabled: true })).rejects.toMatchObject({ code: 'voiceReminderTransportUnavailable' });
    await useCase.save(actor, input);
    expect(repository.saveSettings).toHaveBeenCalledWith(input, 1);
  });
});
