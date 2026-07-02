import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db';
import { appConfig } from '../config';
import { logger } from '../lib/logger';
import { hasLeadershipAccess } from '@shared/academy';

type InstagramBroadcast = (data: any) => void;
type InstagramUser = {
  id: number;
  workspace: string;
  workspaces?: string[] | null;
};

type InstagramAccountRow = {
  id: number;
  ig_user_id: string;
  username: string;
  access_token_encrypted: string | null;
  token_expires_at: Date | string | null;
  source_id: number;
  status: string;
};

type InstagramProfile = {
  id?: string;
  user_id?: string;
  username?: string;
  name?: string;
  profile_pic?: string;
  profile_picture_url?: string;
};

const INSTAGRAM_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
];
const INSTAGRAM_WEBHOOK_FIELDS = [
  'messages',
  'messaging_postbacks',
  'messaging_seen',
  'message_reactions',
];
const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000;

let broadcastToClients: InstagramBroadcast = () => undefined;

const leadershipUserAccessSql = `
  (
    u.workspace = 'administration'
    OR EXISTS (
      SELECT 1
      FROM user_workspaces uw
      WHERE uw.user_id = u.id AND uw.workspace = 'administration'
    )
  )
`;
const salesUserAccessSql = `
  (
    u.workspace = 'sales'
    OR EXISTS (
      SELECT 1
      FROM user_workspaces uw
      WHERE uw.user_id = u.id AND uw.workspace = 'sales'
    )
  )
`;

export const setInstagramBroadcastFunction = (broadcast: InstagramBroadcast) => {
  broadcastToClients = broadcast;
};

const instagramConfig = () => {
  const config = appConfig.integrations?.instagram;
  return {
    appId: config?.appId?.trim() ?? '',
    appSecret: config?.appSecret?.trim() ?? '',
    verifyToken: config?.verifyToken?.trim() ?? '',
    apiVersion: config?.apiVersion?.trim() || 'v25.0',
    graphApiUrl: (config?.graphApiUrl?.trim() || 'https://graph.instagram.com').replace(/\/$/, ''),
    oauthUrl: config?.oauthUrl?.trim() || 'https://www.instagram.com/oauth/authorize',
    tokenEncryptionKey: config?.tokenEncryptionKey?.trim() || appConfig.session.secret,
  };
};

export const getInstagramIntegrationConfig = () => {
  const config = instagramConfig();
  const appUrl = appConfig.server.appUrl.replace(/\/$/, '');
  return {
    configured: Boolean(config.appId && config.appSecret && config.verifyToken),
    appIdConfigured: Boolean(config.appId),
    appSecretConfigured: Boolean(config.appSecret),
    verifyTokenConfigured: Boolean(config.verifyToken),
    apiVersion: config.apiVersion,
    redirectUri: `${appUrl}/api/instagram/oauth/callback`,
    webhookUrl: `${appUrl}/api/incoming/instagram`,
    scopes: INSTAGRAM_SCOPES,
    webhookFields: INSTAGRAM_WEBHOOK_FIELDS,
  };
};

const getEncryptionKey = () =>
  crypto.createHash('sha256').update(instagramConfig().tokenEncryptionKey).digest();

export const encryptInstagramToken = (value: string) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString('base64url')).join('.');
};

export const decryptInstagramToken = (value: string) => {
  const [ivEncoded, tagEncoded, ciphertextEncoded] = value.split('.');
  if (!ivEncoded || !tagEncoded || !ciphertextEncoded) {
    throw new Error('Invalid encrypted Instagram token');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(ivEncoded, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextEncoded, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
};

export const buildInstagramAuthorizationUrl = (state: string) => {
  const config = instagramConfig();
  if (!config.appId || !config.appSecret || !config.verifyToken) {
    throw Object.assign(new Error('instagramIntegrationNotConfigured'), { statusCode: 409 });
  }

  const url = new URL(config.oauthUrl);
  url.searchParams.set('client_id', config.appId);
  url.searchParams.set('redirect_uri', getInstagramIntegrationConfig().redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', INSTAGRAM_SCOPES.join(','));
  url.searchParams.set('state', state);
  url.searchParams.set('enable_fb_login', '0');
  url.searchParams.set('force_authentication', '1');
  return url.toString();
};

const fetchInstagramJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const raw = await response.text();
  let body: any = null;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = { raw };
  }

  if (!response.ok || body?.error) {
    const message = body?.error?.message || body?.error_message || raw || `Instagram API ${response.status}`;
    throw Object.assign(new Error(message), {
      statusCode: response.status >= 400 && response.status < 500 ? 409 : 502,
      instagramResponse: body,
    });
  }
  return body as T;
};

const subscribeInstagramAccount = async (accessToken: string) => {
  const config = instagramConfig();
  const url = new URL(`${config.graphApiUrl}/${config.apiVersion}/me/subscribed_apps`);
  url.searchParams.set('subscribed_fields', INSTAGRAM_WEBHOOK_FIELDS.join(','));
  url.searchParams.set('access_token', accessToken);
  return fetchInstagramJson<{ success?: boolean }>(url.toString(), { method: 'POST' });
};

export const exchangeInstagramAuthorizationCode = async (code: string, connectedBy: number) => {
  const config = instagramConfig();
  if (!config.appId || !config.appSecret) {
    throw Object.assign(new Error('instagramIntegrationNotConfigured'), { statusCode: 409 });
  }

  const tokenForm = new FormData();
  tokenForm.set('client_id', config.appId);
  tokenForm.set('client_secret', config.appSecret);
  tokenForm.set('grant_type', 'authorization_code');
  tokenForm.set('redirect_uri', getInstagramIntegrationConfig().redirectUri);
  tokenForm.set('code', code);

  const shortToken = await fetchInstagramJson<{
    access_token: string;
    user_id?: string | number;
  }>('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    body: tokenForm,
  });

  const longTokenUrl = new URL(`${config.graphApiUrl}/access_token`);
  longTokenUrl.searchParams.set('grant_type', 'ig_exchange_token');
  longTokenUrl.searchParams.set('client_secret', config.appSecret);
  longTokenUrl.searchParams.set('access_token', shortToken.access_token);
  const longToken = await fetchInstagramJson<{
    access_token: string;
    token_type?: string;
    expires_in?: number;
  }>(longTokenUrl.toString());

  const profileUrl = new URL(`${config.graphApiUrl}/${config.apiVersion}/me`);
  profileUrl.searchParams.set('fields', 'user_id,username');
  profileUrl.searchParams.set('access_token', longToken.access_token);
  const profile = await fetchInstagramJson<InstagramProfile>(profileUrl.toString());
  const igUserId = String(profile.user_id ?? profile.id ?? shortToken.user_id ?? '');
  if (!igUserId) {
    throw Object.assign(new Error('instagramAccountIdMissing'), { statusCode: 502 });
  }
  const username = String(profile.username || `instagram_${igUserId}`);

  await subscribeInstagramAccount(longToken.access_token);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT id FROM instagram_accounts WHERE ig_user_id = $1 FOR UPDATE`,
      [igUserId],
    );
    const source = await client.query(
      `INSERT INTO academy_lead_sources
        (code, name, channel, is_system, is_active)
       VALUES ($1,$2,'instagram',true,true)
       ON CONFLICT (code) DO UPDATE
       SET name = EXCLUDED.name,
           channel = 'instagram',
           is_system = true,
           is_active = true,
           updated_at = NOW()
       RETURNING id`,
      ['instagram', 'Instagram'],
    );
    const sourceId = Number(source.rows[0].id);

    const expiresAt = longToken.expires_in
      ? new Date(Date.now() + Number(longToken.expires_in) * 1000)
      : null;
    const account = await client.query(
      `INSERT INTO instagram_accounts
        (ig_user_id, username, access_token_encrypted, token_expires_at, source_id, status, last_error, connected_by)
       VALUES ($1,$2,$3,$4,$5,'connected',NULL,$6)
       ON CONFLICT (ig_user_id) DO UPDATE SET
         username = EXCLUDED.username,
         access_token_encrypted = EXCLUDED.access_token_encrypted,
         token_expires_at = EXCLUDED.token_expires_at,
         source_id = EXCLUDED.source_id,
         status = 'connected',
         last_error = NULL,
         connected_by = EXCLUDED.connected_by,
         updated_at = NOW()
       RETURNING id, ig_user_id, username, token_expires_at, source_id, status, created_at, updated_at`,
      [
        igUserId,
        username,
        encryptInstagramToken(longToken.access_token),
        expiresAt,
        sourceId,
        connectedBy,
      ],
    );
    await client.query(
      `INSERT INTO academy_integration_logs
        (provider, direction, status, payload, retry_count)
       VALUES ('instagram','oauth','connected',$1,0)`,
      [JSON.stringify({ igUserId, username, sourceId })],
    );
    await client.query('COMMIT');
    return camelize(account.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const disconnectInstagramAccount = async (accountId: number) => {
  const accountResult = await pool.query<InstagramAccountRow>(
    `SELECT * FROM instagram_accounts WHERE id = $1`,
    [accountId],
  );
  const account = accountResult.rows[0];
  if (!account) {
    throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
  }

  if (account.access_token_encrypted) {
    try {
      const config = instagramConfig();
      const url = new URL(`${config.graphApiUrl}/${config.apiVersion}/me/subscribed_apps`);
      url.searchParams.set('access_token', decryptInstagramToken(account.access_token_encrypted));
      await fetchInstagramJson(url.toString(), { method: 'DELETE' });
    } catch (error) {
      logger.warn('Failed to unsubscribe Instagram account during disconnect', {
        accountId,
        error,
      });
    }
  }

  const { rows } = await pool.query(
    `UPDATE instagram_accounts
     SET status = 'disconnected', access_token_encrypted = NULL, token_expires_at = NULL, updated_at = NOW()
     WHERE id = $1
     RETURNING id, ig_user_id, username, source_id, status, updated_at`,
    [accountId],
  );
  await logInstagramIntegration('oauth', 'disconnected', {
    accountId,
    igUserId: account.ig_user_id,
  });
  return camelize(rows[0]);
};

export const verifyInstagramWebhookSignature = (rawBody: Buffer | undefined, signature: string | undefined) => {
  const appSecret = instagramConfig().appSecret;
  if (!appSecret) return appConfig.server.environment !== 'production';
  if (!rawBody || !signature?.startsWith('sha256=')) return false;

  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(signature);
  return expectedBuffer.length === suppliedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
};

export const verifyInstagramWebhookChallenge = (mode: unknown, token: unknown) => {
  const expected = instagramConfig().verifyToken;
  return mode === 'subscribe' && Boolean(expected) && token === expected;
};

const extractMessageContent = (message: any) => {
  if (typeof message?.text === 'string' && message.text.trim()) {
    return { content: message.text.trim(), messageType: 'text' };
  }

  const attachment = Array.isArray(message?.attachments) ? message.attachments[0] : null;
  if (attachment) {
    const type = String(attachment.type || 'attachment');
    const url = attachment.payload?.url;
    return {
      content: url ? `[${type}] ${url}` : `[${type}]`,
      messageType: type,
    };
  }
  return { content: '[Instagram message]', messageType: 'unknown' };
};

const getParticipantProfile = async (
  participantIgsid: string,
  accessToken: string,
): Promise<InstagramProfile> => {
  const config = instagramConfig();
  const url = new URL(`${config.graphApiUrl}/${config.apiVersion}/${participantIgsid}`);
  url.searchParams.set('fields', 'name,username,profile_pic');
  url.searchParams.set('access_token', accessToken);
  try {
    return await fetchInstagramJson<InstagramProfile>(url.toString());
  } catch (error) {
    logger.warn('Failed to fetch Instagram participant profile', { participantIgsid, error });
    return {};
  }
};

const getSystemUserId = async (client: PoolClient) => {
  const { rows } = await client.query(
    `SELECT u.id FROM users u
     WHERE ${leadershipUserAccessSql} AND u.is_active = true
     ORDER BY u.id LIMIT 1`,
  );
  if (!rows[0]?.id) {
    throw new Error('No active leadership workspace user');
  }
  return Number(rows[0].id);
};

const getLeadAssigneeId = async (client: PoolClient, fallbackUserId: number) => {
  const { rows } = await client.query(
    `SELECT u.id
     FROM users u
     LEFT JOIN academy_leads l
       ON l.manager_id = u.id
      AND l.status_code NOT IN ('paid', 'not_now')
      AND COALESCE(l.is_archived, false) = false
     WHERE ${salesUserAccessSql} AND u.is_active = true
     GROUP BY u.id
     ORDER BY COUNT(l.id), u.id
     LIMIT 1`,
  );
  return rows[0]?.id ? Number(rows[0].id) : fallbackUserId;
};

const ensureLeadForConversation = async (
  client: PoolClient,
  account: InstagramAccountRow,
  conversation: any,
  participantIgsid: string,
  profile: InstagramProfile,
) => {
  if (conversation.lead_id) {
    const existing = await client.query(
      `SELECT id, manager_id FROM academy_leads WHERE id = $1`,
      [conversation.lead_id],
    );
    if (existing.rows[0]) return existing.rows[0];
  }

  const syntheticPhone = `instagram:${participantIgsid}`.slice(0, 50);
  const existing = await client.query(
    `SELECT id, manager_id FROM academy_leads WHERE phone = $1 LIMIT 1`,
    [syntheticPhone],
  );
  if (existing.rows[0]) {
    await client.query(
      `UPDATE instagram_conversations SET lead_id = $1, updated_at = NOW() WHERE id = $2`,
      [existing.rows[0].id, conversation.id],
    );
    return existing.rows[0];
  }

  const systemUserId = await getSystemUserId(client);
  await client.query(`SELECT pg_advisory_xact_lock(19012026)`);
  const managerId = await getLeadAssigneeId(client, systemUserId);
  const username = profile.username?.trim();
  const contactName = String(profile.name || (username ? `@${username}` : 'Instagram lead')).slice(0, 255);
  const messenger = username ? `@${username}`.slice(0, 120) : syntheticPhone.slice(0, 120);

  const inserted = await client.query(
    `INSERT INTO academy_leads
      (contact_name, phone, messenger, source_id, status_code, manager_id, language, comment, created_by)
     VALUES ($1,$2,$3,$4,'new_request',$5,'ru',$6,$7)
     RETURNING id, manager_id`,
    [
      contactName,
      syntheticPhone,
      messenger,
      account.source_id,
      managerId,
      'Создан автоматически из нового диалога Instagram.',
      systemUserId,
    ],
  );
  const lead = inserted.rows[0];

  await client.query(
    `UPDATE instagram_conversations SET lead_id = $1, updated_at = NOW() WHERE id = $2`,
    [lead.id, conversation.id],
  );
  await client.query(
    `INSERT INTO academy_lead_stage_history
      (lead_id, from_status_code, to_status_code, changed_by, comment)
     VALUES ($1,NULL,'new_request',$2,'Instagram Direct')`,
    [lead.id, systemUserId],
  );
  await client.query(
    `INSERT INTO academy_lead_assignment_history
      (lead_id, from_manager_id, to_manager_id, changed_by, comment)
     VALUES ($1,NULL,$2,$3,'Автоматическое распределение лида из Instagram')`,
    [lead.id, managerId, systemUserId],
  );
  await client.query(
    `INSERT INTO academy_tasks
      (title, description, responsible_id, deadline_at, entity_type, entity_id, status)
     VALUES ('Ответить на сообщение в Instagram','Новый лид написал в Direct. Ответить в течение 15 минут.',$1,NOW() + INTERVAL '15 minutes','lead',$2,'new')`,
    [managerId, lead.id],
  );
  await client.query(
    `INSERT INTO notifications
      (user_id, type, title, message, related_entity_type, related_entity_id)
     VALUES ($1,'instagram_lead','Новый лид из Instagram',$2,'lead',$3)`,
    [managerId, `${contactName} написал(а) в Instagram Direct.`, lead.id],
  );

  return lead;
};

const processMessagingEvent = async (account: InstagramAccountRow, event: any) => {
  const message = event?.message;
  if (!message || (!message.mid && !message.text && !message.attachments)) return;

  const senderIgsid = String(event.sender?.id ?? '');
  const recipientIgsid = String(event.recipient?.id ?? '');
  if (!senderIgsid || !recipientIgsid) return;

  const outbound = Boolean(message.is_echo) || senderIgsid === String(account.ig_user_id);
  const participantIgsid = outbound ? recipientIgsid : senderIgsid;
  if (!participantIgsid || participantIgsid === String(account.ig_user_id)) return;

  const accessToken = account.access_token_encrypted
    ? decryptInstagramToken(account.access_token_encrypted)
    : null;
  const profile = !outbound && accessToken
    ? await getParticipantProfile(participantIgsid, accessToken)
    : {};
  const { content, messageType } = extractMessageContent(message);
  const eventDate = Number.isFinite(Number(event.timestamp))
    ? new Date(Number(event.timestamp))
    : new Date();

  const client = await pool.connect();
  let result: {
    message?: any;
    lead?: any;
    managerId?: number | null;
    conversationId?: number;
    inserted: boolean;
  } = { inserted: false };

  try {
    await client.query('BEGIN');
    const conversationResult = await client.query(
      `INSERT INTO instagram_conversations
        (account_id, participant_igsid, participant_username, participant_name,
         participant_profile_picture_url, last_message_at, last_inbound_at, last_outbound_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (account_id, participant_igsid) DO UPDATE SET
         participant_username = COALESCE(EXCLUDED.participant_username, instagram_conversations.participant_username),
         participant_name = COALESCE(EXCLUDED.participant_name, instagram_conversations.participant_name),
         participant_profile_picture_url = COALESCE(EXCLUDED.participant_profile_picture_url, instagram_conversations.participant_profile_picture_url),
         updated_at = NOW()
       RETURNING *`,
      [
        account.id,
        participantIgsid,
        profile.username ?? null,
        profile.name ?? null,
        profile.profile_pic ?? profile.profile_picture_url ?? null,
        eventDate,
        outbound ? null : eventDate,
        outbound ? eventDate : null,
      ],
    );
    const conversation = conversationResult.rows[0];
    const lead = outbound
      ? conversation.lead_id
        ? (await client.query(`SELECT id, manager_id FROM academy_leads WHERE id = $1`, [conversation.lead_id])).rows[0]
        : null
      : await ensureLeadForConversation(client, account, conversation, participantIgsid, profile);

    const messageResult = await client.query(
      `INSERT INTO instagram_messages
        (conversation_id, external_message_id, direction, sender_igsid, recipient_igsid,
         content, message_type, status, raw_payload, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (external_message_id) DO NOTHING
       RETURNING *`,
      [
        conversation.id,
        message.mid ?? null,
        outbound ? 'outbound' : 'inbound',
        senderIgsid,
        recipientIgsid,
        content,
        messageType,
        outbound ? 'sent' : 'received',
        JSON.stringify(event),
        eventDate,
      ],
    );

    if (messageResult.rows[0]) {
      await client.query(
        `UPDATE instagram_conversations
         SET last_message_at = $2,
             last_inbound_at = CASE WHEN $3 = 'inbound' THEN $2 ELSE last_inbound_at END,
             last_outbound_at = CASE WHEN $3 = 'outbound' THEN $2 ELSE last_outbound_at END,
             unread_count = CASE WHEN $3 = 'inbound' THEN unread_count + 1 ELSE unread_count END,
             updated_at = NOW()
         WHERE id = $1`,
        [conversation.id, eventDate, outbound ? 'outbound' : 'inbound'],
      );
      result = {
        message: camelize(messageResult.rows[0]),
        lead: lead ? camelize(lead) : null,
        managerId: lead?.manager_id ? Number(lead.manager_id) : null,
        conversationId: Number(conversation.id),
        inserted: true,
      };
    }

    await client.query(
      `UPDATE instagram_accounts SET last_webhook_at = NOW(), last_error = NULL, updated_at = NOW() WHERE id = $1`,
      [account.id],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  if (result.inserted) {
    broadcastToClients({
      type: 'INSTAGRAM_CONVERSATION_UPDATED',
      data: {
        conversationId: result.conversationId,
        message: result.message,
        leadId: result.lead?.id,
      },
      audienceUserIds: result.managerId ? [result.managerId] : undefined,
    });
    if (!outbound && result.lead?.id) {
      broadcastToClients({
        type: 'ACADEMY_LEAD_CREATED',
        data: { id: result.lead.id },
        audienceUserIds: result.managerId ? [result.managerId] : undefined,
      });
    }
  }
};

export const processInstagramWebhook = async (payload: any) => {
  if (payload?.object !== 'instagram' || !Array.isArray(payload.entry)) {
    return { processed: 0 };
  }

  let processed = 0;
  for (const entry of payload.entry) {
    const igUserId = String(entry?.id ?? '');
    if (!igUserId) continue;
    const accountResult = await pool.query<InstagramAccountRow>(
      `SELECT * FROM instagram_accounts WHERE ig_user_id = $1 AND status = 'connected' LIMIT 1`,
      [igUserId],
    );
    const account = accountResult.rows[0];
    if (!account) {
      logger.warn('Instagram webhook received for an unknown account', { igUserId });
      continue;
    }

    const messagingEvents = Array.isArray(entry.messaging) ? entry.messaging : [];
    for (const event of messagingEvents) {
      await processMessagingEvent(account, event);
      processed += 1;
    }
  }

  await logInstagramIntegration('inbound', 'received', {
    entries: payload.entry.length,
    processed,
  });
  return { processed };
};

const assertConversationAccess = async (conversationId: number, user: InstagramUser) => {
  const { rows } = await pool.query(
    `SELECT c.*, a.ig_user_id, a.username AS account_username, a.access_token_encrypted,
            a.status AS account_status, l.manager_id, l.contact_name, l.id AS lead_id
     FROM instagram_conversations c
     JOIN instagram_accounts a ON a.id = c.account_id
     LEFT JOIN academy_leads l ON l.id = c.lead_id
     WHERE c.id = $1`,
    [conversationId],
  );
  const conversation = rows[0];
  if (!conversation) {
    throw Object.assign(new Error('resourceNotFound'), { statusCode: 404 });
  }
  if (!hasLeadershipAccess(user) && Number(conversation.manager_id) !== Number(user.id)) {
    throw Object.assign(new Error('accessDenied'), { statusCode: 403 });
  }
  return conversation;
};

export const listInstagramAccounts = async () => {
  const { rows } = await pool.query(
    `SELECT a.id, a.ig_user_id, a.username, a.display_name, a.profile_picture_url,
            a.token_expires_at, a.source_id, a.status, a.last_webhook_at, a.last_error,
            a.created_at, a.updated_at, s.name AS source_name,
            COUNT(DISTINCT c.id)::int AS conversation_count,
            COUNT(DISTINCT c.lead_id)::int AS lead_count
     FROM instagram_accounts a
     JOIN academy_lead_sources s ON s.id = a.source_id
     LEFT JOIN instagram_conversations c ON c.account_id = a.id
     GROUP BY a.id, s.name
     ORDER BY a.created_at DESC`,
  );
  return rows.map(camelize);
};

export const listInstagramConversations = async (user: InstagramUser) => {
  const params: unknown[] = [];
  const ownershipFilter = hasLeadershipAccess(user)
    ? ''
    : `AND l.manager_id = $${params.push(user.id)}`;
  const { rows } = await pool.query(
    `SELECT c.id, c.account_id, c.lead_id, c.participant_igsid, c.participant_username,
            c.participant_name, c.participant_profile_picture_url, c.unread_count,
            c.last_message_at, c.last_inbound_at, c.last_outbound_at,
            a.username AS account_username, a.status AS account_status,
            l.contact_name, l.status_code, l.manager_id, u.full_name AS manager_name,
            last_message.content AS last_message,
            last_message.direction AS last_message_direction
     FROM instagram_conversations c
     JOIN instagram_accounts a ON a.id = c.account_id
     LEFT JOIN academy_leads l ON l.id = c.lead_id
     LEFT JOIN users u ON u.id = l.manager_id
     LEFT JOIN LATERAL (
       SELECT content, direction
       FROM instagram_messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT 1
     ) last_message ON true
     WHERE a.status = 'connected' ${ownershipFilter}
     ORDER BY c.last_message_at DESC NULLS LAST, c.id DESC`,
    params,
  );
  return rows.map((row) => ({
    ...camelize(row),
    canReply: isWithinMessagingWindow(row.last_inbound_at),
    messagingWindowExpiresAt: row.last_inbound_at
      ? new Date(new Date(row.last_inbound_at).getTime() + MESSAGING_WINDOW_MS)
      : null,
  }));
};

export const listInstagramMessages = async (conversationId: number, user: InstagramUser) => {
  await assertConversationAccess(conversationId, user);
  const { rows } = await pool.query(
    `SELECT id, conversation_id, external_message_id, direction, sender_igsid,
            recipient_igsid, content, message_type, status, sent_by, created_at, updated_at
     FROM instagram_messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC, id ASC`,
    [conversationId],
  );
  return rows.map(camelize);
};

export const markInstagramConversationRead = async (conversationId: number, user: InstagramUser) => {
  await assertConversationAccess(conversationId, user);
  const { rows } = await pool.query(
    `UPDATE instagram_conversations
     SET unread_count = 0, updated_at = NOW()
     WHERE id = $1
     RETURNING id, unread_count, updated_at`,
    [conversationId],
  );
  return camelize(rows[0]);
};

export const sendInstagramTextMessage = async (
  conversationId: number,
  text: string,
  user: InstagramUser,
) => {
  const conversation = await assertConversationAccess(conversationId, user);
  if (conversation.account_status !== 'connected' || !conversation.access_token_encrypted) {
    throw Object.assign(new Error('instagramAccountDisconnected'), { statusCode: 409 });
  }
  if (!isWithinMessagingWindow(conversation.last_inbound_at)) {
    throw Object.assign(new Error('instagramMessagingWindowExpired'), { statusCode: 409 });
  }

  const config = instagramConfig();
  const accessToken = decryptInstagramToken(conversation.access_token_encrypted);
  const url = `${config.graphApiUrl}/${config.apiVersion}/${conversation.ig_user_id}/messages`;
  const response = await fetchInstagramJson<{
    recipient_id?: string;
    message_id?: string;
  }>(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      recipient: { id: conversation.participant_igsid },
      message: { text },
    }),
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO instagram_messages
        (conversation_id, external_message_id, direction, sender_igsid, recipient_igsid,
         content, message_type, status, sent_by)
       VALUES ($1,$2,'outbound',$3,$4,$5,'text','sent',$6)
       ON CONFLICT (external_message_id) DO UPDATE SET
         status = 'sent',
         updated_at = NOW()
       RETURNING *`,
      [
        conversationId,
        response.message_id ?? null,
        conversation.ig_user_id,
        conversation.participant_igsid,
        text,
        user.id,
      ],
    );
    await client.query(
      `UPDATE instagram_conversations
       SET last_message_at = NOW(), last_outbound_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [conversationId],
    );
    await client.query(
      `INSERT INTO academy_communications
        (lead_id, channel, result, comment, created_by)
       VALUES ($1,'instagram','message_sent',$2,$3)`,
      [conversation.lead_id ?? null, text, user.id],
    );
    await client.query('COMMIT');
    const message = camelize(inserted.rows[0]);
    broadcastToClients({
      type: 'INSTAGRAM_CONVERSATION_UPDATED',
      data: { conversationId, message },
      audienceUserIds: conversation.manager_id ? [Number(conversation.manager_id)] : undefined,
    });
    return message;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const refreshExpiringInstagramTokens = async () => {
  const { rows } = await pool.query<InstagramAccountRow>(
    `SELECT * FROM instagram_accounts
     WHERE status = 'connected'
       AND access_token_encrypted IS NOT NULL
       AND (token_expires_at IS NULL OR token_expires_at < NOW() + INTERVAL '14 days')`,
  );
  const config = instagramConfig();
  let refreshed = 0;

  for (const account of rows) {
    try {
      const currentToken = decryptInstagramToken(account.access_token_encrypted!);
      const url = new URL(`${config.graphApiUrl}/refresh_access_token`);
      url.searchParams.set('grant_type', 'ig_refresh_token');
      url.searchParams.set('access_token', currentToken);
      const result = await fetchInstagramJson<{ access_token: string; expires_in?: number }>(url.toString());
      const expiresAt = result.expires_in
        ? new Date(Date.now() + Number(result.expires_in) * 1000)
        : null;
      await pool.query(
        `UPDATE instagram_accounts
         SET access_token_encrypted = $1, token_expires_at = $2, last_error = NULL, updated_at = NOW()
         WHERE id = $3`,
        [encryptInstagramToken(result.access_token), expiresAt, account.id],
      );
      refreshed += 1;
    } catch (error: any) {
      await pool.query(
        `UPDATE instagram_accounts SET last_error = $1, updated_at = NOW() WHERE id = $2`,
        [error?.message ?? String(error), account.id],
      );
      logger.error('Failed to refresh Instagram access token', { accountId: account.id, error });
    }
  }
  return refreshed;
};

const isWithinMessagingWindow = (lastInboundAt: Date | string | null | undefined) => {
  if (!lastInboundAt) return false;
  const time = new Date(lastInboundAt).getTime();
  return Number.isFinite(time) && Date.now() - time <= MESSAGING_WINDOW_MS;
};

const camelize = (row: Record<string, any>) =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
      value,
    ]),
  );

const logInstagramIntegration = async (direction: string, status: string, payload: unknown) => {
  try {
    await pool.query(
      `INSERT INTO academy_integration_logs
        (provider, direction, status, payload, retry_count)
       VALUES ('instagram',$1,$2,$3,0)`,
      [direction, status, JSON.stringify(payload)],
    );
  } catch (error) {
    logger.error('Failed to write Instagram integration log', { error, direction, status });
  }
};
