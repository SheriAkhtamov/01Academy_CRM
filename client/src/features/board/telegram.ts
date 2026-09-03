import { apiRequest } from '@/lib/queryClient';
import type { AuthSession } from '@shared/auth';
import { configureBoardTransport } from './transport';

interface TelegramWebApp {
  initData: string;
  colorScheme: 'light' | 'dark';
  ready: () => void;
  expand: () => void;
  close: () => void;
  isVersionAtLeast: (version: string) => boolean;
  onEvent: (name: string, callback: () => void) => void;
  offEvent: (name: string, callback: () => void) => void;
  openLink: (url: string) => void;
  downloadFile?: (params: { url: string; file_name: string }) => void;
  enableClosingConfirmation: () => void;
  disableClosingConfirmation: () => void;
  BackButton: { show: () => void; hide: () => void; onClick: (callback: () => void) => void; offClick: (callback: () => void) => void };
}
export const telegramApp = () => (window as Window & { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
let token = '';
export const clearMiniSession = () => { token = ''; };
export const miniRequest = async (method: string, path: string, data?: unknown) => {
  try {
    return await apiRequest(method, `/api/miniapp${path}`, data, { headers: { Authorization: `Bearer ${token}` }, credentials: 'omit' });
  } catch (error) {
    if ((error as { status?: number }).status === 401) window.dispatchEvent(new Event('miniapp-auth-expired'));
    throw error;
  }
};
export async function launchMiniApp(): Promise<AuthSession> {
  const app = telegramApp();
  if (!app?.initData) throw new Error('miniTasksOpenTelegram');
  const result = await apiRequest('POST', '/api/miniapp/auth', { initData: app.initData }, { credentials: 'omit' });
  token = result.token;
  configureBoardTransport({
    token: () => token,
    download: async (id, name) => {
      const { url } = await miniRequest('POST', `/attachments/${id}/link`);
      if (app.isVersionAtLeast('8.0') && app.downloadFile) app.downloadFile({ url, file_name: name });
      else app.openLink(url);
    },
  });
  return result.session;
}
export const miniAuthApi = {
  fetchAuthSession: (): Promise<AuthSession> => miniRequest('GET', '/auth/session'),
  loginUserSession: async (): Promise<AuthSession> => { throw new Error('miniTasksOpenTelegram'); },
  logoutSession: async () => { clearMiniSession(); telegramApp()?.close(); },
};
