import { timingSafeEqual } from 'crypto';
import { Router, type RequestHandler } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Pool, PoolClient } from 'pg';
import type { WebSocketEvent } from '@shared/websocket';
import { canAccessAcademyWorkspace, hasLeadershipAccess } from '@shared/academy';
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
  leadId: number | null;
  name: string;
  secondaryName: string | null;
  phone: string;
  created?: boolean;
};

type Queryable = Pick<Pool | PoolClient, 'query'>;

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

const findContactByPhone = async (
  phone: string,
  client: Queryable = pool,
): Promise<TelephonyContact | null> => {
  const normalized = normalizeOnlinePbxPhone(phone);
  if (!normalized) return null;
  const digits = digitsOnly(normalized);

  const result = await client.query<TelephonyContact>(
    `WITH matched_contacts AS (
       SELECT 'student'::text AS type,
              student.id,
              student.lead_id AS "leadId",
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
              lead.id AS "leadId",
              COALESCE(NULLIF(lead.student_name, ''), lead.contact_name) AS name,
              NULLIF(lead.contact_name, '') AS "secondaryName",
              phone.phone,
              2 AS priority,
              lead.updated_at
       FROM academy_lead_phones phone
       JOIN academy_leads lead ON lead.id = phone.lead_id
       WHERE regexp_replace(phone.normalized_phone, '\\D', '', 'g') = $1
     )
     SELECT type, id, "leadId", name, "secondaryName", phone
     FROM matched_contacts
     ORDER BY priority, updated_at DESC
     LIMIT 1`,
    [digits],
  );

  return result.rows[0] ?? null;
};

const ensureContactByPhone = async (
  phone: string,
  context: { userId?: number | null; direction: 'incoming' | 'outgoing' },
): Promise<TelephonyContact> => {
  const normalized = normalizeOnlinePbxPhone(phone)!;
  const digits = digitsOnly(normalized);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`telephony-lead:${digits}`]);
    const existing = await findContactByPhone(normalized, client);
    if (existing) {
      await client.query('COMMIT');
      return existing;
    }

    const sourceResult = await client.query<{ id: number }>(
      `INSERT INTO academy_lead_sources
         (code, name, channel, is_system, is_active, updated_at)
       VALUES ('telephony', 'Телефония', 'call', true, true, NOW())
       ON CONFLICT (code) DO UPDATE
       SET name = EXCLUDED.name,
           channel = EXCLUDED.channel,
           is_system = true,
           is_active = true,
           updated_at = NOW()
       RETURNING id`,
    );
    const actorId = Number(context.userId) > 0 ? Number(context.userId) : null;
    const managerResult = actorId
      ? await client.query<{ id: number }>(
          `SELECT user_account.id
           FROM users user_account
           WHERE user_account.id = $1
             AND user_account.is_active = true
             AND (
               user_account.workspace = 'sales'
               OR EXISTS (
                 SELECT 1 FROM user_workspaces workspace
                 WHERE workspace.user_id = user_account.id AND workspace.workspace = 'sales'
               )
             )`,
          [actorId],
        )
      : { rows: [] as Array<{ id: number }> };
    const directionLabel = context.direction === 'incoming' ? 'входящего' : 'исходящего';
    const contactName = `Новый контакт ${normalized}`;
    const leadResult = await client.query<{ id: number; contactName: string }>(
      `INSERT INTO academy_leads (
         contact_name, phone, source_id, status_code, manager_id, language,
         comment, first_contact_channel, created_by
       )
       VALUES ($1,$2,$3,'new_request',$4,'ru',$5,'call',$6)
       RETURNING id, contact_name AS "contactName"`,
      [
        contactName,
        normalized,
        sourceResult.rows[0].id,
        managerResult.rows[0]?.id ?? null,
        `Создан автоматически из ${directionLabel} звонка.`,
        actorId,
      ],
    );
    const lead = leadResult.rows[0];
    await client.query(
      `INSERT INTO academy_lead_phones
         (lead_id, phone, normalized_phone, is_primary)
       VALUES ($1,$2,$2,true)
       ON CONFLICT (lead_id, normalized_phone) DO NOTHING`,
      [lead.id, normalized],
    );
    await client.query(
      `INSERT INTO academy_lead_stage_history
         (lead_id, from_status_code, to_status_code, changed_by, comment)
       VALUES ($1,NULL,'new_request',$2,$3)`,
      [lead.id, actorId, `Автоматически из ${directionLabel} звонка`],
    );
    await client.query('COMMIT');
    return {
      type: 'lead',
      id: lead.id,
      leadId: lead.id,
      name: lead.contactName,
      secondaryName: null,
      phone: normalized,
      created: true,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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
  const contact = await ensureContactByPhone(phone, { userId, direction: input.direction });
  if (contact.created) {
    broadcastFunction({ type: 'ACADEMY_LEAD_CREATED', data: { id: contact.leadId } });
  }
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
    contact?.leadId ?? null,
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
    contact_name AS "contactName", lead_id AS "leadId", started_at AS "startedAt",
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
           lead_id = COALESCE(lead_id, $10),
           started_at = LEAST(started_at, $11),
           answered_at = COALESCE(answered_at, $12),
           ended_at = COALESCE($13, ended_at),
           duration_seconds = GREATEST(duration_seconds, $14),
           talk_seconds = GREATEST(talk_seconds, $15),
           hangup_cause = COALESCE($16, hangup_cause),
           updated_at = NOW()
       WHERE client_call_id = $1 OR provider_call_id = $1
       RETURNING ${returning}`,
      values,
    );

    if (!result.rowCount) {
      result = await client.query(
        `INSERT INTO telephony_calls (
           client_call_id, user_id, extension, direction, status, phone,
           contact_type, contact_id, contact_name, lead_id, started_at, answered_at,
           ended_at, duration_seconds, talk_seconds, hangup_cause
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
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

  const direction = String(payload.direction ?? '').toLowerCase().includes('out') ? 'outgoing' : 'incoming';
  const contact = await ensureContactByPhone(phone, { userId: employee?.id, direction });
  if (contact.created) {
    broadcastFunction({ type: 'ACADEMY_LEAD_CREATED', data: { id: contact.leadId } });
  }
  const durationSeconds = safeInteger(payload.call_duration);
  const talkSeconds = safeInteger(payload.dialog_duration);
  const status = providerEventStatus(event, talkSeconds);
  const startedAtSeconds = safeInteger(payload.date);
  const startedAt = startedAtSeconds > 0 ? new Date(startedAtSeconds * 1000) : new Date();
  const endedAt = ['ended', 'failed', 'declined', 'missed'].includes(status) ? new Date() : null;
  const answeredAt = status === 'connected'
    ? new Date()
    : talkSeconds > 0 && endedAt
      ? new Date(endedAt.getTime() - talkSeconds * 1000)
      : null;

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
    contact?.leadId ?? null,
    startedAt,
    answeredAt,
    endedAt,
    durationSeconds,
    talkSeconds,
    String(payload.hangup_cause ?? '').slice(0, 120) || null,
    String(payload.download_url ?? '').startsWith('https://') ? String(payload.download_url) : null,
    JSON.stringify({ event, hangupBy: payload.hangup_by ?? null }),
  ];
  const returning = `id, status, direction, phone,
    contact_type AS "contactType", contact_id AS "contactId", contact_name AS "contactName",
    lead_id AS "leadId",
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
           lead_id = COALESCE(lead_id, $10),
           started_at = LEAST(started_at, $11),
           answered_at = COALESCE(answered_at, $12),
           ended_at = COALESCE($13, ended_at),
           duration_seconds = GREATEST(duration_seconds, $14),
           talk_seconds = GREATEST(talk_seconds, $15),
           hangup_cause = COALESCE($16, hangup_cause),
           recording_url = COALESCE($17, recording_url),
           metadata = metadata || $18::jsonb,
           updated_at = NOW()
       WHERE provider_call_id = $1 OR client_call_id = $1
       RETURNING ${returning}`,
      values,
    );

    if (!result.rowCount) {
      result = await client.query(
        `INSERT INTO telephony_calls (
           provider_call_id, user_id, extension, direction, status, phone,
           contact_type, contact_id, contact_name, lead_id, started_at, answered_at, ended_at,
           duration_seconds, talk_seconds, hangup_cause, recording_url, metadata
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)
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
            contact_name AS "contactName", lead_id AS "leadId", started_at AS "startedAt",
            answered_at AS "answeredAt", ended_at AS "endedAt",
            duration_seconds AS "durationSeconds", talk_seconds AS "talkSeconds",
            hangup_cause AS "hangupCause",
            (recording_url IS NOT NULL OR talk_seconds > 0) AS "hasRecording"
     FROM telephony_calls
     WHERE user_id = $1
     ORDER BY started_at DESC
     LIMIT $2`,
    [req.user!.id, limit],
  );
  res.json(result.rows);
}));

router.get('/calls/journal', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAcademyWorkspace(req.user, 'sales')) {
    return res.status(403).json({ error: 'salesAccessRequired' });
  }

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const conditions: string[] = [];
  const params: unknown[] = [];
  const addParam = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (!hasLeadershipAccess(req.user)) {
    const actor = addParam(req.user!.id);
    conditions.push(`(
      call.user_id = ${actor}
      OR lead.manager_id = ${actor}
      OR (lead.id IS NOT NULL AND lead.manager_id IS NULL)
    )`);
  }

  const direction = String(req.query.direction ?? '').trim();
  if (['incoming', 'outgoing'].includes(direction)) {
    conditions.push(`call.direction = ${addParam(direction)}`);
  }
  const status = String(req.query.status ?? '').trim();
  if (['dialing', 'ringing', 'connected', 'ended', 'failed', 'declined', 'missed'].includes(status)) {
    conditions.push(`call.status = ${addParam(status)}`);
  }
  const search = String(req.query.q ?? '').trim().toLowerCase();
  if (search) {
    const like = addParam(`%${search}%`);
    conditions.push(`(
      LOWER(call.phone) LIKE ${like}
      OR LOWER(COALESCE(call.contact_name, '')) LIKE ${like}
      OR LOWER(COALESCE(lead.contact_name, '')) LIKE ${like}
      OR LOWER(COALESCE(lead.student_name, '')) LIKE ${like}
      OR LOWER(COALESCE(employee.full_name, '')) LIKE ${like}
    )`);
  }
  const from = String(req.query.from ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    conditions.push(`call.started_at >= ${addParam(`${from}T00:00:00`)}::timestamp`);
  }
  const to = String(req.query.to ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    conditions.push(`call.started_at < (${addParam(`${to}T00:00:00`)}::timestamp + INTERVAL '1 day')`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitParam = addParam(limit);
  const offsetParam = addParam((page - 1) * limit);

  const result = await pool.query(
    `SELECT call.id,
            call.client_call_id AS "clientCallId",
            call.provider_call_id AS "providerCallId",
            call.user_id AS "userId",
            employee.full_name AS "userName",
            call.extension,
            call.direction,
            call.status,
            call.phone,
            call.lead_id AS "leadId",
            COALESCE(NULLIF(lead.student_name, ''), NULLIF(lead.contact_name, ''), call.contact_name)
              AS "leadName",
            lead.contact_name AS "contactName",
            lead.manager_id AS "managerId",
            manager.full_name AS "managerName",
            call.started_at AS "startedAt",
            call.answered_at AS "answeredAt",
            call.ended_at AS "endedAt",
            call.duration_seconds AS "durationSeconds",
            call.talk_seconds AS "talkSeconds",
            call.hangup_cause AS "hangupCause",
            (call.recording_url IS NOT NULL OR call.talk_seconds > 0) AS "hasRecording",
            COUNT(*) OVER()::int AS "totalCount",
            COUNT(*) FILTER (WHERE call.status = 'missed') OVER()::int AS "missedCount",
            COUNT(*) FILTER (WHERE call.talk_seconds > 0) OVER()::int AS "answeredCount",
            COALESCE(SUM(call.talk_seconds) OVER(), 0)::int AS "totalTalkSeconds"
     FROM telephony_calls call
     LEFT JOIN users employee ON employee.id = call.user_id
     LEFT JOIN academy_leads lead ON lead.id = call.lead_id
     LEFT JOIN users manager ON manager.id = lead.manager_id
     ${where}
     ORDER BY call.started_at DESC, call.id DESC
     LIMIT ${limitParam} OFFSET ${offsetParam}`,
    params,
  );

  const first = result.rows[0];
  res.json({
    items: result.rows.map((row) => {
      const { totalCount: _total, missedCount: _missed, answeredCount: _answered, totalTalkSeconds: _talk, ...item } = row;
      return item;
    }),
    page,
    limit,
    total: Number(first?.totalCount ?? 0),
    summary: {
      missed: Number(first?.missedCount ?? 0),
      answered: Number(first?.answeredCount ?? 0),
      talkSeconds: Number(first?.totalTalkSeconds ?? 0),
    },
  });
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
    `SELECT call.id, call.user_id AS "userId", call.provider_call_id AS "providerCallId",
            call.phone, call.started_at AS "startedAt", call.recording_url AS "recordingUrl",
            lead_id AS "leadId", lead.manager_id AS "leadManagerId"
     FROM telephony_calls call
     LEFT JOIN academy_leads lead ON lead.id = call.lead_id
     WHERE call.id = $1`,
    [callId],
  );
  const call = result.rows[0];
  const canReadRecording = Boolean(call) && (
    Number(call.userId) === req.user!.id
    || hasLeadershipAccess(req.user)
    || (
      canAccessAcademyWorkspace(req.user, 'sales')
      && call.leadId
      && (call.leadManagerId == null || Number(call.leadManagerId) === req.user!.id)
    )
  );
  if (!call || !canReadRecording) {
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
