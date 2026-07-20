import { timingSafeEqual } from 'crypto';
import { Router, type RequestHandler } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { WebSocketEvent } from '@shared/websocket';
import { appConfig } from '../config';
import { pool } from '../db';
import { logger } from '../lib/logger';
import { requireAuth } from '../middleware/auth.middleware';
import {
  normalizeOnlinePbxPhone,
  onlinePbxClient,
  OnlinePbxError,
  type OnlinePbxCallHistoryItem,
} from '../services/onlinepbx';

const router = Router();
const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

type TelephonyContact = {
  type: 'lead' | 'student';
  id: number;
  name: string;
  secondaryName: string | null;
  phone: string;
};

type CallStatus = 'dialing' | 'ringing' | 'connected' | 'ended' | 'failed' | 'declined' | 'missed';

type CallEventInput = {
  clientCallId: string;
  direction: 'incoming' | 'outgoing';
  status: CallStatus;
  phone: string;
  startedAt?: string;
  answeredAt?: string | null;
  endedAt?: string | null;
  durationSeconds?: number;
  talkSeconds?: number;
  hangupCause?: string | null;
};

type BroadcastFunction = (data: WebSocketEvent) => void;
let broadcastFunction: BroadcastFunction = () => undefined;

export const setTelephonyBroadcastFunction = (fn: BroadcastFunction) => {
  broadcastFunction = fn;
};

const callLimiter = rateLimit({
  windowMs: 1_000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'onlinePbxTooManyCalls' },
  keyGenerator: (req) => req.user?.id
    ? `user:${req.user.id}`
    : ipKeyGenerator(req.ip ?? 'anonymous'),
});

const digitsOnly = (value: unknown) => String(value ?? '').replace(/\D/g, '');

const safeDate = (value: unknown): Date | null => {
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const safeInteger = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
};

const findContactByPhone = async (phone: string): Promise<TelephonyContact | null> => {
  const normalized = normalizeOnlinePbxPhone(phone);
  if (!normalized) return null;
  const digits = digitsOnly(normalized);

  const result = await pool.query<TelephonyContact>(
    `WITH matched_contacts AS (
       SELECT 'student'::text AS type,
              student.id,
              COALESCE(NULLIF(student.student_name, ''), student.contact_name) AS name,
              NULLIF(student.contact_name, '') AS "secondaryName",
              student.phone,
              1 AS priority,
              student.updated_at
       FROM academy_students student
       WHERE regexp_replace(COALESCE(student.phone, ''), '\\D', '', 'g') = $1

       UNION ALL

       SELECT 'lead'::text AS type,
              lead.id,
              COALESCE(NULLIF(lead.student_name, ''), lead.contact_name) AS name,
              NULLIF(lead.contact_name, '') AS "secondaryName",
              phone.phone,
              2 AS priority,
              lead.updated_at
       FROM academy_lead_phones phone
       JOIN academy_leads lead ON lead.id = phone.lead_id
       WHERE regexp_replace(phone.normalized_phone, '\\D', '', 'g') = $1
     )
     SELECT type, id, name, "secondaryName", phone
     FROM matched_contacts
     ORDER BY priority, updated_at DESC
     LIMIT 1`,
    [digits],
  );

  return result.rows[0] ?? null;
};

const isCallEventInput = (value: unknown): value is CallEventInput => {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<CallEventInput>;
  return Boolean(
    typeof event.clientCallId === 'string'
      && event.clientCallId.length > 0
      && event.clientCallId.length <= 255
      && ['incoming', 'outgoing'].includes(String(event.direction))
      && ['dialing', 'ringing', 'connected', 'ended', 'failed', 'declined', 'missed'].includes(String(event.status))
      && normalizeOnlinePbxPhone(event.phone),
  );
};

const upsertClientCall = async (userId: number, extension: string, input: CallEventInput) => {
  const phone = normalizeOnlinePbxPhone(input.phone)!;
  const contact = await findContactByPhone(phone);
  const startedAt = safeDate(input.startedAt) ?? new Date();
  const answeredAt = safeDate(input.answeredAt);
  const endedAt = safeDate(input.endedAt);
  const values = [
    input.clientCallId,
    userId,
    extension,
    input.direction,
    input.status,
    phone,
    contact?.type ?? null,
    contact?.id ?? null,
    contact?.name ?? null,
    startedAt,
    answeredAt,
    endedAt,
    safeInteger(input.durationSeconds),
    safeInteger(input.talkSeconds),
    input.hangupCause?.slice(0, 120) || null,
  ];
  const returning = `
    id, client_call_id AS "clientCallId", provider_call_id AS "providerCallId",
    user_id AS "userId", extension, direction, status, phone,
    contact_type AS "contactType", contact_id AS "contactId",
    contact_name AS "contactName", started_at AS "startedAt",
    answered_at AS "answeredAt", ended_at AS "endedAt",
    duration_seconds AS "durationSeconds", talk_seconds AS "talkSeconds",
    hangup_cause AS "hangupCause", recording_url AS "recordingUrl"`;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.clientCallId]);
    let result = await client.query(
      `UPDATE telephony_calls
       SET client_call_id = COALESCE(client_call_id, $1),
           user_id = $2,
           extension = $3,
           direction = $4,
           status = CASE
             WHEN status IN ('ended', 'failed', 'declined', 'missed')
              AND $5 NOT IN ('ended', 'failed', 'declined', 'missed') THEN status
             ELSE $5
           END,
           phone = $6,
           contact_type = COALESCE(contact_type, $7),
           contact_id = COALESCE(contact_id, $8),
           contact_name = COALESCE(contact_name, $9),
           started_at = LEAST(started_at, $10),
           answered_at = COALESCE(answered_at, $11),
           ended_at = COALESCE($12, ended_at),
           duration_seconds = GREATEST(duration_seconds, $13),
           talk_seconds = GREATEST(talk_seconds, $14),
           hangup_cause = COALESCE($15, hangup_cause),
           updated_at = NOW()
       WHERE client_call_id = $1 OR provider_call_id = $1
       RETURNING ${returning}`,
      values,
    );

    if (!result.rowCount) {
      result = await client.query(
        `INSERT INTO telephony_calls (
           client_call_id, user_id, extension, direction, status, phone,
           contact_type, contact_id, contact_name, started_at, answered_at,
           ended_at, duration_seconds, talk_seconds, hangup_cause
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING ${returning}`,
        values,
      );
    }

    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const providerEventStatus = (event: string, talkSeconds: number): CallStatus => {
  const normalized = event.toLowerCase();
  if (normalized.includes('answer')) return 'connected';
  if (normalized.includes('miss')) return 'missed';
  if (normalized.includes('reject') || normalized.includes('decline')) return 'declined';
  if (normalized.includes('end') || normalized.includes('hangup')) return talkSeconds > 0 ? 'ended' : 'failed';
  return 'ringing';
};

const hasValidWebhookSecret = (candidate: unknown) => {
  const expected = appConfig.integrations?.onlinePbx?.webhookSecret?.trim();
  if (!expected || typeof candidate !== 'string') return false;
  const actualBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
};

router.post('/webhook', asyncRoute(async (req, res) => {
  if (!hasValidWebhookSecret(req.query.token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const payload = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  const providerCallId = String(payload.uuid ?? '').trim();
  const event = String(payload.event ?? 'call_start');
  if (!providerCallId || providerCallId.length > 120) {
    return res.status(400).json({ error: 'onlinePbxInvalidWebhook' });
  }

  const candidates = [
    payload.caller,
    payload.callee,
    payload.callee_from,
    payload.callee_to,
  ].map(digitsOnly).filter(Boolean);
  const extensionResult = await pool.query<{ id: number; extension: string }>(
    `SELECT id, online_pbx_extension AS extension
     FROM users
     WHERE is_active = true AND online_pbx_extension = ANY($1::text[])
     LIMIT 1`,
    [candidates],
  );
  const employee = extensionResult.rows[0] ?? null;
  const trunk = '998787070171';
  const phoneDigits = candidates.find((value) => value.length >= 7 && value !== trunk) ?? '';
  const phone = normalizeOnlinePbxPhone(phoneDigits);
  if (!phone) return res.status(200).json({ ok: true, ignored: true });

  const contact = await findContactByPhone(phone);
  const direction = String(payload.direction ?? '').toLowerCase().includes('out') ? 'outgoing' : 'incoming';
  const durationSeconds = safeInteger(payload.call_duration);
  const talkSeconds = safeInteger(payload.dialog_duration);
  const status = providerEventStatus(event, talkSeconds);
  const startedAtSeconds = safeInteger(payload.date);
  const startedAt = startedAtSeconds > 0 ? new Date(startedAtSeconds * 1000) : new Date();
  const endedAt = ['ended', 'failed', 'declined', 'missed'].includes(status) ? new Date() : null;

  const values = [
    providerCallId,
    employee?.id ?? null,
    employee?.extension ?? null,
    direction,
    status,
    phone,
    contact?.type ?? null,
    contact?.id ?? null,
    contact?.name ?? null,
    startedAt,
    endedAt,
    durationSeconds,
    talkSeconds,
    String(payload.hangup_cause ?? '').slice(0, 120) || null,
    String(payload.download_url ?? '').startsWith('https://') ? String(payload.download_url) : null,
    JSON.stringify({ event, hangupBy: payload.hangup_by ?? null }),
  ];
  const returning = `id, status, direction, phone,
    contact_type AS "contactType", contact_id AS "contactId", contact_name AS "contactName",
    duration_seconds AS "durationSeconds", talk_seconds AS "talkSeconds"`;
  const client = await pool.connect();
  let call: Record<string, unknown> | undefined;

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [providerCallId]);
    let result = await client.query(
      `UPDATE telephony_calls
       SET provider_call_id = COALESCE(provider_call_id, $1),
           user_id = COALESCE(user_id, $2),
           extension = COALESCE(extension, $3),
           direction = $4,
           status = CASE
             WHEN status IN ('ended', 'failed', 'declined', 'missed')
              AND $5 NOT IN ('ended', 'failed', 'declined', 'missed') THEN status
             ELSE $5
           END,
           phone = $6,
           contact_type = COALESCE(contact_type, $7),
           contact_id = COALESCE(contact_id, $8),
           contact_name = COALESCE(contact_name, $9),
           started_at = LEAST(started_at, $10),
           ended_at = COALESCE($11, ended_at),
           duration_seconds = GREATEST(duration_seconds, $12),
           talk_seconds = GREATEST(talk_seconds, $13),
           hangup_cause = COALESCE($14, hangup_cause),
           recording_url = COALESCE($15, recording_url),
           metadata = metadata || $16::jsonb,
           updated_at = NOW()
       WHERE provider_call_id = $1 OR client_call_id = $1
       RETURNING ${returning}`,
      values,
    );

    if (!result.rowCount) {
      result = await client.query(
        `INSERT INTO telephony_calls (
           provider_call_id, user_id, extension, direction, status, phone,
           contact_type, contact_id, contact_name, started_at, ended_at,
           duration_seconds, talk_seconds, hangup_cause, recording_url, metadata
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
         RETURNING ${returning}`,
        values,
      );
    }

    call = result.rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  if (employee) {
    broadcastFunction({
      type: 'TELEPHONY_CALL_UPDATED',
      data: call ?? {},
      audienceUserIds: [employee.id],
    });
  }

  res.json({ ok: true });
}));

router.get('/credentials', requireAuth, asyncRoute(async (req, res) => {
  const extension = String(req.user?.onlinePbxExtension ?? '').trim();
  if (!/^\d{2,10}$/.test(extension)) {
    return res.status(422).json({ error: 'onlinePbxExtensionMissing' });
  }

  try {
    const credentials = await onlinePbxClient.getWebRtcCredentials(extension);
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Pragma', 'no-cache');
    res.json(credentials);
  } catch (error) {
    const clientCode = error instanceof OnlinePbxError ? error.clientCode : 'onlinePbxWebRtcUnavailable';
    const statusCode = error instanceof OnlinePbxError ? error.statusCode : 502;
    logger.warn('OnlinePBX WebRTC credentials could not be loaded', {
      userId: req.user?.id,
      extension,
      providerCode: error instanceof OnlinePbxError ? error.providerCode : undefined,
    });
    res.status(statusCode).json({ error: clientCode });
  }
}));

router.get('/extensions', requireAuth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT id, full_name AS "name", online_pbx_extension AS "extension"
     FROM users
     WHERE is_active = true
       AND online_pbx_extension IS NOT NULL
       AND online_pbx_extension <> ''
       AND id <> $1
     ORDER BY full_name`,
    [req.user!.id],
  );
  res.json(result.rows);
}));

router.get('/contacts/lookup', requireAuth, asyncRoute(async (req, res) => {
  const phone = normalizeOnlinePbxPhone(req.query.phone);
  if (!phone) return res.status(400).json({ error: 'onlinePbxInvalidPhone' });
  res.json({ phone, contact: await findContactByPhone(phone) });
}));

router.post('/calls/events', requireAuth, callLimiter, asyncRoute(async (req, res) => {
  if (!isCallEventInput(req.body)) {
    return res.status(400).json({ error: 'onlinePbxInvalidCallEvent' });
  }
  const extension = String(req.user?.onlinePbxExtension ?? '').trim();
  if (!/^\d{2,10}$/.test(extension)) {
    return res.status(422).json({ error: 'onlinePbxExtensionMissing' });
  }

  const call = await upsertClientCall(req.user!.id, extension, req.body);
  broadcastFunction({
    type: 'TELEPHONY_CALL_UPDATED',
    data: call,
    audienceUserIds: [req.user!.id],
  });
  res.status(202).json(call);
}));

router.get('/calls', requireAuth, asyncRoute(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  const result = await pool.query(
    `SELECT id, client_call_id AS "clientCallId", provider_call_id AS "providerCallId",
            user_id AS "userId", extension, direction, status, phone,
            contact_type AS "contactType", contact_id AS "contactId",
            contact_name AS "contactName", started_at AS "startedAt",
            answered_at AS "answeredAt", ended_at AS "endedAt",
            duration_seconds AS "durationSeconds", talk_seconds AS "talkSeconds",
            hangup_cause AS "hangupCause",
            recording_url IS NOT NULL AS "hasRecording"
     FROM telephony_calls
     WHERE user_id = $1
     ORDER BY started_at DESC
     LIMIT $2`,
    [req.user!.id, limit],
  );
  res.json(result.rows);
}));

const historyMatchesPhone = (item: OnlinePbxCallHistoryItem, phone: string) => {
  const target = digitsOnly(phone);
  return [item.callerIdNumber, item.destinationNumber, ...item.events.map((event) => event.number)]
    .some((value) => digitsOnly(value) === target);
};

router.get('/calls/:id/recording', requireAuth, asyncRoute(async (req, res) => {
  const callId = Number(req.params.id);
  if (!Number.isInteger(callId) || callId <= 0) {
    return res.status(400).json({ error: 'onlinePbxInvalidCallId' });
  }
  const result = await pool.query(
    `SELECT id, user_id AS "userId", provider_call_id AS "providerCallId",
            phone, started_at AS "startedAt", recording_url AS "recordingUrl"
     FROM telephony_calls WHERE id = $1`,
    [callId],
  );
  const call = result.rows[0];
  if (!call || (Number(call.userId) !== req.user!.id && req.user?.workspace !== 'administration')) {
    return res.status(404).json({ error: 'onlinePbxCallNotFound' });
  }
  if (call.recordingUrl) return res.json({ url: call.recordingUrl });

  try {
    const startedAt = new Date(call.startedAt).getTime();
    const history = call.providerCallId
      ? await onlinePbxClient.getCallHistory({ uuid: call.providerCallId })
      : await onlinePbxClient.getCallHistory({
          phoneNumbers: call.phone,
          startStampFrom: Math.floor(startedAt / 1000) - 180,
          startStampTo: Math.floor(startedAt / 1000) + 300,
        });
    const match = history
      .filter((item) => historyMatchesPhone(item, call.phone))
      .sort((a, b) => Math.abs(a.startStamp * 1000 - startedAt) - Math.abs(b.startStamp * 1000 - startedAt))[0];
    if (!match) return res.status(404).json({ error: 'onlinePbxRecordingPending' });
    const url = await onlinePbxClient.getCallRecordingUrl(match.uuid);
    if (!url) return res.status(404).json({ error: 'onlinePbxRecordingUnavailable' });

    await pool.query(
      `UPDATE telephony_calls
       SET provider_call_id = COALESCE(provider_call_id, $2),
           duration_seconds = GREATEST(duration_seconds, $3),
           talk_seconds = GREATEST(talk_seconds, $4),
           hangup_cause = COALESCE(NULLIF($5, ''), hangup_cause),
           recording_url = $6,
           updated_at = NOW()
       WHERE id = $1`,
      [callId, match.uuid, match.duration, match.talkTime, match.hangupCause, url],
    );
    res.json({ url });
  } catch (error) {
    const clientCode = error instanceof OnlinePbxError ? error.clientCode : 'onlinePbxRecordingUnavailable';
    const statusCode = error instanceof OnlinePbxError ? error.statusCode : 502;
    res.status(statusCode).json({ error: clientCode });
  }
}));

router.post('/calls', requireAuth, (_req, res) => {
  res.status(409).json({ error: 'onlinePbxUseWebPhone' });
});

export default router;
