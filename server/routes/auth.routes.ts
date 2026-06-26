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
import { logger } from '../lib/logger';
import { getLinkedAccountId } from '@shared/account-switching';

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

const normalizeLogin = (value: unknown) =>
    typeof value === 'string' ? value.trim().toLowerCase() : '';

const isValidLogin = (value: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const findUserByLogin = async (login: string, exceptUserId?: number) => {
    const users = await storage.getUsers();
    return users.find((user) =>
        user.email.toLowerCase() === login.toLowerCase() &&
        user.id !== exceptUserId
    );
};

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

router.patch('/me/credentials', requireAuth, async (req: Request, res: Response) => {
    try {
        const currentUser = req.user!;
        const updateData: Record<string, unknown> = {};
        let loginChanged = false;
        let passwordChanged = false;

        if (req.body.email !== undefined) {
            const nextLogin = normalizeLogin(req.body.email);

            if (!nextLogin) {
                return res.status(400).json({ error: 'loginRequired' });
            }

            if (!isValidLogin(nextLogin)) {
                return res.status(400).json({ error: 'invalidEmailAddress' });
            }

            if (nextLogin !== currentUser.email.toLowerCase()) {
                const existingUser = await findUserByLogin(nextLogin, currentUser.id);
                if (existingUser) {
                    return res.status(400).json({ error: 'loginAlreadyExists' });
                }

                updateData.email = nextLogin;
                loginChanged = true;
            }
        }

        const currentPassword = typeof req.body.currentPassword === 'string' ? req.body.currentPassword : '';
        const newPassword = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';
        const confirmNewPassword =
            typeof req.body.confirmNewPassword === 'string'
                ? req.body.confirmNewPassword
                : typeof req.body.confirmPassword === 'string'
                    ? req.body.confirmPassword
                    : '';
        const wantsPasswordChange = Boolean(currentPassword || newPassword || confirmNewPassword);

        if (wantsPasswordChange) {
            if (!currentPassword) {
                return res.status(400).json({ error: 'currentPasswordRequired' });
            }

            if (!newPassword) {
                return res.status(400).json({ error: 'newPasswordRequired' });
            }

            if (newPassword.length < 8) {
                return res.status(400).json({ error: 'passwordTooShort' });
            }

            if (newPassword !== confirmNewPassword) {
                return res.status(400).json({ error: 'passwordsDoNotMatch' });
            }

            const currentPasswordValid = await authService.verifyPassword(currentPassword, currentUser.password);
            if (!currentPasswordValid) {
                return res.status(401).json({ error: 'currentPasswordInvalid' });
            }

            updateData.password = await authService.hashPassword(newPassword);
            passwordChanged = true;
        }

        if (!loginChanged && !passwordChanged) {
            return res.status(400).json({ error: 'credentialsUpdateRequired' });
        }

        const updatedUser = await storage.updateUser(currentUser.id, updateData);

        await storage.createAuditLog({
            userId: currentUser.id,
            action: 'UPDATE_OWN_CREDENTIALS',
            entityType: 'user',
            entityId: currentUser.id,
            oldValues: [{ email: currentUser.email }],
            newValues: [{
                email: updatedUser.email,
                loginChanged,
                passwordChanged,
            }],
        });

        res.json({
            user: authService.sanitizeUser(updatedUser),
            loginChanged,
            passwordChanged,
        });
    } catch (error: any) {
        logger.error('Failed to update own credentials', { error, userId: req.user?.id });
        if (error.code === '23505' && error.constraint === 'users_email_unique') {
            return res.status(400).json({ error: 'loginAlreadyExists' });
        }
        res.status(500).json({ error: 'failedToUpdateCredentials' });
    }
});

// ── Multi-account switching ──────────────────────────────────────────

// List saved accounts for the current user
router.get('/accounts', requireAuth, async (req: Request, res: Response) => {
    try {
        const userId = req.session.userId!;
        const accounts = await storage.getSavedAccountsForUser(userId);
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
        const existing = await storage.getSavedAccountsForUser(ownerUserId);
        if (existing.some((account) => account.accountUser.id === user.id)) {
            return res.status(409).json({ error: 'Account already saved' });
        }

        // Generate token and hash it for storage
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = await bcrypt.hash(token, 10);

        const savedAccount = await storage.addSavedAccount(ownerUserId, user.id, label || null, tokenHash);

        res.json({
            id: user.id,
            savedAccountId: savedAccount.id,
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
        const { token, tokens, targetAccountId } = req.body;
        const candidateTokens = Array.from(new Set(
            (Array.isArray(tokens) ? tokens : [token])
                .filter((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0),
        )).slice(0, 25);
        const requestedTargetId = targetAccountId === undefined
            ? null
            : Number(targetAccountId);

        if (candidateTokens.length === 0) {
            return res.status(400).json({ error: 'Token is required' });
        }

        if (requestedTargetId !== null && (!Number.isInteger(requestedTargetId) || requestedTargetId <= 0)) {
            return res.status(400).json({ error: 'Target account ID is invalid' });
        }

        const currentUserId = req.session.userId!;
        const savedAccounts = await storage.getSavedAccountsForUser(currentUserId);

        let matchedAccount: typeof savedAccounts[0] | undefined;
        let matchedTokenIndex = -1;
        for (const savedAccount of savedAccounts) {
            const linkedAccountId = getLinkedAccountId(savedAccount, currentUserId);
            if (!linkedAccountId || (requestedTargetId !== null && linkedAccountId !== requestedTargetId)) {
                continue;
            }

            for (const [index, candidateToken] of candidateTokens.entries()) {
                if (await bcrypt.compare(candidateToken, savedAccount.tokenHash)) {
                    matchedAccount = savedAccount;
                    matchedTokenIndex = index;
                    break;
                }
            }

            if (matchedAccount) {
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

                res.json({ user: sanitizedUser, matchedTokenIndex });
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
        const userId = req.session.userId!;
        const savedAccountId = parseInt(req.params.id, 10);

        if (isNaN(savedAccountId)) {
            return res.status(400).json({ error: 'Invalid account ID' });
        }

        const deletedAccount = await storage.deleteSavedAccountByIdForUser(userId, savedAccountId);
        if (!deletedAccount) {
            return res.status(404).json({ error: 'Saved account not found' });
        }
        res.json({ success: true });
    } catch (error) {
        logger.error('Failed to remove saved account', { error });
        res.status(500).json({ error: 'Failed to remove account' });
    }
});

export default router;
