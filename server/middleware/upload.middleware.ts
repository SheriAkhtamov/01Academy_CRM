import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { nanoid } from 'nanoid';

// Board task attachments are stored on local disk under <cwd>/uploads/board.
// Downloads are served through an authenticated route, never via static hosting.
export const BOARD_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'board');

if (!fs.existsSync(BOARD_UPLOAD_DIR)) {
    fs.mkdirSync(BOARD_UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, BOARD_UPLOAD_DIR),
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${nanoid()}${ext}`);
    },
});

export const boardAttachmentUpload = multer({
    storage,
    limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB per file
});
