import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { nanoid } from 'nanoid';
import type { RequestHandler } from 'express';
import { MAX_PAYMENT_ATTACHMENTS, MAX_PAYMENT_ATTACHMENT_BYTES, validatePaymentAttachment } from '@shared/payment-attachments';
import { attachmentUploadLimiter } from './rateLimiter';

export const PAYMENT_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'payments');
const storedFileName = /^[A-Za-z0-9_-]{10,64}\.(?:jpg|jpeg|png|webp|heic|heif|pdf)$/;

export const paymentFilePath = (fileName: string): string | null => {
  if (!storedFileName.test(fileName)) return null;
  const filePath = path.resolve(PAYMENT_UPLOAD_DIR, fileName);
  return path.dirname(filePath) === PAYMENT_UPLOAD_DIR ? filePath : null;
};

export const removePaymentFiles = async (files: Express.Multer.File[]) => {
  await Promise.all(files.map((file) => fs.promises.unlink(file.path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  })));
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        fs.mkdirSync(PAYMENT_UPLOAD_DIR, { recursive: true, mode: 0o750 });
        cb(null, PAYMENT_UPLOAD_DIR);
      } catch (error) {
        cb(error as Error, PAYMENT_UPLOAD_DIR);
      }
    },
    filename: (_req, file, cb) => {
      const extension = path.extname(file.originalname).toLowerCase();
      cb(null, `${nanoid()}${extension}`);
    },
  }),
  limits: { fileSize: MAX_PAYMENT_ATTACHMENT_BYTES, files: MAX_PAYMENT_ATTACHMENTS, fields: 12, parts: 20 },
  fileFilter: (_req, file, cb) => {
    const errorKey = validatePaymentAttachment(file.originalname, file.mimetype, 0);
    if (errorKey) return cb(new Error(errorKey));
    cb(null, true);
  },
});

export const parsePaymentAttachments: RequestHandler = (req, res, next) => {
  if (!req.is('multipart/form-data')) return next();
  attachmentUploadLimiter(req, res, (limitError) => {
    if (limitError) return next(limitError);
    upload.array('files', MAX_PAYMENT_ATTACHMENTS)(req, res, (error: any) => {
      if (!error) return next();
      const key = error.code === 'LIMIT_FILE_SIZE'
        ? 'paymentFileTooLarge'
        : error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE'
          ? 'paymentFileLimit'
          : error.message === 'paymentFileTypeUnsupported'
            ? 'paymentFileTypeUnsupported'
            : 'attachmentUploadFailed';
      return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: key });
    });
  });
};
