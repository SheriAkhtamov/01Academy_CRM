import { throwIfResNotOk } from '@/lib/queryClient';
import { boardHeaders, handleBoardUnauthorized } from './transport';
import { safeUserPhotoUrl, USER_PHOTO_MIME_TYPES } from '@shared/user-photo';

export async function fetchMiniBoardUserPhoto(url: string, signal: AbortSignal): Promise<Blob> {
  const safeUrl = safeUserPhotoUrl(url);
  if (!safeUrl) throw new Error('Invalid user photo');
  try {
    const response = await fetch(safeUrl.replace('/api/users/photos/', '/api/miniapp/users/photos/'), {
      headers: { 'X-Requested-With': 'XMLHttpRequest', ...boardHeaders() },
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal,
    });
    await throwIfResNotOk(response);
    const mimeType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    if (!USER_PHOTO_MIME_TYPES.some((type) => type === mimeType)) throw new Error('Invalid user photo type');
    return await response.blob();
  } catch (error) {
    handleBoardUnauthorized(error);
    throw error;
  }
}
