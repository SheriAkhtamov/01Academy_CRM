import { Router, type Request, type RequestHandler } from 'express';
import { canAccessAcademyModule, hasLeadershipAccess } from '@shared/academy';
import { voiceReminderAudioIdSchema } from '@shared/contracts/voice-reminders';
import { requireAuth } from '../middleware/auth.middleware';
import { OnlinePbxError } from '../services/onlinepbx';
import { VoiceReminderCallHistory, type ReminderHistoryRow } from '../services/voice-reminder-call-history';
import { isAllowedOnlinePbxRecordingUrl, proxyOnlinePbxRecording } from './telephony-recording.routes';

const router = Router();
const history = new VoiceReminderCallHistory();

export const loadAuthorizedVoiceReminderRecording = async (
  callId: string, user: NonNullable<Request['user']>,
): Promise<ReminderHistoryRow | null> => {
  return history.readAuthorized(callId,user);
};

const allowedStoredUrl = (row: ReminderHistoryRow) => {
  if (row.recordingProviderId!==(row.providerId ?? row.callId) || !row.recordingUrl) return false;
  try { return isAllowedOnlinePbxRecordingUrl(new URL(row.recordingUrl)); }
  catch { return false; }
};

const recordingRoute = (media: boolean): RequestHandler => async (req,res,next) => {
  try {
    const parsed = voiceReminderAudioIdSchema.safeParse(req.params.id);
    if (!parsed.success) return void res.status(400).json({ error:'onlinePbxInvalidCallId' });
    if (!hasLeadershipAccess(req.user) && !canAccessAcademyModule(req.user,'sales')) {
      return void res.status(403).json({ error:'salesAccessRequired' });
    }
    const callId = parsed.data;
    const call = await loadAuthorizedVoiceReminderRecording(callId,req.user!);
    if (!call) return void res.status(404).json({ error:'onlinePbxCallNotFound' });
    res.setHeader('Cache-Control','private, no-store');
    if (!call.recordingStorageKey) await history.hydrate(callId);
    // Provider lookup/download can outlive a lead reassignment or merge.
    const current = await loadAuthorizedVoiceReminderRecording(callId,req.user!);
    if (!current) return void res.status(404).json({ error:'onlinePbxCallNotFound' });
    if (!current.recordingStorageKey && !allowedStoredUrl(current)) {
      return void res.status(404).json({ error:current.recordingProviderId && current.endedAt && current.talkSeconds===0 && !current.answeredAt && !current.reminderResponse
        ? 'onlinePbxRecordingUnavailable' : 'onlinePbxRecordingPending' });
    }
    if (!media) return void res.json({ url:`/api/telephony/reminder-calls/${callId}/recording/media` });
    if (current.recordingStorageKey) {
      const file = await history.archive.resolve(current.recordingStorageKey);
      if (!await loadAuthorizedVoiceReminderRecording(callId,req.user!)) {
        return void res.status(404).json({ error:'onlinePbxCallNotFound' });
      }
      res.setHeader('Content-Type',current.recordingMimeType ?? 'audio/mpeg');
      return void res.sendFile(file);
    }
    await proxyOnlinePbxRecording(current.recordingUrl!,req,res,
      async () => Boolean(await loadAuthorizedVoiceReminderRecording(callId,req.user!)));
  } catch (error) {
    if (res.headersSent) { if (!res.destroyed) res.destroy(); return; }
    if (error instanceof OnlinePbxError) {
      res.status(error.statusCode).json({ error:error.clientCode });
      return;
    }
    next(error);
  }
};

router.get('/reminder-calls/:id/recording',requireAuth,recordingRoute(false));
router.get('/reminder-calls/:id/recording/media',requireAuth,recordingRoute(true));
export default router;
