import { timingSafeEqual } from 'crypto';
import { Router, type RequestHandler } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Pool, PoolClient } from 'pg';
import type { WebSocketEvent } from '@shared/websocket';
import {
  ONLINE_PBX_CALL_CORRELATION_WINDOW_SECONDS,
  ONLINE_PBX_TRUNK_NUMBER,
  onlinePbxExclusiveExtensionHolder,
  onlinePbxRoutingDestination,
  sharedCallEventClaimsOwnership,
} from '@shared/telephony';
import { canAccessAcademyModule, hasLeadershipAccess } from '@shared/academy';
import { appConfig } from '../config';
import { pool } from '../db';
import { logger } from '../lib/logger';
import { requireAuth } from '../middleware/auth.middleware';
import { inboundWebhookLimiter } from '../middleware/rateLimiter';
import {
  normalizeOnlinePbxPhone,
  onlinePbxClient,
  OnlinePbxError,
} from '../services/onlinepbx';
import telephonyRecordingRoutes, {
  loadAuthorizedRecordingCall,
} from './telephony-recording.routes';
import {
  getOnlinePbxRoutingSettings,
  getOnlinePbxIncomingDelayMs,
  queueOnlinePbxRoutingSync,
  synchronizeOnlinePbxRoutingWithRetry,
} from '../services/telephony-routing';
import {
  buildTelephonyCallVisibilitySql,
  getMissedCallUnreadSummary,
  markMissedCallsSeen,
  MISSED_INCOMING_CALL_SQL,
} from '../services/telephony-notifications';
import { publishRealtimeEvent } from '../realtime/realtime-hub';

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

export const findContactByPhone = async (
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
              false AS is_archived,
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
              COALESCE(lead.is_archived, false) AS is_archived,
              lead.updated_at
       FROM academy_lead_phones phone
       JOIN academy_leads lead ON lead.id = phone.lead_id
       WHERE regexp_replace(phone.normalized_phone, '\\D', '', 'g') = $1

       UNION ALL

       SELECT 'lead'::text AS type,
              lead.id,
              lead.id AS "leadId",
              COALESCE(NULLIF(lead.student_name, ''), lead.contact_name) AS name,
              NULLIF(lead.contact_name, '') AS "secondaryName",
              lead.phone,
              2 AS priority,
              COALESCE(lead.is_archived, false) AS is_archived,
              lead.updated_at
       FROM academy_leads lead
       WHERE COALESCE(lead.phone, '') ~ '^[+()0-9[:space:].-]+$'
         AND CASE
           WHEN left(regexp_replace(COALESCE(lead.phone, ''), '\\D', '', 'g'), 2) = '00'
             THEN substring(regexp_replace(lead.phone, '\\D', '', 'g') FROM 3)
           WHEN length(regexp_replace(COALESCE(lead.phone, ''), '\\D', '', 'g')) = 9
             THEN '998' || regexp_replace(lead.phone, '\\D', '', 'g')
           ELSE regexp_replace(COALESCE(lead.phone, ''), '\\D', '', 'g')
         END = $1
         AND NOT EXISTS (
           SELECT 1
           FROM academy_lead_phones indexed_phone
           WHERE indexed_phone.lead_id = lead.id
             AND regexp_replace(indexed_phone.normalized_phone, '\\D', '', 'g') = $1
         )
     )
     SELECT type, id, "leadId", name, "secondaryName", phone
     FROM matched_contacts
     ORDER BY priority, is_archived, updated_at DESC NULLS LAST, id DESC
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
               user_account.module = 'sales'
               OR EXISTS (
                 SELECT 1 FROM user_modules module
                 WHERE module.user_id = user_account.id AND module.module = 'sales'
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

const claimUnassignedLeadForAnsweredCall = async (leadId: number | null, userId: number) => {
  if (!leadId) return;
  await pool.query(
    `WITH eligible_manager AS (
       SELECT user_account.id
       FROM users user_account
       WHERE user_account.id = $2
         AND user_account.is_active = true
         AND (
           user_account.module = 'sales'
           OR EXISTS (
             SELECT 1
             FROM user_modules module
             WHERE module.user_id = user_account.id
               AND module.module = 'sales'
           )
         )
     ),
     claimed AS (
       UPDATE academy_leads lead
       SET manager_id = eligible_manager.id,
           updated_at = NOW()
       FROM eligible_manager
       WHERE lead.id = $1
         AND lead.manager_id IS NULL
       RETURNING lead.id
     )
     INSERT INTO academy_lead_assignment_history
       (lead_id, from_manager_id, to_manager_id, changed_by, comment)
     SELECT claimed.id, NULL, $2, $2, 'Назначено сотруднику, ответившему во внутренней телефонии CRM'
     FROM claimed`,
    [leadId, userId],
  );
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
  const talkSeconds = safeInteger(input.talkSeconds);
  const claimsOwnership = sharedCallEventClaimsOwnership(input);
  const contact = await ensureContactByPhone(phone, {
    userId: claimsOwnership ? userId : null,
    direction: input.direction,
  });
  if (input.direction === 'incoming' && claimsOwnership) {
    await claimUnassignedLeadForAnsweredCall(contact.leadId, userId);
  }
  if (contact.created) {
    publishRealtimeEvent({ type: 'ACADEMY_LEAD_CREATED', data: { id: contact.leadId } });
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
    talkSeconds,
    input.hangupCause?.slice(0, 120) || null,
    claimsOwnership,
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
    // As on the webhook side, a dialog the provider already reported under this
    // id is left alone: adopting another row on top of it would give two rows
    // the same identifier.
    const known = await client.query<{ id: number }>(
      `SELECT id
       FROM telephony_calls
       WHERE client_call_id = $1 OR provider_call_id = $1
       LIMIT 1`,
      [input.clientCallId],
    );
    const reportedByProvider = known.rowCount
      ? null
      : await findCallReportedByProvider(client, {
          direction: input.direction,
          phone,
        });
    let result = await client.query(
      // $4 and $5 are pinned to text: each is both assigned to a varchar column
      // and compared against a bare literal, and Postgres refuses a statement
      // whose parameter it has to read as varchar in one place and text in
      // another ("inconsistent types deduced for parameter $4").
      `UPDATE telephony_calls
       SET client_call_id = COALESCE(client_call_id, $1),
           user_id = CASE WHEN $17 THEN $2 ELSE user_id END,
           extension = $3,
           direction = $4::text,
           status = CASE
             WHEN $4::text = 'incoming'
              AND NOT $17
              AND $5::text IN ('ended', 'failed', 'declined', 'missed')
              AND (user_id IS NULL OR user_id <> $2) THEN status
             WHEN status IN ('ended', 'failed', 'declined', 'missed')
              AND $5::text NOT IN ('ended', 'failed', 'declined', 'missed') THEN status
             ELSE $5::text
           END,
           phone = $6,
           contact_type = COALESCE(contact_type, $7),
           contact_id = COALESCE(contact_id, $8),
           contact_name = COALESCE(contact_name, $9),
           lead_id = COALESCE(lead_id, $10),
           started_at = LEAST(started_at, $11),
           answered_at = COALESCE(answered_at, $12),
           ended_at = CASE
             WHEN $4::text = 'incoming'
              AND NOT $17
              AND $5::text IN ('ended', 'failed', 'declined', 'missed')
              AND (user_id IS NULL OR user_id <> $2) THEN ended_at
             ELSE COALESCE($13, ended_at)
           END,
           duration_seconds = GREATEST(duration_seconds, $14),
           talk_seconds = GREATEST(talk_seconds, $15),
           hangup_cause = COALESCE($16, hangup_cause),
           updated_at = NOW()
       WHERE client_call_id = $1 OR provider_call_id = $1 OR id = $18
       RETURNING ${returning}`,
      [...values, reportedByProvider],
    );

    if (!result.rowCount) {
      result = await client.query(
        `INSERT INTO telephony_calls (
           client_call_id, user_id, extension, direction, status, phone,
           contact_type, contact_id, contact_name, lead_id, started_at, answered_at,
           ended_at, duration_seconds, talk_seconds, hangup_cause
         )
         VALUES ($1,CASE WHEN $17 THEN $2::integer ELSE NULL::integer END,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
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

// A missed incoming call used to open an urgent board task assigned to a sales
// manager. The call journal already carries the same signal — an unread badge
// in the sidebar and the missed row itself — so the task only duplicated it and
// filled the board with work nobody had planned. Missed calls are followed up
// from the journal; a task for one is now created by hand like any other.

const hasValidWebhookSecret = (candidate: unknown) => {
  const expected = appConfig.integrations?.onlinePbx?.webhookSecret?.trim();
  if (!expected || typeof candidate !== 'string') return false;
  const actualBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
};

type CallOwner = {
  id: number;
  extension: string | null;
};

export const findManagerByExtensions = async (
  candidates: string[],
): Promise<CallOwner | null> => {
  const extensions = [...new Set(
    candidates
      .map((candidate) => onlinePbxRoutingDestination(candidate))
      .filter((candidate): candidate is string => Boolean(candidate)),
  )];
  if (extensions.length === 0) return null;

  // Two rows are enough to know the extension is shared and therefore silent
  // about who was on the line.
  const result = await pool.query<CallOwner>(
    `SELECT manager.id, manager.online_pbx_extension AS extension
     FROM users manager
     WHERE manager.is_active = true
       AND (
         manager.module = 'sales'
         OR EXISTS (
           SELECT 1
           FROM user_modules module
           WHERE module.user_id = manager.id
             AND module.module = 'sales'
         )
       )
       AND manager.online_pbx_extension = ANY($1::text[])
     ORDER BY array_position($1::text[], manager.online_pbx_extension), manager.id
     LIMIT 2`,
    [extensions],
  );
  return onlinePbxExclusiveExtensionHolder(result.rows);
};

type CorrelatedCall = {
  id: number;
  userId: number | null;
  extension: string | null;
};

/**
 * The browser and the provider identify the same conversation differently: the
 * CRM stores the web phone dialog id the moment the manager dials or answers,
 * while OnlinePBX reports the finished call under its own uuid. When the two
 * ids do not coincide the rows are matched on the number, the direction and how
 * recently the CRM saw the call, so the manager who actually handled it keeps
 * it. Correlation reads `created_at`, written by the server, rather than
 * `started_at`, which a browser with a skewed clock can push minutes away.
 */
export const findCallHandledInCrm = async (
  executor: Queryable,
  input: { direction: 'incoming' | 'outgoing'; phone: string },
): Promise<CorrelatedCall | null> => {
  const result = await executor.query<CorrelatedCall>(
    `SELECT call.id,
            call.user_id AS "userId",
            COALESCE(call.extension, employee.online_pbx_extension) AS extension
     FROM telephony_calls call
     LEFT JOIN users employee
       ON employee.id = call.user_id
      AND employee.is_active = true
     WHERE call.client_call_id IS NOT NULL
       AND call.provider_call_id IS NULL
       AND call.direction = $1
       AND call.phone = $2
       AND call.created_at >= NOW() - make_interval(secs => $3)
     ORDER BY call.user_id IS NULL, call.created_at, call.id
     LIMIT 1`,
    [input.direction, input.phone, ONLINE_PBX_CALL_CORRELATION_WINDOW_SECONDS],
  );
  return result.rows[0] ?? null;
};

/** The mirror of {@link findCallHandledInCrm}, for a provider row that landed first. */
const findCallReportedByProvider = async (
  executor: Queryable,
  input: { direction: 'incoming' | 'outgoing'; phone: string },
): Promise<number | null> => {
  const result = await executor.query<{ id: number }>(
    `SELECT call.id
     FROM telephony_calls call
     WHERE call.provider_call_id IS NOT NULL
       AND call.client_call_id IS NULL
       AND call.direction = $1
       AND call.phone = $2
       AND call.created_at >= NOW() - make_interval(secs => $3)
     ORDER BY call.created_at, call.id
     LIMIT 1`,
    [input.direction, input.phone, ONLINE_PBX_CALL_CORRELATION_WINDOW_SECONDS],
  );
  return result.rows[0]?.id ?? null;
};

router.post('/webhook', inboundWebhookLimiter, asyncRoute(async (req, res) => {
  const webhookSecret = req.get('x-webhook-secret') ?? req.query.token;
  if (!hasValidWebhookSecret(webhookSecret)) {
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
  const extensionAudience = await pool.query<{ id: number; extension: string | null }>(
    `SELECT id, online_pbx_extension AS extension
     FROM users manager
     WHERE manager.is_active = true
       AND manager.online_pbx_incoming_enabled = true
       AND (
         manager.module = 'sales'
         OR EXISTS (
           SELECT 1
           FROM user_modules module
           WHERE module.user_id = manager.id
             AND module.module = 'sales'
         )
       )
     ORDER BY manager.id`,
  );
  const knownResult = await pool.query<CorrelatedCall>(
    `SELECT call.id,
            call.user_id AS "userId",
            COALESCE(call.extension, employee.online_pbx_extension) AS extension
     FROM telephony_calls call
     LEFT JOIN users employee
       ON employee.id = call.user_id
      AND employee.is_active = true
     WHERE call.provider_call_id = $1 OR call.client_call_id = $1
     ORDER BY call.updated_at DESC
     LIMIT 1`,
    [providerCallId],
  );
  const known = knownResult.rows[0] ?? null;
  let employee: CallOwner | null = known?.userId
    ? { id: known.userId, extension: known.extension }
    : null;
  const trunk = ONLINE_PBX_TRUNK_NUMBER;
  const phoneDigits = candidates.find((value) => value.length >= 7 && value !== trunk) ?? '';
  const phone = normalizeOnlinePbxPhone(phoneDigits);
  if (!phone) return res.status(200).json({ ok: true, ignored: true });

  const direction = String(payload.direction ?? '').toLowerCase().includes('out') ? 'outgoing' : 'incoming';
  const durationSeconds = safeInteger(payload.call_duration);
  const talkSeconds = safeInteger(payload.dialog_duration);
  const status = providerEventStatus(event, talkSeconds);
  const startedAtSeconds = safeInteger(payload.date);
  const startedAt = startedAtSeconds > 0 ? new Date(startedAtSeconds * 1000) : new Date();

  // The web phone already recorded who dialled or answered, so that row is both
  // the one to merge into and the answer to "whose call is this". Only a call
  // the provider has never reported may be adopted this way: once a row carries
  // this uuid, pulling a second row into the same update would make both claim
  // the identifier.
  const handledInCrm = known
    ? null
    : await findCallHandledInCrm(pool, { direction, phone });
  if (handledInCrm?.userId) {
    employee = { id: handledInCrm.userId, extension: handledInCrm.extension };
  }
  if (!employee) employee = await findManagerByExtensions(candidates);

  // Nobody owns a call that no one in the CRM picked up: an extension shared by
  // the whole team cannot name the manager, and guessing one puts every call on
  // the same person.
  const claimsOwnership = sharedCallEventClaimsOwnership({ direction, status, talkSeconds });
  const ownerId = claimsOwnership ? employee?.id ?? null : null;
  if (claimsOwnership && !ownerId) {
    // A handled call the CRM cannot put a name to means the web phone never
    // reported it — usually because it was dialled from outside the CRM, where
    // the shared extension makes everyone look alike.
    logger.warn('OnlinePBX call was handled outside the CRM web phone', {
      providerCallId,
      direction,
      status,
      extensions: candidates.map((candidate) => onlinePbxRoutingDestination(candidate)).filter(Boolean),
    });
  }
  const contact = await ensureContactByPhone(phone, { userId: ownerId, direction });
  if (contact.created) {
    publishRealtimeEvent({ type: 'ACADEMY_LEAD_CREATED', data: { id: contact.leadId } });
  }
  if (direction === 'incoming' && status === 'connected' && ownerId) {
    await claimUnassignedLeadForAnsweredCall(contact.leadId, ownerId);
  }
  const endedAt = ['ended', 'failed', 'declined', 'missed'].includes(status) ? new Date() : null;
  const answeredAt = status === 'connected'
    ? new Date()
    : talkSeconds > 0 && endedAt
      ? new Date(endedAt.getTime() - talkSeconds * 1000)
      : null;

  const values = [
    providerCallId,
    ownerId,
    employee?.extension
      ?? candidates.map((candidate) => onlinePbxRoutingDestination(candidate)).find(Boolean)
      ?? null,
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
       WHERE provider_call_id = $1 OR client_call_id = $1 OR id = $19
       RETURNING ${returning}`,
      [...values, handledInCrm?.id ?? null],
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

  const audienceUserIds = direction === 'incoming' || !employee
    ? extensionAudience.rows.map((user) => user.id)
    : [employee.id];
  if (audienceUserIds.length > 0) {
    publishRealtimeEvent({
      type: 'TELEPHONY_CALL_UPDATED',
      data: call ?? {},
      audienceUserIds,
    });
  }
  res.json({ ok: true });
}));

router.get('/credentials', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAcademyModule(req.user, 'sales')) {
    return res.status(403).json({ error: 'salesAccessRequired' });
  }
  if (!req.user?.onlinePbxIncomingEnabled) {
    return res.status(403).json({ error: 'onlinePbxManagerNotAssigned' });
  }
  const extension = onlinePbxRoutingDestination(req.user?.onlinePbxExtension);
  if (!extension) {
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

router.get('/incoming/access', requireAuth, asyncRoute(async (req, res) => {
  const allowed = Boolean(
    canAccessAcademyModule(req.user, 'sales')
    && req.user?.onlinePbxIncomingEnabled
    && req.user?.isOnline
    && onlinePbxRoutingDestination(req.user?.onlinePbxExtension),
  );
  res.setHeader('Cache-Control', 'no-store, private');
  res.json({
    allowed,
    delayMs: allowed ? await getOnlinePbxIncomingDelayMs(req.user!.id) : 0,
  });
}));

router.post('/availability/refresh', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAcademyModule(req.user, 'sales')) {
    return res.status(403).json({ error: 'salesAccessRequired' });
  }
  if (!req.user?.onlinePbxIncomingEnabled) {
    return res.status(403).json({ error: 'onlinePbxManagerNotAssigned' });
  }
  queueOnlinePbxRoutingSync();
  res.status(202).json({ ok: true });
}));

type OnlinePbxAssignmentInput = {
  managerId: number;
  extension: string;
};

const parseRoutingAssignments = (value: unknown): OnlinePbxAssignmentInput[] | null => {
  if (!Array.isArray(value) || value.length > 100) return null;
  const assignments = value.map((item) => {
    if (!item || typeof item !== 'object') return null;
    const managerId = Number((item as Record<string, unknown>).managerId);
    const extension = onlinePbxRoutingDestination(
      String((item as Record<string, unknown>).extension ?? ''),
    );
    return Number.isInteger(managerId) && managerId > 0 && extension
      ? { managerId, extension }
      : null;
  });
  if (assignments.some((assignment) => !assignment)) return null;
  const parsed = assignments as OnlinePbxAssignmentInput[];
  if (new Set(parsed.map((assignment) => assignment.managerId)).size !== parsed.length) {
    return null;
  }
  return parsed;
};

router.get('/routing', requireAuth, asyncRoute(async (req, res) => {
  if (!hasLeadershipAccess(req.user)) {
    return res.status(403).json({ error: 'adminAccessRequired' });
  }
  res.setHeader('Cache-Control', 'no-store, private');
  res.json(await getOnlinePbxRoutingSettings());
}));

router.put('/routing', requireAuth, asyncRoute(async (req, res) => {
  if (!hasLeadershipAccess(req.user)) {
    return res.status(403).json({ error: 'adminAccessRequired' });
  }

  const assignments = parseRoutingAssignments(req.body?.assignments);
  const requestedPrimaryManagerId = req.body?.primaryManagerId === null
    ? null
    : Number(req.body?.primaryManagerId);
  const forwardingEnabled = req.body?.forwarding?.enabled;
  const requestedForwardingPhone = normalizeOnlinePbxPhone(req.body?.forwarding?.phone);
  if (
    !assignments
    || (
      requestedPrimaryManagerId !== null
      && (!Number.isInteger(requestedPrimaryManagerId) || requestedPrimaryManagerId <= 0)
    )
  ) {
    return res.status(400).json({ error: 'onlinePbxInvalidManagerSelection' });
  }
  if (
    typeof forwardingEnabled !== 'boolean'
    || (forwardingEnabled && !requestedForwardingPhone)
    || (
      req.body?.forwarding?.phone
      && !requestedForwardingPhone
    )
  ) {
    return res.status(400).json({ error: 'onlinePbxInvalidForwardingPhone' });
  }
  if (
    requestedForwardingPhone
    && digitsOnly(requestedForwardingPhone) === ONLINE_PBX_TRUNK_NUMBER
  ) {
    return res.status(400).json({ error: 'onlinePbxForwardingLoop' });
  }

  const [current, existingExtensions] = await Promise.all([
    getOnlinePbxRoutingSettings(),
    onlinePbxClient.listExtensions(),
  ]);
  const existingExtensionNumbers = new Set(
    existingExtensions.map((extension) => extension.extension),
  );
  if (assignments.some((assignment) => !existingExtensionNumbers.has(assignment.extension))) {
    return res.status(400).json({ error: 'onlinePbxExtensionMustExist' });
  }
  const managerIds = assignments.map((assignment) => assignment.managerId);
  const primaryManagerId = assignments.length === 0
    ? null
    : requestedPrimaryManagerId ?? assignments[0].managerId;
  if (
    primaryManagerId !== null
    && !managerIds.includes(primaryManagerId)
  ) {
    return res.status(400).json({ error: 'onlinePbxPrimaryManagerMustBeEnabled' });
  }
  const forwardingPhone = requestedForwardingPhone ?? current.forwarding.phone;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const companySettings = await client.query<{ id: number }>(
      `SELECT id
       FROM academy_company_settings
       ORDER BY id
       LIMIT 1
       FOR UPDATE`,
    );
    const companySettingsId = companySettings.rows[0]?.id
      ?? (
        await client.query<{ id: number }>(
          `INSERT INTO academy_company_settings DEFAULT VALUES
           RETURNING id`,
        )
      ).rows[0].id;
    const eligibleManagers = await client.query<{ id: number }>(
      `SELECT manager.id
       FROM users manager
       WHERE manager.is_active = true
         AND (
           manager.module = 'sales'
           OR EXISTS (
             SELECT 1
             FROM user_modules module
             WHERE module.user_id = manager.id
               AND module.module = 'sales'
           )
         )
       ORDER BY manager.id
       FOR UPDATE`,
    );
    const eligibleManagerIds = new Set(eligibleManagers.rows.map((manager) => manager.id));
    if (managerIds.some((managerId) => !eligibleManagerIds.has(managerId))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'onlinePbxInvalidManagerSelection' });
    }

    await client.query(
      `UPDATE users
       SET online_pbx_extension = NULL,
           online_pbx_incoming_enabled = false,
           updated_at = NOW()
       WHERE online_pbx_extension IS NOT NULL
          OR online_pbx_incoming_enabled = true`,
    );
    for (const assignment of assignments) {
      await client.query(
        `UPDATE users
         SET online_pbx_extension = $2,
             online_pbx_incoming_enabled = true,
             updated_at = NOW()
         WHERE id = $1`,
        [assignment.managerId, assignment.extension],
      );
    }

    await client.query(
      `UPDATE academy_company_settings
       SET online_pbx_primary_manager_id = $1,
           online_pbx_forwarding_phone = $2,
           online_pbx_forwarding_enabled = $3,
           updated_by = $4,
           updated_at = NOW()
       WHERE id = $5`,
      [
        primaryManagerId,
        forwardingPhone,
        forwardingEnabled,
        req.user!.id,
        companySettingsId,
      ],
    );
    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, old_values, new_values)
       VALUES ($1, 'UPDATE_TELEPHONY_ROUTING', 'telephony', $2::jsonb, $3::jsonb)`,
      [
        req.user!.id,
        JSON.stringify({
          primaryManagerId: current.primaryManagerId,
          assignments: current.assignments.map((assignment) => ({
            managerId: assignment.managerId,
            extension: assignment.extension,
          })),
          forwarding: current.forwarding,
        }),
        JSON.stringify({
          primaryManagerId,
          assignments,
          forwarding: { enabled: forwardingEnabled, phone: forwardingPhone },
        }),
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  publishRealtimeEvent({
    type: 'TELEPHONY_ROUTING_UPDATED',
    data: { updatedAt: new Date().toISOString() },
  });

  let synchronized = true;
  try {
    await synchronizeOnlinePbxRoutingWithRetry();
  } catch (error) {
    synchronized = false;
    logger.error('OnlinePBX manager routing was saved but provider synchronization failed', {
      error,
      userId: req.user?.id,
    });
  }

  const settings = await getOnlinePbxRoutingSettings();
  res.json({
    ...settings,
    synchronized: synchronized && settings.synchronized !== false,
  });
}));

router.get('/forwarding', requireAuth, asyncRoute(async (req, res) => {
  if (!hasLeadershipAccess(req.user)) {
    return res.status(403).json({ error: 'adminAccessRequired' });
  }

  const settings = await getOnlinePbxRoutingSettings();
  res.setHeader('Cache-Control', 'no-store, private');
  res.json(settings.forwarding);
}));

router.put('/forwarding', requireAuth, asyncRoute(async (req, res) => {
  if (!hasLeadershipAccess(req.user)) {
    return res.status(403).json({ error: 'adminAccessRequired' });
  }
  const enabled = req.body?.enabled;
  const phone = normalizeOnlinePbxPhone(req.body?.phone);
  if (typeof enabled !== 'boolean' || !phone) {
    return res.status(400).json({ error: 'onlinePbxInvalidForwardingPhone' });
  }
  if (digitsOnly(phone) === ONLINE_PBX_TRUNK_NUMBER) {
    return res.status(400).json({ error: 'onlinePbxForwardingLoop' });
  }

  const current = await getOnlinePbxRoutingSettings();
  const settingsRow = await pool.query<{ id: number }>(
    `SELECT id
     FROM academy_company_settings
     ORDER BY id
     LIMIT 1`,
  );
  const settingsId = settingsRow.rows[0]?.id
    ?? (
      await pool.query<{ id: number }>(
        `INSERT INTO academy_company_settings DEFAULT VALUES
         RETURNING id`,
      )
    ).rows[0].id;
  await pool.query(
    `UPDATE academy_company_settings
     SET online_pbx_forwarding_phone = $1,
         online_pbx_forwarding_enabled = $2,
         updated_by = $3,
         updated_at = NOW()
     WHERE id = $4`,
    [phone, enabled, req.user!.id, settingsId],
  );
  await pool.query(
    `INSERT INTO audit_logs (user_id, action, entity_type, old_values, new_values)
     VALUES ($1, 'UPDATE_TELEPHONY_FORWARDING', 'telephony', $2::jsonb, $3::jsonb)`,
    [
      req.user!.id,
      JSON.stringify(current.forwarding),
      JSON.stringify({ enabled, phone }),
    ],
  );
  await synchronizeOnlinePbxRoutingWithRetry();
  res.json({ enabled, phone });
}));

router.get('/extensions', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAcademyModule(req.user, 'sales')) {
    return res.status(403).json({ error: 'salesAccessRequired' });
  }
  const result = await pool.query(
    `SELECT manager.id,
            manager.full_name AS name,
            manager.online_pbx_extension AS extension
     FROM users manager
     WHERE manager.is_active = true
       AND manager.id <> $1
       AND manager.online_pbx_extension IS NOT NULL
       AND manager.online_pbx_extension <> ''
       AND (
         manager.module = 'sales'
         OR EXISTS (
           SELECT 1
           FROM user_modules module
           WHERE module.user_id = manager.id
             AND module.module = 'sales'
         )
       )
     ORDER BY manager.full_name, manager.id`,
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
  if (!canAccessAcademyModule(req.user, 'sales')) {
    return res.status(403).json({ error: 'salesAccessRequired' });
  }
  if (!req.user?.onlinePbxIncomingEnabled) {
    return res.status(403).json({ error: 'onlinePbxManagerNotAssigned' });
  }
  const extension = onlinePbxRoutingDestination(req.user?.onlinePbxExtension);
  if (!extension) {
    return res.status(422).json({ error: 'onlinePbxExtensionMissing' });
  }

  const call = await upsertClientCall(req.user!.id, extension, req.body);
  publishRealtimeEvent({
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
            hangup_cause AS "hangupCause", note,
            (NULLIF(BTRIM(recording_url), '') IS NOT NULL OR talk_seconds > 0) AS "hasRecording"
     FROM telephony_calls
     WHERE user_id = $1
     ORDER BY started_at DESC
     LIMIT $2`,
    [req.user!.id, limit],
  );
  res.json(result.rows);
}));

router.get('/calls/missed/unread', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAcademyModule(req.user, 'sales')) {
    return res.status(403).json({ error: 'salesAccessRequired' });
  }
  res.setHeader('Cache-Control', 'no-store, private');
  res.json(await getMissedCallUnreadSummary(req.user!));
}));

router.put('/calls/missed/read', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAcademyModule(req.user, 'sales')) {
    return res.status(403).json({ error: 'salesAccessRequired' });
  }
  const lastSeenCallId = await markMissedCallsSeen(req.user!);
  publishRealtimeEvent({
    type: 'TELEPHONY_MISSED_CALLS_READ',
    data: { lastSeenCallId },
    audienceUserIds: [req.user!.id],
  });
  res.json({ count: 0, lastSeenCallId });
}));

router.get('/calls/journal', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAcademyModule(req.user, 'sales')) {
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
    conditions.push(buildTelephonyCallVisibilitySql(actor));
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
            call.note,
            (NULLIF(BTRIM(call.recording_url), '') IS NOT NULL OR call.talk_seconds > 0) AS "hasRecording",
            COUNT(*) OVER()::int AS "totalCount",
            COUNT(*) FILTER (WHERE ${MISSED_INCOMING_CALL_SQL}) OVER()::int AS "missedCount",
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

router.use(telephonyRecordingRoutes);

export { isAllowedOnlinePbxRecordingUrl } from './telephony-recording.routes';

export const TELEPHONY_CALL_NOTE_MAX_LENGTH = 2_000;

export const parseTelephonyCallNote = (value: unknown): string | null | undefined => {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= TELEPHONY_CALL_NOTE_MAX_LENGTH ? trimmed : undefined;
};

/**
 * A note is written by whoever handled the conversation, so the same rule that
 * decides who may listen to the recording decides who may annotate it: the
 * manager on the call, leadership, or the sales owner of an unclaimed lead.
 */
router.put('/calls/:id/note', requireAuth, asyncRoute(async (req, res) => {
  const callId = Number(req.params.id);
  if (!Number.isInteger(callId) || callId <= 0) {
    return res.status(400).json({ error: 'onlinePbxInvalidCallId' });
  }
  const note = parseTelephonyCallNote(req.body?.note);
  if (note === undefined) {
    return res.status(400).json({ error: 'onlinePbxInvalidCallNote' });
  }
  if (!await loadAuthorizedRecordingCall(callId, req.user!)) {
    return res.status(404).json({ error: 'onlinePbxCallNotFound' });
  }

  const result = await pool.query(
    `UPDATE telephony_calls
     SET note = $2,
         note_author_id = CASE WHEN $2::text IS NULL THEN NULL ELSE $3::integer END,
         note_updated_at = CASE WHEN $2::text IS NULL THEN NULL ELSE NOW() END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, note, note_author_id AS "noteAuthorId", note_updated_at AS "noteUpdatedAt"`,
    [callId, note, req.user!.id],
  );
  const updated = result.rows[0];
  publishRealtimeEvent({
    type: 'TELEPHONY_CALL_UPDATED',
    data: updated,
    audienceUserIds: [req.user!.id],
  });
  res.json(updated);
}));

router.post('/calls', requireAuth, (_req, res) => {
  res.status(409).json({ error: 'onlinePbxUseWebPhone' });
});

export default router;
