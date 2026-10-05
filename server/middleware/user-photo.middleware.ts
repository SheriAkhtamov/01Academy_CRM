import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { nanoid } from 'nanoid';
import type { Request, RequestHandler, Response } from 'express';
import { MAX_USER_PHOTO_BYTES, USER_PHOTO_MIME_TYPES } from '@shared/user-photo';
import { readFileMimeType } from '../lib/file-media';
import { attachmentUploadLimiter } from './rateLimiter';
import { logger } from '../lib/logger';

export const USER_PHOTO_DIR = path.resolve(process.cwd(), 'uploads', 'user-photos');
export const userPhotoPath = (id: string) => /^[A-Za-z0-9_-]{21}$/.test(id) ? path.join(USER_PHOTO_DIR, id) : null;
export const retainUploadedUserPhoto = (res: Response) => { res.locals.userPhotoSaved = true; };
export const cleanupUploadedUserPhoto = async (req: Request, res: Response) => {
  if (req.file && !res.locals.userPhotoSaved) await fs.unlink(req.file.path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') logger.error('Failed to remove unsaved profile photo', { error });
  });
};
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      fs.mkdir(USER_PHOTO_DIR, { recursive: true, mode: 0o750 })
        .then(() => callback(null, USER_PHOTO_DIR), error => callback(error, USER_PHOTO_DIR));
    },
    filename: (_req, _file, callback) => callback(null, nanoid()),
  }),
  limits: { fileSize: MAX_USER_PHOTO_BYTES, files: 1, fields: 1, fieldSize: 64_000, parts: 3 },
});

export const parseUserPhotoUpload: RequestHandler = (req, res, next) => {
  if (!req.is('multipart/form-data')) return next();
  attachmentUploadLimiter(req, res, (error) => {
    if (error) return next(error);
    upload.single('photo')(req, res, async (uploadError: unknown) => {
      if (uploadError) {
        const oversized = uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_SIZE';
        return res.status(oversized ? 413 : 400).json({ error: oversized ? 'messageFileTooLarge' : 'attachmentUploadFailed' });
      }
      const reject = async (key: string) => {
        await cleanupUploadedUserPhoto(req, res);
        res.status(400).json({ error: key });
      };
      try {
        if (typeof req.body?.profile !== 'string' || Object.keys(req.body).length !== 1) {
          return await reject('invalidData');
        }
        const profile: unknown = JSON.parse(req.body.profile);
        if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
          return await reject('invalidData');
        }
        req.body = profile;
        if (req.file) {
          const mimeType = await readFileMimeType(req.file.path);
          if (!USER_PHOTO_MIME_TYPES.some((type) => type === mimeType)) {
            return await reject('profilePhotoTypeUnsupported');
          }
          res.locals.userPhotoUrl = `/api/users/photos/${req.file.filename}`;
        }
        next();
      } catch { await reject('invalidData'); }
    });
  });
};
