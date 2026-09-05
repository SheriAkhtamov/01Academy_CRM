import { apiRequest, handleUnauthorized } from '@/lib/queryClient';

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
export function handleBoardUnauthorized(error: unknown) {
  if ((error as { status?: number })?.status !== 401) return;
  if (transport) window.dispatchEvent(new Event('miniapp-auth-expired'));
  else handleUnauthorized(error);
}
export async function downloadBoardAttachment(id: number, name: string) {
  if (transport) return transport.download(id, name);
  try {
    const response = await apiRequest('GET', `/api/board/attachments/${id}/download`);
    if (!(response instanceof Response)) throw new Error('attachmentDownloadFailed');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    handleBoardUnauthorized(error);
    throw error;
  }
}
export async function boardRequest(method: string, url: string, data?: unknown) {
  if (!transport) return apiRequest(method, url, data);
  try {
    return await apiRequest(method, boardUrl(url), data, { headers: boardHeaders(), credentials: 'omit' });
  } catch (error) {
    handleBoardUnauthorized(error);
    throw error;
  }
}
