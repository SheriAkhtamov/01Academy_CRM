import { appConfig } from '../config';

type OnlinePbxConfig = {
  domain?: string;
  authKey?: string;
  apiUrl?: string;
};

type OnlinePbxResponse<T> = {
  status?: string | number;
  data?: T;
  comment?: string;
  error?: string;
  isNotAuth?: boolean;
};

type OnlinePbxSession = {
  header: string;
  expiresAt: number;
};

type OnlinePbxAuthData = {
  key?: string;
  key_id?: string | number;
};

type OnlinePbxUser = {
  num?: string | number;
  name?: string;
  enabled?: string | number | boolean;
};

export type OnlinePbxExtension = {
  extension: string;
  name: string | null;
  enabled: boolean;
};

export class OnlinePbxError extends Error {
  constructor(
    public readonly clientCode: string,
    public readonly statusCode = 502,
  ) {
    super(clientCode);
    this.name = 'OnlinePbxError';
  }
}

const DEFAULT_API_URL = 'https://api2.onlinepbx.ru';
const AUTH_TTL_MS = 71 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8_000;

const cleanBaseUrl = (value: string | undefined) =>
  (value?.trim() || DEFAULT_API_URL).replace(/\/+$/, '');

const cleanDomain = (value: string | undefined) => value?.trim().toLowerCase() ?? '';

const isValidDomain = (value: string) =>
  /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value) && value.includes('.');

export const normalizeOnlinePbxPhone = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const digits = raw.replace(/\D/g, '');
  if (digits.length === 9) return `+998${digits}`;
  if (digits.length === 12 && digits.startsWith('998')) return `+${digits}`;
  if (digits.length < 7 || digits.length > 15) return null;
  return raw.startsWith('+') ? `+${digits}` : digits;
};

export class OnlinePbxClient {
  private session: OnlinePbxSession | null = null;
  private authenticationPromise: Promise<OnlinePbxSession> | null = null;

  constructor(
    private readonly config: OnlinePbxConfig = appConfig.integrations?.onlinePbx ?? {},
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  isConfigured() {
    const domain = cleanDomain(this.config.domain);
    return Boolean(this.config.authKey?.trim() && isValidDomain(domain));
  }

  getDomain() {
    return cleanDomain(this.config.domain);
  }

  private assertConfigured() {
    if (!this.isConfigured()) {
      throw new OnlinePbxError('onlinePbxNotConfigured', 503);
    }
  }

  private endpoint(path: string) {
    return `${cleanBaseUrl(this.config.apiUrl)}/${this.getDomain()}/${path}.json`;
  }

  private async post<T>(url: string, body: URLSearchParams, authentication?: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          ...(authentication ? { 'x-pbx-authentication': authentication } : {}),
        },
        body,
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as OnlinePbxResponse<T> | null;
      if (!payload) throw new OnlinePbxError('onlinePbxInvalidResponse');
      return { response, payload };
    } catch (error) {
      if (error instanceof OnlinePbxError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new OnlinePbxError('onlinePbxTimeout', 504);
      }
      throw new OnlinePbxError('onlinePbxUnavailable');
    } finally {
      clearTimeout(timeout);
    }
  }

  private async authenticate(): Promise<OnlinePbxSession> {
    this.assertConfigured();
    if (this.session && this.session.expiresAt > Date.now()) return this.session;
    if (this.authenticationPromise) return this.authenticationPromise;

    this.authenticationPromise = (async () => {
      const { response, payload } = await this.post<OnlinePbxAuthData>(
        this.endpoint('auth'),
        new URLSearchParams({
          auth_key: this.config.authKey!.trim(),
          new: 'true',
        }),
      );
      const key = payload.data?.key;
      const keyId = payload.data?.key_id;
      if (!response.ok || String(payload.status) !== '1' || !key || keyId === undefined) {
        throw new OnlinePbxError('onlinePbxAuthenticationFailed', 502);
      }
      this.session = {
        header: `${keyId}:${key}`,
        expiresAt: Date.now() + AUTH_TTL_MS,
      };
      return this.session;
    })();

    try {
      return await this.authenticationPromise;
    } finally {
      this.authenticationPromise = null;
    }
  }

  private async request<T>(path: string, body: URLSearchParams, retryAuthentication = true): Promise<T> {
    const session = await this.authenticate();
    const { response, payload } = await this.post<T>(this.endpoint(path), body, session.header);

    if (payload.isNotAuth && retryAuthentication) {
      this.session = null;
      return this.request<T>(path, body, false);
    }

    if (!response.ok || String(payload.status) !== '1' || payload.data === undefined) {
      throw new OnlinePbxError('onlinePbxRequestFailed');
    }
    return payload.data;
  }

  async listExtensions(): Promise<OnlinePbxExtension[]> {
    const data = await this.request<OnlinePbxUser[]>('user/get', new URLSearchParams());
    if (!Array.isArray(data)) throw new OnlinePbxError('onlinePbxInvalidResponse');
    return data
      .map((user) => ({
        extension: String(user.num ?? '').trim(),
        name: user.name?.trim() || null,
        enabled: !['0', 'false'].includes(String(user.enabled).toLowerCase()),
      }))
      .filter((user) => /^\d{2,10}$/.test(user.extension));
  }

  async initiateCall(from: string, to: string): Promise<{ uuid: string }> {
    const data = await this.request<{ uuid?: string }>(
      'call/instantly',
      new URLSearchParams({ from, to }),
    );
    const uuid = data?.uuid?.trim();
    if (!uuid) throw new OnlinePbxError('onlinePbxCallFailed');
    return { uuid };
  }
}

export const onlinePbxClient = new OnlinePbxClient();
