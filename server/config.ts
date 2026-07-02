import fs from 'fs';
import path from 'path';

type AppEnvironment = 'development' | 'production' | 'test';

interface AppConfig {
  database: {
    provider: string;
    url: string;
    ssl?: {
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
  };
  session: {
    secret: string;
    cookieSecure: boolean;
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
      adAccountId?: string;
    };
    notion?: {
      token?: string;
      databaseId?: string;
    };
    googleSheets?: {
      credentialsPath?: string;
      spreadsheetId?: string;
    };
  };
}

const configPath = path.resolve(process.cwd(), 'config', 'app.config.json');
const validEnvironments: ReadonlySet<AppEnvironment> = new Set(['development', 'production', 'test']);

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

  if (!config.session?.secret) {
    throw new Error('config.session.secret is required');
  }

  if (!config.server?.host) {
    throw new Error('config.server.host is required');
  }

  if (!config.server?.port) {
    throw new Error('config.server.port is required');
  }

  if (!config.server?.environment) {
    throw new Error('config.server.environment is required');
  }

  if (!validEnvironments.has(config.server.environment)) {
    throw new Error(`config.server.environment must be one of: ${Array.from(validEnvironments).join(', ')}`);
  }
};

const loadedConfig = readConfigFile();
validateConfig(loadedConfig);

export const appConfig = Object.freeze(loadedConfig);
const appEnvironment = appConfig.server.environment;
export const isDevelopmentEnvironment = appEnvironment === 'development';
export const isProductionEnvironment = appEnvironment === 'production';
