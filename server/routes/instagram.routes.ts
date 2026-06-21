import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { logger } from '../lib/logger';
import {
  buildInstagramAuthorizationUrl,
  disconnectInstagramAccount,
  exchangeInstagramAuthorizationCode,
  getInstagramIntegrationConfig,
  listInstagramAccounts,
  listInstagramConversations,
  listInstagramMessages,
  markInstagramConversationRead,
  sendInstagramTextMessage,
} from '../services/instagram';

const router = Router();
const messageSchema = z.object({
  content: z.string().trim().min(1).max(1000),
});

router.use(requireAuth);

const ensureAdministration = (req: any, res: any) => {
  if (req.user?.workspace === 'administration') return true;
  res.status(403).json({ error: 'Admin access required' });
  return false;
};

const ensureMessagingAccess = (req: any, res: any) => {
  if (req.user?.workspace === 'sales' || req.user?.workspace === 'administration') return true;
  res.status(403).json({ error: 'Sales access required' });
  return false;
};

const parseId = (value: string) => {
  const id = Number.parseInt(value, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
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
    const url = buildInstagramAuthorizationUrl(state);
    req.session.instagramOAuth = {
      state,
      createdAt: Date.now(),
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
    res.status(error?.statusCode ?? 500).json({ error: error?.message ?? 'instagramConnectionFailed' });
  }
});

router.get('/oauth/callback', async (req, res) => {
  if (!ensureAdministration(req, res)) return;
  const state = String(req.query.state ?? '');
  const code = String(req.query.code ?? '').replace(/#_$/, '');
  const oauthState = req.session.instagramOAuth;
  delete req.session.instagramOAuth;

  if (
    !oauthState
    || !state
    || state !== oauthState.state
    || Date.now() - oauthState.createdAt > 10 * 60 * 1000
  ) {
    return res.redirect('/integrations?instagram=invalid_state');
  }
  if (req.query.error || !code) {
    return res.redirect('/integrations?instagram=cancelled');
  }

  try {
    const account = await exchangeInstagramAuthorizationCode(code, req.user!.id);
    return res.redirect(`/integrations?instagram=connected&account=${account.id}`);
  } catch (error: any) {
    logger.error('Instagram OAuth callback failed', {
      error,
      response: error?.instagramResponse,
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
    res.status(error?.statusCode ?? 500).json({ error: error?.message ?? 'instagramDisconnectFailed' });
  }
});

router.get('/conversations', async (req, res) => {
  if (!ensureMessagingAccess(req, res)) return;
  try {
    res.json(await listInstagramConversations({
      id: req.user!.id,
      workspace: req.user!.workspace,
    }));
  } catch (error) {
    logger.error('Failed to list Instagram conversations', { userId: req.user?.id, error });
    res.status(500).json({ error: 'failedToLoadData' });
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
    }));
  } catch (error: any) {
    logger.error('Failed to list Instagram messages', { conversationId, error });
    res.status(error?.statusCode ?? 500).json({ error: error?.message ?? 'failedToLoadData' });
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
    }));
  } catch (error: any) {
    logger.error('Failed to mark Instagram conversation read', { conversationId, error });
    res.status(error?.statusCode ?? 500).json({ error: error?.message ?? 'failedToUpdateResource' });
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
      },
    );
    res.status(201).json(message);
  } catch (error: any) {
    logger.error('Failed to send Instagram message', {
      conversationId,
      userId: req.user?.id,
      error,
      response: error?.instagramResponse,
    });
    res.status(error?.statusCode ?? 500).json({ error: error?.message ?? 'instagramSendFailed' });
  }
});

export default router;
