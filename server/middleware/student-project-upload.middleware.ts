import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { nanoid } from 'nanoid';
import type { RequestHandler } from 'express';
import { MAX_STUDENT_PROJECT_BYTES } from '@shared/contracts/student-profile';

export const STUDENT_PROJECT_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'portfolio');
const fileIdPattern = /^[A-Za-z0-9_-]{21}$/;
export function studentProjectFilePath(fileId: string): string | null {
  return fileIdPattern.test(fileId) ? path.join(STUDENT_PROJECT_UPLOAD_DIR, fileId) : null;
}
export function studentProjectFileInfo(fileUrl: string | null | undefined) {
  const match = /^\/api\/academy\/students\/([1-9]\d*)\/projects\/files\/([A-Za-z0-9_-]{21})\?name=(.+)$/.exec(fileUrl ?? '');
  if (!match) return null;
  try {
    return { studentId: Number(match[1]), fileId: match[2], fileName: decodeURIComponent(match[3]) };
  } catch { return null; }
}
export const removeStudentProjectFile = async (file: Express.Multer.File | undefined) => {
  if (file) await fs.promises.unlink(file.path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
};
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      try {
        fs.mkdirSync(STUDENT_PROJECT_UPLOAD_DIR, { recursive: true, mode: 0o750 });
        callback(null, STUDENT_PROJECT_UPLOAD_DIR);
      } catch (error) { callback(error as Error, STUDENT_PROJECT_UPLOAD_DIR); }
    },
    filename: (_req, _file, callback) => callback(null, nanoid()),
  }),
  limits: { fileSize: MAX_STUDENT_PROJECT_BYTES, files: 1, fields: 3, parts: 4 },
});
export const parseStudentProjectUpload: RequestHandler = (req, res, next) => {
  if (!req.is('multipart/form-data')) return next();
  upload.single('file')(req, res, (error: unknown) => {
    if (!error) return next();
    const tooLarge = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE';
    res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? 'studentProjectFileTooLarge' : 'studentProjectSaveFailed' });
  });
};
