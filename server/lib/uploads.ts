import fs from 'fs/promises';
import path from 'path';

const uploadsRoot = path.resolve(process.cwd(), 'uploads');

export const resolveStoredFilePath = (fileUrl?: string | null) => {
    if (!fileUrl) {
        return null;
    }

    const normalized = fileUrl
        .replace(/^\/api\/files\//, '')
        .replace(/^\/uploads\//, '');

    if (!normalized || normalized === fileUrl) {
        return null;
    }

    if (normalized.startsWith('photos/')) {
        return path.resolve(uploadsRoot, 'photos', path.basename(normalized.slice('photos/'.length)));
    }

    return path.resolve(uploadsRoot, path.basename(normalized));
};

export const removeStoredFile = async (fileUrl?: string | null) => {
    const filePath = resolveStoredFilePath(fileUrl);

    if (!filePath) {
        return;
    }

    try {
        await fs.unlink(filePath);
    } catch (error: any) {
        if (error?.code !== 'ENOENT') {
            throw error;
        }
    }
};
