import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { authService } from '../services/auth';
import { resolveAuthSession } from '../services/authSession';
import { t } from '../lib/i18n';
import { appConfig } from '../config';

const router = Router();

const destroySessionAsync = (req: Request) =>
    new Promise<void>((resolve) => {
        req.session.destroy(() => resolve());
    });

// Rate limiting configurations
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: t('tooManyLoginAttempts'),
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false,
});

router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { login, email, password } = req.body;
        const loginOrEmail = login || email;

        if (!loginOrEmail) {
            return res.status(400).json({ error: 'Login is required' });
        }

        if (!password) {
            return res.status(400).json({ error: 'Password is required' });
        }

        const user = await authService.authenticateUser(loginOrEmail, password);

        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const sanitizedUser = authService.sanitizeUser(user);
        req.session.regenerate((regenErr: Error | null) => {
            if (regenErr) {
                return res.status(500).json({ error: 'Session regeneration failed' });
            }

            req.session.userId = sanitizedUser.id;

            req.session.save((err: Error | null) => {
                if (err) {
                    return res.status(500).json({ error: 'Session save failed' });
                }

                res.json({ user: sanitizedUser });
            });
        });
    } catch (error) {
        res.status(500).json({ error: 'Login failed' });
    }
});

router.get('/session', async (req, res) => {
    try {
        const { session, shouldDestroy } = await resolveAuthSession(req.session);

        if (shouldDestroy) {
            await destroySessionAsync(req);
        }

        res.json(session);
    } catch (error) {
        res.status(500).json({ error: 'Failed to resolve session' });
    }
});

router.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid', {
            path: '/',
            httpOnly: true,
            sameSite: 'lax',
            secure: appConfig.session.cookieSecure,
        });
        res.json({ success: true });
    });
});

export default router;
