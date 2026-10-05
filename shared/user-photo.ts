export const MAX_USER_PHOTO_BYTES = 10 * 1024 * 1024;
export const USER_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'] as const;
export const safeUserPhotoUrl = (url: string | null | undefined) =>
  url && /^\/api\/users\/photos\/[A-Za-z0-9_-]{21}$/.test(url) ? url : undefined;
