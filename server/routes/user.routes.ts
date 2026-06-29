import { Router } from 'express';
import crypto from 'crypto';
import { storage } from '../storage';
import { pool } from '../db';
import { authService } from '../services/auth';
import { requireAuth, requireAdministration } from '../middleware/auth.middleware';
import { emailService } from '../services/email';
import { logger } from '../lib/logger';
import {
    ACADEMY_WORKSPACES,
    getAssignedWorkspaces,
    hasLeadershipAccess,
    isLeadershipWorkspace,
    type AcademyWorkspace,
} from '@shared/academy';
import {
    decryptCredentialPassword,
    encryptCredentialPassword,
} from '../services/credential-password';

const router = Router();
const workspaceSet = new Set<string>(ACADEMY_WORKSPACES);
const workspaceLoginPrefix: Record<AcademyWorkspace, string> = {
    administration: 'admin',
    director: 'director',
    sales: 'sales',
    teacher: 'teacher',
    marketing: 'marketing',
};
const maxGeneratedLoginAttempts = 8;

const translitMap: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
    й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
    у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'y', ь: '',
    э: 'e', ю: 'yu', я: 'ya',
};

const slugifyName = (fullName: string) => {
    const transliterated = fullName
        .trim()
        .toLowerCase()
        .split('')
        .map((char) => translitMap[char] ?? char)
        .join('');

    const slug = transliterated
        .replace(/[^a-z0-9]+/g, '.')
        .replace(/^\.+|\.+$/g, '')
        .slice(0, 32);

    return slug || 'user';
};

const generateLogin = (fullName: string, workspace: AcademyWorkspace, unavailableLogins: Set<string>) => {
    const prefix = workspaceLoginPrefix[workspace];
    const base = `${prefix}.${slugifyName(fullName)}`;

    for (let attempt = 0; attempt < 12; attempt += 1) {
        const suffix = crypto.randomBytes(2).toString('hex');
        const login = `${base}.${suffix}@01academy.local`.toLowerCase();
        if (!unavailableLogins.has(login)) {
            return login;
        }
    }

    return `${base}.${Date.now().toString(36)}@01academy.local`.toLowerCase();
};

const isUsersEmailUniqueViolation = (error: unknown) => {
    const pgError = error as { code?: string; constraint?: string; detail?: string; message?: string };
    if (pgError?.code !== '23505') return false;

    const constraint = pgError.constraint?.toLowerCase() ?? '';
    const detail = pgError.detail?.toLowerCase() ?? '';
    const message = pgError.message?.toLowerCase() ?? '';

    return constraint === 'users_email_unique' ||
        (constraint.includes('users') && constraint.includes('email')) ||
        detail.includes('email') ||
        message.includes('users_email_unique');
};

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

const normalizeRequestedWorkspaces = (value: unknown, primaryWorkspace: AcademyWorkspace) => {
    const requested = Array.isArray(value)
        ? value
            .map((workspace) => String(workspace))
            .filter((workspace): workspace is AcademyWorkspace => workspaceSet.has(workspace))
        : [];

    return [...new Set([primaryWorkspace, ...requested])];
};

const canViewCredentialPassword = (req: any) =>
    getAssignedWorkspaces(req.user).includes('administration');

const buildCredentialPayload = (user: {
    id: number;
    fullName: string;
    email: string;
    position?: string | null;
    workspace: string;
    workspaces?: string[] | null;
    credentialPasswordCiphertext?: string | null;
}, canViewPassword: boolean, fallbackPassword?: string) => ({
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    position: user.position,
    workspace: user.workspace,
    workspaces: getAssignedWorkspaces(user),
    temporaryPassword: canViewPassword
        ? fallbackPassword ?? decryptCredentialPassword(user.credentialPasswordCiphertext)
        : undefined,
    passwordStored: Boolean(user.credentialPasswordCiphertext || fallbackPassword),
    passwordVisibleToAdministration: canViewPassword,
});

const syncAcademyTeacherForUser = async (user: {
    id: number;
    fullName: string;
    workspace: string;
    workspaces?: string[] | null;
    isActive?: boolean | null;
}) => {
    const existing = await pool.query<{ id: number }>(
        'SELECT id FROM academy_teachers WHERE user_id = $1 LIMIT 1',
        [user.id],
    );
    const teacherRecord = existing.rows[0];

    if (getAssignedWorkspaces(user).includes('teacher')) {
        const status = user.isActive === false ? 'dismissed' : 'active';

        if (teacherRecord) {
            await pool.query(
                'UPDATE academy_teachers SET full_name = $1, status = $2, updated_at = NOW() WHERE id = $3',
                [user.fullName, status, teacherRecord.id],
            );
            return;
        }

        await pool.query(
            `INSERT INTO academy_teachers (user_id, full_name, course_ids, schedule, status)
             VALUES ($1, $2, '[]'::jsonb, '[]'::jsonb, $3)`,
            [user.id, user.fullName, status],
        );
        return;
    }

    if (teacherRecord) {
        await pool.query(
            'UPDATE academy_teachers SET full_name = $1, status = $2, updated_at = NOW() WHERE id = $3',
            [user.fullName, 'dismissed', teacherRecord.id],
        );
    }
};

router.get('/', requireAuth, async (_req, res) => {
    try {
        const users = await storage.getUsers();
        const sanitizedUsers = users.map(u => authService.sanitizeUser(u));
        res.json(sanitizedUsers);
    } catch (error) {
        logger.error('Error fetching users', { error });
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

router.get('/online-status', requireAuth, async (_req, res) => {
    try {
        const users = await storage.getUsersWithOnlineStatus();
        const sanitizedUsers = users.map((user) => authService.sanitizeUser(user));
        res.json(sanitizedUsers);
    } catch (error) {
        logger.error('Error fetching online status', { error });
        res.status(500).json({ error: 'Failed to fetch online status' });
    }
});

router.post('/', requireAdministration, async (req, res) => {
    try {
        const { fullName, phone, position, hasReportAccess, isActive } = req.body;
        if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
            return res.status(400).json({ error: 'Full name is required' });
        }

        if (!workspaceSet.has(req.body.workspace)) {
            return res.status(400).json({ error: 'A valid workspace is required' });
        }
        const workspace = req.body.workspace as AcademyWorkspace;
        const workspaces = normalizeRequestedWorkspaces(req.body.workspaces, workspace);

        const existingUsers = await storage.getUsers();
        const unavailableLogins = new Set(existingUsers.map((user) => user.email.toLowerCase()));
        const providedEmail = normalizeLogin(req.body.email);

        if (providedEmail && !isValidLogin(providedEmail)) {
            return res.status(400).json({ error: 'invalidEmailAddress' });
        }

        if (providedEmail && unavailableLogins.has(providedEmail)) {
            return res.status(409).json({ error: 'loginAlreadyExists' });
        }

        const temporaryPassword = crypto.randomBytes(12).toString('base64url');
        let email = providedEmail || generateLogin(fullName, workspace, unavailableLogins);
        let newUser: (Awaited<ReturnType<typeof authService.createUser>> & { workspaces?: AcademyWorkspace[] }) | null = null;

        for (let attempt = 0; attempt < maxGeneratedLoginAttempts; attempt += 1) {
            try {
                newUser = await authService.createUser({
                    email,
                    password: temporaryPassword,
                    credentialPasswordCiphertext: encryptCredentialPassword(temporaryPassword),
                    fullName,
                    phone: phone || null,
                    position: position || null,
                    workspace,
                    hasReportAccess: hasReportAccess || false,
                    isActive: isActive !== undefined ? isActive : true,
                });
                const savedWorkspaces = await storage.setUserWorkspaces(newUser.id, workspaces);
                newUser = {
                    ...newUser,
                    workspaces: savedWorkspaces,
                };
                break;
            } catch (error) {
                if (!isUsersEmailUniqueViolation(error)) {
                    throw error;
                }

                if (providedEmail) {
                    return res.status(409).json({ error: 'loginAlreadyExists' });
                }

                unavailableLogins.add(email.toLowerCase());
                email = generateLogin(fullName, workspace, unavailableLogins);
            }
        }

        if (!newUser) {
            return res.status(500).json({ error: 'failedCreateUserDescription' });
        }

        await syncAcademyTeacherForUser(newUser);

        try {
            await emailService.sendWelcomeEmail(newUser.email, fullName, temporaryPassword);
        } catch (emailError) {
            logger.error('Failed to send welcome email', { error: emailError, userId: newUser.id });
        }

        await storage.createAuditLog({
            userId: req.user!.id,
            action: 'CREATE_USER',
            entityType: 'user',
            entityId: newUser.id,
            newValues: [authService.sanitizeUser(newUser)],
        });

        res.json({
            ...authService.sanitizeUser(newUser),
            temporaryPassword: canViewCredentialPassword(req) ? temporaryPassword : undefined,
        });
    } catch (error: any) {
        logger.error('Error creating user', { error });
        if (isUsersEmailUniqueViolation(error)) {
            return res.status(409).json({ error: 'loginAlreadyExists' });
        }
        res.status(500).json({ error: 'Failed to create user' });
    }
});

router.get('/:id/credentials', requireAdministration, async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);

        if (Number.isNaN(id)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        const user = await storage.getUserWithPassword(id);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(buildCredentialPayload(user, canViewCredentialPassword(req)));
    } catch (error) {
        logger.error('Error fetching user credentials', { error, userId: req.params.id });
        res.status(500).json({ error: 'Failed to fetch credentials' });
    }
});

router.patch('/:id/credentials', requireAdministration, async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);

        if (Number.isNaN(id)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        const user = await storage.getUser(id);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const updateData: Record<string, unknown> = {};
        let loginChanged = false;
        let passwordChanged = false;
        let plainPassword: string | undefined;

        if (req.body.email !== undefined) {
            const nextLogin = normalizeLogin(req.body.email);

            if (!nextLogin) {
                return res.status(400).json({ error: 'loginRequired' });
            }

            if (!isValidLogin(nextLogin)) {
                return res.status(400).json({ error: 'invalidEmailAddress' });
            }

            if (nextLogin !== user.email.toLowerCase()) {
                const existingUser = await findUserByLogin(nextLogin, user.id);
                if (existingUser) {
                    return res.status(400).json({ error: 'loginAlreadyExists' });
                }

                updateData.email = nextLogin;
                loginChanged = true;
            }
        }

        const newPassword =
            typeof req.body.password === 'string'
                ? req.body.password
                : typeof req.body.newPassword === 'string'
                    ? req.body.newPassword
                    : '';
        const confirmPassword =
            typeof req.body.confirmPassword === 'string'
                ? req.body.confirmPassword
                : typeof req.body.confirmNewPassword === 'string'
                    ? req.body.confirmNewPassword
                    : '';

        if (newPassword || confirmPassword) {
            if (!newPassword) {
                return res.status(400).json({ error: 'newPasswordRequired' });
            }

            if (newPassword.length < 8) {
                return res.status(400).json({ error: 'passwordTooShort' });
            }

            if (newPassword !== confirmPassword) {
                return res.status(400).json({ error: 'passwordsDoNotMatch' });
            }

            updateData.password = await authService.hashPassword(newPassword);
            updateData.credentialPasswordCiphertext = encryptCredentialPassword(newPassword);
            plainPassword = newPassword;
            passwordChanged = true;
        }

        if (!loginChanged && !passwordChanged) {
            return res.status(400).json({ error: 'credentialsUpdateRequired' });
        }

        const updatedUser = await storage.updateUser(id, updateData);

        await storage.createAuditLog({
            userId: req.user!.id,
            action: 'UPDATE_USER_CREDENTIALS',
            entityType: 'user',
            entityId: updatedUser.id,
            oldValues: [{ email: user.email }],
            newValues: [{
                email: updatedUser.email,
                loginChanged,
                passwordChanged,
                updatedBy: req.user!.id,
            }],
        });

        res.json({
            ...buildCredentialPayload(
                updatedUser,
                canViewCredentialPassword(req),
                plainPassword,
            ),
            loginChanged,
            passwordChanged,
        });
    } catch (error: any) {
        logger.error('Error updating user credentials', { error, userId: req.params.id });
        if (isUsersEmailUniqueViolation(error)) {
            return res.status(409).json({ error: 'loginAlreadyExists' });
        }
        res.status(500).json({ error: 'failedToUpdateCredentials' });
    }
});

router.post('/:id/reset-password', requireAdministration, async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);

        if (Number.isNaN(id)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        const user = await storage.getUser(id);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const temporaryPassword = crypto.randomBytes(12).toString('base64url');
        const hashedPassword = await authService.hashPassword(temporaryPassword);

        const updatedUser = await storage.updateUser(id, {
            password: hashedPassword,
            credentialPasswordCiphertext: encryptCredentialPassword(temporaryPassword),
        });

        await storage.createAuditLog({
            userId: req.user!.id,
            action: 'RESET_USER_PASSWORD',
            entityType: 'user',
            entityId: user.id,
            oldValues: [],
            newValues: [{
                userId: user.id,
                email: user.email,
                passwordResetBy: req.user!.id,
            }],
        });

        res.json(buildCredentialPayload(
            updatedUser,
            canViewCredentialPassword(req),
            temporaryPassword,
        ));
    } catch (error) {
        logger.error('Error resetting user password', { error, userId: req.params.id });
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

router.put('/:id', requireAuth, async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        const currentUser = req.user;

        if (Number.isNaN(id)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        if (currentUser?.id !== id && !hasLeadershipAccess(currentUser)) {
            return res.status(403).json({ error: 'Cannot update other users profile' });
        }

        const existingUser = await storage.getUser(id);
        if (!existingUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        const updateData: any = {
            fullName: req.body.fullName,
            position: req.body.position,
            phone: req.body.phone || null,
        };

        if (req.body.email !== undefined) {
            const nextLogin = normalizeLogin(req.body.email);

            if (!nextLogin) {
                return res.status(400).json({ error: 'loginRequired' });
            }

            if (!isValidLogin(nextLogin)) {
                return res.status(400).json({ error: 'invalidEmailAddress' });
            }

            if (nextLogin !== existingUser.email.toLowerCase()) {
                const userWithLogin = await findUserByLogin(nextLogin, id);
                if (userWithLogin) {
                    return res.status(400).json({ error: 'loginAlreadyExists' });
                }
            }

            updateData.email = nextLogin;
        }

        if (req.body.dateOfBirth !== undefined) {
            updateData.dateOfBirth = req.body.dateOfBirth ? new Date(req.body.dateOfBirth) : null;
        }

        let requestedWorkspaces: AcademyWorkspace[] | null = null;

        if (hasLeadershipAccess(currentUser)) {
            if (req.body.workspace !== undefined) {
                if (!workspaceSet.has(req.body.workspace)) {
                    return res.status(400).json({ error: 'A valid workspace is required' });
                }
                updateData.workspace = req.body.workspace;
            }
            if (req.body.workspaces !== undefined) {
                requestedWorkspaces = normalizeRequestedWorkspaces(
                    req.body.workspaces,
                    (updateData.workspace ?? existingUser.workspace) as AcademyWorkspace,
                );
            }
            if (req.body.hasReportAccess !== undefined) {
                updateData.hasReportAccess = Boolean(req.body.hasReportAccess);
            }
            if (req.body.isActive !== undefined) {
                updateData.isActive = Boolean(req.body.isActive);
            }
        }

        const nextWorkspaces = requestedWorkspaces ?? getAssignedWorkspaces(existingUser);
        const isRemovingActiveLeadershipAccess =
            hasLeadershipAccess(existingUser) &&
            existingUser.isActive &&
            (
                !nextWorkspaces.some(isLeadershipWorkspace) ||
                updateData.isActive === false
            );

        if (isRemovingActiveLeadershipAccess) {
            const allUsers = await storage.getUsers();
            const activeLeadershipUsers = allUsers.filter((u: any) => hasLeadershipAccess(u) && u.isActive);

            if (activeLeadershipUsers.length <= 1) {
                return res.status(403).json({
                    error: 'Cannot remove or deactivate the last active leadership account.',
                });
            }
        }

        let updatedUser = await storage.updateUser(id, updateData);
        if (requestedWorkspaces) {
            const savedWorkspaces = await storage.setUserWorkspaces(id, requestedWorkspaces);
            updatedUser = {
                ...updatedUser,
                workspaces: savedWorkspaces,
            };
        }
        await syncAcademyTeacherForUser(updatedUser);

        res.json(authService.sanitizeUser(updatedUser));
    } catch (error) {
        logger.error('Error updating user', { error, userId: req.params.id });
        if (isUsersEmailUniqueViolation(error)) {
            return res.status(409).json({ error: 'loginAlreadyExists' });
        }
        res.status(500).json({ error: 'Failed to update user' });
    }
});

router.delete('/:id', requireAdministration, async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);

        if (Number.isNaN(id)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        const user = await storage.getUser(id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (req.user!.id === id) {
            return res.status(403).json({ error: 'Cannot delete your own account.' });
        }

        const allUsers = await storage.getUsers();
        const activeLeadershipUsers = allUsers.filter((u: any) => hasLeadershipAccess(u) && u.isActive);
        if (hasLeadershipAccess(user) && user.isActive && activeLeadershipUsers.length <= 1) {
            return res.status(403).json({ error: 'Cannot delete the last active leadership account.' });
        }

        await pool.query(
            "UPDATE academy_teachers SET status = 'dismissed', updated_at = NOW() WHERE user_id = $1",
            [id],
        );
        await storage.deleteUser(id);
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        logger.error('Error deleting user', { error, userId: req.params.id });
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

export default router;
