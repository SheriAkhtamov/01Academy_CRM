import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { appConfig } from '../config';
import { logger } from '../lib/logger';
import {
  attendanceSettingsFingerprint, publicAttendanceService, PublicAttendanceError, verifyAttendancePassword,
  type PublicAttendanceService, type PublicAttendanceSettings,
} from '../services/public-attendance';

const ACCESS_DURATION_MS = 12 * 60 * 60 * 1000;
const MAX_BULK_STUDENTS = 200;
const parseId = (raw: string) => /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
const parseStudentIds = (raw: unknown) => Array.isArray(raw) && raw.length > 0 && raw.length <= MAX_BULK_STUDENTS
  && raw.every((id) => Number.isSafeInteger(id) && id > 0) && new Set(raw).size === raw.length ? raw as number[] : null;
const saveSession = (req: Request) => new Promise<void>((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
const regenerateSession = (req: Request) => new Promise<void>((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));

interface RouterOptions {
  settings: () => PublicAttendanceSettings | null;
  service: PublicAttendanceService;
}

export const createPublicAttendanceRouter = ({ settings, service }: RouterOptions) => {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    next();
  });
  const activeAccess = (req: Request) => {
    const config = settings();
    const access = req.session.publicAttendance;
    return config && access && access.expiresAt > Date.now()
      && access.fingerprint === attendanceSettingsFingerprint(config) ? access : null;
  };
  router.get('/session', (req, res) => {
    const access = activeAccess(req);
    res.json({ available: Boolean(settings()), authenticated: Boolean(access), ...(access ? { csrfToken: access.csrfToken } : {}) });
  });
  const passwordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 8, skipSuccessfulRequests: true,
    standardHeaders: true, legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: 'tooManyRequests' }),
  });
  router.post('/access', passwordLimiter, async (req, res) => {
    try {
      const config = settings();
      if (!config) return res.status(404).json({ error: 'publicAttendanceUnavailable' });
      if (typeof req.body?.password !== 'string' || req.body.password.length > 256) return res.status(400).json({ error: 'publicAttendanceInvalid' });
      if (!await verifyAttendancePassword(req.body.password, config.passwordHash)) return res.status(401).json({ error: 'publicAttendanceWrongPassword' });
      // Do not disturb an existing CRM account; anonymous visitors get a new session ID.
      if (!req.session.userId) await regenerateSession(req);
      req.session.publicAttendance = {
        fingerprint: attendanceSettingsFingerprint(config), expiresAt: Date.now() + ACCESS_DURATION_MS,
        csrfToken: randomBytes(24).toString('hex'),
      };
      await saveSession(req);
      res.json({ available: true, authenticated: true, csrfToken: req.session.publicAttendance.csrfToken });
    } catch (error) {
      logger.error('Failed to open public attendance access', { error });
      res.status(503).json({ error: 'publicAttendanceSaveFailed' });
    }
  });
  router.use((req, res, next) => {
    if (!settings()) return res.status(404).json({ error: 'publicAttendanceUnavailable' });
    const access = activeAccess(req);
    if (!access) return res.status(401).json({ error: 'publicAttendanceAccessExpired' });
    if (req.method !== 'GET') {
      const token = req.get('x-attendance-csrf') ?? '';
      const provided = Buffer.from(token);
      const expected = Buffer.from(access.csrfToken);
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return res.status(403).json({ error: 'publicAttendanceAccessExpired' });
    }
    next();
  });
  router.post('/exit', async (req, res) => {
    delete req.session.publicAttendance;
    try {
      await saveSession(req);
      res.json({ ok: true });
    } catch {
      res.status(503).json({ error: 'publicAttendanceSaveFailed' });
    }
  });
  router.get('/groups', async (_req, res) => {
    try {
      res.json({ groups: await service.listGroups(settings()!.groupIds) });
    } catch (error) {
      logger.error('Failed to list public attendance groups', { error });
      res.status(500).json({ error: 'publicAttendanceLoadFailed' });
    }
  });
  router.get('/lessons/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'publicAttendanceInvalid' });
    try {
      res.json(await service.loadRoster(id, settings()!.groupIds));
    } catch (error) {
      if (error instanceof PublicAttendanceError) return res.status(error.status).json({ error: error.code });
      logger.error('Failed to load public attendance roster', { error });
      res.status(500).json({ error: 'publicAttendanceLoadFailed' });
    }
  });
  router.patch('/lessons/:id/attendance', async (req, res) => {
    const id = parseId(req.params.id);
    const body = req.body;
    if (!id || !Number.isSafeInteger(body?.studentId) || body.studentId < 1
      || ![null, 'present', 'absent'].includes(body?.status)
      || !(body.expectedRevision === null || typeof body.expectedRevision === 'string' && body.expectedRevision.length <= 128)
      || body.status === null && body.clearConfirmed !== true) return res.status(400).json({ error: 'publicAttendanceInvalid' });
    try {
      res.json(await service.mark(id, settings()!.groupIds, {
        studentId: body.studentId, status: body.status, expectedRevision: body.expectedRevision, clearConfirmed: body.clearConfirmed === true,
      }));
    } catch (error) {
      if (error instanceof PublicAttendanceError) return res.status(error.status).json({ error: error.code });
      logger.error('Failed to save public attendance mark', { error });
      res.status(500).json({ error: 'publicAttendanceSaveFailed' });
    }
  });
  router.patch('/lessons/:id/attendance/bulk', async (req, res) => {
    const id = parseId(req.params.id);
    const studentIds = parseStudentIds(req.body?.studentIds);
    const status = req.body?.status;
    if (!id || !studentIds || (status !== 'present' && status !== 'absent')) return res.status(400).json({ error: 'publicAttendanceInvalid' });
    try {
      res.json(await service.markMany(id, settings()!.groupIds, { studentIds, status }));
    } catch (error) {
      if (error instanceof PublicAttendanceError) return res.status(error.status).json({ error: error.code });
      logger.error('Failed to save public attendance marks', { error });
      res.status(500).json({ error: 'publicAttendanceSaveFailed' });
    }
  });
  return router;
};

export default createPublicAttendanceRouter({
  settings: () => {
    const config = appConfig.publicAttendance;
    return config?.enabled && config.passwordHash && config.groupIds?.length
      ? { passwordHash: config.passwordHash, groupIds: config.groupIds } : null;
  },
  service: publicAttendanceService,
});
