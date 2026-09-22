import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { appConfig } from '../../config';
import {
  getConnectedInstagramAccountCount,
  getTelegramTaskBindingCount,
  IntegrationSettingsValidationError,
  saveIntegrationSettings,
} from '../../services/integration-settings';
import { OnlinePbxClient, OnlinePbxError } from '../../services/onlinepbx';
import { normalizeWebsiteIntegrationDomain } from '../../services/website-integrations';
import { createWebsiteLeadToken, hashWebsiteLeadToken } from '../../services/website-lead-tokens';
import { ensureAdministrationModuleAccess } from './academy-core';

const router = Router();

const settingsProvider = z.enum(['telegram_tasks', 'website', 'instagram', 'meta', 'onlinepbx']);
const secretField = z.string().trim().max(2048).optional();
const integrationSettingsSchemas = {
  telegram_tasks: z.object({
    botToken: secretField,
    openRouterApiKey: secretField,
    agentModel: z.string().trim().max(120).optional(),
  }).strict(),
  website: z.object({ domain: z.string().trim().min(4).max(100) }).strict(),
  instagram: z.object({
    appId: z.string().trim().min(1).max(100),
    appSecret: secretField,
    verifyToken: secretField,
    apiVersion: z.string().trim().regex(/^v\d+\.\d+$/).optional(),
  }).strict(),
  meta: z.object({
    adAccountId: z.string().trim().min(1).max(100),
    businessId: z.string().trim().max(100),
    datasetId: z.string().trim().min(1).max(100),
    pageId: z.string().trim().min(1).max(100),
    marketingAccessToken: secretField,
    capiAccessToken: secretField,
    leadAccessToken: secretField,
    webhookAppSecret: secretField,
    leadWebhookVerifyToken: secretField,
    apiVersion: z.string().trim().regex(/^v\d+\.\d+$/).optional(),
    usdToUzsRate: z.string().trim().regex(/^\d+(?:\.\d+)?$/).optional(),
  }).strict(),
  onlinepbx: z.object({
    domain: z.string().trim().min(1).max(120),
    authKey: secretField,
    webhookSecret: secretField,
  }).strict(),
} as const;

const currentIntegrationSettings = (provider: z.infer<typeof settingsProvider>) => {
  const integrations = appConfig.integrations;
  if (provider === 'telegram_tasks') {
    const settings = integrations?.telegramTasks;
    return {
      botUsername: settings?.botUsername ?? '',
      botTokenConfigured: Boolean(settings?.botToken),
      openRouterApiKeyConfigured: Boolean(settings?.openRouterApiKey),
      agentModel: settings?.agentModel ?? '',
    };
  }
  if (provider === 'website') return {
    domains: [...new Set([
      ...(integrations?.website?.allowedFormOrigins ?? [])
        .map(normalizeWebsiteIntegrationDomain).filter((domain): domain is string => Boolean(domain)),
      ...Object.keys(integrations?.website?.apiTokens ?? {}),
    ])],
    tokenConfiguredDomains: Object.keys(integrations?.website?.apiTokens ?? {}),
  };
  if (provider === 'instagram') {
    const settings = integrations?.instagram;
    return {
      appId: settings?.appId ?? '',
      apiVersion: settings?.apiVersion ?? 'v25.0',
      appSecretConfigured: Boolean(settings?.appSecret),
      verifyTokenConfigured: Boolean(settings?.verifyToken),
      callbackUrl: new URL('/api/instagram/oauth/callback', appConfig.server.appUrl).href,
      webhookUrl: new URL('/api/incoming/instagram', appConfig.server.appUrl).href,
    };
  }
  if (provider === 'meta') {
    const settings = integrations?.metaAds;
    return {
      adAccountId: settings?.adAccountId ?? '', businessId: settings?.businessId ?? '',
      datasetId: settings?.datasetId ?? '', pageId: settings?.pageId ?? '',
      apiVersion: settings?.apiVersion ?? 'v25.0',
      usdToUzsRate: settings?.usdToUzsRate ?? 0,
      marketingAccessTokenConfigured: Boolean(settings?.marketingAccessToken || settings?.accessToken),
      capiAccessTokenConfigured: Boolean(settings?.capiAccessToken || settings?.accessToken),
      leadAccessTokenConfigured: Boolean(settings?.leadAccessToken),
      webhookAppSecretConfigured: Boolean(settings?.webhookAppSecret || integrations?.instagram?.appSecret),
      leadWebhookVerifyTokenConfigured: Boolean(settings?.leadWebhookVerifyToken),
      webhookUrl: new URL('/api/incoming/meta-leads', appConfig.server.appUrl).href,
    };
  }
  const settings = integrations?.onlinePbx;
  return {
    domain: settings?.domain ?? '',
    authKeyConfigured: Boolean(settings?.authKey),
    webhookSecretConfigured: Boolean(settings?.webhookSecret),
    webhookUrl: new URL('/api/telephony/webhook', appConfig.server.appUrl).href,
  };
};

router.get('/integrations/settings/:provider', (req, res) => {
  if (!ensureAdministrationModuleAccess(req, res)) return;
  const provider = settingsProvider.safeParse(req.params.provider);
  if (!provider.success) return res.status(404).json({ error: 'integrationNotFound' });
  return res.json(currentIntegrationSettings(provider.data));
});

router.post('/integrations/website-token', async (req, res) => {
  if (!ensureAdministrationModuleAccess(req, res)) return;
  const parsed = z.object({ domain: z.string().trim().min(4).max(100) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'integrationInvalidDomain' });
  const domain = normalizeWebsiteIntegrationDomain(parsed.data.domain);
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    return res.status(400).json({ error: 'integrationInvalidDomain' });
  }

  const token = createWebsiteLeadToken();
  const website = appConfig.integrations?.website;
  const origins = new Set(website?.allowedFormOrigins ?? []);
  origins.add(`https://${domain}`);
  origins.add(`https://www.${domain}`);
  const apiTokens = {
    ...website?.apiTokens,
    [domain]: { hash: hashWebsiteLeadToken(token), createdAt: new Date().toISOString() },
  };
  try {
    await saveIntegrationSettings('website', { allowedFormOrigins: [...origins], apiTokens });
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ domain, token });
  } catch (error) {
    if (error instanceof IntegrationSettingsValidationError) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: 'integrationSaveFailed' });
  }
});

router.put('/integrations/settings/:provider', async (req, res) => {
  if (!ensureAdministrationModuleAccess(req, res)) return;
  const provider = settingsProvider.safeParse(req.params.provider);
  if (!provider.success) return res.status(404).json({ error: 'integrationNotFound' });
  const parsed = integrationSettingsSchemas[provider.data].safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'integrationInvalidSettings' });
  try {
    const input = parsed.data as Record<string, string>;
    const nonempty = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== ''));
    if (provider.data === 'website') {
      const domain = normalizeWebsiteIntegrationDomain(input.domain);
      if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
        return res.status(400).json({ error: 'integrationInvalidDomain' });
      }
      const origins = new Set(appConfig.integrations?.website?.allowedFormOrigins ?? []);
      origins.add(`https://${domain}`);
      origins.add(`https://www.${domain}`);
      await saveIntegrationSettings('website', { allowedFormOrigins: [...origins] });
    } else if (provider.data === 'telegram_tasks') {
      const current = appConfig.integrations?.telegramTasks;
      const botToken = nonempty.botToken ?? current?.botToken;
      if (!botToken || !/^\d+:[A-Za-z0-9_-]{30,}$/.test(botToken)) {
        return res.status(400).json({ error: 'integrationInvalidBotToken' });
      }
      const secret = current?.webhookSecret || crypto.randomBytes(32).toString('base64url');
      const botResponse = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
        signal: AbortSignal.timeout(10_000),
      });
      const bot = await botResponse.json() as { ok?: boolean; result?: { id?: number; username?: string } };
      if (!botResponse.ok || !bot.ok || !bot.result?.id || !bot.result.username) {
        return res.status(400).json({ error: 'integrationInvalidBotToken' });
      }
      if (current?.botToken && current.botToken.split(':')[0] !== String(bot.result.id)) {
        if (await getTelegramTaskBindingCount(current.botToken.split(':')[0]) > 0) {
          return res.status(409).json({ error: 'integrationBotAlreadyBound' });
        }
      }
      const webhookResponse = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: new URL('/api/incoming/telegram-tasks', appConfig.server.appUrl).href,
          secret_token: secret,
          allowed_updates: ['message'], max_connections: 10, drop_pending_updates: false,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const webhook = await webhookResponse.json() as { ok?: boolean };
      if (!webhookResponse.ok || !webhook.ok) {
        return res.status(502).json({ error: 'integrationWebhookFailed' });
      }
      await saveIntegrationSettings('telegramTasks', {
        ...nonempty, botToken, webhookSecret: secret, botUsername: bot.result.username,
      });
    } else if (provider.data === 'instagram') {
      const current = appConfig.integrations?.instagram;
      if (current?.appId && current.appId !== input.appId) {
        if (await getConnectedInstagramAccountCount() > 0) {
          return res.status(409).json({ error: 'integrationAppInUse' });
        }
      }
      if (!(nonempty.appSecret || current?.appSecret) || !(nonempty.verifyToken || current?.verifyToken)) {
        return res.status(400).json({ error: 'integrationSecretRequired' });
      }
      await saveIntegrationSettings('instagram', {
        ...nonempty,
        tokenEncryptionKey: current?.tokenEncryptionKey || crypto.randomBytes(48).toString('base64url'),
      });
    } else if (provider.data === 'meta') {
      const current = appConfig.integrations?.metaAds;
      if (!(nonempty.marketingAccessToken || current?.marketingAccessToken || current?.accessToken)
        || !(nonempty.capiAccessToken || current?.capiAccessToken || current?.accessToken)
        || !(nonempty.leadAccessToken || current?.leadAccessToken)
        || !(nonempty.webhookAppSecret || current?.webhookAppSecret || appConfig.integrations?.instagram?.appSecret)
        || !(nonempty.leadWebhookVerifyToken || current?.leadWebhookVerifyToken)) {
        return res.status(400).json({ error: 'integrationSecretRequired' });
      }
      await saveIntegrationSettings('metaAds', {
        ...nonempty,
        ...(nonempty.usdToUzsRate !== undefined
          ? { usdToUzsRate: Number(nonempty.usdToUzsRate) } : {}),
      });
    } else {
      const current = appConfig.integrations?.onlinePbx;
      if (!/^[a-z0-9][a-z0-9.-]{0,119}$/i.test(input.domain)
        || !(nonempty.authKey || current?.authKey)
        || !(nonempty.webhookSecret || current?.webhookSecret)) {
        return res.status(400).json({ error: 'integrationInvalidSettings' });
      }
      try {
        await new OnlinePbxClient({
          domain: input.domain,
          authKey: nonempty.authKey || current?.authKey,
          apiUrl: current?.apiUrl,
        }).listExtensions();
      } catch (error) {
        if (error instanceof OnlinePbxError) {
          return res.status(error.statusCode).json({ error: error.clientCode });
        }
        throw error;
      }
      await saveIntegrationSettings('onlinePbx', nonempty);
    }
    return res.json(currentIntegrationSettings(provider.data));
  } catch (error) {
    if (error instanceof IntegrationSettingsValidationError) {
      return res.status(400).json({ error: 'integrationInvalidSettings' });
    }
    return res.status(502).json({ error: 'integrationSaveFailed' });
  }
});


export default router;
