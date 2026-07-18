import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db';
import { appConfig } from '../config';
import {
  isGeneratedInstagramLeadName,
  resolveInstagramLeadContactName,
} from '../lib/instagram-lead';
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
  profile_lookup_error_code?: number;
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
  story?: any;
  is_unsupported?: boolean;
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
  leadComment?: string;
  stageComment?: string;
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
const INSTAGRAM_REAUTHORIZATION_REQUIRED = 'instagramReauthorizationRequired';
const INSTAGRAM_MESSAGE_ATTACHMENT_FIELDS = 'file_url,generic_template,id,image_data,name,video_data';
const INSTAGRAM_MESSAGE_SHARE_FIELDS = 'link,template';
const INSTAGRAM_MESSAGE_FIELDS = [
  'id',
  'created_time',
  'from',
  'to',
  'message',
  `attachments{${INSTAGRAM_MESSAGE_ATTACHMENT_FIELDS}}`,
  `shares{${INSTAGRAM_MESSAGE_SHARE_FIELDS}}`,
  'story',
  'is_unsupported',
  'sticker',
].join(',');
const INSTAGRAM_MESSAGE_FIELDS_LEGACY = 'id,created_time,from,to,message,attachments,shares,story,is_unsupported,sticker';

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

/**
 * Mirrors the HTTP access boundary for realtime Instagram events: leadership
 * sees every conversation, while sales staff see either their assigned
 * conversation or the shared unassigned queue. Returning [] on an access-query
 * failure is deliberate fail-closed behaviour; the socket router treats an
 * explicit empty audience as "send to nobody".
 */
export const getInstagramConversationAudienceUserIds = async (
  managerId?: number | null,
): Promise<number[]> => {
  const normalizedManagerId = Number(managerId) > 0 ? Number(managerId) : null;
  try {
    const params: unknown[] = normalizedManagerId ? [normalizedManagerId] : [];
    const salesScope = normalizedManagerId
      ? `(u.id = $1 AND ${salesUserAccessSql})`
      : salesUserAccessSql;
    const { rows } = await pool.query<{ id: number | string }>(
      `SELECT DISTINCT u.id
       FROM users u
       WHERE u.is_active = true
         AND (${leadershipUserAccessSql} OR ${salesScope})
       ORDER BY u.id`,
      params,
    );
    return [...new Set(rows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0))];
  } catch (error) {
    logger.error('Failed to resolve Instagram realtime audience', { managerId: normalizedManagerId, error });
    return [];
  }
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

const getMessageDataArray = (value: any): any[] => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  return [];
};

const logImportedMediaExtractionMiss = (message: InstagramGraphMessage) => {
  const rawAttachments = getMessageDataArray(message.attachments);
  const rawShares = getMessageDataArray(message.shares);
  if (!rawAttachments.length && !rawShares.length && !message.story) return;

  logger.warn('Instagram imported message has media fields without extractable media URL', {
    messageId: message.id,
    attachmentTypes: rawAttachments.map((attachment) => attachment?.type).filter(Boolean).slice(0, 8),
    attachmentKeys: [...new Set(rawAttachments.flatMap((attachment) => (
      isObjectRecord(attachment) ? Object.keys(attachment) : []
    )))].slice(0, 24),
    shareKeys: [...new Set(rawShares.flatMap((share) => (
      isObjectRecord(share) ? Object.keys(share) : []
    )))].slice(0, 24),
    hasStory: Boolean(message.story),
  });
};

const extractImportedMessageContent = (message: InstagramGraphMessage) => {
  const text = typeof message?.message === 'string' ? message.message.trim() : '';
  const attachments = extractAttachments(message);
  if (!attachments.length) logImportedMediaExtractionMiss(message);
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
    const connectedAccount = camelize(account.rows[0]);
    setImmediate(() => {
      try {
        startInstagramConversationHistorySync(connectedBy);
      } catch (error) {
        logger.error('Failed to start Instagram identity repair after reconnect', {
          accountId: connectedAccount.id,
          error,
        });
      }
    });
    return connectedAccount;
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
  type: 'image' | 'video' | 'animated_gif' | 'audio' | 'share' | 'reel' | 'story' | 'sticker' | 'like' | 'file' | 'generic';
  url?: string;
  previewUrl?: string;
  link?: string;
  title?: string;
  subtitle?: string;
}

const firstText = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
};

const isObjectRecord = (value: unknown): value is Record<string, any> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const firstMediaItem = (...values: unknown[]): Record<string, any> | null => {
  for (const value of values) {
    if (Array.isArray(value) && isObjectRecord(value[0])) return value[0];
    if (isObjectRecord(value) && Array.isArray(value.data) && isObjectRecord(value.data[0])) return value.data[0];
    if (isObjectRecord(value) && Object.keys(value).some((key) => key !== 'data')) return value;
  }
  return null;
};

const isLikelyMediaUrl = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (host === 'instagram.com' || host.endsWith('.instagram.com')) return false;
    return (
      /\.(jpg|jpeg|png|webp|heic|avif|gif|mp4|mov|webm|m4v|mp3|m4a|ogg|wav|aac)$/i.test(path)
      || host.includes('cdninstagram')
      || host.includes('fbcdn')
      || host.includes('fbsbx')
      || host.includes('scontent')
    );
  } catch {
    return /\.(jpg|jpeg|png|webp|heic|avif|gif|mp4|mov|webm|m4v|mp3|m4a|ogg|wav|aac)$/i.test(value);
  }
};

const firstMediaUrl = (...values: unknown[]) => {
  for (const value of values) {
    const text = firstText(value);
    if (text && isLikelyMediaUrl(text)) return text;
  }
  return undefined;
};

const instagramSharedContentType = (link?: string): 'share' | 'reel' | 'story' => {
  if (!link) return 'share';
  try {
    const parsed = new URL(link);
    const host = parsed.hostname.toLowerCase();
    if (host !== 'instagram.com' && host !== 'www.instagram.com') return 'share';
    if (/^\/(?:reel|tv)\//i.test(parsed.pathname)) return 'reel';
    if (/^\/stories\//i.test(parsed.pathname)) return 'story';
  } catch {
    return 'share';
  }
  return 'share';
};

const instagramPreviewUrlFromLink = (link?: string) => {
  if (!link) return undefined;
  try {
    const parsed = new URL(link);
    const host = parsed.hostname.toLowerCase();
    if (host !== 'instagram.com' && host !== 'www.instagram.com') return undefined;
    // Meta often provides only a permalink for shared Reels. A Reel permalink
    // is not a media file and must not be turned into an <img>; it is rendered
    // as an explicit "open Reel" card by the client. Feed posts can still use
    // Instagram's image preview endpoint.
    const match = parsed.pathname.match(/^\/p\/([^/?#]+)/i);
    if (!match?.[1]) return undefined;
    return `https://www.instagram.com/p/${match[1]}/media/?size=l`;
  } catch {
    return undefined;
  }
};

type MediaUrlCandidate = {
  url: string;
  key: string;
};

const collectMediaUrls = (
  value: unknown,
  keyHint = '',
  candidates: MediaUrlCandidate[] = [],
  seen = new Set<object>(),
  depth = 0,
) => {
  if (depth > 6 || value == null) return candidates;
  if (typeof value === 'string') {
    if (isLikelyMediaUrl(value)) candidates.push({ url: value.trim(), key: keyHint });
    return candidates;
  }
  if (typeof value !== 'object') return candidates;
  if (seen.has(value)) return candidates;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item) => collectMediaUrls(item, keyHint, candidates, seen, depth + 1));
    return candidates;
  }

  Object.entries(value).forEach(([key, nested]) => {
    collectMediaUrls(nested, key, candidates, seen, depth + 1);
  });
  return candidates;
};

const collectDeepMediaUrlCandidates = (values: unknown[]) =>
  values.flatMap((value) => collectMediaUrls(value));

const firstPreferredDeepMediaUrlByKey = (
  predicate: (key: string) => boolean,
  ...values: unknown[]
) => collectDeepMediaUrlCandidates(values)
  .find((candidate) => predicate(candidate.key.toLowerCase()))?.url;

const firstDeepMediaUrlByKey = (
  predicate: (key: string) => boolean,
  ...values: unknown[]
) => {
  const candidates = collectDeepMediaUrlCandidates(values);
  return candidates.find((candidate) => predicate(candidate.key.toLowerCase()))?.url
    ?? candidates[0]?.url;
};

const firstDeepMediaUrl = (...values: unknown[]) =>
  firstDeepMediaUrlByKey(() => false, ...values);

const isDirectMediaKey = (key: string) => (
  key === 'url'
  || key === 'src'
  || key.includes('media')
  || key.includes('source')
  || key.includes('file')
) && !key.includes('preview') && !key.includes('thumbnail') && !key.includes('picture');

const inferAttachmentType = (declaredType: string, url?: string, metadata?: unknown): InstagramMessageAttachment['type'] => {
  const normalizedType = String(declaredType || '').toLowerCase();
  const metadataType = typeof metadata === 'string' ? metadata.toLowerCase() : '';
  const urlPath = String(url || '').split('?')[0].toLowerCase();

  // A Reel is only a playable <video> when Meta gave us a direct video URL.
  // Otherwise it is a share permalink and the user should open it in Instagram.
  if (normalizedType.includes('reel')) return 'reel';
  if (normalizedType.includes('story')) return 'story';
  if (normalizedType === 'share') return 'share';
  if (['video', 'audio', 'animated_gif', 'sticker', 'like', 'file'].includes(normalizedType)) {
    return normalizedType as InstagramMessageAttachment['type'];
  }
  if (metadataType.includes('reel')) return 'reel';
  if (metadataType.includes('video') || /\.(mp4|mov|webm|m4v)$/i.test(urlPath)) return 'video';
  if (metadataType.includes('audio') || /\.(mp3|m4a|ogg|wav|aac)$/i.test(urlPath)) return 'audio';
  if (metadataType.includes('gif') || /\.gif$/i.test(urlPath)) return 'animated_gif';
  if (metadataType.includes('image') || /\.(jpg|jpeg|png|webp|heic|avif)$/i.test(urlPath)) return 'image';
  if (normalizedType === 'image' || normalizedType.includes('post') || normalizedType === 'share') return 'image';
  return 'image';
};

const mediaMetadata = (...values: unknown[]) =>
  values.filter((value) => value != null && value !== '').map((value) => String(value)).join(' ');

const makeMediaAttachment = ({
  declaredType,
  mediaUrl,
  previewUrl,
  link,
  title,
  subtitle,
  metadata,
}: {
  declaredType: string;
  mediaUrl?: string;
  previewUrl?: string;
  link?: string;
  title?: string;
  subtitle?: string;
  metadata?: unknown;
}): InstagramMessageAttachment | null => {
  const displayUrl = mediaUrl || previewUrl;
  if (!displayUrl) {
    const instagramPreviewUrl = instagramPreviewUrlFromLink(link);
    if (instagramPreviewUrl) {
      return { type: 'share', url: instagramPreviewUrl, link, title, subtitle };
    }
    return link ? { type: instagramSharedContentType(link), link, title, subtitle } : null;
  }

  const type = mediaUrl
    ? inferAttachmentType(declaredType, mediaUrl, metadata)
    : 'image';
  return {
    type,
    url: displayUrl,
    previewUrl,
    link,
    title,
    subtitle,
  };
};

const normalizeAttachmentPayload = (attachment: any): InstagramMessageAttachment | null => {
  if (!isObjectRecord(attachment)) return null;
  const type = String(attachment.type || 'attachment');
  const normalizedType = type.toLowerCase();
  const payload = isObjectRecord(attachment.payload) ? attachment.payload : {};
  const imageData = isObjectRecord(attachment.image_data)
    ? attachment.image_data
    : isObjectRecord(payload.image_data)
      ? payload.image_data
      : {};
  const videoData = isObjectRecord(attachment.video_data)
    ? attachment.video_data
    : isObjectRecord(payload.video_data)
      ? payload.video_data
      : {};
  const genericTemplate = isObjectRecord(attachment.generic_template)
    ? attachment.generic_template
    : isObjectRecord(payload.generic_template)
      ? payload.generic_template
      : {};
  const genericPayload = isObjectRecord(genericTemplate.payload) ? genericTemplate.payload : {};
  const share = isObjectRecord(payload.share) ? payload.share : {};
  const reel = isObjectRecord(payload.reel) ? payload.reel : {};
  const mediaItem = firstMediaItem(
    share.media,
    payload.media,
    attachment.media,
    reel.media,
    genericPayload.media,
    genericPayload.elements,
    genericTemplate.elements,
  );
  const link = firstText(share.link, payload.link, payload.permalink, attachment.link, payload.url, attachment.url);
  const title = firstText(
    attachment.name,
    share.name,
    share.title,
    payload.name,
    payload.title,
    genericTemplate.title,
    genericPayload.title,
    mediaItem?.name,
    mediaItem?.title,
  );
  const subtitle = firstText(attachment.subtitle, payload.subtitle, genericTemplate.subtitle, genericPayload.subtitle);
  const videoUrl = firstMediaUrl(
    videoData.url,
    videoData.video_url,
    payload.video_url,
    payload.playable_url,
    payload.reel_video_url,
    reel.video_url,
    reel.playable_url,
    mediaItem?.video_url,
    mediaItem?.video_src,
    mediaItem?.playable_url,
    mediaItem?.playable_url_quality_hd,
  ) ?? firstPreferredDeepMediaUrlByKey((key) => key.includes('video') || key.includes('playable') || key.includes('reel'), videoData, reel, payload, mediaItem);
  const gifUrl = firstMediaUrl(
    imageData.animated_gif_url,
    imageData.gif_url,
    payload.animated_gif_url,
    payload.gif_url,
    attachment.animated_gif_url,
    attachment.gif_url,
    mediaItem?.animated_gif_url,
    mediaItem?.gif_url,
  ) ?? firstPreferredDeepMediaUrlByKey((key) => key.includes('gif'), imageData, payload, mediaItem);
  const imageUrl = firstMediaUrl(
    imageData.url,
    imageData.medial_url,
    imageData.media_url,
    payload.image_url,
    attachment.image_url,
    reel.image_url,
    mediaItem?.image_src,
    mediaItem?.image_url,
    mediaItem?.thumbnail_src,
    mediaItem?.thumbnail_url,
    payload.picture,
    share.picture,
  ) ?? firstDeepMediaUrlByKey((key) => key.includes('image') || key.includes('picture') || key.includes('thumbnail'), imageData, payload, share, mediaItem);
  const audioUrl = firstMediaUrl(
    payload.audio_url,
    attachment.audio_url,
    mediaItem?.audio_url,
  ) ?? firstPreferredDeepMediaUrlByKey((key) => key.includes('audio'), payload, attachment, mediaItem);
  const fileUrl = firstMediaUrl(attachment.file_url, payload.file_url, mediaItem?.file_url);
  const directMediaUrl = firstMediaUrl(
    payload.media_url,
    attachment.media_url,
    attachment.url,
    payload.url,
    reel.media_url,
    mediaItem?.media_url,
    mediaItem?.source,
    mediaItem?.src,
    mediaItem?.url,
  ) ?? firstPreferredDeepMediaUrlByKey(isDirectMediaKey, attachment, payload, genericTemplate);
  const previewUrl = firstMediaUrl(
    imageData.preview_url,
    imageData.animated_gif_preview_url,
    videoData.preview_url,
    videoData.thumbnail_url,
    mediaItem?.image_src,
    mediaItem?.thumbnail_src,
    mediaItem?.thumbnail_url,
    mediaItem?.preview_url,
    reel.thumbnail_url,
    reel.image_url,
    payload.picture,
    share.picture,
  );
  const mediaUrl = videoUrl || gifUrl || imageUrl || audioUrl || fileUrl || directMediaUrl;
  const declaredType = normalizedType.includes('reel')
    ? (videoUrl ? 'video' : 'reel')
    : normalizedType.includes('post')
      ? (videoUrl ? 'video' : 'image')
      : type;

  return makeMediaAttachment({
    declaredType,
    mediaUrl,
    previewUrl,
    link,
    title,
    subtitle,
    metadata: mediaMetadata(
      normalizedType,
      videoUrl ? 'video' : '',
      gifUrl ? 'gif' : '',
      imageUrl ? 'image' : '',
      audioUrl ? 'audio' : '',
      mediaItem?.media_type,
      mediaItem?.type,
      reel.media_type,
      payload.media_type,
      imageData.render_as_sticker ? 'sticker' : '',
    ),
  });
};

const normalizeShare = (share: any): InstagramMessageAttachment | null => {
  if (!isObjectRecord(share)) return null;
  const template = isObjectRecord(share.template) ? share.template : {};
  const payload = isObjectRecord(template.payload) ? template.payload : {};
  const product = isObjectRecord(payload.product) ? payload.product : {};
  const mediaItem = firstMediaItem(share.media, payload.media, product.elements, payload.elements, template.elements);
  const videoUrl = firstMediaUrl(
    share.video_url,
    mediaItem?.video_url,
    mediaItem?.video_src,
    mediaItem?.playable_url,
    mediaItem?.playable_url_quality_hd,
  ) ?? firstPreferredDeepMediaUrlByKey((key) => key.includes('video') || key.includes('playable') || key.includes('reel'), share, template, payload, mediaItem);
  const gifUrl = firstMediaUrl(mediaItem?.animated_gif_url, mediaItem?.gif_url)
    ?? firstPreferredDeepMediaUrlByKey((key) => key.includes('gif'), share, template, payload, mediaItem);
  const directMediaUrl = firstMediaUrl(
    share.media_url,
    mediaItem?.media_url,
    mediaItem?.source,
    mediaItem?.src,
    mediaItem?.url,
  ) ?? firstPreferredDeepMediaUrlByKey(isDirectMediaKey, share, template, payload, mediaItem);
  const imageUrl = firstMediaUrl(
    share.image_url,
    mediaItem?.image_src,
    mediaItem?.image_url,
    mediaItem?.thumbnail_src,
    mediaItem?.thumbnail_url,
    mediaItem?.preview_url,
    share.picture,
  ) ?? firstDeepMediaUrlByKey((key) => key.includes('image') || key.includes('picture') || key.includes('thumbnail'), share, template, payload, mediaItem);
  const previewUrl = firstMediaUrl(mediaItem?.image_src, mediaItem?.thumbnail_src, mediaItem?.thumbnail_url, mediaItem?.preview_url, share.picture);
  const link = firstText(share.link);
  const mediaUrl = videoUrl || gifUrl || directMediaUrl || imageUrl;
  return makeMediaAttachment({
    declaredType: videoUrl ? 'video' : instagramSharedContentType(link),
    mediaUrl,
    previewUrl,
    link,
    title: firstText(share.title, share.name, template.title, payload.title, mediaItem?.name),
    subtitle: firstText(share.subtitle, template.subtitle, payload.subtitle),
    metadata: mediaMetadata(videoUrl ? 'video' : '', gifUrl ? 'gif' : '', mediaItem?.media_type, mediaItem?.type),
  });
};

const normalizeStory = (story: any): InstagramMessageAttachment | null => {
  const storyItem = firstMediaItem(story) ?? (isObjectRecord(story) ? story : null);
  if (!storyItem) return null;
  const videoUrl = firstMediaUrl(
    storyItem.video_url,
    storyItem.video_src,
    storyItem.playable_url,
  ) ?? firstPreferredDeepMediaUrlByKey((key) => key.includes('video') || key.includes('playable'), storyItem);
  const imageUrl = firstMediaUrl(
    storyItem.image_url,
    storyItem.image_src,
    storyItem.thumbnail_url,
    storyItem.preview_url,
  ) ?? firstDeepMediaUrlByKey((key) => key.includes('image') || key.includes('picture') || key.includes('thumbnail'), storyItem);
  const directMediaUrl = firstMediaUrl(storyItem.link, storyItem.url, storyItem.media_url)
    ?? firstDeepMediaUrl(storyItem);
  const mediaUrl = videoUrl || imageUrl || directMediaUrl;
  return makeMediaAttachment({
    declaredType: videoUrl ? 'video' : imageUrl ? 'image' : 'story',
    mediaUrl,
    previewUrl: imageUrl,
    link: firstText(storyItem.permalink),
    title: firstText(storyItem.title),
    metadata: mediaMetadata(storyItem.media_type, storyItem.type),
  });
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
  const story = normalizeStory(message?.story);
  if (story) result.push(story);
  return result.filter((attachment, index) => result.findIndex((candidate) => (
    candidate.type === attachment.type
    && candidate.url === attachment.url
    && candidate.link === attachment.link
  )) === index);
};

// Kept public so webhook/import media payloads can be covered by isolated tests
// without reaching the database or the Meta API.
export const normalizeInstagramMessageAttachments = (message: unknown) => extractAttachments(message);

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
  accountId?: number,
): Promise<InstagramProfile> => {
  const config = instagramConfig();
  const url = new URL(`${config.graphApiUrl}/${config.apiVersion}/${participantIgsid}`);
  url.searchParams.set('fields', 'name,username,profile_pic');
  url.searchParams.set('access_token', accessToken);
  try {
    const profile = await fetchInstagramJson<InstagramProfile>(url.toString());
    if (accountId && (profile.username?.trim() || profile.name?.trim())) {
      await pool.query(
        `UPDATE instagram_accounts
         SET last_error = NULL, updated_at = NOW()
         WHERE id = $1 AND last_error = $2`,
        [accountId, INSTAGRAM_REAUTHORIZATION_REQUIRED],
      );
    }
    return profile;
  } catch (error: any) {
    const errorCode = Number(error?.instagramResponse?.error?.code);
    if (accountId && errorCode === 190) {
      await pool.query(
        `UPDATE instagram_accounts SET last_error = $1, updated_at = NOW() WHERE id = $2`,
        [INSTAGRAM_REAUTHORIZATION_REQUIRED, accountId],
      );
    }
    logger.warn('Failed to fetch Instagram participant profile', { participantIgsid, error });
    return {
      profile_lookup_error_code: Number.isFinite(errorCode) ? errorCode : undefined,
    };
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

const ensureLeadForConversation = async (
  client: PoolClient,
  account: InstagramAccountRow,
  conversation: any,
  participantIgsid: string,
  profile: InstagramProfile,
  options: EnsureLeadOptions = {},
) => {
  const username = String(profile.username ?? conversation.participant_username ?? '').trim() || null;
  const contactName = resolveInstagramLeadContactName({
    name: profile.name ?? conversation.participant_name,
    username,
  });
  const stableMessenger = `instagram:${participantIgsid}`.slice(0, 120);
  const messenger = username ? `@${username.replace(/^@+/, '')}`.slice(0, 120) : stableMessenger;

  const enrichExistingLead = async (lead: any) => {
    if (!contactName) return lead;
    const shouldUpdateName = isGeneratedInstagramLeadName(lead.contact_name);
    const shouldUpdateMessenger = String(lead.messenger ?? '').toLowerCase().startsWith('instagram:') && Boolean(username);
    if (!shouldUpdateName && !shouldUpdateMessenger) return lead;

    const { rows } = await client.query(
      `UPDATE academy_leads
       SET contact_name = $2,
           messenger = $3,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, manager_id, contact_name, messenger, false AS created_lead`,
      [
        lead.id,
        shouldUpdateName ? contactName : lead.contact_name,
        shouldUpdateMessenger ? messenger : lead.messenger,
      ],
    );
    return rows[0] ?? lead;
  };

  if (conversation.lead_id) {
    const existing = await client.query(
      `SELECT id, manager_id, contact_name, messenger, false AS created_lead
       FROM academy_leads WHERE id = $1`,
      [conversation.lead_id],
    );
    if (existing.rows[0]) return enrichExistingLead(existing.rows[0]);
  }

  const existing = await client.query(
    `SELECT id, manager_id, contact_name, messenger, false AS created_lead
     FROM academy_leads
     WHERE phone = $1
        OR LOWER(BTRIM(messenger)) = LOWER(BTRIM($2))
     LIMIT 1`,
    [`instagram:${participantIgsid}`.slice(0, 50), stableMessenger],
  );
  if (existing.rows[0]) {
    await client.query(
      `UPDATE instagram_conversations SET lead_id = $1, updated_at = NOW() WHERE id = $2`,
      [existing.rows[0].id, conversation.id],
    );
    return enrichExistingLead(existing.rows[0]);
  }

  if (!contactName) {
    logger.warn('Instagram lead creation deferred until profile identity is available', {
      accountId: account.id,
      conversationId: conversation.id,
      participantIgsid,
      profileLookupErrorCode: profile.profile_lookup_error_code ?? null,
    });
    return null;
  }

  const systemUserId = await getSystemUserId(client);

  const inserted = await client.query(
    `INSERT INTO academy_leads
      (contact_name, phone, messenger, source_id, status_code, manager_id, language, comment, created_by)
     VALUES ($1,NULL,$2,$3,'new_request',NULL,'ru',$4,$5)
     RETURNING id, manager_id, contact_name, messenger, true AS created_lead`,
    [
      contactName,
      messenger,
      account.source_id,
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
    `INSERT INTO academy_tasks
       (title, description, responsible_id, deadline_at, entity_type, entity_id, status)
     VALUES (
       'Первый контакт по новой заявке',
       'Ответить на новый диалог Instagram в течение 15 минут.',
       NULL,
       NOW() + INTERVAL '15 minutes',
       'lead',
       $1,
       'new'
     )`,
    [lead.id],
  );

  return lead;
};

const processReceiptEvent = async (account: InstagramAccountRow, event: any) => {
  const watermarkMs = Number(event?.read?.watermark ?? event?.delivery?.watermark);
  if (!Number.isFinite(watermarkMs) || watermarkMs <= 0) return;
  const isRead = event?.read?.watermark != null;
  const watermark = new Date(watermarkMs);

  // sender here is the participant (who saw/received), recipient is the IG account.
  const participantIgsid = String(event?.sender?.id ?? '');
  if (!participantIgsid || participantIgsid === String(account.ig_user_id)) return;

  const client = await pool.connect();
  let conversation: { id: number; lead_id: number | null; manager_id: number | null } | null = null;
  try {
    const conversationResult = await client.query(
      `SELECT c.id, c.lead_id, l.manager_id
       FROM instagram_conversations c
       LEFT JOIN academy_leads l ON l.id = c.lead_id
       WHERE c.account_id = $1 AND c.participant_igsid = $2
       LIMIT 1`,
      [account.id, participantIgsid],
    );
    conversation = conversationResult.rows[0] ?? null;
    if (!conversation) return;

    if (isRead) {
      await client.query(
        `UPDATE instagram_messages
           SET read_at = COALESCE(read_at, NOW()),
               delivered_at = COALESCE(delivered_at, NOW())
         WHERE conversation_id = $1
           AND direction = 'outbound'
           AND created_at <= $2`,
        [conversation.id, watermark],
      );
      await client.query(
        `UPDATE instagram_conversations
           SET last_read_message_at = GREATEST(COALESCE(last_read_message_at, 'epoch'::timestamp), $2),
               updated_at = NOW()
         WHERE id = $1
           AND (last_read_message_at IS NULL OR last_read_message_at < $2)`,
        [conversation.id, watermark],
      );
    } else {
      await client.query(
        `UPDATE instagram_messages
           SET delivered_at = COALESCE(delivered_at, NOW())
         WHERE conversation_id = $1
           AND direction = 'outbound'
           AND created_at <= $2
           AND delivered_at IS NULL`,
        [conversation.id, watermark],
      );
    }
  } catch (error) {
    logger.warn('Failed to process Instagram message receipt event', {
      accountId: account.id,
      isRead,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    client.release();
  }

  if (conversation) {
    const audienceUserIds = await getInstagramConversationAudienceUserIds(conversation.manager_id);
    broadcastToClients({
      type: 'INSTAGRAM_CONVERSATION_UPDATED',
      data: {
        conversationId: Number(conversation.id),
        receipt: { read: isRead, watermark: watermark.toISOString() },
      },
      audienceUserIds,
    });
  }
};

const processMessagingEvent = async (account: InstagramAccountRow, event: any) => {
  const message = event?.message;

  // Receipt events carry no `message` payload — they only carry a watermark.
  // Instagram delivers these as:
  //   read:     { sender: {id: participantIgsid}, recipient: {id: igUserId},
  //               read: { watermark: <epochMs> } }
  //   delivery: { ... recipient: {id: igUserId}, delivery: { watermark: <epochMs> } }
  // The participant is the one who saw/delivered-to, so we stamp our own
  // OUTBOUND messages in that conversation up to (and including) the watermark.
  if (!message || (!message.mid && !message.text && !message.attachments)) {
    if (event?.read?.watermark != null || event?.delivery?.watermark != null) {
      return processReceiptEvent(account, event);
    }
    return;
  }

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
    ? await getParticipantProfile(participantIgsid, accessToken, account.id)
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
         SET last_message_at = GREATEST(COALESCE(last_message_at, $2), $2),
             last_inbound_at = CASE
               WHEN $3 = 'inbound' THEN GREATEST(COALESCE(last_inbound_at, $2), $2)
               ELSE last_inbound_at
             END,
             last_outbound_at = CASE
               WHEN $3 = 'outbound' THEN GREATEST(COALESCE(last_outbound_at, $2), $2)
               ELSE last_outbound_at
             END,
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
      `UPDATE instagram_accounts SET last_webhook_at = NOW(), updated_at = NOW() WHERE id = $1`,
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
    const audienceUserIds = await getInstagramConversationAudienceUserIds(result.managerId);
    broadcastToClients({
      type: 'INSTAGRAM_CONVERSATION_UPDATED',
      data: {
        conversationId: result.conversationId,
        message: result.message,
        leadId: result.lead?.id,
      },
      audienceUserIds,
    });
    if (!outbound && result.lead?.createdLead) {
      broadcastToClients({
        type: 'ACADEMY_LEAD_CREATED',
        data: { id: result.lead.id },
        audienceUserIds,
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

const updateInstagramImportJobProgress = (stats: InstagramImportStats) => {
  if (instagramImportJobStatus.status !== 'running') return;
  instagramImportJobStatus = {
    ...instagramImportJobStatus,
    stats: { ...stats },
  };
  broadcastInstagramImportJobStatus();
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

type ExistingInstagramConversationImportState = {
  id: number;
  participant_igsid: string;
  participant_username: string | null;
  participant_name: string | null;
  contact_name: string | null;
  last_message_at: Date | string | null;
};

const loadExistingInstagramConversationImportState = async (accountId: number) => {
  const { rows } = await pool.query<ExistingInstagramConversationImportState>(
    `SELECT conversation.id, conversation.participant_igsid,
            conversation.participant_username, conversation.participant_name,
            lead.contact_name, conversation.last_message_at
     FROM instagram_conversations conversation
     LEFT JOIN academy_leads lead ON lead.id = conversation.lead_id
     WHERE conversation.account_id = $1`,
    [accountId],
  );
  return new Map(rows.map((row) => [String(row.participant_igsid), row]));
};

const findConversationSummaryParticipant = (
  conversation: InstagramGraphConversation,
  account: InstagramAccountRow,
) => getGraphParticipantList(conversation.participants)
  .find((participant) => participant.id && !isAccountParticipant(participant, account));

export const shouldSkipImportedConversation = (
  existing: ExistingInstagramConversationImportState | undefined,
  summary: InstagramGraphConversation,
) => {
  if (!existing) return false;
  if (
    (!existing.participant_username && !existing.participant_name)
    || !existing.contact_name
    || isGeneratedInstagramLeadName(existing.contact_name)
  ) {
    return false;
  }
  const summaryUpdatedAt = parseInstagramDate(summary.updated_time);
  const localLastMessageAt = parseInstagramDate(existing.last_message_at);

  // If Meta did not send an update timestamp in the list response, avoid a
  // detail/messages call for an already known participant. New conversations
  // still import because `existing` is absent.
  if (!summaryUpdatedAt) return true;
  if (!localLastMessageAt) return false;

  return localLastMessageAt.getTime() >= summaryUpdatedAt.getTime() - 2000;
};

const fetchInstagramConversationDetail = async (
  conversationId: string,
  accessToken: string,
) => {
  const config = instagramConfig();
  const url = new URL(`${config.graphApiUrl}/${config.apiVersion}/${conversationId}`);
  url.searchParams.set(
    'fields',
    `id,updated_time,participants,messages.limit(100){${INSTAGRAM_MESSAGE_FIELDS}}`,
  );
  url.searchParams.set('access_token', accessToken);
  try {
    return await fetchInstagramJson<InstagramGraphConversation>(url.toString());
  } catch (error) {
    if (isInstagramRateLimitError(error)) throw error;
    logger.warn('Failed to fetch Instagram conversation with expanded media fields, retrying legacy fields', {
      conversationId,
      error,
    });
    url.searchParams.set(
      'fields',
      `id,updated_time,participants,messages.limit(100){${INSTAGRAM_MESSAGE_FIELDS_LEGACY}}`,
    );
    return fetchInstagramJson<InstagramGraphConversation>(url.toString());
  }
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
    url.searchParams.set('fields', INSTAGRAM_MESSAGE_FIELDS);
    url.searchParams.set('limit', '100');
    url.searchParams.set('access_token', accessToken);
    try {
      appendMessages(await fetchInstagramPages<InstagramGraphMessage>(url.toString()));
    } catch (error) {
      if (isInstagramRateLimitError(error)) throw error;
      logger.warn('Failed to fetch Instagram messages with expanded media fields, retrying legacy fields', {
        conversationId,
        error,
      });
      url.searchParams.set('fields', INSTAGRAM_MESSAGE_FIELDS_LEGACY);
      appendMessages(await fetchInstagramPages<InstagramGraphMessage>(url.toString()));
    }
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
        leadComment: 'Импортирован из истории Instagram Direct.',
        stageComment: 'Импорт истории Instagram Direct',
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
         RETURNING (xmax = 0) AS inserted`,
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
      if (inserted.rows[0]?.inserted === true) stats.messages += 1;
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
  onProgress?: (stats: InstagramImportStats) => void,
) => {
  const stats = emptyImportStats();
  stats.accounts = 1;

  if (!account.access_token_encrypted) {
    stats.skipped += 1;
    onProgress?.(stats);
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

  const existingConversations = await loadExistingInstagramConversationImportState(account.id);

  for (const conversationSummary of conversations) {
    try {
      const summaryParticipant = findConversationSummaryParticipant(conversationSummary, account);
      const summaryParticipantIgsid = String(summaryParticipant?.id ?? '');
      const existingConversation = summaryParticipantIgsid
        ? existingConversations.get(summaryParticipantIgsid)
        : undefined;
      if (shouldSkipImportedConversation(existingConversation, conversationSummary)) {
        stats.skipped += 1;
        onProgress?.(stats);
        continue;
      }

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
        onProgress?.(stats);
        continue;
      }

      const profileNeedsFetch = !participant?.username || !participant?.name;
      const fetchedProfile = profileNeedsFetch
        ? await getParticipantProfile(participantIgsid, accessToken, account.id)
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
      existingConversations.set(participantIgsid, {
        id: existingConversation?.id ?? 0,
        participant_igsid: participantIgsid,
        participant_username: profile.username ?? existingConversation?.participant_username ?? null,
        participant_name: profile.name ?? existingConversation?.participant_name ?? null,
        contact_name: resolveInstagramLeadContactName({
          name: profile.name,
          username: profile.username,
        }) ?? existingConversation?.contact_name ?? null,
        last_message_at: parseInstagramDate(conversation.updated_time) ?? null,
      });
      onProgress?.(stats);
    } catch (error) {
      if (isInstagramRateLimitError(error)) {
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
          partialStats: stats,
        });
      }
      stats.errors += 1;
      onProgress?.(stats);
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
      const accountStats = await importInstagramAccountHistory(account, requestedBy, (partialAccountStats) => {
        const progress = { ...stats };
        mergeImportStats(progress, partialAccountStats);
        updateInstagramImportJobProgress(progress);
      });
      mergeImportStats(stats, accountStats);
      updateInstagramImportJobProgress(stats);
    } catch (error: any) {
      if (error?.partialStats) {
        mergeImportStats(stats, error.partialStats);
      } else {
        stats.accounts += 1;
      }
      stats.errors += 1;
      updateInstagramImportJobProgress(stats);
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
  const hasSalesAccess = user.workspace === 'sales' || Boolean(user.workspaces?.includes('sales'));
  const assignedManagerId = conversation.manager_id ? Number(conversation.manager_id) : null;
  if (
    !hasLeadershipAccess(user)
    && (
      (assignedManagerId && assignedManagerId !== Number(user.id))
      || (!assignedManagerId && !hasSalesAccess)
    )
  ) {
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
  const params: unknown[] = [user.id];
  const ownershipFilter = hasLeadershipAccess(user)
    ? ''
    : `AND (l.manager_id = $1 OR l.manager_id IS NULL)`;
  const { rows } = await pool.query(
    `SELECT c.id, c.account_id, c.lead_id, c.participant_igsid, c.participant_username,
            c.participant_name, c.participant_profile_picture_url,
            CASE
              WHEN conversation_read.user_id IS NULL THEN c.unread_count
              ELSE COALESCE(reader_unread.unread_count, 0)
            END::int AS unread_count,
            c.last_message_at, c.last_inbound_at, c.last_outbound_at, c.last_read_message_at,
            a.username AS account_username, a.status AS account_status,
            l.contact_name, l.status_code, l.manager_id, u.full_name AS manager_name,
            last_message.content AS last_message,
            last_message.direction AS last_message_direction
     FROM instagram_conversations c
     JOIN instagram_accounts a ON a.id = c.account_id
     LEFT JOIN academy_leads l ON l.id = c.lead_id
     LEFT JOIN users u ON u.id = l.manager_id
     LEFT JOIN instagram_conversation_reads conversation_read
       ON conversation_read.conversation_id = c.id
      AND conversation_read.user_id = $1
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS unread_count
       FROM instagram_messages unread_message
       WHERE unread_message.conversation_id = c.id
         AND unread_message.direction = 'inbound'
         AND unread_message.id > COALESCE(conversation_read.last_read_message_id, 0)
     ) reader_unread ON true
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
            recipient_igsid, content, message_type, status, sent_by, attachments,
            delivered_at, read_at, created_at, updated_at
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
    `INSERT INTO instagram_conversation_reads
       (conversation_id, user_id, last_read_message_id, last_read_at, created_at, updated_at)
     SELECT $1, $2, COALESCE(MAX(id), 0), NOW(), NOW(), NOW()
     FROM instagram_messages
     WHERE conversation_id = $1
     ON CONFLICT (conversation_id, user_id)
     DO UPDATE SET
       last_read_message_id = GREATEST(
         instagram_conversation_reads.last_read_message_id,
         EXCLUDED.last_read_message_id
       ),
       last_read_at = NOW(),
       updated_at = NOW()
     RETURNING conversation_id AS id, 0::int AS unread_count, updated_at`,
    [conversationId, user.id],
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
    const audienceUserIds = await getInstagramConversationAudienceUserIds(
      conversation.manager_id ? Number(conversation.manager_id) : null,
    );
    broadcastToClients({
      type: 'INSTAGRAM_CONVERSATION_UPDATED',
      data: { conversationId, message },
      audienceUserIds,
    });
    return message;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    // Meta has already accepted the message at this point. Returning an error
    // would invite a retry and duplicate the real outbound message. The webhook
    // echo/history sync will reconcile persistence when the database recovers.
    logger.error('Instagram message sent but local persistence failed', {
      conversationId,
      externalMessageId: response.message_id,
      error,
    });
    const message = {
      id: -Date.now(),
      conversationId,
      externalMessageId: response.message_id ?? null,
      direction: 'outbound',
      senderIgsid: conversation.ig_user_id,
      recipientIgsid: conversation.participant_igsid,
      content: text,
      messageType: 'text',
      status: 'sent',
      sentBy: user.id,
      attachments: [],
      createdAt: new Date(),
      persistencePending: true,
    };
    const audienceUserIds = await getInstagramConversationAudienceUserIds(
      conversation.manager_id ? Number(conversation.manager_id) : null,
    );
    broadcastToClients({
      type: 'INSTAGRAM_CONVERSATION_UPDATED',
      data: { conversationId, message },
      audienceUserIds,
    });
    return message;
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
      const updated = await pool.query(
        `UPDATE instagram_accounts
         SET access_token_encrypted = $1, token_expires_at = $2, last_error = NULL, updated_at = NOW()
         WHERE id = $3
           AND status = 'connected'
           AND access_token_encrypted = $4`,
        [encryptInstagramToken(result.access_token), expiresAt, account.id, account.access_token_encrypted],
      );
      if ((updated.rowCount ?? 0) > 0) refreshed += 1;
    } catch (error: any) {
      await pool.query(
        `UPDATE instagram_accounts
         SET last_error = $1, updated_at = NOW()
         WHERE id = $2
           AND status = 'connected'
           AND access_token_encrypted = $3`,
        [error?.message ?? String(error), account.id, account.access_token_encrypted],
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
