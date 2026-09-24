import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { logger } from '../lib/logger';

const reportSchema = z.object({
  source: z.enum(['react-boundary', 'module-preload']),
  boundary: z.enum(['root', 'page', 'widget']).optional(),
  name: z.string().max(80),
  message: z.string().max(500),
  stack: z.string().max(3000).optional(),
  componentStack: z.string().max(2000).nullable().optional(),
  path: z.string().max(250).regex(/^\/[^?#]*$/),
});

const router = Router();

router.post('/', requireAuth, rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
}), (req, res) => {
  const report = reportSchema.safeParse(req.body);
  if (!report.success) return res.status(400).json({ error: 'invalidClientErrorReport' });

  logger.error('Client application error', {
    userId: req.user!.id,
    ...report.data,
  });
  return res.status(204).end();
});

export default router;
