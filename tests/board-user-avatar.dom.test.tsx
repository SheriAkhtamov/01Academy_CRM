// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardUserAvatar } from '../client/src/components/ux/board/BoardUserAvatar';
import { configureBoardTransport } from '../client/src/features/board/transport';
import { clearMiniSession } from '../client/src/features/board/telegram';
import { fetchMiniBoardUserPhoto } from '../client/src/features/board/user-photo';

const firstPhoto = '/api/users/photos/aaaaaaaaaaaaaaaaaaaaa';
const secondPhoto = '/api/users/photos/bbbbbbbbbbbbbbbbbbbbb';
const employee = { fullName: 'First Employee', avatarUrl: firstPhoto };
const png = () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
let client: QueryClient;
let fetchPhoto: ReturnType<typeof vi.fn<typeof fetch>>;
let createObjectURL: ReturnType<typeof vi.fn<typeof URL.createObjectURL>>;
let revokeObjectURL: ReturnType<typeof vi.fn<typeof URL.revokeObjectURL>>;
let imageFails: boolean;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  fetchPhoto = vi.fn<typeof fetch>().mockImplementation(async () => png());
  vi.stubGlobal('fetch', fetchPhoto);
  imageFails = false;
  vi.stubGlobal('Image', class extends EventTarget {
    complete = false;
    naturalWidth = 0;
    set src(_src: string) {
      queueMicrotask(() => {
        this.complete = true;
        this.naturalWidth = imageFails ? 0 : 24;
        this.dispatchEvent(new Event(imageFails ? 'error' : 'load'));
      });
    }
  });
  createObjectURL = vi.fn<typeof URL.createObjectURL>().mockImplementation(() => `blob:avatar-${createObjectURL.mock.calls.length}`);
  revokeObjectURL = vi.fn<typeof URL.revokeObjectURL>();
  const NativeURL = URL;
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
  configureBoardTransport({ token: () => 'test-photo-bearer', download: async () => undefined });
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mini(user = employee) {
  return <QueryClientProvider client={client}><BoardUserAvatar user={user} miniMode /></QueryClientProvider>;
}

describe('task people avatars', () => {
  it('uses the canonical CRM photo with session image loading without requiring a query provider', async () => {
    const { container } = render(<BoardUserAvatar user={employee} />);
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe(firstPhoto));
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(container.querySelector('img')?.getAttribute('draggable')).toBe('false');
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    expect(fetchPhoto).not.toHaveBeenCalled();
  });

  it('falls back to initials and a neutral icon for absent or blank identities', () => {
    const { container } = render(<><BoardUserAvatar user={{ fullName: ' First Employee ' }} /><BoardUserAvatar /><BoardUserAvatar user={{ fullName: '  ' }} /></>);
    expect(container.textContent).toBe('FE');
    expect(container.querySelectorAll('svg')).toHaveLength(2);
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(fetchPhoto).not.toHaveBeenCalled();
  });

  it.each(['https://outside.test/photo.png', '//outside.test/photo.png', '/api/users/photos/../private', '/api/users/photos/short'])('rejects unsafe photo URLs without any pixel requests: %s', async (avatarUrl) => {
    const { container } = render(mini({ ...employee, avatarUrl }));
    expect(container.textContent).toBe('FE');
    expect(container.querySelector('img')).toBeNull();
    expect(fetchPhoto).not.toHaveBeenCalled();
    await expect(fetchMiniBoardUserPhoto(avatarUrl, new AbortController().signal)).rejects.toThrow();
    expect(fetchPhoto).not.toHaveBeenCalled();
  });

  it('deduplicates mini photo requests and shows local images fetched with bearer headers and no CRM cookie', async () => {
    const { container, unmount } = render(<QueryClientProvider client={client}><BoardUserAvatar user={employee} miniMode /><BoardUserAvatar user={employee} miniMode /></QueryClientProvider>);
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(2));
    expect(fetchPhoto).toHaveBeenCalledTimes(1);
    expect(fetchPhoto).toHaveBeenCalledWith('/api/miniapp/users/photos/aaaaaaaaaaaaaaaaaaaaa', expect.objectContaining({
      headers: { 'X-Requested-With': 'XMLHttpRequest', Authorization: 'Bearer test-photo-bearer' },
      credentials: 'omit', redirect: 'error', cache: 'no-store', signal: expect.any(AbortSignal),
    }));
    expect([...container.querySelectorAll('img')].every((img) => img.src.startsWith('blob:avatar-'))).toBe(true);
    expect(JSON.stringify(client.getQueryCache().getAll().map((query) => query.queryKey))).not.toContain('test-photo-bearer');
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    unmount();
    expect(revokeObjectURL.mock.calls.map(([url]) => url).sort()).toEqual(['blob:avatar-1', 'blob:avatar-2']);
  });

  it('removes the old image immediately on identity changes and revokes both resulting local URLs', async () => {
    const { container, rerender, unmount } = render(mini());
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:avatar-1'));
    let finish!: (response: Response) => void;
    fetchPhoto.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    rerender(mini({ fullName: 'Second Employee', avatarUrl: secondPhoto }));
    await waitFor(() => expect(container.querySelector('img')).toBeNull());
    expect(container.textContent).toBe('SE');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:avatar-1');
    await act(async () => finish(png()));
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:avatar-2'));
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:avatar-2');
  });

  it('aborts a pending photo when the avatar leaves without creating a stale object URL', async () => {
    let signal!: AbortSignal;
    let finish!: (response: Response) => void;
    fetchPhoto.mockImplementationOnce((_url, options) => {
      signal = options!.signal as AbortSignal;
      return new Promise((resolve) => { finish = resolve; });
    });
    const { unmount } = render(mini());
    await waitFor(() => expect(fetchPhoto).toHaveBeenCalledOnce());
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => finish(png()));
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('keeps a deduplicated pending photo alive while another avatar still needs it', async () => {
    let signal!: AbortSignal;
    let finish!: (response: Response) => void;
    fetchPhoto.mockImplementationOnce((_url, options) => {
      signal = options!.signal as AbortSignal;
      return new Promise((resolve) => { finish = resolve; });
    });
    const first = () => <QueryClientProvider client={client}><BoardUserAvatar key="first" user={employee} miniMode /></QueryClientProvider>;
    const { container, rerender, unmount } = render(<QueryClientProvider client={client}><BoardUserAvatar key="first" user={employee} miniMode /><BoardUserAvatar key="second" user={employee} miniMode /></QueryClientProvider>);
    await waitFor(() => expect(fetchPhoto).toHaveBeenCalledOnce());
    rerender(first());
    expect(signal.aborted).toBe(false);
    await act(async () => finish(png()));
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(1));
    expect(fetchPhoto).toHaveBeenCalledOnce();
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
  });

  it('aborts a previous session request and ignores its late pixels while the new session loads', async () => {
    const signals: AbortSignal[] = [];
    const finish: Array<(response: Response) => void> = [];
    fetchPhoto.mockImplementation((_url, options) => {
      signals.push(options!.signal as AbortSignal);
      return new Promise((resolve) => { finish.push(resolve); });
    });
    const { container } = render(mini());
    await waitFor(() => expect(fetchPhoto).toHaveBeenCalledOnce());
    act(() => configureBoardTransport({ token: () => 'next-photo-bearer', download: async () => undefined }));
    await waitFor(() => expect(fetchPhoto).toHaveBeenCalledTimes(2));
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    await act(async () => finish[0](png()));
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(container.querySelector('img')).toBeNull();
    await act(async () => finish[1](png()));
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    expect(createObjectURL).toHaveBeenCalledOnce();
  });

  it('aborts pending pixels when the session is cleared and makes no empty-bearer request', async () => {
    let activeToken = 'initial-photo-bearer';
    configureBoardTransport({ token: () => activeToken, download: async () => undefined });
    let signal!: AbortSignal;
    fetchPhoto.mockImplementationOnce((_url, options) => {
      signal = options!.signal as AbortSignal;
      return new Promise(() => undefined);
    });
    render(mini());
    await waitFor(() => expect(fetchPhoto).toHaveBeenCalledOnce());
    act(() => { activeToken = ''; clearMiniSession(); });
    expect(signal.aborted).toBe(true);
    expect(fetchPhoto).toHaveBeenCalledOnce();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('does not show or reuse a previous session photo after a token/session change', async () => {
    const { container } = render(mini());
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    let finish!: (response: Response) => void;
    fetchPhoto.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    act(() => configureBoardTransport({ token: () => 'next-photo-bearer', download: async () => undefined }));
    await waitFor(() => expect(container.querySelector('img')).toBeNull());
    expect(fetchPhoto).toHaveBeenCalledTimes(2);
    expect(fetchPhoto.mock.lastCall?.[1]?.headers).toMatchObject({ Authorization: 'Bearer next-photo-bearer' });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:avatar-1');
    await act(async () => finish(png()));
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:avatar-2'));
  });

  it('drops a cleared mini session image without fetching with an empty bearer', async () => {
    let activeToken = 'initial-photo-bearer';
    configureBoardTransport({ token: () => activeToken, download: async () => undefined });
    const { container, unmount } = render(mini());
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    act(() => { activeToken = ''; clearMiniSession(); });
    await waitFor(() => expect(container.querySelector('img')).toBeNull());
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:avatar-1');
    expect(fetchPhoto).toHaveBeenCalledOnce();
    unmount();
  });

  it.each([404, 500])('keeps initials when photo loading returns %s', async (status) => {
    fetchPhoto.mockResolvedValueOnce(new Response('{}', { status, headers: { 'content-type': 'application/json' } }));
    const { container } = render(mini());
    await waitFor(() => expect(client.getQueryCache().getAll()[0].state.status).toBe('error'));
    expect(container.textContent).toBe('FE');
    expect(container.querySelector('img')).toBeNull();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('signals normal mini session expiry on unauthorized photo loading without putting credentials in the URL', async () => {
    const expired = vi.fn();
    window.addEventListener('miniapp-auth-expired', expired);
    fetchPhoto.mockResolvedValueOnce(new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } }));
    render(mini());
    await waitFor(() => expect(expired).toHaveBeenCalledOnce());
    expect(String(fetchPhoto.mock.calls[0][0])).not.toContain('bearer');
    expect(createObjectURL).not.toHaveBeenCalled();
    window.removeEventListener('miniapp-auth-expired', expired);
  });

  it.each(['text/html', 'image/svg+xml', 'application/json'])('rejects a response with unsafe image MIME %s', async (type) => {
    fetchPhoto.mockResolvedValueOnce(new Response('<svg />', { headers: { 'content-type': type } }));
    const { container } = render(mini());
    await waitFor(() => expect(client.getQueryCache().getAll()[0].state.status).toBe('error'));
    expect(container.textContent).toBe('FE');
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('keeps initials when genuine image decoding fails and releases its local URL', async () => {
    imageFails = true;
    const { container, unmount } = render(mini());
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('FE');
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:avatar-1');
  });
});
