import { apiRequest } from '@/lib/queryClient';

interface BoardTransport {
  token: () => string;
  download: (id: number, name: string) => Promise<void>;
}
let transport: BoardTransport | undefined;
// Only the separate Mini App entry configures this. The CRM keeps its existing transport.
export const configureBoardTransport = (value: BoardTransport) => { transport = value; };
export const isMiniBoard = () => Boolean(transport);
export const boardUrl = (url: string) => transport ? url.replace(/^\/api\/board(?=\/|$)/, '/api/miniapp/board') : url;
export const boardHeaders = (): Record<string, string> => transport ? { Authorization: `Bearer ${transport.token()}` } : {};
export const downloadBoardAttachment = (id: number, name: string) => transport!.download(id, name);
export async function boardRequest(method: string, url: string, data?: unknown) {
  if (!transport) return apiRequest(method, url, data);
  try {
    return await apiRequest(method, boardUrl(url), data, { headers: boardHeaders(), credentials: 'omit' });
  } catch (error) {
    if ((error as { status?: number }).status === 401) window.dispatchEvent(new Event('miniapp-auth-expired'));
    throw error;
  }
}
