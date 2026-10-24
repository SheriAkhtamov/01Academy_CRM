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
  it('loads current and prepaid licenses in seconds from the billing API', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: '1', data: { key_id: 'billing', key: 'session' } }))
      .mockResolvedValueOnce(jsonResponse({ status: '1', data: [
        { start_stamp: 1792750360, end_stamp: 1795294799, service_type: 'USER', service_count: 2 },
        { start_stamp: '1795294800', end_stamp: '1797886799', service_type: 'USER', service_count: '2' },
      ] }));
    const client = new OnlinePbxClient({ domain: 'example.onpbx.ru', authKey: 'test-only' }, fetchMock);
    await expect(client.listLicenses()).resolves.toEqual([
      { startStamp: 1792750360, endStamp: 1795294799, serviceType: 'USER', serviceCount: 2 },
      { startStamp: 1795294800, endStamp: 1797886799, serviceType: 'USER', serviceCount: 2 },
    ]);
    expect(fetchMock.mock.calls[1][0]).toBe('https://api2.onlinepbx.ru/example.onpbx.ru/billing/licenses/get.json');
  });

  it.each([null, {}, [null], [{ start_stamp: 1792750360, end_stamp: 1795294799000, service_type: 'USER', service_count: 1 }],
    [{ start_stamp: 1792750360, end_stamp: 1795294799, service_type: 'USER', service_count: -1 }]])(
    'rejects malformed billing data rather than planning a misleading reminder: %j', async (data) => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse({ status: '1', data: { key_id: 'billing', key: 'session' } }))
        .mockResolvedValueOnce(jsonResponse({ status: '1', data }));
      const client = new OnlinePbxClient({ domain: 'example.onpbx.ru', authKey: 'test-only' }, fetchMock);
      await expect(client.listLicenses()).rejects.toThrow('onlinePbxInvalidResponse');
    },
  );

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

  it('loads WebRTC credentials for the employee extension', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: '1', data: { key_id: 'one', key: 'first' } }))
      .mockResolvedValueOnce(jsonResponse({
        status: '1',
        data: [{
          num: '107',
          enabled: true,
          webrtc: {
            host: 'pbx38153.onpbx.ru:8082',
            user: '107',
            password: 'browser-sip-password',
          },
        }],
      }));
    const client = new OnlinePbxClient({
      domain: 'pbx38153.onpbx.ru',
      authKey: 'permanent-token',
    }, fetchMock as unknown as typeof fetch);

    await expect(client.getWebRtcCredentials('107')).resolves.toEqual({
      extension: '107',
      username: '107',
      password: 'browser-sip-password',
      sipDomain: 'pbx38153.onpbx.ru',
      websocketUrl: 'wss://pbx38153.onpbx.ru:8082',
      aor: 'sip:107@pbx38153.onpbx.ru',
    });
    expect(String(fetchMock.mock.calls[1][1]?.body)).toContain('fields=num%2Cname%2Cenabled%2Cwebrtc');
  });

  it('rejects WebRTC credentials for an extension without an active user license', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: '1', data: { key_id: 'one', key: 'first' } }))
      .mockResolvedValueOnce(jsonResponse({
        status: '1',
        data: [{
          num: '107',
          enabled: false,
          webrtc: {
            host: 'pbx38153.onpbx.ru:8082',
            user: '107',
            password: 'browser-sip-password',
          },
        }],
      }));
    const client = new OnlinePbxClient({
      domain: 'pbx38153.onpbx.ru',
      authKey: 'permanent-token',
    }, fetchMock as unknown as typeof fetch);

    await expect(client.getWebRtcCredentials('107')).rejects.toMatchObject({
      clientCode: 'onlinePbxUserLicenseRequired',
      statusCode: 409,
      providerCode: 'USER_DISABLED',
    });
  });

  it('reads and updates the existing incoming group without changing its other settings', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: '1', data: { key_id: 'one', key: 'first' } }))
      .mockResolvedValueOnce(jsonResponse({
        status: '1',
        data: {
          num: '10',
          name: 'Sales Department',
          users: '100;998978576040',
          delay: '20',
          default: '',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ status: '1' }));
    const client = new OnlinePbxClient({
      domain: 'pbx38153.onpbx.ru',
      authKey: 'permanent-token',
    }, fetchMock as unknown as typeof fetch);

    const group = await client.getGroup('10');
    await client.updateGroup({
      ...group,
      users: ['100'],
    });

    expect(group).toEqual({
      extension: '10',
      name: 'Sales Department',
      users: ['100', '998978576040'],
      delay: 20,
      defaultDestination: null,
    });
    expect(String(fetchMock.mock.calls[2][1]?.body))
      .toBe('num=10&users=100&delay=20&default=&name=Sales+Department');
  });

  it('keeps provider diagnostics when a call request is rejected', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: '1', data: { key_id: 'one', key: 'first' } }))
      .mockResolvedValueOnce(jsonResponse({
        status: '0',
        errorCode: 'USER_NOT_REGISTERED',
        comment: 'Extension is offline',
      }));
    const client = new OnlinePbxClient({
      domain: 'pbx38153.onpbx.ru',
      authKey: 'permanent-token',
    }, fetchMock as unknown as typeof fetch);

    await expect(client.initiateCall('107', '+998901234567')).rejects.toMatchObject({
      clientCode: 'onlinePbxRequestFailed',
      providerCode: 'USER_NOT_REGISTERED',
      providerComment: 'Extension is offline',
    });
  });
});
