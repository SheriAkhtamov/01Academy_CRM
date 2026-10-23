import fs from 'fs';
import path from 'path';

type AppEnvironment = 'development' | 'production' | 'test';

export interface AppConfig {
  database: {
    provider: string;
    url: string;
    ssl?: boolean | {
      rejectUnauthorized?: boolean;
    };
    pool?: {
      max?: number;
      idleTimeoutMillis?: number;
      connectionTimeoutMillis?: number;
    };
  };
  server: {
    environment: AppEnvironment;
    host: string;
    port: number;
    appUrl: string;
    trustedProxies?: boolean | number | string | string[];
  };
  session: {
    secret: string;
    cookieSecure?: boolean;
  };
  publicAttendance?: {
    enabled: boolean;
    passwordHash?: string;
    groupIds?: number[];
  };
  portal?: {
    enabled?: boolean;
    learningEnabled?: boolean;
    sessionSecret?: string;
    tokenEncryptionKey?: string;
    allowInvitations?: boolean;
    publicPortfolioEnabled?: boolean;
    groupIds?: number[];
    support?: { phone?: string; email?: string };
  };
  integrations?: {
    telegramMarketing?: {
      webhookReady?: boolean;
      botToken?: string;
      webhookSecret?: string;
      botUsername?: string;
      passwordHash?: string;
    };
    telegramTasks?: {
      botToken?: string;
      webhookSecret?: string;
      botUsername?: string;
      openRouterApiKey?: string;
      agentModel?: string;
    };
    website?: {
      webhookSecret?: string;
      allowedFormOrigins?: string[];
      apiTokens?: Record<string, { hash: string; createdAt: string }>;
    };
    instagram?: {
      appId?: string;
      appSecret?: string;
      verifyToken?: string;
      tokenEncryptionKey?: string;
      apiVersion?: string;
      graphApiUrl?: string;
      oauthUrl?: string;
    };
    metaAds?: {
      accessToken?: string;
      marketingAccessToken?: string;
      capiAccessToken?: string;
      leadAccessToken?: string;
      webhookAppSecret?: string;
      leadWebhookVerifyToken?: string;
      adAccountId?: string;
      adAccountIds?: string[];
      marketingPageId?: string;
      businessId?: string;
      datasetId?: string;
      pageId?: string;
      apiVersion?: string;
      partnerAgent?: string;
      testEventCode?: string;
      // Meta bills this account in USD while the CRM stores every amount in UZS.
      // Zero or absent keeps ad spend in USD rather than inventing a rate.
      usdToUzsRate?: number;
    };
    onlinePbx?: {
      domain?: string;
      authKey?: string;
      apiUrl?: string;
      webhookSecret?: string;
    };
  };
}

const configPath = process.env.APP_CONFIG_PATH?.trim()
  ? path.resolve(process.env.APP_CONFIG_PATH.trim())
  : path.resolve(process.cwd(), 'config', 'app.config.json');
const validEnvironments: ReadonlySet<AppEnvironment> = new Set(['development', 'production', 'test']);

const validateHttpsIntegrationUrl = (
  name: string,
  value: string | undefined,
  allowedHost: (hostname: string) => boolean,
) => {
  if (!value?.trim()) return;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL`);
  }
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || !allowedHost(url.hostname.toLowerCase())
  ) {
    throw new Error(`${name} must use an approved HTTPS host without credentials`);
  }
};

const validateAllowedFormOrigins = (origins: string[] | undefined) => {
  if (origins === undefined) return;
  if (!Array.isArray(origins)) {
    throw new Error('integrations.website.allowedFormOrigins must be an array');
  }
  for (const value of origins) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('integrations.website.allowedFormOrigins must contain non-empty origins');
    }
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error('integrations.website.allowedFormOrigins must contain valid origins');
    }
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || url.origin !== value.trim().replace(/\/$/, '')
    ) {
      throw new Error('integrations.website.allowedFormOrigins must contain HTTPS origins without paths or credentials');
    }
  }
};

const readConfigFile = (): AppConfig => {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing config file: ${configPath}`);
  }

  const configContents = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
  const config = JSON.parse(configContents) as AppConfig;

  /*
    The committed config points at the compose service name, which only
    resolves inside the container. DATABASE_URL lets a developer run the very
    same config against a Postgres on their own machine without editing \u2014 and
    so without risking a commit of \u2014 a file that holds live credentials. It
    goes through the same validation as the file value below.
  */
  const databaseUrlOverride = process.env.DATABASE_URL?.trim();
  const portOverride = Number(process.env.PORT);
  const appUrlOverride = process.env.APP_URL?.trim();

  return {
    ...config,
    integrations: config.integrations ?? {},
    database: databaseUrlOverride
      ? { ...config.database, url: databaseUrlOverride }
      : config.database,
    server: {
      ...config.server,
      ...(Number.isInteger(portOverride) && portOverride > 0 ? { port: portOverride } : {}),
      // Kept in step with the port on purpose: appUrl is the allowed origin the
      // security middleware checks, so a port override alone would lock the
      // browser out of the very server it just started.
      ...(appUrlOverride ? { appUrl: appUrlOverride } : {}),
    },
  };
};

export const validateConfig = (config: AppConfig) => {
  const portal = config.portal;
  if (portal !== undefined) {
    const flags = ['enabled', 'learningEnabled', 'allowInvitations', 'publicPortfolioEnabled'] as const;
    if (!portal || typeof portal !== 'object' || flags.some((flag) => portal[flag] !== undefined && typeof portal[flag] !== 'boolean')) {
      throw new Error('portal feature flags must be boolean values');
    }
    if (portal.groupIds !== undefined && (
      !Array.isArray(portal.groupIds)
      || portal.groupIds.some((id) => !Number.isSafeInteger(id) || id < 1)
      || new Set(portal.groupIds).size !== portal.groupIds.length
    )) {
      throw new Error('portal.groupIds must contain distinct positive group IDs');
    }
    if (portal.enabled) {
      for (const [name, value] of [['sessionSecret', portal.sessionSecret], ['tokenEncryptionKey', portal.tokenEncryptionKey]] as const) {
        if (!value || value.trim().length < 32 || /change[-_ ]?me|example|placeholder/i.test(value)) {
          throw new Error(`portal.${name} must be a non-placeholder value of at least 32 characters`);
        }
      }
      if (portal.sessionSecret === config.session?.secret || portal.tokenEncryptionKey === portal.sessionSecret || portal.tokenEncryptionKey === config.session?.secret) {
        throw new Error('portal session and encryption secrets must be independent');
      }
      if (!/^[A-Za-z0-9+/]{43}=$/.test(portal.tokenEncryptionKey!) || Buffer.from(portal.tokenEncryptionKey!, 'base64').length !== 32) {
        throw new Error('portal.tokenEncryptionKey must be a base64 encoded 32-byte key');
      }
    }
    if (portal.support?.phone && !/^\+?[0-9 ()-]{7,30}$/.test(portal.support.phone)) throw new Error('portal support phone is invalid');
    if (portal.support?.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(portal.support.email)) throw new Error('portal support email is invalid');
  }
  const attendance = config.publicAttendance;
  if (attendance?.enabled && (
    !/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(attendance.passwordHash ?? '')
    || !Array.isArray(attendance.groupIds)
    || attendance.groupIds.length === 0
    || attendance.groupIds.length > 100
    || attendance.groupIds.some((id) => !Number.isSafeInteger(id) || id < 1)
    || new Set(attendance.groupIds).size !== attendance.groupIds.length
  )) {
    throw new Error('publicAttendance requires a scrypt password hash and distinct positive group IDs');
  }
  const marketingBot = config.integrations?.telegramMarketing;
  if (marketingBot?.botToken || marketingBot?.webhookSecret || marketingBot?.passwordHash) {
    if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(marketingBot.botToken ?? '')
      || !/^[A-Za-z0-9_-]{32,256}$/.test(marketingBot.webhookSecret ?? '')
      || !/^scrypt:[a-f0-9]{32}:[a-f0-9]{64}$/.test(marketingBot.passwordHash ?? '')) {
      throw new Error('Telegram Marketing requires valid bot credentials and a password hash');
    }
    if (config.server.environment === 'production' && new URL(config.server.appUrl).protocol !== 'https:') {
      throw new Error('Telegram Marketing requires HTTPS');
    }
  }
  const telegram = config.integrations?.telegramTasks;
  if (telegram?.botToken?.trim() || telegram?.webhookSecret?.trim()) {
    if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(telegram.botToken?.trim() ?? '')
      || !/^[A-Za-z0-9_-]{32,256}$/.test(telegram.webhookSecret?.trim() ?? '')) {
      throw new Error('Telegram Tasks requires a valid bot token and a separate webhook secret (32–256 characters)');
    }
    if (config.server.environment === 'production' && new URL(config.server.appUrl).protocol !== 'https:') {
      throw new Error('Telegram Tasks requires an HTTPS application URL');
    }
  }
  if (telegram?.openRouterApiKey?.trim()) {
    if (!/^sk-or-v1-[A-Za-z0-9_-]{20,}$/.test(telegram.openRouterApiKey.trim())) {
      throw new Error('integrations.telegramTasks.openRouterApiKey must be a valid OpenRouter API key');
    }
    const model = telegram.agentModel?.trim();
    if (model && !/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i.test(model)) {
      throw new Error('integrations.telegramTasks.agentModel must be an OpenRouter model slug');
    }
  }
  if (!config.database?.url) {
    throw new Error('config.database.url is required');
  }
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(config.database.url);
  } catch {
    throw new Error('config.database.url must be a valid PostgreSQL URL');
  }
  if (
    !['postgres:', 'postgresql:'].includes(databaseUrl.protocol)
    || !databaseUrl.hostname
    || !databaseUrl.username
    || !databaseUrl.password
  ) {
    throw new Error('config.database.url must include a PostgreSQL host and credentials');
  }

  if (!config.session?.secret) {
    throw new Error('config.session.secret is required');
  }

  if (!config.server?.host) {
    throw new Error('config.server.host is required');
  }

  if (
    !Number.isSafeInteger(config.server?.port)
    || config.server.port < 1
    || config.server.port > 65_535
  ) {
    throw new Error('config.server.port is required');
  }

  if (!config.server?.environment) {
    throw new Error('config.server.environment is required');
  }

  if (!validEnvironments.has(config.server.environment)) {
    throw new Error(`config.server.environment must be one of: ${Array.from(validEnvironments).join(', ')}`);
  }

  let appUrl: URL;
  try {
    appUrl = new URL(config.server.appUrl);
  } catch {
    throw new Error('config.server.appUrl must be an absolute URL');
  }

  if (
    config.server.environment === 'production'
    && appUrl.protocol !== 'https:'
  ) {
    throw new Error('config.server.appUrl must use HTTPS in production');
  }
  if (appUrl.username || appUrl.password) {
    throw new Error('config.server.appUrl must not contain credentials');
  }

  const sessionSecret = config.session.secret.trim();
  if (
    config.server.environment === 'production'
    && (
      sessionSecret.length < 32
      || /change[-_ ]?me|example|placeholder/i.test(sessionSecret)
    )
  ) {
    throw new Error('config.session.secret must be a non-placeholder value of at least 32 characters in production');
  }

  const trustedProxies = config.server.trustedProxies;
  const validTrustedProxies = (
    trustedProxies === undefined
    || typeof trustedProxies === 'boolean'
    || (typeof trustedProxies === 'number' && Number.isSafeInteger(trustedProxies) && trustedProxies >= 0)
    || (typeof trustedProxies === 'string' && trustedProxies.trim().length > 0)
    || (
      Array.isArray(trustedProxies)
      && trustedProxies.every((entry) => typeof entry === 'string' && entry.trim().length > 0)
    )
  );
  if (!validTrustedProxies) {
    throw new Error('config.server.trustedProxies must be a boolean, number, string, or string array');
  }
  if (config.server.environment === 'production' && trustedProxies === true) {
    throw new Error('config.server.trustedProxies must not trust every proxy in production');
  }

  const webhookSecrets = [
    ['integrations.website.webhookSecret', config.integrations?.website?.webhookSecret],
    ['integrations.instagram.verifyToken', config.integrations?.instagram?.verifyToken],
    ['integrations.metaAds.leadWebhookVerifyToken', config.integrations?.metaAds?.leadWebhookVerifyToken],
    ['integrations.onlinePbx.webhookSecret', config.integrations?.onlinePbx?.webhookSecret],
  ] as const;
  if (config.server.environment === 'production') {
    for (const [name, value] of webhookSecrets) {
      const secret = value?.trim();
      if (
        secret
        && (
          secret.length < 16
          || /change[-_ ]?me|example|placeholder/i.test(secret)
        )
      ) {
        throw new Error(`${name} must be a non-placeholder value of at least 16 characters`);
      }
    }
  }

  const instagram = config.integrations?.instagram;
  const metaAds = config.integrations?.metaAds;
  validateAllowedFormOrigins(config.integrations?.website?.allowedFormOrigins);
  const websiteTokens = config.integrations?.website?.apiTokens;
  if (websiteTokens !== undefined) {
    if (!websiteTokens || typeof websiteTokens !== 'object' || Array.isArray(websiteTokens)) {
      throw new Error('integrations.website.apiTokens must be an object');
    }
    for (const [domain, credential] of Object.entries(websiteTokens)) {
      if (
        !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)
        || !credential
        || !/^[a-f0-9]{64}$/.test(credential.hash)
        || !Number.isFinite(Date.parse(credential.createdAt))
      ) {
        throw new Error('integrations.website.apiTokens contains an invalid credential');
      }
    }
  }
  if (config.server.environment === 'production') {
    validateHttpsIntegrationUrl(
      'integrations.instagram.graphApiUrl',
      instagram?.graphApiUrl,
      (hostname) => ['graph.instagram.com', 'graph.facebook.com'].includes(hostname),
    );
    validateHttpsIntegrationUrl(
      'integrations.instagram.oauthUrl',
      instagram?.oauthUrl,
      (hostname) => hostname === 'www.instagram.com',
    );
    validateHttpsIntegrationUrl(
      'integrations.onlinePbx.apiUrl',
      config.integrations?.onlinePbx?.apiUrl,
      (hostname) => hostname === 'onlinepbx.ru' || hostname.endsWith('.onlinepbx.ru'),
    );
  }
  if (config.server.environment === 'production' && instagram?.appId?.trim()) {
    const encryptionKey = instagram.tokenEncryptionKey?.trim() ?? '';
    if (
      encryptionKey.length < 32
      || encryptionKey === sessionSecret
      || /change[-_ ]?me|example|placeholder/i.test(encryptionKey)
    ) {
      throw new Error('integrations.instagram.tokenEncryptionKey must be a separate non-placeholder value of at least 32 characters');
    }
  }
  if (metaAds?.apiVersion && !/^v\d+\.\d+$/.test(metaAds.apiVersion.trim())) {
    throw new Error('integrations.metaAds.apiVersion must look like v25.0');
  }
  if (metaAds?.adAccountIds !== undefined && (
    !Array.isArray(metaAds.adAccountIds) || metaAds.adAccountIds.length > 20
    || metaAds.adAccountIds.some((id) => typeof id !== 'string' || !/^(?:act_)?\d{5,30}$/.test(id.trim()))
  )) {
    throw new Error('integrations.metaAds.adAccountIds must contain at most 20 numeric account IDs');
  }
  if (metaAds?.marketingPageId !== undefined && (
    typeof metaAds.marketingPageId !== 'string' || !/^\d{5,30}$/.test(metaAds.marketingPageId.trim())
  )) {
    throw new Error('integrations.metaAds.marketingPageId must be a numeric Page ID');
  }
  if (metaAds?.usdToUzsRate !== undefined) {
    const rate = Number(metaAds.usdToUzsRate);
    if (!Number.isFinite(rate) || rate < 0) {
      throw new Error('integrations.metaAds.usdToUzsRate must be a non-negative number');
    }
  }
};

const loadedConfig = readConfigFile();
validateConfig(loadedConfig);

export const appConfig = Object.freeze(loadedConfig);
const appEnvironment = appConfig.server.environment;
export const isDevelopmentEnvironment = appEnvironment === 'development';
export const isProductionEnvironment = appEnvironment === 'production';
export const trustedProxyConfig = appConfig.server.trustedProxies
  ?? (isProductionEnvironment ? ['loopback', 'linklocal', 'uniquelocal'] : false);
export const secureSessionCookies = Boolean(
  appConfig.session.cookieSecure
  || (
    isProductionEnvironment
    && new URL(appConfig.server.appUrl).protocol === 'https:'
  ),
);
