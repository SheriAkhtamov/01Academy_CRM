import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ warn: vi.fn(), fetch: vi.fn() }));
vi.mock('../server/lib/logger', () => ({ logger: { warn: mocks.warn } }));
vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn().mockResolvedValue(undefined) }));

import { fetchMetaGraphJson } from '../server/services/meta-graph';

const url = () => new URL('https://graph.facebook.com/v25.0/12345/leads');
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('Meta Graph reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetch.mockReset();
    vi.stubGlobal('fetch', mocks.fetch);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('recovers a transient network failure and logs its original cause', async () => {
    const error = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('DNS lookup failed'), { code: 'EAI_AGAIN' }),
    });
    mocks.fetch.mockRejectedValueOnce(error).mockResolvedValueOnce(response({ data: [{ id: 'lead-1' }] }));
    await expect(fetchMetaGraphJson(url(), 'fixture-secret')).resolves.toEqual({ data: [{ id: 'lead-1' }] });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.warn).toHaveBeenCalledWith('Meta Graph read retry', expect.objectContaining({
      error: expect.objectContaining({ cause: error, details: { endpoint: '/v25.0/12345/leads', retryable: true } }),
      attempt: 1,
    }));
  });

  it('bounds retries and preserves the final network error', async () => {
    const error = new TypeError('fetch failed');
    mocks.fetch.mockRejectedValue(error);
    await expect(fetchMetaGraphJson(url(), 'fixture-secret')).rejects.toMatchObject({ cause: error });
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

  it('does not retry revoked tokens and retains Meta diagnostics and user-facing detail', async () => {
    mocks.fetch.mockResolvedValue(response({ error: {
      message: 'Invalid OAuth token', error_user_msg: 'Lead access was revoked', code: 190,
      error_subcode: 463, fbtrace_id: 'trace-fixture',
    } }, 400));
    await expect(fetchMetaGraphJson(url(), 'fixture-secret')).rejects.toMatchObject({
      message: 'Invalid OAuth token — Lead access was revoked',
      details: { httpStatus: 400, metaCode: 190, metaSubcode: 463, traceId: 'trace-fixture', retryable: false },
    });
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it('retries transient API failures but leaves conversion POST retries to the outbox', async () => {
    mocks.fetch.mockResolvedValueOnce(response({ error: { message: 'Try later', is_transient: true } }, 503))
      .mockResolvedValueOnce(response({ data: [] }));
    await expect(fetchMetaGraphJson(url(), 'fixture-secret')).resolves.toEqual({ data: [] });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    mocks.fetch.mockReset().mockResolvedValue(response({ error: { message: 'Try later' } }, 503));
    await expect(fetchMetaGraphJson(url(), 'fixture-secret', { method: 'POST', body: '{}' })).rejects.toThrow('Try later');
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it('rejects foreign pagination hosts and keeps credentials out of pagination URLs', async () => {
    await expect(fetchMetaGraphJson(new URL('https://attacker.example/leads'), 'fixture-secret')).rejects.toThrow('graph.facebook.com');
    expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.fetch.mockResolvedValue(response({ data: [] }));
    await fetchMetaGraphJson(new URL(`${url()}?access_token=stale-secret&after=next`), 'fixture-secret');
    const [request, init] = mocks.fetch.mock.calls[0];
    expect(request.searchParams.has('access_token')).toBe(false);
    expect(request.searchParams.get('after')).toBe('next');
    expect(init.headers.Authorization).toBe('Bearer fixture-secret');
  });
});
