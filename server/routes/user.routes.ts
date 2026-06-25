import { Router } from 'express';
import crypto from 'crypto';
import { storage } from '../storage';
import { pool } from '../db';
import { authService } from '../services/auth';
import { requireAuth, requireAdministration } from '../middleware/auth.middleware';
import { emailService } from '../services/email';
import { logger } from '../lib/logger';
import { ACADEMY_WORKSPACES, type AcademyWorkspace } from '@shared/academy';

const router = Router();
const workspaceSet = new Set<string>(ACADEMY_WORKSPACES);
const workspaceLoginPrefix: Record<AcademyWorkspace, string> = {
    administration: 'admin',
    sales: 'sales',
    teacher: 'teacher',
    marketing: 'marketing',
};

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

const generateLogin = (fullName: string, workspace: AcademyWorkspace, existingUsers: Array<{ email: string }>) => {
    const prefix = workspaceLoginPrefix[workspace];
    const base = `${prefix}.${slugifyName(fullName)}`;
    const existing = new Set(existingUsers.map((user) => user.email.toLowerCase()));

    for (let attempt = 0; attempt < 12; attempt += 1) {
        const suffix = crypto.randomBytes(2).toString('hex');
        const login = `${base}.${suffix}@01academy.local`.toLowerCase();
        if (!existing.has(login)) {
            return login;
        }
    }

    return `${base}.${Date.now().toString(36)}@01academy.local`.toLowerCase();
};

const syncAcademyTeacherForUser = async (user: {
    id: number;
    fullName: string;
    workspace: string;
    isActive?: boolean | null;
}) => {
    const existing = await pool.query<{ id: number }>(
        'SELECT id FROM academy_teachers WHERE user_id = $1 LIMIT 1',
        [user.id],
    );
    const teacherRecord = existing.rows[0];

    if (user.workspace === 'teacher') {
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

        const existingUsers = await storage.getUsers();
        const providedEmail = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const email = providedEmail || generateLogin(fullName, workspace, existingUsers);
        const userExists = existingUsers.some(u => u.email.toLowerCase() === email.toLowerCase());

        if (userExists) {
            return res.status(400).json({ error: 'User with this email already exists' });
        }

        const temporaryPassword = crypto.randomBytes(12).toString('base64url');

        const newUser = await authService.createUser({
            email,
            password: temporaryPassword,
            fullName,
            phone: phone || null,
            position: position || null,
            workspace,
            hasReportAccess: hasReportAccess || false,
            isActive: isActive !== undefined ? isActive : true,
        });

        await syncAcademyTeacherForUser(newUser);

        try {
            await emailService.sendWelcomeEmail(email, fullName, temporaryPassword);
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
            temporaryPassword
        });
    } catch (error: any) {
        logger.error('Error creating user', { error });
        if (error.code === '23505' && error.constraint === 'users_email_unique') {
            return res.status(400).json({ error: 'Email already exists' });
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

        res.json({
            id: user.id,
            fullName: user.fullName,
            email: user.email,
            position: user.position,
            workspace: user.workspace,
        });
    } catch (error) {
        logger.error('Error fetching user credentials', { error, userId: req.params.id });
        res.status(500).json({ error: 'Failed to fetch credentials' });
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

        await storage.updateUser(id, { password: hashedPassword });

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

        res.json({
            id: user.id,
            fullName: user.fullName,
            email: user.email,
            position: user.position,
            workspace: user.workspace,
            temporaryPassword,
        });
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

        if (currentUser?.id !== id && currentUser?.workspace !== 'administration') {
            return res.status(403).json({ error: 'Cannot update other users profile' });
        }

        const existingUser = await storage.getUser(id);
        if (!existingUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        const updateData: any = {
            fullName: req.body.fullName,
            email: req.body.email,
            position: req.body.position,
            phone: req.body.phone || null,
        };

        if (req.body.dateOfBirth !== undefined) {
            updateData.dateOfBirth = req.body.dateOfBirth ? new Date(req.body.dateOfBirth) : null;
        }

        if (currentUser?.workspace === 'administration') {
            if (req.body.workspace !== undefined) {
                if (!workspaceSet.has(req.body.workspace)) {
                    return res.status(400).json({ error: 'A valid workspace is required' });
                }
                updateData.workspace = req.body.workspace;
            }
            if (req.body.hasReportAccess !== undefined) {
                updateData.hasReportAccess = Boolean(req.body.hasReportAccess);
            }
            if (req.body.isActive !== undefined) {
                updateData.isActive = Boolean(req.body.isActive);
            }
        }

        const isRemovingActiveAdministrationAccess =
            existingUser.workspace === 'administration' &&
            existingUser.isActive &&
            (
                (updateData.workspace !== undefined && updateData.workspace !== 'administration') ||
                updateData.isActive === false
            );

        if (isRemovingActiveAdministrationAccess) {
            const allUsers = await storage.getUsers();
            const activeAdministrators = allUsers.filter((u: any) => (
                u.workspace === 'administration' &&
                u.isActive
            ));

            if (activeAdministrators.length <= 1) {
                return res.status(403).json({
                    error: 'Cannot remove or deactivate the last active administrator account.',
                });
            }
        }

        const updatedUser = await storage.updateUser(id, updateData);
        await syncAcademyTeacherForUser(updatedUser);

        res.json(authService.sanitizeUser(updatedUser));
    } catch (error) {
        logger.error('Error updating user', { error, userId: req.params.id });
        if ((error as any).code === '23505' && (error as any).constraint === 'users_email_unique') {
            return res.status(400).json({ error: 'Email already exists' });
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
        const activeAdministrators = allUsers.filter((u: any) => u.workspace === 'administration' && u.isActive);
        if (user.workspace === 'administration' && user.isActive && activeAdministrators.length <= 1) {
            return res.status(403).json({ error: 'Cannot delete the last active administrator account.' });
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
