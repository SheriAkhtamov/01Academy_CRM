import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { MAX_ATTACHMENT_BYTES, validateAttachmentInfo } from '@shared/board-attachments';

// Board task attachments are stored on local disk under <cwd>/uploads/board.
// Downloads are served through an authenticated route, never via static hosting.
export const BOARD_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'board');

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
        // Busboy emits LIMIT_FILE_SIZE at equality; allow exactly 50 MiB.
        fileSize: MAX_ATTACHMENT_BYTES + 1,
        files: 1,
        fields: 5,
        parts: 8,
    },
    fileFilter: (_req, file, cb) => {
        if (validateAttachmentInfo(file.originalname, file.mimetype, 0)) {
            return cb(new Error('Unsupported attachment type'));
        }
        cb(null, true);
    },
});
