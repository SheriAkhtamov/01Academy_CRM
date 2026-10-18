import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, queryClient } from '../client/src/lib/queryClient';
import { i18n } from '../client/src/lib/i18n';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  queryClient.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  queryClient.clear();
});

describe.each(['en', 'ru'] as const)('user-facing request errors (%s)', (language) => {
  beforeEach(() => i18n.setLanguage(language));

  it.each(['mutation', 'query'] as const)('keeps network diagnostics out of a %s error', async (kind) => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch https://internal.example/api?token=secret'));
    const request = kind === 'mutation'
      ? apiRequest('POST', '/api/test', {})
      : queryClient.fetchQuery({ queryKey: ['/api/test'] });
    await expect(request).rejects.toMatchObject({ message: i18n.t('failedToLoadData') });
  });

  it.each(['mutation', 'query'] as const)('keeps malformed responses out of a %s error', async (kind) => {
    fetchMock.mockResolvedValueOnce(new Response('<html>internal-proxy</html>', {
      headers: { 'Content-Type': 'application/json' },
    }));
    const request = kind === 'mutation'
      ? apiRequest('POST', '/api/test', {})
      : queryClient.fetchQuery({ queryKey: ['/api/test'] });
    await expect(request).rejects.toMatchObject({ message: i18n.t('failedToLoadData') });
  });

  it('preserves specific validation and response metadata', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'demoRoomRequired' }), { status: 400 }));
    await expect(apiRequest('POST', '/api/test', {})).rejects.toMatchObject({
      message: i18n.t('demoRoomRequired'), status: 400, rawMessage: 'demoRoomRequired',
    });
  });

  it('replaces unknown server diagnostics with a concise failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'SQL academy_leads internal_id=42' }), { status: 500 }));
    await expect(apiRequest('POST', '/api/test', {})).rejects.toMatchObject({ message: i18n.t('apiErrorGeneric') });
  });
});
