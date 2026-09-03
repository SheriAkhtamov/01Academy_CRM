import { validateAttachmentInfo } from '@shared/board-attachments';
export { MAX_ATTACHMENT_BYTES, ALLOWED_ATTACHMENT_EXTENSIONS } from '@shared/board-attachments';
export const validateAttachment = (file: File) => validateAttachmentInfo(file.name, file.type, file.size);

/** Translates raw server/multer upload failures into i18n keys. */
export const attachmentErrorKey = (message: string | undefined) => {
  const normalized = String(message ?? '').toLowerCase();
  if (normalized.includes('too large') || normalized.includes('file_size') || normalized.includes('413')) {
    return 'fileTooLarge';
  }
  if (normalized.includes('unsupported attachment') || normalized.includes('type') || normalized.includes('format')) {
    return 'fileTypeNotSupported';
  }
  return 'attachmentUploadFailed';
};
