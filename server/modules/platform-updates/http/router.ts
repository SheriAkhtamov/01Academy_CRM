import { Router, type RequestHandler } from 'express';
import { publishUpdateSchema } from '@shared/contracts/platform-updates';
import type { PlatformUpdateService } from '../application/update-service';
import { logger } from '../../../lib/logger';

export function createUpdateRouter(service: PlatformUpdateService, auth: RequestHandler, administration: RequestHandler,
  resolveImage: (release: string, file: string) => Promise<string | null>) {
  const router = Router();
  router.get('/', auth, async (_req, res, next) => {
    try { res.setHeader('Cache-Control', 'private, no-store'); res.json(await service.list()); }
    catch (error) { next(error); }
  });
  router.get('/images/:release/:file', auth, async (req, res, next) => {
    try {
      const file = await resolveImage(req.params.release, req.params.file);
      if (!file) return res.status(404).json({ error: 'updatesPostMissing' });
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.sendFile(file);
    } catch (error) { next(error); }
  });
  router.get('/:id', auth, async (req, res, next) => {
    const text = String(req.params.id);
    const id = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'invalidDataFormat' });
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      const post = await service.find(id);
      if (!post) return res.status(404).json({ error: 'updatesPostMissing' });
      res.json(post);
    } catch (error) { next(error); }
  });
  router.post('/', administration, async (req, res) => {
    const input = publishUpdateSchema.safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: 'updatesInvalidContent' });
    try { res.status(201).json(await service.publish(input.data, req.user!.id)); }
    catch (error) {
      if (error instanceof Error && error.message === 'updatesPublicationConflict') return res.status(409).json({ error: error.message });
      logger.error('Failed to publish platform update', { error });
      res.status(500).json({ error: 'updateFailed' });
    }
  });
  return router;
}
