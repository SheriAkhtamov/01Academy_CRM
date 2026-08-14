import { Readable, Transform, pipeline } from 'node:stream';
import { Router, type Request, type RequestHandler } from 'express';
import { canAccessAcademyModule, hasLeadershipAccess } from '@shared/academy';
import { appConfig } from '../config';
import { pool } from '../db';
import { logger } from '../lib/logger';
import { requireAuth } from '../middleware/auth.middleware';
import { OnlinePbxError } from '../services/onlinepbx';
import { resolveOnlinePbxRecording } from '../services/telephony-recording';

const router = Router();
const ONLINE_PBX_RECORDING_MAX_BYTES = 100 * 1024 * 1024;
const ONLINE_PBX_RECORDING_TIMEOUT_MS = 20_000;
const ONLINE_PBX_RECORDING_MAX_REDIRECTS = 2;
const configuredOnlinePbxApiUrl =
  appConfig.integrations?.onlinePbx?.apiUrl?.trim() || 'https://api2.onlinepbx.ru';
const configuredOnlinePbxMediaOrigin = new URL(configuredOnlinePbxApiUrl).origin;

export const isAllowedOnlinePbxRecordingUrl = (url: URL) => (
  url.protocol === 'https:'
  && !url.username
  && !url.password
  && url.origin === configuredOnlinePbxMediaOrigin
  && url.pathname.startsWith('/calls-records/download/')
);

const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

export type RecordingCallRow = {
  id: number;
  userId: number | null;
  providerCallId: string | null;
  direction: 'incoming' | 'outgoing';
  phone: string;
  startedAt: string | Date;
  talkSeconds: number;
  recordingUrl: string | null;
  leadId: number | null;
  leadManagerId: number | null;
};

/**
 * Recordings and call notes answer to the same question — was this manager on
 * this conversation — so both routes gate on this one lookup.
 */
export const loadAuthorizedRecordingCall = async (
  callId: number,
  user: NonNullable<Request['user']>,
): Promise<RecordingCallRow | null> => {
  const result = await pool.query(
    `SELECT call.id, call.user_id AS "userId", call.provider_call_id AS "providerCallId",
            call.direction, call.phone, call.started_at AS "startedAt",
            call.talk_seconds AS "talkSeconds",
            call.recording_url AS "recordingUrl",
            lead_id AS "leadId", lead.manager_id AS "leadManagerId"
     FROM telephony_calls call
     LEFT JOIN academy_leads lead ON lead.id = call.lead_id
     WHERE call.id = $1`,
    [callId],
  );
  const call = result.rows[0] as RecordingCallRow | undefined;
  const canReadRecording = Boolean(call) && (
    Number(call!.userId) === user.id
    || hasLeadershipAccess(user)
    || (
      canAccessAcademyModule(user, 'sales')
      && call!.leadId
      && (call!.leadManagerId == null || Number(call!.leadManagerId) === user.id)
    )
  );
  return call && canReadRecording ? call : null;
};

const resolveAndStoreOnlinePbxRecording = async (
  call: RecordingCallRow,
) => {
  const storedRecordingUrl = (() => {
    const value = call.recordingUrl?.trim();
    if (!value) return null;
    try {
      const url = new URL(value);
      return isAllowedOnlinePbxRecordingUrl(url) ? url.toString() : null;
    } catch {
      return null;
    }
  })();

  let recording: Awaited<ReturnType<typeof resolveOnlinePbxRecording>>;
  try {
    recording = await resolveOnlinePbxRecording(call);
  } catch (error) {
    if (storedRecordingUrl) {
      logger.warn('Using stored OnlinePBX recording URL after refresh failed', {
        callId: call.id,
      });
      return { state: 'ready' as const, url: storedRecordingUrl };
    }
    throw error;
  }
  if (recording.state !== 'ready') {
    return storedRecordingUrl
      ? { state: 'ready' as const, url: storedRecordingUrl }
      : recording;
  }

  await pool.query(
    `UPDATE telephony_calls
     SET provider_call_id = COALESCE(provider_call_id, $2),
         duration_seconds = GREATEST(duration_seconds, $3),
         talk_seconds = GREATEST(talk_seconds, $4),
         hangup_cause = COALESCE(NULLIF($5, ''), hangup_cause),
         recording_url = $6,
         updated_at = NOW()
     WHERE id = $1`,
    [
      call.id,
      recording.providerCallId,
      recording.history?.duration ?? 0,
      recording.history?.talkTime ?? 0,
      recording.history?.hangupCause ?? null,
      recording.url,
    ],
  );
  return recording;
};

const respondWithRecordingResolutionError = (
  res: Parameters<RequestHandler>[1],
  state: 'pending' | 'unavailable',
) => res.status(404).json({
  error: state === 'pending'
    ? 'onlinePbxRecordingPending'
    : 'onlinePbxRecordingUnavailable',
});

const proxyOnlinePbxRecording = async (
  recordingUrl: string,
  req: Request,
  res: Parameters<RequestHandler>[1],
) => {
  let currentUrl: URL;
  try {
    currentUrl = new URL(recordingUrl);
  } catch {
    return res.status(502).json({ error: 'onlinePbxRecordingUnavailable' });
  }
  if (!isAllowedOnlinePbxRecordingUrl(currentUrl)) {
    return res.status(502).json({ error: 'onlinePbxRecordingUnavailable' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ONLINE_PBX_RECORDING_TIMEOUT_MS);
  timeout.unref();
  res.once('close', () => controller.abort());
  const headers: Record<string, string> = {
    Accept: 'audio/mpeg,audio/*;q=0.9,*/*;q=0.1',
    'User-Agent': '01AcademyCRM/1.0',
  };
  if (
    typeof req.headers.range === 'string'
    && /^bytes=(?:\d+-\d*|\d*-\d+)$/.test(req.headers.range)
  ) {
    headers.Range = req.headers.range;
  }

  let upstream: Response | null = null;
  for (
    let redirectCount = 0;
    redirectCount <= ONLINE_PBX_RECORDING_MAX_REDIRECTS;
    redirectCount += 1
  ) {
    upstream = await fetch(currentUrl, {
      headers,
      redirect: 'manual',
      signal: controller.signal,
    });
    if (upstream.status < 300 || upstream.status >= 400) break;

    const location = upstream.headers.get('location');
    if (!location || redirectCount === ONLINE_PBX_RECORDING_MAX_REDIRECTS) {
      clearTimeout(timeout);
      return res.status(502).json({ error: 'onlinePbxRecordingUnavailable' });
    }
    const redirectUrl = new URL(location, currentUrl);
    if (!isAllowedOnlinePbxRecordingUrl(redirectUrl)) {
      clearTimeout(timeout);
      return res.status(502).json({ error: 'onlinePbxRecordingUnavailable' });
    }
    currentUrl = redirectUrl;
  }

  if (!upstream?.ok) {
    clearTimeout(timeout);
    return res.status(502).json({ error: 'onlinePbxRecordingUnavailable' });
  }
  const contentType = upstream.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('audio/')) {
    clearTimeout(timeout);
    return res.status(502).json({ error: 'onlinePbxRecordingUnavailable' });
  }
  const contentLengthValue = upstream.headers.get('content-length');
  const contentLength = contentLengthValue ? Number(contentLengthValue) : null;
  if (
    contentLength !== null
    && (
      !Number.isSafeInteger(contentLength)
      || contentLength < 0
      || contentLength > ONLINE_PBX_RECORDING_MAX_BYTES
    )
  ) {
    clearTimeout(timeout);
    return res.status(413).json({ error: 'onlinePbxRecordingUnavailable' });
  }

  res.status(upstream.status);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', 'inline; filename="recording.mp3"');
  res.setHeader('Cache-Control', 'private, no-store');
  if (contentLengthValue) res.setHeader('Content-Length', contentLengthValue);
  const contentRange = upstream.headers.get('content-range');
  const acceptRanges = upstream.headers.get('accept-ranges');
  if (contentRange) res.setHeader('Content-Range', contentRange);
  if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);

  if (!upstream.body) {
    clearTimeout(timeout);
    return res.end();
  }

  let receivedBytes = 0;
  const byteLimiter = new Transform({
    transform(chunk, _encoding, callback) {
      receivedBytes += Buffer.byteLength(chunk);
      if (receivedBytes > ONLINE_PBX_RECORDING_MAX_BYTES) {
        callback(new Error('OnlinePBX recording exceeds proxy limit'));
        return;
      }
      callback(null, chunk);
    },
  });
  pipeline(Readable.fromWeb(upstream.body as never), byteLimiter, res, (error) => {
    clearTimeout(timeout);
    if (error) {
      controller.abort();
      logger.warn('OnlinePBX recording stream stopped', {
        host: currentUrl.hostname,
        reason: error.message,
      });
      if (!res.destroyed) res.destroy();
    }
  });
  return undefined;
};

router.get('/calls/:id/recording', requireAuth, asyncRoute(async (req, res) => {
  const callId = Number(req.params.id);
  if (!Number.isInteger(callId) || callId <= 0) {
    return res.status(400).json({ error: 'onlinePbxInvalidCallId' });
  }
  const call = await loadAuthorizedRecordingCall(callId, req.user!);
  if (!call) {
    return res.status(404).json({ error: 'onlinePbxCallNotFound' });
  }
  res.setHeader('Cache-Control', 'no-store, private');

  try {
    const recording = await resolveAndStoreOnlinePbxRecording(call);
    if (recording.state !== 'ready') {
      return respondWithRecordingResolutionError(res, recording.state);
    }
    res.json({ url: `/api/telephony/calls/${callId}/recording/media` });
  } catch (error) {
    const clientCode = error instanceof OnlinePbxError ? error.clientCode : 'onlinePbxRecordingUnavailable';
    const statusCode = error instanceof OnlinePbxError ? error.statusCode : 502;
    res.status(statusCode).json({ error: clientCode });
  }
}));

router.get('/calls/:id/recording/media', requireAuth, asyncRoute(async (req, res) => {
  const callId = Number(req.params.id);
  if (!Number.isInteger(callId) || callId <= 0) {
    return res.status(400).json({ error: 'onlinePbxInvalidCallId' });
  }
  const call = await loadAuthorizedRecordingCall(callId, req.user!);
  if (!call) {
    return res.status(404).json({ error: 'onlinePbxCallNotFound' });
  }

  try {
    const recording = await resolveAndStoreOnlinePbxRecording(call);
    if (recording.state !== 'ready') {
      return respondWithRecordingResolutionError(res, recording.state);
    }
    return await proxyOnlinePbxRecording(recording.url, req, res);
  } catch (error) {
    if (res.headersSent) {
      if (!res.destroyed) res.destroy();
      return;
    }
    const clientCode = error instanceof OnlinePbxError
      ? error.clientCode
      : 'onlinePbxRecordingUnavailable';
    const statusCode = error instanceof OnlinePbxError ? error.statusCode : 502;
    res.status(statusCode).json({ error: clientCode });
  }
}));

export default router;
