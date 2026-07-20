import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { pool } from '../db';
import { logger } from '../lib/logger';
import { requireAuth } from '../middleware/auth.middleware';
import {
  normalizeOnlinePbxPhone,
  onlinePbxClient,
  OnlinePbxError,
} from '../services/onlinepbx';

const router = Router();

const callLimiter = rateLimit({
  windowMs: 1_000,
  max: 4,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'onlinePbxTooManyCalls' },
  keyGenerator: (req) => String(req.user?.id ?? 'anonymous'),
});

const logCall = async (status: string, payload: Record<string, unknown>, errorMessage?: string) => {
  await pool.query(
    `INSERT INTO academy_integration_logs
       (provider, direction, status, payload, error_message, retry_count)
     VALUES ('onlinepbx', 'outbound', $1, $2::jsonb, $3, 0)`,
    [status, JSON.stringify(payload), errorMessage ?? null],
  ).catch((error) => logger.error('Failed to persist OnlinePBX call log', { error }));
};

router.post('/calls', requireAuth, callLimiter, async (req, res) => {
  const user = req.user!;
  const to = normalizeOnlinePbxPhone(req.body?.phone);
  if (!to) return res.status(400).json({ error: 'onlinePbxInvalidPhone' });

  const extension = String(user.onlinePbxExtension ?? '').trim();
  const from = /^\d{2,10}$/.test(extension)
    ? extension
    : normalizeOnlinePbxPhone(user.phone);
  if (!from) return res.status(422).json({ error: 'onlinePbxCallerNumberMissing' });

  const safePayload = {
    userId: user.id,
    callerType: from === extension ? 'extension' : 'employee_phone',
    destinationLast4: to.slice(-4),
  };

  try {
    const result = await onlinePbxClient.initiateCall(from, to);
    await logCall('queued', { ...safePayload, uuid: result.uuid });
    res.status(202).json({ status: 'queued', uuid: result.uuid });
  } catch (error) {
    const clientCode = error instanceof OnlinePbxError ? error.clientCode : 'onlinePbxCallFailed';
    const statusCode = error instanceof OnlinePbxError ? error.statusCode : 502;
    await logCall('failed', safePayload, clientCode);
    logger.warn('OnlinePBX call could not be started', {
      error,
      userId: user.id,
      destinationLast4: to.slice(-4),
    });
    res.status(statusCode).json({ error: clientCode });
  }
});

export default router;
