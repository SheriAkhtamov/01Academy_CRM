import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import { platformLoginResolveSchema, type PlatformLoginRealm } from '@shared/contracts/platform-auth';
import { normalizeStaffLogin } from '@shared/staff-login';

export type PlatformCredentialVerifier = (identifier: string, password: string) => Promise<boolean>;

/** Credential proof selects a realm without creating a session or revealing an account. */
export function createPlatformAuthRouter({ verifyStaff, verifyPortal }: {
  verifyStaff: PlatformCredentialVerifier;
  verifyPortal?: PlatformCredentialVerifier;
}) {
  const router = Router();
  const limiterOptions = {
    windowMs: 15 * 60 * 1000,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: (_request: unknown, response: import('express').Response) => response.status(429).json({ error: 'tooManyLoginAttempts' }),
  };
  const ipLimit = rateLimit({ ...limiterOptions, max: 30 });
  const accountLimit = rateLimit({ ...limiterOptions, max: 5, keyGenerator: (request) =>
    `platform:${crypto.createHash('sha256').update(normalizeStaffLogin(request.body?.identifier).slice(0, 254) || 'missing').digest('hex')}`,
  });
  router.post('/login-realm', (_request, response, next) => {
    response.setHeader('Cache-Control', 'private, no-store');
    next();
  }, ipLimit, accountLimit, async (request, response, next) => {
    const parsed = platformLoginResolveSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'invalidCredentialsMessage' });
    const { identifier, password, preferredRealm } = parsed.data;
    const realms: PlatformLoginRealm[] = preferredRealm === 'portal' ? ['portal', 'staff'] : ['staff', 'portal'];
    const verifiers = { staff: verifyStaff, portal: verifyPortal };
    try {
      for (const realm of realms) {
        const verify = verifiers[realm];
        if (verify && await verify(identifier, password)) return response.json({ realm });
      }
      return response.status(401).json({ error: 'invalidCredentialsMessage' });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
