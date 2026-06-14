import { Router, static as expressStatic, type Request, type Response, type NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { requireFileAccess } from '../middleware/auth.middleware';

const router = Router();
const uploadsRoot = path.resolve(process.cwd(), 'uploads');

// Fix #82: Safe content types for served files to prevent XSS
const SAFE_CONTENT_TYPES: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.txt': 'text/plain',
};

const resolveSafeUploadPath = (subDir: string, filename: string) => {
    const safeName = path.basename(filename);
    if (safeName !== filename) {
        return null;
    }
    const resolved = path.resolve(uploadsRoot, subDir, safeName);
    if (!resolved.startsWith(path.resolve(uploadsRoot, subDir))) {
        return null;
    }
    return resolved;
};

const authorizeUploadAccess = async (req: Request, res: Response, subDir: string, filename: string) => {
    const filePath = resolveSafeUploadPath(subDir, filename);

    if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }

    const ext = path.extname(filename).toLowerCase();
    const safeType = SAFE_CONTENT_TYPES[ext];
    if (safeType) {
        res.setHeader('Content-Type', safeType);
        res.setHeader('Content-Disposition', `inline; filename="${path.basename(filename)}"`);
    } else {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filename)}"`);
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');

    res.sendFile(filePath);
};

// Serve photo files
router.get('/photos/:filename', requireFileAccess, async (req, res) => {
    try {
        const filename = req.params.filename;
        await authorizeUploadAccess(req, res, 'photos', filename);
    } catch (error) {
        res.status(500).json({ error: 'Failed to load photo' });
    }
});

// Serve files
router.get('/:filename', requireFileAccess, async (req, res) => {
    try {
        const filename = req.params.filename;
        await authorizeUploadAccess(req, res, '', filename);
    } catch (error) {
        res.status(500).json({ error: 'Failed to load file' });
    }
});

// Static file serving for uploads directory
const staticUploadsMiddleware = expressStatic('uploads', {
    index: false,
    dotfiles: 'deny',
    redirect: false,
});

export const uploadsMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const relativePath = req.path.replace(/^\/+/, '');
        const parts = relativePath.split('/').filter(Boolean);
        const isPhoto = parts[0] === 'photos';
        const filename = isPhoto ? parts.slice(1).join('/') : parts.join('/');
        const subDir = isPhoto ? 'photos' : '';

        const safeName = path.basename(filename);
        if (!filename || safeName !== filename) {
            return res.status(404).json({ error: 'File not found' });
        }

        const filePath = resolveSafeUploadPath(subDir, safeName);
        if (!filePath || !fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        return staticUploadsMiddleware(req, res, next);
    } catch (error) {
        return next(error);
    }
};

export default router;
