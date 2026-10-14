import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { VOICE_REMINDER_MAX_AUDIO_BYTES, voiceReminderAudioIdSchema, voiceReminderClockTimeSchema, voiceReminderHourSchema, voiceReminderMinuteSchema, voiceReminderSettingsSchema, voiceReminderTestCallSchema } from '@shared/contracts/voice-reminders';
import type { VoiceReminderAudioTarget } from '../application/ports';
import { actorContextFrom } from '../../leads/domain/actor-context';
import type { VoiceReminderSettingsService } from '../application/settings-service';
import { requireVoiceReminderLeadership, VoiceReminderError } from '../domain/policy';

const sendError = (response: Response, error: unknown) => {
  if (error instanceof VoiceReminderError) return response.status(error.statusCode).json({ error: error.code });
  return response.status(500).json({ error: 'voiceReminderSaveFailed' });
};

export const createVoiceReminderRouter = (service: VoiceReminderSettingsService) => {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: VOICE_REMINDER_MAX_AUDIO_BYTES, files: 1, fields: 0, parts: 1 },
  }).single('file');
  const expectedFrom = (request: Request, response: Response, required = false): { id: string | null } | null => {
    if (request.query.expectedId === undefined && !required) return { id: null };
    const parsed = voiceReminderAudioIdSchema.safeParse(request.query.expectedId);
    if (!parsed.success) { response.status(400).json({ error: 'voiceReminderAudioInvalid' }); return null; }
    return { id: parsed.data };
  };
  const streamFile = async (response: Response, action: () => Promise<{ path: string; mimeType: string }>) => {
    try {
      const file = await action();
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.type(file.mimeType).sendFile(file.path, { acceptRanges: true }, error => {
        if (error && !response.headersSent) response.status(404).json({ error: 'resourceNotFound' });
      });
    } catch (error) { sendError(response, error); }
  };
  const uploadPart = (request: Request, response: Response, target?: VoiceReminderAudioTarget) => {
    const expected = target ? expectedFrom(request, response) : { id: null };
    if (!expected) return;
    upload(request, response, (error: unknown) => {
      if (error) {
        const tooLarge = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE';
        response.status(tooLarge ? 413 : 400).json({ error: tooLarge ? 'voiceReminderAudioTooLarge' : 'voiceReminderAudioInvalid' });
        return;
      }
      if (!request.file) { response.status(400).json({ error: 'voiceReminderAudioRequired' }); return; }
      const input = { bytes: request.file.buffer, originalName: request.file.originalname, mimeType: request.file.mimetype };
      const action = target ? service.uploadPart(actorContextFrom(request), target, input, expected.id) : service.upload(actorContextFrom(request), input);
      void action.then(result => response.json(result)).catch(failure => { sendError(response, failure); });
    });
  };
  const timeFrom = (request: Request, response: Response): string | null => {
    const parsed = voiceReminderClockTimeSchema.safeParse(request.params.time);
    if (!parsed.success) { response.status(400).json({ error: 'voiceReminderInvalidTime' }); return null; }
    return parsed.data;
  };

  router.use('/voice-reminders', (request, response, next) => {
    try {
      requireVoiceReminderLeadership(actorContextFrom(request));
      response.setHeader('Cache-Control', 'no-store');
      next();
    } catch (error) { sendError(response, error); }
  });

  router.get('/voice-reminders', async (request, response) => {
    try { response.json(await service.snapshot(actorContextFrom(request))); }
    catch (error) { sendError(response, error); }
  });

  router.put('/voice-reminders/settings', async (request, response) => {
    const input = voiceReminderSettingsSchema.safeParse(request.body);
    if (!input.success) return response.status(400).json({ error: 'voiceReminderInvalidSettings' });
    try { response.json(await service.save(actorContextFrom(request), input.data)); }
    catch (error) { sendError(response, error); }
  });

  router.post('/voice-reminders/test-calls', async (request, response) => {
    const input = voiceReminderTestCallSchema.safeParse(request.body);
    if (!input.success) return response.status(400).json({ error: 'voiceReminderInvalidTestCall' });
    try { response.json(await service.requestTestCall(actorContextFrom(request), input.data)); }
    catch (error) { sendError(response, error); }
  });
  router.get('/voice-reminders/test-calls/current', async (request, response) => {
    try { response.json(await service.currentTestCall(actorContextFrom(request))); }
    catch (error) { sendError(response, error); }
  });

  router.post('/voice-reminders/audio', (request, response) => uploadPart(request, response));
  router.get('/voice-reminders/audio', (request, response) => streamFile(response, () => service.playback(actorContextFrom(request))));
  for (const part of ['intro', 'outro'] as const) {
    router.post(`/voice-reminders/audio/${part}`, (request, response) => uploadPart(request, response, { part }));
    router.get(`/voice-reminders/audio/${part}`, (request, response) => streamFile(response, () => service.playbackPart(actorContextFrom(request), { part })));
  }
  router.post('/voice-reminders/audio/times/:time', (request, response) => {
    const time = timeFrom(request, response);
    if (time) uploadPart(request, response, { part: 'time', time });
  });
  router.get('/voice-reminders/audio/times/:time', (request, response) => {
    const time = timeFrom(request, response);
    if (time) void streamFile(response, () => service.playbackPart(actorContextFrom(request), { part: 'time', time }));
  });
  router.delete('/voice-reminders/audio/times/:time', async (request, response) => {
    const time = timeFrom(request, response);
    if (!time) return;
    const expected = expectedFrom(request, response, true);
    if (!expected?.id) return;
    try { response.json(await service.removeTime(actorContextFrom(request), time, expected.id)); }
    catch (error) { sendError(response, error); }
  });
  for (const part of ['hour', 'minute'] as const) {
    const base = `/voice-reminders/audio/${part}s/:index`;
    const targetFrom = (request: Request, response: Response) => {
      const schema = part === 'hour' ? voiceReminderHourSchema : voiceReminderMinuteSchema;
      const parsed = schema.safeParse(request.params.index);
      if (!parsed.success) { response.status(400).json({ error: 'voiceReminderInvalidTime' }); return null; }
      return part === 'hour' ? { part, hour: parsed.data } : { part, minute: parsed.data };
    };
    router.post(base, (request, response) => {
      const target = targetFrom(request, response);
      if (target) uploadPart(request, response, target);
    });
    router.get(base, (request, response) => {
      const target = targetFrom(request, response);
      if (target) void streamFile(response, () => service.playbackPart(actorContextFrom(request), target));
    });
    router.delete(base, async (request, response) => {
      const target = targetFrom(request, response);
      if (!target) return;
      const expected = expectedFrom(request, response, true);
      if (!expected?.id) return;
      try { response.json(await service.removePart(actorContextFrom(request), target, expected.id)); }
      catch (error) { sendError(response, error); }
    });
  }
  router.get('/voice-reminders/preview/:time', (request, response) => {
    const time = timeFrom(request, response);
    if (time) void streamFile(response, () => service.preview(actorContextFrom(request), time));
  });
  return router;
};
