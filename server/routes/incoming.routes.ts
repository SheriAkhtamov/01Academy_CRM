import crypto from 'node:crypto';
import { Router } from 'express';
import type { PoolClient } from 'pg';
import { pool } from '../db';
import { appConfig, isDevelopmentEnvironment } from '../config';
import { logger } from '../lib/logger';
import { inboundWebhookLimiter, websiteLeadLimiter } from '../middleware/rateLimiter';
import { isAllowedWebsiteLeadFormOrigin } from '../middleware/security.middleware';
import {
  processInstagramWebhook,
  verifyInstagramWebhookChallenge,
  verifyInstagramWebhookSignature,
} from '../services/instagram';
import {
  processMetaLeadAdsWebhook,
  verifyMetaLeadWebhookChallenge,
  verifyMetaLeadWebhookSignature,
} from '../services/meta-lead-ads';

const router = Router();

router.use(expressRawJson);
router.use(inboundWebhookLimiter);

router.get('/meta-leads', (req, res) => {
  if (!verifyMetaLeadWebhookChallenge(req.query['hub.mode'], req.query['hub.verify_token'])) {
    return res.status(403).send('Invalid Meta Lead Ads webhook verification token');
  }
  return res.status(200).send(String(req.query['hub.challenge'] ?? ''));
});

router.post('/meta-leads', async (req, res) => {
  const signature = req.get('x-hub-signature-256');
  if (!verifyMetaLeadWebhookSignature(req.rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid Meta Lead Ads webhook signature' });
  }
  try {
    const result = await processMetaLeadAdsWebhook(req.body);
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    logger.error('Failed to process Meta Lead Ads webhook', {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ error: 'Failed to process Meta Lead Ads webhook' });
  }
});

router.get('/instagram', (req, res) => {
  if (!verifyInstagramWebhookChallenge(req.query['hub.mode'], req.query['hub.verify_token'])) {
    return res.status(403).send('Invalid Instagram webhook verification token');
  }
  return res.status(200).send(String(req.query['hub.challenge'] ?? ''));
});

router.post('/instagram', async (req, res) => {
  const signature = req.get('x-hub-signature-256');
  if (!verifyInstagramWebhookSignature(req.rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid Instagram webhook signature' });
  }
  try {
    const result = await processInstagramWebhook(req.body);
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    logger.error('Failed to process Instagram webhook', { error });
    return res.status(500).json({ error: 'Failed to process Instagram webhook' });
  }
});

router.post('/instagram/deauthorize', async (req, res) => {
  const signedRequest = parseInstagramSignedRequest(req.body?.signed_request ?? req.query?.signed_request);
  if (!signedRequest.ok) {
    return res.status(signedRequest.status).json({ error: signedRequest.error });
  }

  const igUserId = extractInstagramSignedUserId(signedRequest.payload);
  let accountIds: number[] = [];
  if (igUserId) {
    const { rows } = await pool.query<{ id: number }>(
      `UPDATE instagram_accounts
       SET status = 'disconnected',
           access_token_encrypted = NULL,
           token_expires_at = NULL,
           last_error = 'Instagram deauthorized by user',
           updated_at = NOW()
       WHERE ig_user_id = $1
       RETURNING id`,
      [igUserId],
    );
    accountIds = rows.map((row) => Number(row.id));
  }

  await logIntegration('instagram', 'deauthorize', 'received', {
    igUserId,
    accountIds,
  });
  return res.status(200).json({ success: true });
});

router.get('/instagram/deauthorize', (_req, res) => {
  return res.status(200).json({ ok: true, endpoint: 'instagram_deauthorize' });
});

router.post('/instagram/data-deletion', async (req, res) => {
  const signedRequest = parseInstagramSignedRequest(req.body?.signed_request ?? req.query?.signed_request);
  if (!signedRequest.ok) {
    return res.status(signedRequest.status).json({ error: signedRequest.error });
  }

  const igUserId = extractInstagramSignedUserId(signedRequest.payload);
  let accountIds: number[] = [];
  if (igUserId) {
    const { rows } = await pool.query<{ id: number }>(
      `DELETE FROM instagram_accounts
       WHERE ig_user_id = $1
       RETURNING id`,
      [igUserId],
    );
    accountIds = rows.map((row) => Number(row.id));
  }

  const confirmationCode = createInstagramDataDeletionConfirmationCode(igUserId);
  await logIntegration('instagram', 'data_deletion', 'received', {
    igUserId,
    accountIds,
    confirmationCode,
  });

  const appUrl = appConfig.server.appUrl.replace(/\/$/, '');
  return res.status(200).json({
    url: `${appUrl}/api/incoming/instagram/data-deletion/status/${confirmationCode}`,
    confirmation_code: confirmationCode,
  });
});

router.get('/instagram/data-deletion', (_req, res) => {
  return res.status(200).json({ ok: true, endpoint: 'instagram_data_deletion' });
});

router.get('/instagram/data-deletion/status/:confirmationCode', (req, res) => {
  return res.status(200).json({
    confirmation_code: req.params.confirmationCode,
    status: 'received',
  });
});

// The public landing is allowed only from explicitly configured origins. Other
// clients must authenticate with the server-side webhook secret.
const verifyWebsiteLeadRequest = (req: any, res: any): boolean => {
  if (isAllowedWebsiteLeadFormOrigin(req.get('origin'))) return true;

  const configured = appConfig.integrations?.website?.webhookSecret?.trim();
  if (!configured) {
    if (isDevelopmentEnvironment) return true;
    res.status(503).json({ error: 'integrationNotConfigured' });
    return false;
  }
  const provided = req.get('x-webhook-secret')?.trim();
  if (provided) {
    const expectedBuffer = Buffer.from(configured);
    const actualBuffer = Buffer.from(provided);
    if (
      actualBuffer.length === expectedBuffer.length
      && crypto.timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      return true;
    }
  }
  res.status(401).json({ error: 'Invalid or missing webhook secret' });
  return false;
};

type QueryExecutor = {
  query: (text: string, values?: any[]) => Promise<{ rows: any[] }>;
};

const leadershipUserAccessSql = `
  (
    u.module = 'administration'
    OR EXISTS (
      SELECT 1
      FROM user_modules uw
      WHERE uw.user_id = u.id AND uw.module = 'administration'
    )
  )
`;

const withIncomingTransaction = async <T>(callback: (client: PoolClient) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const getSystemUserId = async (executor: QueryExecutor = pool): Promise<number> => {
  const { rows } = await executor.query(
    `SELECT u.id FROM users u WHERE ${leadershipUserAccessSql} AND u.is_active=true ORDER BY u.id LIMIT 1`,
  );
  if (!rows[0]?.id) throw new Error('No active leadership module user to attribute webhook actions');
  return Number(rows[0].id);
};

const toSnake = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const camelize = (row: Record<string, any>) =>
  Object.fromEntries(Object.entries(row).map(([key, value]) => [toSnake(key).replace(/_([a-z])/g, (_, l) => l.toUpperCase()), value]));

const normalizePhoneForStorage = (value: unknown) => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  let digits = text.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 9) digits = `998${digits}`;
  const phone = `+${digits}`;
  return { phone, normalizedPhone: phone };
};

const normalizeMessengerForStorage = (value: unknown) => {
  const text = nullableText(value, 120);
  if (!text) return null;

  let handle = text;
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      if (['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me'].includes(url.hostname.toLowerCase())) {
        handle = url.pathname.split('/').filter(Boolean)[0] ?? text;
      }
    } catch {
      handle = text;
    }
  }

  const normalizedHandle = handle.replace(/^@+/, '').replace(/[/?#].*$/, '').trim();
  if (/^[a-z0-9_]{5,32}$/i.test(normalizedHandle)) return `@${normalizedHandle}`;
  return text;
};

const normalizeMessengerForLookup = (value: unknown) => (
  normalizeMessengerForStorage(value)?.replace(/^@/, '').toLowerCase() ?? null
);

const resolveWebsiteContact = (body: Record<string, unknown>) => {
  let phone = nullableText(body.phone, 50);
  let messenger = nullableText(body.messenger, 120);
  const contact = nullableText(body.contact, 120);

  if (!phone && !messenger && contact) {
    if (/^@|t[.]me\/|telegram[.]me\/|[a-z_]/i.test(contact)) messenger = contact;
    else phone = contact;
  }

  return {
    phone,
    messenger: normalizeMessengerForStorage(messenger),
  };
};

const nullableText = (value: unknown, maxLength?: number) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return maxLength ? trimmed.slice(0, maxLength) : trimmed;
};

const lockIncomingContact = async (
  executor: QueryExecutor,
  phone: string | null | undefined,
  messenger: string | null | undefined,
) => {
  const normalizedPhone = normalizePhoneForStorage(phone)?.normalizedPhone ?? '';
  const normalizedMessenger = normalizeMessengerForLookup(messenger) ?? '';
  const contactKeys = [
    normalizedPhone ? `phone:${normalizedPhone}` : null,
    normalizedMessenger ? `messenger:${normalizedMessenger}` : null,
  ].filter((contactKey): contactKey is string => Boolean(contactKey));
  for (const contactKey of contactKeys) {
    await executor.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [contactKey],
    );
  }
};

const syncIncomingLeadPhone = async (executor: QueryExecutor, leadId: number, phone: string) => {
  const normalized = normalizePhoneForStorage(phone);
  if (!normalized) return;
  await executor.query(
    `INSERT INTO academy_lead_phones (lead_id, phone, normalized_phone, is_primary)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (lead_id, normalized_phone) DO NOTHING`,
    [leadId, normalized.phone, normalized.normalizedPhone],
  );
};

const findIncomingDuplicate = async (
  executor: QueryExecutor,
  phone: string | null | undefined,
  messenger: string | null | undefined,
) => {
  const normalizedPhone = normalizePhoneForStorage(phone)?.normalizedPhone ?? null;
  const normalizedMessenger = normalizeMessengerForLookup(messenger);
  const { rows } = await executor.query(
    `SELECT 'lead' AS entity_type, l.id, NULL::integer AS lead_id, l.contact_name AS name, l.phone, l.messenger
     FROM academy_leads l
     WHERE (
       $1::text IS NOT NULL
       AND (
         l.phone = $1
         OR EXISTS (
           SELECT 1
           FROM academy_lead_phones lp
           WHERE lp.lead_id = l.id
             AND lp.normalized_phone = $1
         )
       )
     )
     OR (
       $2::text IS NOT NULL
       AND LOWER(
         REGEXP_REPLACE(
           REGEXP_REPLACE(BTRIM(COALESCE(l.messenger, '')), '^https?://(www[.])?(t[.]me|telegram[.]me)/', '', 'i'),
           '^@', ''
         )
       ) = $2
     )
     UNION ALL
     SELECT 'student' AS entity_type, id, lead_id, student_name AS name, phone, messenger
     FROM academy_students
     WHERE phone = $1
        OR (
          $2::text IS NOT NULL
          AND LOWER(
            REGEXP_REPLACE(
              REGEXP_REPLACE(BTRIM(COALESCE(messenger, '')), '^https?://(www[.])?(t[.]me|telegram[.]me)/', '', 'i'),
              '^@', ''
            )
          ) = $2
        )
     LIMIT 1`,
    [normalizedPhone, normalizedMessenger],
  );
  return rows[0] ?? null;
};

router.post('/website-lead', websiteLeadLimiter, async (req, res) => {
  if (!verifyWebsiteLeadRequest(req, res)) return;
  try {
    const body = req.body ?? {};
    if (nullableText(body.website, 255)) return res.status(202).json({ ok: true });

    const contactName = nullableText(body.contactName ?? body.name, 255);
    const { phone, messenger } = resolveWebsiteContact(body);
    const company = nullableText(body.company, 255);
    const team = nullableText(body.team, 255);
    const message = nullableText(body.message ?? body.comment, 2000);
    const pageUrl = nullableText(body.pageUrl ?? body.page, 2000);
    const language = nullableText(body.locale ?? body.language, 20) ?? 'ru';
    const campaign = nullableText(body.sourceLabel ?? body.source ?? pageUrl, 255);

    if (!contactName) return res.status(400).json({ error: 'contactNameRequired' });
    if (!phone && !messenger) return res.status(400).json({ error: 'contactRequired' });

    const storedPhone = phone ? (normalizePhoneForStorage(phone)?.phone ?? phone) : null;
    const comment = [
      company ? `Компания: ${company}` : null,
      team ? `Отдел / размер группы: ${team}` : null,
      message ? `Комментарий: ${message}` : null,
      pageUrl ? `Страница заявки: ${pageUrl}` : null,
    ].filter((line): line is string => Boolean(line)).join('\n') || null;

    const result = await withIncomingTransaction(async (client) => {
      const systemUserId = await getSystemUserId(client);
      await lockIncomingContact(client, phone, messenger);
      const duplicate = await findIncomingDuplicate(client, phone, messenger);
      if (duplicate) return { duplicate: camelize(duplicate), lead: null };

      const sourceId = await ensureIncomingSourceId(client, {
        code: 'website',
        name: 'Сайт',
        channel: 'website',
      });

      const { rows: inserted } = await client.query(
        `INSERT INTO academy_leads
          (contact_name, phone, messenger, source_id, advertising_campaign, status_code, manager_id, language, comment, created_by)
         VALUES ($1,$2,$3,$4,$5,'new_request',NULL,$6,$7,$8) RETURNING *`,
        [contactName, storedPhone, messenger, sourceId, campaign, language, comment, systemUserId],
      );
      const lead = camelize(inserted[0]);
      if (storedPhone) await syncIncomingLeadPhone(client, lead.id, storedPhone);
      await client.query(
        `INSERT INTO academy_lead_stage_history (lead_id, from_status_code, to_status_code, changed_by, comment)
         VALUES ($1,NULL,'new_request',$2,'Заявка с сайта')`,
        [lead.id, systemUserId],
      );
      return { duplicate: null, lead };
    });

    if (result.duplicate) {
      await logIntegration('website', 'inbound', 'duplicate', body);
      return res.status(409).json({ error: 'Duplicate lead or student', duplicate: result.duplicate });
    }

    await logIntegration('website', 'inbound', 'received', body);
    return res.status(201).json(result.lead);
  } catch (error) {
    logger.error('Failed to receive website lead', { error });
    return res.status(500).json({ error: 'Failed to receive website lead' });
  }
});

const ensureIncomingSourceId = async (
  executor: QueryExecutor,
  source: { code: string; name: string; channel: string },
): Promise<number> => {
  const { rows: created } = await executor.query(
    `INSERT INTO academy_lead_sources (code, name, channel, is_system, is_active)
     VALUES ($1, $2, $3, true, true)
     ON CONFLICT (code) DO UPDATE
     SET name = EXCLUDED.name,
         channel = EXCLUDED.channel,
         is_system = true,
         is_active = true,
         updated_at = NOW()
     RETURNING id`,
    [source.code, source.name, source.channel],
  );
  return Number(created[0].id);
};

const logIntegration = async (provider: string, direction: string, status: string, payload: unknown) => {
  try {
    await pool.query(
      `INSERT INTO academy_integration_logs (provider, direction, status, payload, retry_count) VALUES ($1,$2,$3,$4,0)`,
      [provider, direction, status, JSON.stringify(payload)],
    );
  } catch (error) {
    logger.error('Failed to write integration log', { provider, direction, status, error });
  }
};

type InstagramSignedRequestResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; status: number; error: string };

const parseInstagramSignedRequest = (value: unknown): InstagramSignedRequestResult => {
  const signedRequest = Array.isArray(value) ? value[0] : value;
  if (typeof signedRequest !== 'string' || !signedRequest.includes('.')) {
    return { ok: false, status: 400, error: 'Missing signed_request' };
  }

  const appSecret = appConfig.integrations?.instagram?.appSecret?.trim();
  if (!appSecret) {
    return { ok: false, status: 503, error: 'Instagram app secret is not configured' };
  }

  const [encodedSignature, encodedPayload] = signedRequest.split('.', 2);
  try {
    const suppliedSignature = Buffer.from(encodedSignature, 'base64url');
    const expectedSignature = crypto
      .createHmac('sha256', appSecret)
      .update(encodedPayload)
      .digest();

    if (
      suppliedSignature.length !== expectedSignature.length
      || !crypto.timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      return { ok: false, status: 401, error: 'Invalid signed_request signature' };
    }

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Record<string, unknown>;
    const algorithm = typeof payload.algorithm === 'string' ? payload.algorithm.toUpperCase() : 'HMAC-SHA256';
    if (algorithm !== 'HMAC-SHA256') {
      return { ok: false, status: 400, error: 'Unsupported signed_request algorithm' };
    }
    return { ok: true, payload };
  } catch {
    return { ok: false, status: 400, error: 'Invalid signed_request payload' };
  }
};

const extractInstagramSignedUserId = (payload: Record<string, unknown>): string | null => {
  const value = payload.user_id ?? payload.profile_id ?? payload.instagram_user_id ?? payload.ig_user_id;
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
};

const createInstagramDataDeletionConfirmationCode = (igUserId: string | null) =>
  crypto
    .createHash('sha256')
    .update(`${igUserId ?? 'unknown'}:${Date.now()}:${crypto.randomUUID()}`)
    .digest('hex')
    .slice(0, 32);

// Parse JSON bodies for these public webhook routes (mounted before the authed academy router).
function expressRawJson(_req: any, _res: any, next: any) {
  // Express json() is applied globally before route mounting, so bodies are already parsed.
  next();
}

export default router;
