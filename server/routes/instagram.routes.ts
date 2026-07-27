import crypto from 'node:crypto';
import { Readable, Transform, pipeline } from 'node:stream';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { logger } from '../lib/logger';
import { sendHttpError } from '../lib/http-errors';
import { canAccessAcademyWorkspace, getAssignedWorkspaces, hasLeadershipAccess } from '@shared/academy';
import {
  buildInstagramAuthorizationUrl,
  disconnectInstagramAccount,
  exchangeInstagramAuthorizationCode,
  getInstagramIntegrationConfig,
  getInstagramConversationSyncStatus,
  listInstagramAccounts,
  listInstagramConversations,
  listInstagramMessages,
  markInstagramConversationRead,
  sendInstagramTextMessage,
  startInstagramConversationHistorySync,
} from '../services/instagram';

const router = Router();
const messageSchema = z.object({
  content: z.string().trim().min(1).max(1000),
});

router.use(requireAuth);

const ensureAdministration = (req: any, res: any) => {
  if (hasLeadershipAccess(req.user)) return true;
  res.status(403).json({ error: 'Admin access required' });
  return false;
};

const ensureMessagingAccess = (req: any, res: any) => {
  if (canAccessAcademyWorkspace(req.user, 'sales')) return true;
  res.status(403).json({ error: 'Sales access required' });
  return false;
};

const allowedMediaProxyHosts = [
  'instagram.com',
  'cdninstagram.com',
  'fbcdn.net',
  'fbsbx.com',
  'facebook.com',
];

const isAllowedMediaProxyUrl = (url: URL) => (
  url.protocol === 'https:'
  && allowedMediaProxyHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
);

const isProxyableMediaType = (contentType: string) =>
  /^(image|video|audio)\//i.test(contentType);
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const MEDIA_FETCH_TIMEOUT_MS = 15_000;
const MAX_MEDIA_REDIRECTS = 3;

const parseId = (value: string) => {
  const id = Number.parseInt(value, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
};

const getRawQueryParam = (req: any, name: string): string | null => {
  const rawQuery = String(req.originalUrl || '').split('?')[1]?.split('#')[0];
  if (!rawQuery) return null;

  for (const part of rawQuery.split('&')) {
    const [rawKey, ...rawValueParts] = part.split('=');
    try {
      if (decodeURIComponent(rawKey) === name) {
        return decodeURIComponent(rawValueParts.join('='));
      }
    } catch {
      return null;
    }
  }
  return null;
};

router.get('/config', async (req, res) => {
  if (!ensureAdministration(req, res)) return;
  res.json(getInstagramIntegrationConfig());
});

router.get('/accounts', async (req, res) => {
  if (!ensureAdministration(req, res)) return;
  try {
    res.json(await listInstagramAccounts());
  } catch (error) {
    logger.error('Failed to list Instagram accounts', { error });
    res.status(500).json({ error: 'failedToLoadData' });
  }
});

router.post('/oauth/start', async (req, res) => {
  if (!ensureAdministration(req, res)) return;
  try {
    const state = crypto.randomBytes(24).toString('base64url');
    const redirectUri = getInstagramIntegrationConfig().redirectUri;
    const url = buildInstagramAuthorizationUrl(state, redirectUri);
    logger.info('Instagram OAuth start', { redirectUri });
    req.session.instagramOAuth = {
      state,
      createdAt: Date.now(),
      redirectUri,
    };
    req.session.save((sessionError) => {
      if (sessionError) {
        logger.error('Failed to save Instagram OAuth state', { sessionError });
        res.status(500).json({ error: 'sessionSaveFailed' });
        return;
      }
      res.json({ url });
    });
  } catch (error: any) {
    logger.error('Failed to start Instagram OAuth', { error });
    return sendHttpError(res, error, 'instagramConnectionFailed');
  }
});

router.get('/oauth/callback', async (req, res) => {
  if (!ensureAdministration(req, res)) return;
  const state = String(req.query.state ?? '');
  const code = String(getRawQueryParam(req, 'code') ?? req.query.code ?? '').replace(/#_$/, '');
  const oauthState = req.session.instagramOAuth;
  delete req.session.instagramOAuth;
  const configuredRedirectUri = getInstagramIntegrationConfig().redirectUri;

  if (
    !oauthState
    || !state
    || state !== oauthState.state
    || oauthState.redirectUri !== configuredRedirectUri
    || Date.now() - oauthState.createdAt > 10 * 60 * 1000
  ) {
    return res.redirect('/integrations?instagram=invalid_state');
  }
  if (req.query.error || !code) {
    return res.redirect('/integrations?instagram=cancelled');
  }

  try {
    const account = await exchangeInstagramAuthorizationCode(
      code,
      req.user!.id,
      configuredRedirectUri,
    );
    return res.redirect(`/integrations?instagram=connected&account=${account.id}`);
  } catch (error: any) {
    logger.error('Instagram OAuth callback failed', {
      errorName: error?.name,
      statusCode: error?.statusCode,
      userId: req.user?.id,
    });
    return res.redirect('/integrations?instagram=error');
  }
});

router.delete('/accounts/:id', async (req, res) => {
  if (!ensureAdministration(req, res)) return;
  const accountId = parseId(req.params.id);
  if (!accountId) return res.status(400).json({ error: 'invalidData' });
  try {
    res.json(await disconnectInstagramAccount(accountId));
  } catch (error: any) {
    logger.error('Failed to disconnect Instagram account', { accountId, error });
    return sendHttpError(res, error, 'instagramDisconnectFailed');
  }
});

router.get('/conversations', async (req, res) => {
  if (!ensureMessagingAccess(req, res)) return;
  try {
    res.json(await listInstagramConversations({
      id: req.user!.id,
      workspace: req.user!.workspace,
      workspaces: getAssignedWorkspaces(req.user),
    }));
  } catch (error) {
    logger.error('Failed to list Instagram conversations', { userId: req.user?.id, error });
    res.status(500).json({ error: 'failedToLoadData' });
  }
});

router.post('/conversations/sync', async (req, res) => {
  if (!ensureMessagingAccess(req, res)) return;
  try {
    const status = startInstagramConversationHistorySync(req.user!.id);
    res.status(status.started ? 202 : 200).json(status);
  } catch (error: any) {
    logger.error('Failed to sync Instagram conversations', {
      userId: req.user?.id,
      error,
    });
    return sendHttpError(res, error, 'instagramSyncFailed');
  }
});

router.get('/conversations/sync/status', async (req, res) => {
  if (!ensureMessagingAccess(req, res)) return;
  res.json(getInstagramConversationSyncStatus());
});

router.get('/media-proxy', async (req, res) => {
  if (!ensureMessagingAccess(req, res)) return;

  const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
  let mediaUrl: URL;

  try {
    mediaUrl = new URL(rawUrl);
  } catch {
    return res.status(400).json({ error: 'invalidData' });
  }

  if (!isAllowedMediaProxyUrl(mediaUrl)) {
    return res.status(400).json({ error: 'invalidData' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MEDIA_FETCH_TIMEOUT_MS);
    timeout.unref?.();
    res.once('close', () => controller.abort());

    const headers: Record<string, string> = {
      Accept: 'image/avif,image/webp,image/apng,image/*,video/*,audio/*,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 (compatible; 01AcademyCRM/1.0)',
    };
    if (
      typeof req.headers.range === 'string'
      && /^bytes=(?:\d+-\d*|\d*-\d+)$/.test(req.headers.range)
    ) {
      headers.Range = req.headers.range;
    }

    let currentUrl = mediaUrl;
    let upstream: Response | null = null;
    for (let redirectCount = 0; redirectCount <= MAX_MEDIA_REDIRECTS; redirectCount += 1) {
      upstream = await fetch(currentUrl, {
        headers,
        redirect: 'manual',
        signal: controller.signal,
      });
      if (upstream.status < 300 || upstream.status >= 400) break;

      const location = upstream.headers.get('location');
      if (!location || redirectCount === MAX_MEDIA_REDIRECTS) {
        clearTimeout(timeout);
        return res.status(502).json({ error: 'instagramMediaUnavailable' });
      }
      const redirectUrl = new URL(location, currentUrl);
      if (!isAllowedMediaProxyUrl(redirectUrl)) {
        clearTimeout(timeout);
        return res.status(502).json({ error: 'instagramMediaUnavailable' });
      }
      currentUrl = redirectUrl;
    }

    if (!upstream) {
      clearTimeout(timeout);
      return res.status(502).json({ error: 'instagramMediaUnavailable' });
    }
    const contentType = upstream.headers.get('content-type') ?? '';
    const contentLengthValue = upstream.headers.get('content-length');
    const contentLength = contentLengthValue ? Number(contentLengthValue) : null;

    if (!upstream.ok) {
      clearTimeout(timeout);
      return res.status(upstream.status).json({ error: 'instagramMediaUnavailable' });
    }
    if (!isProxyableMediaType(contentType)) {
      clearTimeout(timeout);
      return res.status(415).json({ error: 'instagramMediaUnavailable' });
    }
    if (
      contentLength !== null
      && (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > MAX_MEDIA_BYTES)
    ) {
      clearTimeout(timeout);
      return res.status(413).json({ error: 'instagramMediaUnavailable' });
    }

    res.status(upstream.status);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=300');

    const contentRange = upstream.headers.get('content-range');
    const acceptRanges = upstream.headers.get('accept-ranges');
    if (contentLengthValue) res.setHeader('Content-Length', contentLengthValue);
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
        if (receivedBytes > MAX_MEDIA_BYTES) {
          callback(new Error('Instagram media exceeds proxy limit'));
          return;
        }
        callback(null, chunk);
      },
    });
    pipeline(Readable.fromWeb(upstream.body as any), byteLimiter, res, (error) => {
      clearTimeout(timeout);
      if (error) {
        controller.abort();
        logger.warn('Instagram media stream stopped', {
          host: currentUrl.hostname,
          reason: error.message,
        });
        if (!res.destroyed) res.destroy();
      }
    });
    return;
  } catch (error) {
    logger.error('Failed to proxy Instagram media', { error, host: mediaUrl.hostname });
    return res.status(502).json({ error: 'instagramMediaUnavailable' });
  }
});

router.get('/conversations/:id/messages', async (req, res) => {
  if (!ensureMessagingAccess(req, res)) return;
  const conversationId = parseId(req.params.id);
  if (!conversationId) return res.status(400).json({ error: 'invalidData' });
  try {
    res.json(await listInstagramMessages(conversationId, {
      id: req.user!.id,
      workspace: req.user!.workspace,
      workspaces: getAssignedWorkspaces(req.user),
    }));
  } catch (error: any) {
    logger.error('Failed to list Instagram messages', { conversationId, error });
    return sendHttpError(res, error, 'failedToLoadData');
  }
});

router.post('/conversations/:id/read', async (req, res) => {
  if (!ensureMessagingAccess(req, res)) return;
  const conversationId = parseId(req.params.id);
  if (!conversationId) return res.status(400).json({ error: 'invalidData' });
  try {
    res.json(await markInstagramConversationRead(conversationId, {
      id: req.user!.id,
      workspace: req.user!.workspace,
      workspaces: getAssignedWorkspaces(req.user),
    }));
  } catch (error: any) {
    logger.error('Failed to mark Instagram conversation read', { conversationId, error });
    return sendHttpError(res, error, 'failedToUpdateResource');
  }
});

router.post('/conversations/:id/messages', async (req, res) => {
  if (!ensureMessagingAccess(req, res)) return;
  const conversationId = parseId(req.params.id);
  if (!conversationId) return res.status(400).json({ error: 'invalidData' });
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalidData' });

  try {
    const message = await sendInstagramTextMessage(
      conversationId,
      parsed.data.content,
      {
        id: req.user!.id,
        workspace: req.user!.workspace,
        workspaces: getAssignedWorkspaces(req.user),
      },
    );
    res.status(201).json(message);
  } catch (error: any) {
    logger.error('Failed to send Instagram message', {
      conversationId,
      userId: req.user?.id,
      error,
    });
    return sendHttpError(res, error, 'instagramSendFailed');
  }
});

export default router;
