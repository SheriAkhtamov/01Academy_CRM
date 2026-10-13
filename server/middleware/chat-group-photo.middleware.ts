import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { nanoid } from 'nanoid';
import type { Request, RequestHandler } from 'express';
import { MAX_USER_PHOTO_BYTES, USER_PHOTO_MIME_TYPES } from '@shared/user-photo';
import { logger } from '../lib/logger';
import { readFileMimeType } from '../lib/file-media';
import { attachmentUploadLimiter } from './rateLimiter';

const directory = path.resolve(process.cwd(), 'uploads', 'group-photos');
export const chatGroupPhotoPath = (id: string) => /^[A-Za-z0-9_-]{21}$/.test(id) ? path.join(directory, id) : null;
export const cleanupChatGroupPhoto = async (req: Request) => {
  if (req.file) await fs.unlink(req.file.path).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
};
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      fs.mkdir(directory, { recursive: true, mode: 0o750 }).then(() => callback(null, directory), error => callback(error, directory));
    },
    filename: (_req, _file, callback) => callback(null, nanoid()),
  }),
  limits: { fileSize: MAX_USER_PHOTO_BYTES, files: 1, fields: 1, fieldSize: 1024, parts: 3 },
});
export const parseChatGroupPhotoUpload: RequestHandler = (req, res, next) => {
  if (!req.is('multipart/form-data')) return next();
  attachmentUploadLimiter(req, res, (limitError) => {
    if (limitError) return next(limitError);
    upload.single('photo')(req, res, async (uploadError: unknown) => {
      const reject = async (key: string, status = 400) => {
        await cleanupChatGroupPhoto(req).catch(error => logger.error('Failed to remove rejected group photo', { error }));
        res.status(status).json({ error: key });
      };
      try {
        if (uploadError) return await reject(uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_SIZE' ? 'messageFileTooLarge' : 'attachmentUploadFailed', uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_SIZE' ? 413 : 400);
        if (Object.keys(req.body).length !== 1 || typeof req.body.profile !== 'string') return await reject('invalidData');
        req.body = JSON.parse(req.body.profile);
        if (req.file) {
          const mimeType = await readFileMimeType(req.file.path);
          if (!USER_PHOTO_MIME_TYPES.some(type => type === mimeType)) return await reject('profilePhotoTypeUnsupported');
        }
        next();
      } catch { await reject('attachmentUploadFailed'); }
    });
  });
};
