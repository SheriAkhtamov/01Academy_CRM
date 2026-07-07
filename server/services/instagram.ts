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

type InstagramGraphListResponse<T> = {
  data?: T[];
  paging?: {
    next?: string;
  };
};

type InstagramGraphParticipant = {
  id?: string;
  username?: string;
  name?: string;
  profile_pic?: string;
  profile_picture_url?: string;
};

type InstagramGraphMessage = {
  id?: string;
  created_time?: string;
  from?: InstagramGraphParticipant;
  to?: {
    data?: InstagramGraphParticipant[];
  } | InstagramGraphParticipant;
  message?: string;
  attachments?: {
    data?: any[];
  } | any[];
  shares?: {
    data?: any[];
  } | any[];
  sticker?: string;
};

type InstagramGraphConversation = {
  id: string;
  updated_time?: string;
  participants?: InstagramGraphListResponse<InstagramGraphParticipant>;
  messages?: InstagramGraphListResponse<InstagramGraphMessage>;
};

type InstagramImportStats = {
  accounts: number;
  conversations: number;
  conversationsCreated: number;
  messages: number;
  leadsCreated: number;
  skipped: number;
  errors: number;
};

type InstagramImportJobStatus = {
  status: 'idle' | 'running' | 'completed' | 'partial' | 'failed';
  requestedBy: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  stats: InstagramImportStats;
  error: string | null;
};

type EnsureLeadOptions = {
  createTask?: boolean;
  notify?: boolean;
  leadComment?: string;
  stageComment?: string;
  assignmentComment?: string;
};

const INSTAGRAM_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_comments',
  'instagram_business_manage_messages',
];
const INSTAGRAM_WEBHOOK_FIELDS = [
  'messages',
  'messaging_postbacks',
  'messaging_seen',
  'message_reactions',
];
const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000;
const INSTAGRAM_FETCH_TIMEOUT_MS = 30_000;

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

export const buildInstagramAuthorizationUrl = (state: string, redirectUri = getInstagramIntegrationConfig().redirectUri) => {
  const config = instagramConfig();
  if (!config.appId || !config.appSecret || !config.verifyToken) {
    throw Object.assign(new Error('instagramIntegrationNotConfigured'), { statusCode: 409 });
  }

  const url = new URL(config.oauthUrl);
  url.searchParams.set('client_id', config.appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', INSTAGRAM_SCOPES.join(','));
  url.searchParams.set('state', state);
  return url.toString();
};

const fetchInstagramJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), INSTAGRAM_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: init?.signal ?? timeoutController.signal,
    });
  } catch (error: any) {
    const message = error?.name === 'AbortError'
      ? 'Instagram API request timed out'
      : error?.message || 'Instagram API request failed';
    throw Object.assign(new Error(message), {
      statusCode: 502,
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
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
      statusCode: body?.error?.code === 4
        ? 429
        : response.status >= 400 && response.status < 500
          ? 409
          : 502,
      instagramResponse: body,
    });
  }
  return body as T;
};

const isInstagramRateLimitError = (error: any) =>
  error?.statusCode === 429
  || error?.instagramResponse?.error?.code === 4
  || String(error?.message ?? '').toLowerCase().includes('request limit');

const fetchInstagramPages = async <T>(initialUrl: string, maxPages = 100) => {
  const items: T[] = [];
  let nextUrl: string | undefined = initialUrl;
  let page = 0;

  while (nextUrl && page < maxPages) {
    const body: InstagramGraphListResponse<T> = await fetchInstagramJson<InstagramGraphListResponse<T>>(nextUrl);
    items.push(...(body.data ?? []));
    nextUrl = body.paging?.next;
    page += 1;
  }

  return items;
};

const normalizeInstagramUsername = (value: unknown) =>
  String(value ?? '').trim().replace(/^@+/, '').toLowerCase();

const parseInstagramDate = (value: unknown) => {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
};

const maxInstagramDate = (dates: Array<Date | null>) => {
  const timestamp = dates.reduce((latest, date) => {
    if (!date) return latest;
    return Math.max(latest, date.getTime());
  }, 0);
  return timestamp > 0 ? new Date(timestamp) : null;
};

const getGraphParticipantList = (participants: InstagramGraphConversation['participants']) =>
  Array.isArray(participants?.data) ? participants.data : [];

const getGraphRecipientList = (message: InstagramGraphMessage) => {
  const to = message.to as any;
  if (Array.isArray(to?.data)) return to.data as InstagramGraphParticipant[];
  if (to?.id || to?.username) return [to as InstagramGraphParticipant];
  return [];
};

const isAccountParticipant = (participant: InstagramGraphParticipant | undefined, account: InstagramAccountRow) => {
  if (!participant) return false;
  const participantId = String(participant.id ?? '');
  return participantId === String(account.ig_user_id)
    || normalizeInstagramUsername(participant.username) === normalizeInstagramUsername(account.username);
};

const findConversationParticipant = (
  conversation: InstagramGraphConversation,
  messages: InstagramGraphMessage[],
  account: InstagramAccountRow,
) => {
  const explicitParticipant = getGraphParticipantList(conversation.participants)
    .find((participant) => !isAccountParticipant(participant, account));
  if (explicitParticipant?.id) return explicitParticipant;

  for (const message of messages) {
    if (message.from?.id && !isAccountParticipant(message.from, account)) {
      return message.from;
    }
    const recipient = getGraphRecipientList(message)
      .find((participant) => participant.id && !isAccountParticipant(participant, account));
    if (recipient?.id) return recipient;
  }

  return explicitParticipant ?? null;
};

const extractImportedMessageContent = (message: InstagramGraphMessage) => {
  const text = typeof message?.message === 'string' ? message.message.trim() : '';
  const attachments = extractAttachments(message);
  let messageType = 'text';
  if (attachments.length) messageType = primaryTypeFromAttachments(attachments);
  else if (message?.sticker) messageType = 'sticker';
  const content = text || (attachments.length ? `[${messageType}]` : '[Instagram message]');
  return { content, messageType, attachments };
};

const resolveImportedMessageParties = (
  message: InstagramGraphMessage,
  account: InstagramAccountRow,
  participantIgsid: string,
) => {
  const sender = message.from;
  const recipients = getGraphRecipientList(message);
  const outbound = isAccountParticipant(sender, account);
  const senderIgsid = String(sender?.id ?? (outbound ? account.ig_user_id : participantIgsid));
  const recipient = outbound
    ? recipients.find((item) => !isAccountParticipant(item, account))
    : recipients.find((item) => isAccountParticipant(item, account)) ?? recipients[0];
  const recipientIgsid = String(recipient?.id ?? (outbound ? participantIgsid : account.ig_user_id));

  return {
    direction: outbound ? 'outbound' : 'inbound',
    senderIgsid,
    recipientIgsid,
  };
};

const subscribeInstagramAccount = async (igUserId: string, accessToken: string) => {
  const config = instagramConfig();
  const url = new URL(`${config.graphApiUrl}/${config.apiVersion}/${igUserId}/subscribed_apps`);
  url.searchParams.set('subscribed_fields', INSTAGRAM_WEBHOOK_FIELDS.join(','));
  url.searchParams.set('access_token', accessToken);
  return fetchInstagramJson<{ success?: boolean }>(url.toString(), { method: 'POST' });
};

const ensureInstagramLeadSource = async (client: PoolClient) => {
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
  return Number(source.rows[0].id);
};

export const exchangeInstagramAuthorizationCode = async (
  code: string,
  connectedBy: number,
  redirectUri = getInstagramIntegrationConfig().redirectUri,
) => {
  const config = instagramConfig();
  if (!config.appId || !config.appSecret) {
    throw Object.assign(new Error('instagramIntegrationNotConfigured'), { statusCode: 409 });
  }

  logger.info('Instagram OAuth exchange started', {
    redirectUri,
    codeLength: code.length,
    apiVersion: config.apiVersion,
    graphApiUrl: config.graphApiUrl,
  });

  const tokenForm = new URLSearchParams();
  tokenForm.set('client_id', config.appId);
  tokenForm.set('client_secret', config.appSecret);
  tokenForm.set('grant_type', 'authorization_code');
  tokenForm.set('redirect_uri', redirectUri);
  tokenForm.set('code', code);

  const shortToken = await fetchInstagramJson<{
    access_token: string;
    user_id?: string | number;
  }>('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    body: tokenForm,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });
  logger.info('Instagram OAuth short token exchanged', {
    hasAccessToken: Boolean(shortToken.access_token),
    userId: shortToken.user_id ? String(shortToken.user_id) : null,
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
  logger.info('Instagram OAuth long token exchanged', {
    tokenType: longToken.token_type ?? null,
    expiresIn: longToken.expires_in ?? null,
    hasAccessToken: Boolean(longToken.access_token),
  });

  const profileUrl = new URL(`${config.graphApiUrl}/${config.apiVersion}/me`);
  profileUrl.searchParams.set('fields', 'user_id,username');
  profileUrl.searchParams.set('access_token', longToken.access_token);
  const profile = await fetchInstagramJson<InstagramProfile>(profileUrl.toString());
  const igUserId = String(profile.user_id ?? profile.id ?? shortToken.user_id ?? '');
  if (!igUserId) {
    throw Object.assign(new Error('instagramAccountIdMissing'), { statusCode: 502 });
  }
  const username = String(profile.username || `instagram_${igUserId}`);
  logger.info('Instagram OAuth profile loaded', { igUserId, username });

  await subscribeInstagramAccount(igUserId, longToken.access_token);
  logger.info('Instagram OAuth subscribed account to webhooks', { igUserId });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT id FROM instagram_accounts WHERE ig_user_id = $1 FOR UPDATE`,
      [igUserId],
    );
    const sourceId = await ensureInstagramLeadSource(client);

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
    logger.info('Instagram OAuth account stored', {
      accountId: account.rows[0]?.id,
      igUserId,
      username,
    });
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

export interface InstagramMessageAttachment {
  type: 'image' | 'video' | 'animated_gif' | 'audio' | 'share' | 'sticker' | 'like' | 'file' | 'generic';
  url?: string;
  previewUrl?: string;
  link?: string;
  title?: string;
  subtitle?: string;
}

const normalizeAttachmentPayload = (attachment: any): InstagramMessageAttachment | null => {
  if (!attachment || typeof attachment !== 'object') return null;
  const type = String(attachment.type || 'attachment');
  const payload = attachment.payload && typeof attachment.payload === 'object' ? attachment.payload : {};
  const url = payload.url || payload.media_url || attachment.url || undefined;
  switch (type) {
    case 'image':
    case 'video':
    case 'animated_gif':
    case 'audio':
      return { type, url };
    case 'sticker':
      return { type: 'sticker', url };
    case 'like':
      return { type: 'like', url };
    case 'share':
    case 'xma': {
      const share = payload.share && typeof payload.share === 'object' ? payload.share : {};
      const mediaItem = Array.isArray(share.media)
        ? share.media[0]
        : Array.isArray(payload.media)
          ? payload.media[0]
          : null;
      const previewUrl =
        (mediaItem && (mediaItem.image_src || mediaItem.url)) || payload.picture || share.picture || undefined;
      const link = share.link || payload.link || undefined;
      return { type: 'share', url: url || undefined, link, title: share.name || payload.title, previewUrl };
    }
    default:
      return url ? { type: 'generic', url } : null;
  }
};

const normalizeShare = (share: any): InstagramMessageAttachment | null => {
  if (!share || typeof share !== 'object') return null;
  const mediaItem = Array.isArray(share.media) ? share.media[0] : null;
  const previewUrl =
    (mediaItem && (mediaItem.image_src || mediaItem.url)) || share.picture || undefined;
  return {
    type: 'share',
    link: share.link || undefined,
    title: share.title || share.name,
    previewUrl,
  };
};

const extractAttachments = (message: any): InstagramMessageAttachment[] => {
  const result: InstagramMessageAttachment[] = [];
  const attachments = Array.isArray(message?.attachments)
    ? message.attachments
    : Array.isArray(message?.attachments?.data)
      ? message.attachments.data
      : [];
  for (const attachment of attachments) {
    const normalized = normalizeAttachmentPayload(attachment);
    if (normalized) result.push(normalized);
  }
  const shares = Array.isArray(message?.shares)
    ? message.shares
    : Array.isArray(message?.shares?.data)
      ? message.shares.data
      : [];
  for (const share of shares) {
    const normalized = normalizeShare(share);
    if (normalized) result.push(normalized);
  }
  return result;
};

const primaryTypeFromAttachments = (attachments: InstagramMessageAttachment[]): string => {
  if (attachments.length === 0) return 'text';
  const first = attachments[0];
  if (first.type === 'share') return 'share';
  if (first.type === 'sticker') return 'sticker';
  if (
    first.type === 'image'
    || first.type === 'video'
    || first.type === 'animated_gif'
    || first.type === 'audio'
  ) {
    return first.type;
  }
  return 'attachment';
};

const extractMessageContent = (message: any) => {
  const text = typeof message?.text === 'string' ? message.text.trim() : '';
  const attachments = extractAttachments(message);
  let messageType = 'text';
  if (attachments.length) messageType = primaryTypeFromAttachments(attachments);
  else if (message?.sticker) messageType = 'sticker';
  const content = text || (attachments.length ? `[${messageType}]` : '[Instagram message]');
  return { content, messageType, attachments };
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
  options: EnsureLeadOptions = {},
) => {
  if (conversation.lead_id) {
    const existing = await client.query(
      `SELECT id, manager_id, false AS created_lead FROM academy_leads WHERE id = $1`,
      [conversation.lead_id],
    );
    if (existing.rows[0]) return existing.rows[0];
  }

  const syntheticPhone = `instagram:${participantIgsid}`.slice(0, 50);
  const existing = await client.query(
    `SELECT id, manager_id, false AS created_lead FROM academy_leads WHERE phone = $1 LIMIT 1`,
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
     RETURNING id, manager_id, true AS created_lead`,
    [
      contactName,
      syntheticPhone,
      messenger,
      account.source_id,
      managerId,
      options.leadComment ?? 'Создан автоматически из нового диалога Instagram.',
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
     VALUES ($1,NULL,'new_request',$2,$3)`,
    [lead.id, systemUserId, options.stageComment ?? 'Instagram Direct'],
  );
  await client.query(
    `INSERT INTO academy_lead_assignment_history
      (lead_id, from_manager_id, to_manager_id, changed_by, comment)
     VALUES ($1,NULL,$2,$3,$4)`,
    [lead.id, managerId, systemUserId, options.assignmentComment ?? 'Автоматическое распределение лида из Instagram'],
  );

  if (options.createTask !== false) {
    await client.query(
      `INSERT INTO academy_tasks
        (title, description, responsible_id, deadline_at, entity_type, entity_id, status)
       VALUES ('Ответить на сообщение в Instagram','Новый лид написал в Direct. Ответить в течение 15 минут.',$1,NOW() + INTERVAL '15 minutes','lead',$2,'new')`,
      [managerId, lead.id],
    );
  }

  if (options.notify !== false) {
    await client.query(
      `INSERT INTO notifications
        (user_id, type, title, message, related_entity_type, related_entity_id)
       VALUES ($1,'instagram_lead','Новый лид из Instagram',$2,'lead',$3)`,
      [managerId, `${contactName} написал(а) в Instagram Direct.`, lead.id],
    );
  }

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
  const { content, messageType, attachments } = extractMessageContent(message);
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
         content, message_type, status, raw_payload, attachments, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
        JSON.stringify(attachments),
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
    if (!outbound && result.lead?.createdLead) {
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

const emptyImportStats = (): InstagramImportStats => ({
  accounts: 0,
  conversations: 0,
  conversationsCreated: 0,
  messages: 0,
  leadsCreated: 0,
  skipped: 0,
  errors: 0,
});

const mergeImportStats = (target: InstagramImportStats, source: InstagramImportStats) => {
  target.accounts += source.accounts;
  target.conversations += source.conversations;
  target.conversationsCreated += source.conversationsCreated;
  target.messages += source.messages;
  target.leadsCreated += source.leadsCreated;
  target.skipped += source.skipped;
  target.errors += source.errors;
};

const createInstagramImportJobStatus = (): InstagramImportJobStatus => ({
  status: 'idle',
  requestedBy: null,
  startedAt: null,
  finishedAt: null,
  stats: emptyImportStats(),
  error: null,
});

let instagramImportJobStatus = createInstagramImportJobStatus();
let instagramImportPromise: Promise<InstagramImportStats> | null = null;

const cloneInstagramImportJobStatus = (): InstagramImportJobStatus => ({
  ...instagramImportJobStatus,
  stats: { ...instagramImportJobStatus.stats },
});

const broadcastInstagramImportJobStatus = () => {
  broadcastToClients({
    type: 'INSTAGRAM_HISTORY_IMPORT_STATUS',
    data: cloneInstagramImportJobStatus(),
  });
};

const buildConversationListUrl = (account: InstagramAccountRow, accessToken: string, useMeEndpoint = false) => {
  const config = instagramConfig();
  const nodeId = useMeEndpoint ? 'me' : account.ig_user_id;
  const url = new URL(`${config.graphApiUrl}/${config.apiVersion}/${nodeId}/conversations`);
  url.searchParams.set('platform', 'instagram');
  url.searchParams.set('fields', 'id,updated_time,participants');
  url.searchParams.set('limit', '100');
  url.searchParams.set('access_token', accessToken);
  return url.toString();
};

const fetchInstagramConversationSummaries = async (
  account: InstagramAccountRow,
  accessToken: string,
) => {
  try {
    return await fetchInstagramPages<InstagramGraphConversation>(
      buildConversationListUrl(account, accessToken),
    );
  } catch (error) {
    if (isInstagramRateLimitError(error)) {
      throw error;
    }
    logger.warn('Failed to import Instagram conversations by IG user id, retrying with /me', {
      accountId: account.id,
      igUserId: account.ig_user_id,
      error,
    });
    return fetchInstagramPages<InstagramGraphConversation>(
      buildConversationListUrl(account, accessToken, true),
    );
  }
};

const fetchInstagramConversationDetail = async (
  conversationId: string,
  accessToken: string,
) => {
  const config = instagramConfig();
  const url = new URL(`${config.graphApiUrl}/${config.apiVersion}/${conversationId}`);
  url.searchParams.set(
    'fields',
    'id,updated_time,participants,messages.limit(100){id,created_time,from,to,message,attachments,shares,sticker}',
  );
  url.searchParams.set('access_token', accessToken);
  return fetchInstagramJson<InstagramGraphConversation>(url.toString());
};

const getImportedMessageKey = (
  conversationId: string,
  message: InstagramGraphMessage,
  index: number,
) => String(
  message.id
  ?? `ig-import:${conversationId}:${message.created_time ?? 'unknown'}:${message.from?.id ?? 'unknown'}:${index}`,
).slice(0, 255);

const fetchInstagramConversationMessages = async (
  conversationId: string,
  accessToken: string,
  embeddedMessages?: InstagramGraphListResponse<InstagramGraphMessage>,
) => {
  const byKey = new Map<string, InstagramGraphMessage>();
  const appendMessages = (messages: InstagramGraphMessage[]) => {
    messages.forEach((message, index) => {
      byKey.set(getImportedMessageKey(conversationId, message, byKey.size + index), message);
    });
  };

  appendMessages(embeddedMessages?.data ?? []);
  if (embeddedMessages?.paging?.next) {
    appendMessages(await fetchInstagramPages<InstagramGraphMessage>(embeddedMessages.paging.next));
  }

  if (byKey.size === 0) {
    const config = instagramConfig();
    const url = new URL(`${config.graphApiUrl}/${config.apiVersion}/${conversationId}/messages`);
    url.searchParams.set('fields', 'id,created_time,from,to,message,attachments,shares,sticker');
    url.searchParams.set('limit', '100');
    url.searchParams.set('access_token', accessToken);
    appendMessages(await fetchInstagramPages<InstagramGraphMessage>(url.toString()));
  }

  return [...byKey.values()].sort((a, b) => {
    const aTime = parseInstagramDate(a.created_time)?.getTime() ?? 0;
    const bTime = parseInstagramDate(b.created_time)?.getTime() ?? 0;
    return aTime - bTime;
  });
};

const upsertImportedInstagramConversation = async (
  account: InstagramAccountRow,
  conversation: InstagramGraphConversation,
  messages: InstagramGraphMessage[],
  profile: InstagramProfile,
  participantIgsid: string,
) => {
  const stats = emptyImportStats();
  const importedMessages = messages.map((message, index) => {
    const { direction, senderIgsid, recipientIgsid } = resolveImportedMessageParties(
      message,
      account,
      participantIgsid,
    );
    const { content, messageType, attachments } = extractImportedMessageContent(message);
    const createdAt = parseInstagramDate(message.created_time)
      ?? parseInstagramDate(conversation.updated_time)
      ?? new Date();

    return {
      externalMessageId: getImportedMessageKey(conversation.id, message, index),
      direction,
      senderIgsid,
      recipientIgsid,
      content,
      messageType,
      attachments,
      createdAt,
      rawPayload: message,
    };
  });
  const lastMessageAt = maxInstagramDate([
    ...importedMessages.map((message) => message.createdAt),
    parseInstagramDate(conversation.updated_time),
  ]);
  const lastInboundAt = maxInstagramDate(
    importedMessages
      .filter((message) => message.direction === 'inbound')
      .map((message) => message.createdAt),
  );
  const lastOutboundAt = maxInstagramDate(
    importedMessages
      .filter((message) => message.direction === 'outbound')
      .map((message) => message.createdAt),
  );
  const client = await pool.connect();

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
         last_message_at = CASE
           WHEN instagram_conversations.last_message_at IS NULL THEN EXCLUDED.last_message_at
           WHEN EXCLUDED.last_message_at IS NULL THEN instagram_conversations.last_message_at
           ELSE GREATEST(instagram_conversations.last_message_at, EXCLUDED.last_message_at)
         END,
         last_inbound_at = CASE
           WHEN instagram_conversations.last_inbound_at IS NULL THEN EXCLUDED.last_inbound_at
           WHEN EXCLUDED.last_inbound_at IS NULL THEN instagram_conversations.last_inbound_at
           ELSE GREATEST(instagram_conversations.last_inbound_at, EXCLUDED.last_inbound_at)
         END,
         last_outbound_at = CASE
           WHEN instagram_conversations.last_outbound_at IS NULL THEN EXCLUDED.last_outbound_at
           WHEN EXCLUDED.last_outbound_at IS NULL THEN instagram_conversations.last_outbound_at
           ELSE GREATEST(instagram_conversations.last_outbound_at, EXCLUDED.last_outbound_at)
         END,
         updated_at = NOW()
       RETURNING *, (xmax = 0) AS inserted`,
      [
        account.id,
        participantIgsid,
        profile.username ?? null,
        profile.name ?? null,
        profile.profile_pic ?? profile.profile_picture_url ?? null,
        lastMessageAt,
        lastInboundAt,
        lastOutboundAt,
      ],
    );
    const conversationRow = conversationResult.rows[0];
    stats.conversations += 1;
    if (conversationRow?.inserted) stats.conversationsCreated += 1;

    const lead = await ensureLeadForConversation(
      client,
      account,
      conversationRow,
      participantIgsid,
      profile,
      {
        createTask: false,
        notify: false,
        leadComment: 'Импортирован из истории Instagram Direct.',
        stageComment: 'Импорт истории Instagram Direct',
        assignmentComment: 'Автоматическое распределение лида из импортированной истории Instagram',
      },
    );
    if (lead?.created_lead) stats.leadsCreated += 1;

    for (const message of importedMessages) {
      const inserted = await client.query(
        `INSERT INTO instagram_messages
          (conversation_id, external_message_id, direction, sender_igsid, recipient_igsid,
           content, message_type, status, raw_payload, attachments, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (external_message_id) DO UPDATE SET
           content = EXCLUDED.content,
           message_type = EXCLUDED.message_type,
           attachments = EXCLUDED.attachments,
           updated_at = NOW()
         RETURNING id`,
        [
          conversationRow.id,
          message.externalMessageId,
          message.direction,
          message.senderIgsid,
          message.recipientIgsid,
          message.content,
          message.messageType,
          message.direction === 'outbound' ? 'sent' : 'received',
          JSON.stringify(message.rawPayload),
          JSON.stringify(message.attachments ?? []),
          message.createdAt,
        ],
      );
      if (inserted.rows[0]) stats.messages += 1;
    }

    await client.query(
      `UPDATE instagram_accounts
       SET last_webhook_at = COALESCE(last_webhook_at, NOW()),
           last_error = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [account.id],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return stats;
};

const importInstagramAccountHistory = async (
  account: InstagramAccountRow,
  requestedBy: number,
) => {
  const stats = emptyImportStats();
  stats.accounts = 1;

  if (!account.access_token_encrypted) {
    stats.skipped += 1;
    return stats;
  }

  const accessToken = decryptInstagramToken(account.access_token_encrypted);
  let conversations: InstagramGraphConversation[];
  try {
    conversations = await fetchInstagramConversationSummaries(account, accessToken);
  } catch (error) {
    if (isInstagramRateLimitError(error)) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        partialStats: stats,
      });
    }
    throw error;
  }

  for (const conversationSummary of conversations) {
    try {
      const conversation = await fetchInstagramConversationDetail(conversationSummary.id, accessToken);
      const messages = await fetchInstagramConversationMessages(
        conversation.id,
        accessToken,
        conversation.messages,
      );
      const participant = findConversationParticipant(conversation, messages, account);
      const participantIgsid = String(participant?.id ?? '');
      if (!participantIgsid || participantIgsid === String(account.ig_user_id)) {
        stats.skipped += 1;
        continue;
      }

      const profileNeedsFetch = !participant?.username || !participant?.name;
      const fetchedProfile = profileNeedsFetch
        ? await getParticipantProfile(participantIgsid, accessToken)
        : {};
      const profile: InstagramProfile = {
        ...fetchedProfile,
        id: participantIgsid,
        username: participant?.username ?? fetchedProfile.username,
        name: participant?.name ?? fetchedProfile.name,
        profile_pic: participant?.profile_pic ?? fetchedProfile.profile_pic,
        profile_picture_url: participant?.profile_picture_url ?? fetchedProfile.profile_picture_url,
      };
      mergeImportStats(
        stats,
        await upsertImportedInstagramConversation(
          account,
          conversation,
          messages,
          profile,
          participantIgsid,
        ),
      );
    } catch (error) {
      if (isInstagramRateLimitError(error)) {
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
          partialStats: stats,
        });
      }
      stats.errors += 1;
      logger.warn('Failed to import Instagram conversation', {
        accountId: account.id,
        igUserId: account.ig_user_id,
        conversationId: conversationSummary.id,
        error,
      });
    }
  }

  await logInstagramIntegration('history_import', 'completed', {
    requestedBy,
    accountId: account.id,
    igUserId: account.ig_user_id,
    stats,
  });

  return stats;
};

export const importInstagramConversationHistory = async (requestedBy: number) => {
  const { rows } = await pool.query<InstagramAccountRow>(
    `SELECT * FROM instagram_accounts
     WHERE status = 'connected' AND access_token_encrypted IS NOT NULL
     ORDER BY id`,
  );
  const stats = emptyImportStats();

  for (const account of rows) {
    try {
      mergeImportStats(stats, await importInstagramAccountHistory(account, requestedBy));
    } catch (error: any) {
      if (error?.partialStats) {
        mergeImportStats(stats, error.partialStats);
      } else {
        stats.accounts += 1;
      }
      stats.errors += 1;
      await pool.query(
        `UPDATE instagram_accounts SET last_error = $1, updated_at = NOW() WHERE id = $2`,
        [error?.message ?? String(error), account.id],
      );
      logger.error('Failed to import Instagram account history', {
        accountId: account.id,
        igUserId: account.ig_user_id,
        error,
        response: error?.instagramResponse,
      });
    }
  }

  await logInstagramIntegration('history_import', stats.errors > 0 ? 'partial' : 'completed', stats);
  broadcastToClients({
    type: 'INSTAGRAM_CONVERSATION_UPDATED',
    data: { imported: true, stats },
  });
  return stats;
};

export const getInstagramConversationSyncStatus = () => cloneInstagramImportJobStatus();

export const startInstagramConversationHistorySync = (requestedBy: number) => {
  if (instagramImportPromise) {
    return {
      ...cloneInstagramImportJobStatus(),
      started: false,
      alreadyRunning: true,
    };
  }

  instagramImportJobStatus = {
    status: 'running',
    requestedBy,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    stats: emptyImportStats(),
    error: null,
  };
  broadcastInstagramImportJobStatus();

  instagramImportPromise = importInstagramConversationHistory(requestedBy)
    .then((stats) => {
      instagramImportJobStatus = {
        ...instagramImportJobStatus,
        status: stats.errors > 0 ? 'partial' : 'completed',
        finishedAt: new Date().toISOString(),
        stats: { ...stats },
        error: stats.errors > 0 ? 'instagramSyncPartial' : null,
      };
      broadcastInstagramImportJobStatus();
      return stats;
    })
    .catch((error: any) => {
      instagramImportJobStatus = {
        ...instagramImportJobStatus,
        status: 'failed',
        finishedAt: new Date().toISOString(),
        stats: error?.partialStats ?? instagramImportJobStatus.stats,
        error: error?.message ?? String(error),
      };
      logger.error('Failed to run Instagram history import job', {
        requestedBy,
        error,
        response: error?.instagramResponse,
      });
      broadcastInstagramImportJobStatus();
      throw error;
    })
    .finally(() => {
      instagramImportPromise = null;
    });

  instagramImportPromise.catch(() => undefined);

  return {
    ...cloneInstagramImportJobStatus(),
    started: true,
    alreadyRunning: false,
  };
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
            recipient_igsid, content, message_type, status, sent_by, attachments, created_at, updated_at
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
         content, message_type, status, sent_by, attachments)
       VALUES ($1,$2,'outbound',$3,$4,$5,'text','sent',$6,$7)
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
        JSON.stringify([]),
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
