import { setTimeout as delay } from 'node:timers/promises';
import { logger } from '../lib/logger';

type JsonObject = Record<string, any>;

export class MetaGraphRequestError extends Error {
  constructor(message: string, readonly details: {
    endpoint: string;
    httpStatus?: number;
    metaCode?: number;
    metaSubcode?: number;
    traceId?: string;
    retryable: boolean;
  }, readonly cause?: unknown) {
    super(message);
    this.name = 'MetaGraphRequestError';
  }
}

const responseError = (url: URL, response: Response, body: JsonObject) => {
  const error = body.error ?? {};
  return new MetaGraphRequestError(
    [error.message, error.error_user_msg].filter((value) => typeof value === 'string').join(' — ').slice(0, 2_000)
      || `Meta API request failed (${response.status})`,
    {
      endpoint: url.pathname,
      httpStatus: response.status,
      metaCode: error.code,
      metaSubcode: error.error_subcode,
      traceId: error.fbtrace_id,
      retryable: response.status === 429 || response.status >= 500 || error.is_transient === true
        || [1, 2, 4, 17, 32, 613].includes(error.code),
    },
  );
};

/** Retry reads only; conversion writes retain the outbox's existing retry policy. */
export const fetchMetaGraphJson = async <T>(url: URL, accessToken: string, init: RequestInit = {}): Promise<T> => {
  if (url.origin !== 'https://graph.facebook.com' || url.username || url.password) {
    throw new Error('Meta API URL must use https://graph.facebook.com');
  }
  const requestUrl = new URL(url);
  requestUrl.searchParams.delete('access_token');
  const maxAttempts = (init.method ?? 'GET').toUpperCase() === 'GET' ? 3 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(requestUrl, {
        ...init,
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...Object.fromEntries(new Headers(init.headers).entries()),
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const body = await response.text();
      if (Buffer.byteLength(body, 'utf8') > 2 * 1024 * 1024) {
        throw new MetaGraphRequestError('Meta API response exceeded the size limit', {
          endpoint: requestUrl.pathname, httpStatus: response.status, retryable: false,
        });
      }
      let parsed: JsonObject;
      try {
        parsed = body ? JSON.parse(body) : {};
      } catch (cause) {
        throw new MetaGraphRequestError('Meta API returned invalid JSON', {
          endpoint: requestUrl.pathname, httpStatus: response.status, retryable: response.status >= 500,
        }, cause);
      }
      if (!response.ok || parsed?.error) throw responseError(requestUrl, response, parsed);
      return parsed as T;
    } catch (cause) {
      const error = cause instanceof MetaGraphRequestError ? cause : new MetaGraphRequestError(
        cause instanceof Error ? cause.message : 'Meta API request failed',
        { endpoint: requestUrl.pathname, retryable: cause instanceof TypeError || controller.signal.aborted },
        cause,
      );
      if (attempt === maxAttempts || !error.details.retryable) throw error;
      logger.warn('Meta Graph read retry', { error, attempt, maxAttempts });
    } finally {
      clearTimeout(timeout);
    }
    await delay(250 * 2 ** (attempt - 1));
  }
  throw new Error('Meta API attempts exhausted');
};
