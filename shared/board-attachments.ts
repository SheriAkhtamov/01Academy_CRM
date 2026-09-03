export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const MAX_SELECTED_ATTACHMENTS = 10;

// Raster images only. SVG/HTML/scripts must never become inline previews.
export const PHOTO_EXTENSIONS = [
  '.jpg', '.jpeg', '.jpe', '.jfif', '.png', '.apng', '.gif', '.webp', '.avif',
  '.bmp', '.dib', '.tif', '.tiff', '.heic', '.heif', '.ico', '.jxl', '.jp2', '.j2k',
  '.dng', '.cr2', '.cr3', '.nef', '.nrw', '.arw', '.sr2', '.srf', '.orf', '.rw2', '.raf', '.pef', '.3fr',
] as const;
export const ALLOWED_ATTACHMENT_EXTENSIONS: readonly string[] = [
  ...PHOTO_EXTENSIONS,
  '.7z', '.csv', '.doc', '.docx', '.m4a', '.mov', '.mp3', '.mp4', '.odp',
  '.ods', '.odt', '.pdf', '.ppt', '.pptx', '.rar', '.rtf', '.txt', '.wav',
  '.webm', '.xls', '.xlsx', '.zip',
];
const BLOCKED_MIME_TYPES = new Set([
  'application/javascript', 'application/x-httpd-php', 'application/x-msdownload',
  'application/x-sh', 'image/svg+xml', 'text/html', 'text/javascript', 'text/xml',
  'application/xhtml+xml', 'application/xml',
]);

export const attachmentExtension = (name: string) => {
  const index = name.lastIndexOf('.');
  return index < 0 ? '' : name.slice(index).toLowerCase();
};
export const isPhotoAttachment = (name: string) =>
  (PHOTO_EXTENSIONS as readonly string[]).includes(attachmentExtension(name));

export type AttachmentValidationError = 'fileTooLarge' | 'fileTypeNotSupported';
export function validateAttachmentInfo(name: string, type: string, size: number): AttachmentValidationError | null {
  if (size > MAX_ATTACHMENT_BYTES) return 'fileTooLarge';
  if (!ALLOWED_ATTACHMENT_EXTENSIONS.includes(attachmentExtension(name))
    || BLOCKED_MIME_TYPES.has(type.toLowerCase().split(';')[0].trim())) return 'fileTypeNotSupported';
  return null;
}
