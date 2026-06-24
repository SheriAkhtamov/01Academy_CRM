import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { authService } from '../services/auth';
import { resolveAuthSession } from '../services/authSession';
import { storage } from '../storage';
import { requireAuth } from '../middleware/auth.middleware';
import { t } from '../lib/i18n';
import { appConfig } from '../config';
import { isRestrictedAtCurrentTime } from '../services/workforce-policy';
import { logger } from '../lib/logger';

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

const accountLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Too many account operations',
    standardHeaders: true,
    legacyHeaders: false,
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

        if (await isRestrictedAtCurrentTime(user.workspace)) {
            return res.status(403).json({ error: 'System access is available only during configured working hours' });
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

// ── Multi-account switching ──────────────────────────────────────────

// List saved accounts for the current user
router.get('/accounts', requireAuth, async (req: Request, res: Response) => {
    try {
        const ownerUserId = req.session.userId!;
        const accounts = await storage.getSavedAccounts(ownerUserId);
        const sanitized = accounts.map((a) => ({
            id: a.id,
            accountUser: authService.sanitizeUser(a.accountUser),
            label: a.label,
            createdAt: a.createdAt,
        }));
        res.json(sanitized);
    } catch (error) {
        logger.error('Failed to list saved accounts', { error });
        res.status(500).json({ error: 'Failed to list accounts' });
    }
});

// Add a saved account (authenticate with login/password, store token)
router.post('/accounts', accountLimiter, requireAuth, async (req: Request, res: Response) => {
    try {
        const ownerUserId = req.session.userId!;
        const { login, password, label } = req.body;

        if (!login || !password) {
            return res.status(400).json({ error: 'Login and password are required' });
        }

        const user = await authService.authenticateUser(login, password);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (!user.isActive) {
            return res.status(403).json({ error: 'Account is inactive' });
        }

        if (user.id === ownerUserId) {
            return res.status(400).json({ error: 'Cannot add your own account' });
        }

        // Check if already saved
        const existing = await storage.getSavedAccounts(ownerUserId);
        if (existing.some((a) => a.accountUserId === user.id)) {
            return res.status(409).json({ error: 'Account already saved' });
        }

        // Generate token and hash it for storage
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = await bcrypt.hash(token, 10);

        await storage.addSavedAccount(ownerUserId, user.id, label || null, tokenHash);

        res.json({
            id: user.id,
            user: authService.sanitizeUser(user),
            token,
            label: label || null,
        });
    } catch (error) {
        logger.error('Failed to add saved account', { error });
        res.status(500).json({ error: 'Failed to add account' });
    }
});

// Switch to a saved account by token
router.post('/switch-account', accountLimiter, requireAuth, async (req: Request, res: Response) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({ error: 'Token is required' });
        }

        // Find all saved accounts for this owner and compare token hashes
        const ownerUserId = req.session.userId!;
        const savedAccounts = await storage.getSavedAccounts(ownerUserId);

        let matchedAccount: typeof savedAccounts[0] | undefined;
        for (const sa of savedAccounts) {
            const matches = await bcrypt.compare(token, sa.tokenHash);
            if (matches) {
                matchedAccount = sa;
                break;
            }
        }

        if (!matchedAccount) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        if (!matchedAccount.accountUser.isActive) {
            return res.status(403).json({ error: 'Target account is inactive' });
        }

        const sanitizedUser = authService.sanitizeUser(matchedAccount.accountUser);

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
        logger.error('Failed to switch account', { error });
        res.status(500).json({ error: 'Failed to switch account' });
    }
});

// Remove a saved account
router.delete('/accounts/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const ownerUserId = req.session.userId!;
        const savedAccountId = parseInt(req.params.id, 10);

        if (isNaN(savedAccountId)) {
            return res.status(400).json({ error: 'Invalid account ID' });
        }

        await storage.deleteSavedAccountById(ownerUserId, savedAccountId);
        res.json({ success: true });
    } catch (error) {
        logger.error('Failed to remove saved account', { error });
        res.status(500).json({ error: 'Failed to remove account' });
    }
});

export default router;
