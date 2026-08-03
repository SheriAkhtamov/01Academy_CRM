import fs from 'fs';
import path from 'path';

type AppEnvironment = 'development' | 'production' | 'test';

interface AppConfig {
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
  email: {
    resendApiKey?: string;
    smtp?: {
      host?: string;
      port?: number;
      user?: string;
      pass?: string;
      from?: string;
    };
  };
  integrations?: {
    chatplace?: {
      webhookSecret?: string;
    };
    website?: {
      webhookSecret?: string;
    };
    telegram?: {
      botToken?: string;
      leadershipChatId?: string;
    };
    whatsapp?: {
      apiToken?: string;
      phoneNumberId?: string;
      apiUrl?: string;
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
      adAccountId?: string;
      businessId?: string;
      datasetId?: string;
      pageId?: string;
      apiVersion?: string;
      conversionStageCode?: string;
      conversionEventName?: string;
      partnerAgent?: string;
      testEventCode?: string;
    };
    notion?: {
      token?: string;
      databaseId?: string;
    };
    googleSheets?: {
      credentialsPath?: string;
      spreadsheetId?: string;
    };
    onlinePbx?: {
      domain?: string;
      authKey?: string;
      apiUrl?: string;
      webhookSecret?: string;
    };
  };
}

const configPath = path.resolve(process.cwd(), 'config', 'app.config.json');
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

const readConfigFile = (): AppConfig => {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing config file: ${configPath}`);
  }

  const configContents = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(configContents) as AppConfig;
};

const validateConfig = (config: AppConfig) => {
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
    ['integrations.chatplace.webhookSecret', config.integrations?.chatplace?.webhookSecret],
    ['integrations.website.webhookSecret', config.integrations?.website?.webhookSecret],
    ['integrations.instagram.verifyToken', config.integrations?.instagram?.verifyToken],
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
      'integrations.whatsapp.apiUrl',
      config.integrations?.whatsapp?.apiUrl,
      (hostname) => hostname === 'graph.facebook.com',
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
