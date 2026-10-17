import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptInstagramToken, listInstagramConversations } from '../server/services/instagram';

const mocks = vi.hoisted(() => ({ query: vi.fn(), publish: vi.fn(), warn: vi.fn() }));
vi.mock('../server/db', () => ({ pool: { query: mocks.query } }));
vi.mock('../server/realtime/realtime-hub', () => ({ publishRealtimeEvent: mocks.publish }));
vi.mock('../server/lib/logger', () => ({ logger: { warn: mocks.warn, error: vi.fn(), info: vi.fn() } }));
let nextId = 800;
let accountId: number;
let picture: string | null;
let encryptedToken: string;

beforeEach(() => {
  vi.clearAllMocks();
  accountId = nextId++;
  picture = null;
  encryptedToken = encryptInstagramToken('synthetic-profile-token');
  mocks.query.mockImplementation(async (sql: string, values: unknown[]) => {
    if (sql.startsWith('SELECT access_token_encrypted')) return { rows: [{ access_token_encrypted: encryptedToken }] };
    if (sql.startsWith('UPDATE instagram_accounts SET profile_picture_url')) {
      if (values[2] !== encryptedToken) return { rows: [], rowCount: 0 };
      picture = String(values[1]);
      return { rows: [], rowCount: 1 };
    }
    return { rows: [
      { id: 1, account_id: accountId, account_username: 'academy', account_profile_picture_url: picture },
      { id: 2, account_id: accountId, account_username: 'academy', account_profile_picture_url: picture },
    ] };
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('Instagram account photo backfill', () => {
  it('keeps the inbox responsive, deduplicates concurrent profile reads and refreshes authorized readers', async () => {
    let finish!: (response: Response) => void;
    const fetchProfile = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal('fetch', fetchProfile);
    const [first, second] = await Promise.all([
      listInstagramConversations({ id: 7, module: 'sales' }),
      listInstagramConversations({ id: 8, module: 'sales' }),
    ]);
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(first[0]).toMatchObject({ accountProfilePictureUrl: null });
    await vi.waitFor(() => expect(fetchProfile).toHaveBeenCalledOnce());
    const [url, init] = fetchProfile.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).searchParams.get('fields')).toBe('profile_picture_url');
    expect(url).not.toContain('synthetic-profile-token');
    expect(init.headers).toEqual({ Authorization: 'Bearer synthetic-profile-token' });
    finish(new Response(JSON.stringify({ profile_picture_url: 'https://scontent.cdninstagram.com/academy-photo' }), {
      headers: { 'content-type': 'application/json' },
    }));
    await vi.waitFor(() => expect(mocks.publish).toHaveBeenCalledWith({
      type: 'INSTAGRAM_ACCOUNT_PHOTO_UPDATED', data: { accountId }, audienceUserIds: [7, 8],
    }));
    const refreshed = await listInstagramConversations({ id: 7, module: 'sales' });
    expect(refreshed[0]).toMatchObject({ accountProfilePictureUrl: 'https://scontent.cdninstagram.com/academy-photo' });
    expect(JSON.stringify(refreshed)).not.toContain('accessToken');
    expect(fetchProfile).toHaveBeenCalledOnce();
  });

  it('preserves inbox access and backs off if the profile request fails', async () => {
    const fetchProfile = vi.fn().mockRejectedValue(new Error('Synthetic unavailable profile'));
    vi.stubGlobal('fetch', fetchProfile);
    expect(await listInstagramConversations({ id: 7, module: 'sales' })).toHaveLength(2);
    await vi.waitFor(() => expect(mocks.warn).toHaveBeenCalled());
    expect(await listInstagramConversations({ id: 7, module: 'sales' })).toHaveLength(2);
    expect(fetchProfile).toHaveBeenCalledOnce();
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(picture).toBeNull();
  });

  it.each(['http://scontent.cdninstagram.com/photo', 'https://user:password@scontent.cdninstagram.com/photo'])('does not store an unsafe profile photo URL: %s', async (url) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ profile_picture_url: url }), { headers: { 'content-type': 'application/json' } })));
    await listInstagramConversations({ id: 7, module: 'sales' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(picture).toBeNull();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});
