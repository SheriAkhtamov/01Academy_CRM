import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { nanoid } from 'nanoid';
import type { RequestHandler } from 'express';
import { MAX_MESSAGE_FILES, MAX_MESSAGE_FILE_BYTES, type MessageAttachment } from '@shared/contracts/messages';
import { attachmentUploadLimiter } from './rateLimiter';

export const MESSAGE_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'messages');
export const messageFilePath = (id: string) => /^[A-Za-z0-9_-]{21}$/.test(id) ? path.join(MESSAGE_UPLOAD_DIR, id) : null;
export const removeMessageFiles = async (files: Express.Multer.File[]) => {
  await Promise.all(files.map(file => fs.unlink(file.path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  })));
};
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      fs.mkdir(MESSAGE_UPLOAD_DIR, { recursive: true, mode: 0o750 })
        .then(() => callback(null, MESSAGE_UPLOAD_DIR), error => callback(error, MESSAGE_UPLOAD_DIR));
    },
    filename: (_req, _file, callback) => callback(null, nanoid()),
  }),
  limits: { fileSize: MAX_MESSAGE_FILE_BYTES, files: MAX_MESSAGE_FILES, fields: 2, parts: MAX_MESSAGE_FILES + 4, fieldSize: 40_000 },
});
export const parseMessageUpload: RequestHandler = (req, res, next) => {
  if (!req.is('multipart/form-data')) return next();
  attachmentUploadLimiter(req, res, (error) => {
    if (error) return next(error);
    upload.array('files', MAX_MESSAGE_FILES)(req, res, (uploadError: unknown) => {
      if (!uploadError) return next();
      const code = uploadError instanceof multer.MulterError ? uploadError.code : '';
      const key = code === 'LIMIT_FILE_SIZE' ? 'messageFileTooLarge'
        : ['LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE', 'LIMIT_PART_COUNT'].includes(code) ? 'messageFileLimit' : 'attachmentUploadFailed';
      res.status(code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: key });
    });
  });
};

// Decide what may be rendered inline from file bytes, independently of the
// supplied filename or Content-Type. Everything else is a download.
export const messageInlineMimeType = (header: Buffer): string => {
  if (header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (header[0] === 255 && header[1] === 216 && header[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a/.test(header.toString('ascii', 0, 6))) return 'image/gif';
  if (header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (header.toString('ascii', 4, 8) === 'ftyp') {
    const brand = header.toString('ascii', 8, 12);
    if (['avif', 'avis'].includes(brand)) return 'image/avif';
    if (['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ', 'M4VH', 'M4VP'].includes(brand)) return 'video/mp4';
    if (brand === 'qt  ') return 'video/quicktime';
  }
  if (header.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])) && header.includes(Buffer.from('webm'))) return 'video/webm';
  return 'application/octet-stream';
};

export const uploadedMessageAttachment = async (file: Express.Multer.File): Promise<MessageAttachment> => {
  const handle = await fs.open(file.path, 'r');
  let mimeType: string;
  try {
    const header = Buffer.alloc(512);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    mimeType = messageInlineMimeType(header.subarray(0, bytesRead));
  } finally { await handle.close(); }
  const decoded = Buffer.from(file.originalname, 'latin1').toString('utf8');
  const name = /[\u0080-\u00ff]/.test(file.originalname) && !decoded.includes('\uFFFD') ? decoded : file.originalname;
  return { id: file.filename, name: path.basename(name.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255) || 'file',
    mimeType, size: file.size, url: `/api/messages/attachments/${file.filename}` };
};
