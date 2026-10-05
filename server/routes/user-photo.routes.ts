import type { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { userPhotoPath } from '../middleware/user-photo.middleware';
import { readFileMimeType } from '../lib/file-media';
import { USER_PHOTO_MIME_TYPES } from '@shared/user-photo';

export function registerUserPhotoRoutes(router: Router) {
  router.get('/photos/:photoId', requireAuth, async (req, res) => {
    try {
      const filePath = userPhotoPath(req.params.photoId);
      if (!filePath) return res.status(404).json({ error: 'resourceNotFound' });
      const mimeType = await readFileMimeType(filePath);
      if (!USER_PHOTO_MIME_TYPES.some((type) => type === mimeType)) return res.status(404).json({ error: 'resourceNotFound' });
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader('Content-Type', mimeType);
      res.sendFile(filePath, (error) => { if (error && !res.headersSent) res.status(404).json({ error: 'resourceNotFound' }); });
    } catch { if (!res.headersSent) res.status(404).json({ error: 'resourceNotFound' }); }
  });
}
