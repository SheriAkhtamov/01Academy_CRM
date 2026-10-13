import { Router, type Response } from 'express';
import multer from 'multer';
import { VOICE_REMINDER_MAX_AUDIO_BYTES, voiceReminderSettingsSchema } from '@shared/contracts/voice-reminders';
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

  router.post('/voice-reminders/audio', (request, response) => {
    upload(request, response, (error: unknown) => {
      if (error) {
        const tooLarge = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE';
        response.status(tooLarge ? 413 : 400).json({ error: tooLarge ? 'voiceReminderAudioTooLarge' : 'voiceReminderAudioInvalid' });
        return;
      }
      if (!request.file) { response.status(400).json({ error: 'voiceReminderAudioRequired' }); return; }
      void service.upload(actorContextFrom(request), {
        bytes: request.file.buffer, originalName: request.file.originalname, mimeType: request.file.mimetype,
      }).then(result => response.json(result)).catch(failure => { sendError(response, failure); });
    });
  });

  router.get('/voice-reminders/audio', async (request, response) => {
    try {
      const file = await service.playback(actorContextFrom(request));
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.type(file.mimeType).sendFile(file.path, { acceptRanges: true }, error => {
        if (error && !response.headersSent) response.status(404).json({ error: 'resourceNotFound' });
      });
    } catch (error) { sendError(response, error); }
  });
  return router;
};
