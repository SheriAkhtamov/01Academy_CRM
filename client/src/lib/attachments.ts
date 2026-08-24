/**
 * Client-side mirror of the board attachment rules enforced by
 * `server/middleware/upload.middleware.ts`. Checking before upload avoids
 * streaming a large file just to have the server reject it, and lets the UI
 * speak in translated messages instead of raw multer errors.
 */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

export const ALLOWED_ATTACHMENT_EXTENSIONS = [
  '.7z', '.csv', '.doc', '.docx', '.gif', '.jpeg', '.jpg', '.m4a', '.mov',
  '.mp3', '.mp4', '.odp', '.ods', '.odt', '.pdf', '.png', '.ppt', '.pptx',
  '.rar', '.rtf', '.txt', '.wav', '.webm', '.webp', '.xls', '.xlsx', '.zip',
] as const;

const BLOCKED_MIME_TYPES = new Set([
  'application/javascript',
  'application/x-httpd-php',
  'application/x-msdownload',
  'application/x-sh',
  'image/svg+xml',
  'text/html',
  'text/javascript',
  'text/xml',
]);

export type AttachmentValidationError = 'fileTooLarge' | 'fileTypeNotSupported';

export const validateAttachment = (
  file: File,
): AttachmentValidationError | null => {
  if (file.size > MAX_ATTACHMENT_BYTES) return 'fileTooLarge';
  const dotIndex = file.name.lastIndexOf('.');
  const extension = dotIndex >= 0 ? file.name.slice(dotIndex).toLowerCase() : '';
  if (
    !(ALLOWED_ATTACHMENT_EXTENSIONS as readonly string[]).includes(extension)
    || BLOCKED_MIME_TYPES.has(file.type.toLowerCase())
  ) return 'fileTypeNotSupported';
  return null;
};

/** Translates raw server/multer upload failures into i18n keys. */
export const attachmentErrorKey = (message: string | undefined): 'fileTooLarge' | 'fileTypeNotSupported' => {
  const normalized = String(message ?? '').toLowerCase();
  if (normalized.includes('too large') || normalized.includes('file_size') || normalized.includes('limit')) {
    return 'fileTooLarge';
  }
  if (normalized.includes('type') || normalized.includes('format')) {
    return 'fileTypeNotSupported';
  }
  return 'fileTooLarge';
};
