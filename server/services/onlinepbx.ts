import { appConfig } from '../config';
import { isOnlinePbxExtension } from '@shared/telephony';

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
  errorCode?: string;
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
  device?: {
    agent?: string;
    exp?: number;
    ip?: string;
    port?: string;
  } | null;
  webrtc?: {
    host?: string;
    user?: string | number;
    password?: string;
  } | null;
};

export type OnlinePbxExtension = {
  extension: string;
  name: string | null;
  enabled: boolean;
  registered: boolean;
};

export type OnlinePbxGroup = {
  extension: string;
  name: string | null;
  users: string[];
  delay: number;
  defaultDestination: string | null;
};

export type OnlinePbxWebRtcCredentials = {
  extension: string;
  username: string;
  password: string;
  sipDomain: string;
  websocketUrl: string;
  aor: string;
};

export type OnlinePbxCallHistoryItem = {
  uuid: string;
  callerIdNumber: string;
  destinationNumber: string;
  startStamp: number;
  endStamp: number;
  duration: number;
  talkTime: number;
  hangupCause: string;
  direction: string;
  gateway: string;
  events: Array<Record<string, unknown>>;
};

export class OnlinePbxError extends Error {
  constructor(
    public readonly clientCode: string,
    public readonly statusCode = 502,
    public readonly providerCode?: string,
    public readonly providerComment?: string,
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

    if (!response.ok || String(payload.status) !== '1') {
      throw new OnlinePbxError(
        'onlinePbxRequestFailed',
        502,
        payload.errorCode,
        payload.comment || payload.error,
      );
    }
    return payload.data as T;
  }

  async listExtensions(): Promise<OnlinePbxExtension[]> {
    const data = await this.request<OnlinePbxUser[]>(
      'user/get',
      new URLSearchParams({ fields: 'num,name,enabled,device' }),
    );
    if (!Array.isArray(data)) throw new OnlinePbxError('onlinePbxInvalidResponse');
    return data
      .map((user) => ({
        extension: String(user.num ?? '').trim(),
        name: user.name?.trim() || null,
        enabled: !['0', 'false'].includes(String(user.enabled).toLowerCase()),
        registered: Boolean(user.device?.ip),
      }))
      .filter((user) => /^\d{2,10}$/.test(user.extension));
  }

  async getWebRtcCredentials(extension: string): Promise<OnlinePbxWebRtcCredentials> {
    if (!isOnlinePbxExtension(extension)) {
      throw new OnlinePbxError('onlinePbxInvalidExtension', 400);
    }

    const data = await this.request<OnlinePbxUser[]>(
      'user/get',
      new URLSearchParams({
        num: extension,
        fields: 'num,name,enabled,webrtc',
      }),
    );
    const user = Array.isArray(data) ? data[0] : null;
    const username = String(user?.webrtc?.user ?? '').trim();
    const password = user?.webrtc?.password?.trim() ?? '';
    const rawHost = user?.webrtc?.host?.trim() ?? '';
    const sipDomain = rawHost.replace(/:\d+$/, '') || this.getDomain();
    const websocketHost = rawHost || `${this.getDomain()}:8082`;

    if (!username || !password || !sipDomain || !websocketHost) {
      throw new OnlinePbxError('onlinePbxWebRtcUnavailable', 503);
    }

    return {
      extension,
      username,
      password,
      sipDomain,
      websocketUrl: `wss://${websocketHost}`,
      aor: `sip:${username}@${sipDomain}`,
    };
  }

  async createExtension(input: { extension: string; password: string; name: string }) {
    if (!isOnlinePbxExtension(input.extension)) {
      throw new OnlinePbxError('onlinePbxInvalidExtension', 400);
    }
    await this.request<unknown>(
      'user/add',
      new URLSearchParams({
        num: input.extension,
        pass: input.password,
        name: input.name,
      }),
    );
  }

  async updateExtension(input: {
    extension: string;
    name?: string;
    password?: string;
    enabled?: boolean;
  }) {
    if (!isOnlinePbxExtension(input.extension)) {
      throw new OnlinePbxError('onlinePbxInvalidExtension', 400);
    }
    const body = new URLSearchParams({ num: input.extension });
    if (input.name) body.set('name', input.name);
    if (input.password) body.set('pass', input.password);
    if (input.enabled !== undefined) body.set('enabled', input.enabled ? '1' : '0');
    await this.request<unknown>('user/edit', body);
  }

  async getGroup(extension: string): Promise<OnlinePbxGroup> {
    const data = await this.request<Record<string, unknown>>(
      'group/get',
      new URLSearchParams({ num: extension }),
    );
    if (!data || String(data.num ?? '').trim() !== extension) {
      throw new OnlinePbxError('onlinePbxRingGroupUnavailable', 502);
    }
    return {
      extension,
      name: String(data.name ?? '').trim() || null,
      users: String(data.users ?? '').split(';').map((user) => user.trim()).filter(Boolean),
      delay: Math.max(1, Number(data.delay) || 20),
      defaultDestination: String(data.default ?? '').trim() || null,
    };
  }

  async updateGroup(input: OnlinePbxGroup): Promise<void> {
    const body = new URLSearchParams({
      num: input.extension,
      users: input.users.join(';'),
      delay: String(input.delay),
    });
    if (input.name) body.set('name', input.name);
    if (input.defaultDestination) body.set('default', input.defaultDestination);
    await this.request<unknown>('group/edit', body);
  }

  async getCallHistory(filters: {
    uuid?: string;
    phoneNumbers?: string;
    startStampFrom?: number;
    startStampTo?: number;
  }): Promise<OnlinePbxCallHistoryItem[]> {
    const body = new URLSearchParams();
    if (filters.uuid) body.set('uuid', filters.uuid);
    if (filters.phoneNumbers) body.set('phone_numbers', filters.phoneNumbers);
    if (filters.startStampFrom) body.set('start_stamp_from', String(filters.startStampFrom));
    if (filters.startStampTo) body.set('start_stamp_to', String(filters.startStampTo));
    if ([...body.keys()].length === 0) {
      body.set('start_stamp_from', String(Math.floor(Date.now() / 1000) - 24 * 60 * 60));
    }

    const data = await this.request<Array<Record<string, unknown>>>(
      'mongo_history/search',
      body,
    );
    if (!Array.isArray(data)) throw new OnlinePbxError('onlinePbxInvalidResponse');

    return data.map((item) => ({
      uuid: String(item.uuid ?? ''),
      callerIdNumber: String(item.caller_id_number ?? ''),
      destinationNumber: String(item.destination_number ?? ''),
      startStamp: Number(item.start_stamp ?? 0),
      endStamp: Number(item.end_stamp ?? 0),
      duration: Number(item.duration ?? 0),
      talkTime: Number(item.user_talk_time ?? 0),
      hangupCause: String(item.hangup_cause ?? ''),
      direction: String(item.accountcode ?? ''),
      gateway: String(item.gateway ?? ''),
      events: Array.isArray(item.events) ? item.events as Array<Record<string, unknown>> : [],
    })).filter((item) => item.uuid);
  }

  async getCallRecordingUrl(uuid: string): Promise<string | null> {
    const data = await this.request<string | Array<Record<string, unknown>>>(
      'mongo_history/search',
      new URLSearchParams({ uuid, download: '1' }),
    );
    return typeof data === 'string' && /^https:\/\//.test(data) ? data : null;
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
