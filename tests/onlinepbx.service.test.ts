import { describe, expect, it, vi } from 'vitest';
import {
  normalizeOnlinePbxPhone,
  OnlinePbxClient,
} from '../server/services/onlinepbx';

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

describe('OnlinePbxClient', () => {
  it('normalizes Uzbek customer phone numbers', () => {
    expect(normalizeOnlinePbxPhone('90 123-45-67')).toBe('+998901234567');
    expect(normalizeOnlinePbxPhone('998901234567')).toBe('+998901234567');
    expect(normalizeOnlinePbxPhone('+7 (999) 123-45-67')).toBe('+79991234567');
    expect(normalizeOnlinePbxPhone('101')).toBeNull();
  });

  it('authenticates and starts an instant callback without exposing the permanent token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: '1',
        data: { key_id: 'key-id', key: 'short-lived-key' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: '1',
        data: { uuid: 'call-uuid' },
      }));
    const client = new OnlinePbxClient({
      domain: 'pbx38153.onpbx.ru',
      authKey: 'permanent-token',
      apiUrl: 'https://api2.onlinepbx.ru',
    }, fetchMock as unknown as typeof fetch);

    await expect(client.initiateCall('100', '+998901234567')).resolves.toEqual({ uuid: 'call-uuid' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const authRequest = fetchMock.mock.calls[0];
    expect(authRequest[0]).toBe('https://api2.onlinepbx.ru/pbx38153.onpbx.ru/auth.json');
    expect(String(authRequest[1]?.body)).toContain('auth_key=permanent-token');

    const callRequest = fetchMock.mock.calls[1];
    expect(callRequest[0]).toBe('https://api2.onlinepbx.ru/pbx38153.onpbx.ru/call/instantly.json');
    expect(callRequest[1]?.headers).toMatchObject({
      'x-pbx-authentication': 'key-id:short-lived-key',
    });
    expect(String(callRequest[1]?.body)).toBe('from=100&to=%2B998901234567');
  });

  it('refreshes authentication once when OnlinePBX invalidates a session key', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: '1', data: { key_id: 'one', key: 'first' } }))
      .mockResolvedValueOnce(jsonResponse({ status: '0', isNotAuth: true }))
      .mockResolvedValueOnce(jsonResponse({ status: '1', data: { key_id: 'two', key: 'second' } }))
      .mockResolvedValueOnce(jsonResponse({ status: '1', data: { uuid: 'retried-call' } }));
    const client = new OnlinePbxClient({
      domain: 'pbx38153.onpbx.ru',
      authKey: 'permanent-token',
    }, fetchMock as unknown as typeof fetch);

    await expect(client.initiateCall('101', '+998901234567')).resolves.toEqual({ uuid: 'retried-call' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
