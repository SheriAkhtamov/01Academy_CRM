import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { nanoid } from 'nanoid';

// Board task attachments are stored on local disk under <cwd>/uploads/board.
// Downloads are served through an authenticated route, never via static hosting.
export const BOARD_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'board');
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
    '.7z', '.csv', '.doc', '.docx', '.gif', '.jpeg', '.jpg', '.m4a', '.mov',
    '.mp3', '.mp4', '.odp', '.ods', '.odt', '.pdf', '.png', '.ppt', '.pptx',
    '.rar', '.rtf', '.txt', '.wav', '.webm', '.webp', '.xls', '.xlsx', '.zip',
]);
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

// Best-effort directory creation. This must NEVER throw at import time: if the
// directory is not writable (e.g. a read-only working dir in a container), the
// whole server would crash-loop on boot. Attachment uploads simply fail with a
// clear error instead, leaving the rest of the app running.
function ensureUploadDir(): boolean {
    try {
        fs.mkdirSync(BOARD_UPLOAD_DIR, { recursive: true, mode: 0o750 });
        fs.chmodSync(BOARD_UPLOAD_DIR, 0o750);
        return true;
    } catch {
        console.warn(`[uploads] could not create ${BOARD_UPLOAD_DIR}; attachment uploads will be unavailable`);
        return false;
    }
}

ensureUploadDir();

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        // Re-check at upload time so a transient/late-fixed dir still works.
        if (ensureUploadDir()) {
            cb(null, BOARD_UPLOAD_DIR);
        } else {
            cb(new Error('Upload directory is not available'), BOARD_UPLOAD_DIR);
        }
    },
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${nanoid()}${ext}`);
    },
});

export const boardAttachmentUpload = multer({
    storage,
    limits: {
        fileSize: MAX_ATTACHMENT_BYTES,
        files: 1,
        fields: 5,
        parts: 8,
    },
    fileFilter: (_req, file, cb) => {
        const extension = path.extname(file.originalname).toLowerCase();
        const mimeType = file.mimetype.toLowerCase();
        if (
            !ALLOWED_EXTENSIONS.has(extension)
            || BLOCKED_MIME_TYPES.has(mimeType)
        ) {
            return cb(new Error('Unsupported attachment type'));
        }
        cb(null, true);
    },
});
