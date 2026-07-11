import { Router } from 'express';
import crypto from 'crypto';
import type { PoolClient } from 'pg';
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
    sales: 'sales',
    teacher: 'teacher',
    marketing: 'marketing',
};
const maxGeneratedLoginAttempts = 8;
const USER_ACCESS_ADVISORY_LOCK = 10_100_001;

type QueryExecutor = Pick<PoolClient, 'query'>;

const parsePositiveId = (value: unknown): number | null => {
    const text = String(value ?? '').trim();
    if (!/^\d+$/.test(text)) return null;
    const parsed = Number(text);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
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
    if (value !== undefined && !Array.isArray(value)) {
        throw Object.assign(new Error('invalidData'), { statusCode: 400 });
    }
    const rawWorkspaces = value ?? [];
    if ((rawWorkspaces as unknown[]).some((workspace) => (
        typeof workspace !== 'string' || !workspaceSet.has(workspace)
    ))) {
        throw Object.assign(new Error('invalidData'), { statusCode: 400 });
    }
    const requested = rawWorkspaces as AcademyWorkspace[];

    return [...new Set([primaryWorkspace, ...requested])];
};

const parseDateOfBirth = (value: unknown) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;

    const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        throw Object.assign(new Error('invalidDateOfBirth'), { statusCode: 400 });
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (
        date.getFullYear() !== year
        || date.getMonth() !== month - 1
        || date.getDate() !== day
        || date.getTime() > Date.now()
    ) {
        throw Object.assign(new Error('invalidDateOfBirth'), { statusCode: 400 });
    }
    return date;
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
}, executor: QueryExecutor = pool) => {
    const existing = await executor.query<{ id: number }>(
        'SELECT id FROM academy_teachers WHERE user_id = $1 LIMIT 1',
        [user.id],
    );
    const teacherRecord = existing.rows[0];

    if (getAssignedWorkspaces(user).includes('teacher')) {
        const status = user.isActive === false ? 'dismissed' : 'active';

        if (teacherRecord) {
            await executor.query(
                'UPDATE academy_teachers SET full_name = $1, status = $2, updated_at = NOW() WHERE id = $3',
                [user.fullName, status, teacherRecord.id],
            );
            return;
        }

        await executor.query(
            `INSERT INTO academy_teachers (user_id, full_name, course_ids, schedule, status)
             VALUES ($1, $2, '[]'::jsonb, '[]'::jsonb, $3)`,
            [user.id, user.fullName, status],
        );
        return;
    }

    if (teacherRecord) {
        await executor.query(
            'UPDATE academy_teachers SET full_name = $1, status = $2, updated_at = NOW() WHERE id = $3',
            [user.fullName, 'dismissed', teacherRecord.id],
        );
    }
};

const getAssignedWorkload = async (managerId: number, executor: QueryExecutor = pool) => {
    const result = await executor.query<{
        lead_count: number | string;
        student_count: number | string;
        open_task_count: number | string;
    }>(
        `SELECT
           (SELECT COUNT(*)::int FROM academy_leads WHERE manager_id = $1) AS lead_count,
           (SELECT COUNT(*)::int FROM academy_students WHERE manager_id = $1) AS student_count,
           (SELECT COUNT(*)::int FROM academy_tasks WHERE responsible_id = $1 AND status <> 'done') AS open_task_count`,
        [managerId],
    );
    const row = result.rows[0];
    const leadCount = Number(row?.lead_count ?? 0);
    const studentCount = Number(row?.student_count ?? 0);
    const openTaskCount = Number(row?.open_task_count ?? 0);
    return {
        leadCount,
        studentCount,
        openTaskCount,
        salesResponsibilityCount: leadCount + studentCount,
        offboardingResponsibilityCount: leadCount + studentCount + openTaskCount,
    };
};

const getActiveSalesManagerForTransfer = async (managerId: number, executor: QueryExecutor = pool) => {
    const result = await executor.query<{ id: number; full_name: string }>(
        `SELECT u.id, u.full_name
         FROM users u
         WHERE u.id = $1
           AND u.is_active = true
           AND (
             u.workspace = 'sales'
             OR EXISTS (
               SELECT 1
               FROM user_workspaces uw
               WHERE uw.user_id = u.id AND uw.workspace = 'sales'
             )
           )
         FOR UPDATE OF u`,
        [managerId],
    );
    return result.rows[0] ?? null;
};

const transferAssignedSalesLeads = async ({
    client,
    fromManagerId,
    toManagerId,
    changedBy,
    transferAllOpenTasks = false,
}: {
    client: PoolClient;
    fromManagerId: number;
    toManagerId: number;
    changedBy: number;
    transferAllOpenTasks?: boolean;
}) => {
    const leads = await client.query<{ id: number }>(
            `SELECT id
             FROM academy_leads
             WHERE manager_id = $1
             FOR UPDATE`,
            [fromManagerId],
        );
    const leadIds = leads.rows.map((lead) => Number(lead.id));
    const students = await client.query<{ id: number }>(
        `SELECT id
         FROM academy_students
         WHERE manager_id = $1
            OR lead_id = ANY($2::int[])
         FOR UPDATE`,
        [fromManagerId, leadIds],
    );
    const studentIds = students.rows.map((student) => Number(student.id));

    if (leadIds.length > 0) await client.query(
            `UPDATE academy_leads
             SET manager_id = $1, updated_at = NOW()
             WHERE id = ANY($2::int[])`,
            [toManagerId, leadIds],
        );
    if (studentIds.length > 0) await client.query(
            `UPDATE academy_students
             SET manager_id = $1, updated_at = NOW()
             WHERE id = ANY($2::int[])`,
            [toManagerId, studentIds],
        );
    const taskUpdate = await client.query(
            `UPDATE academy_tasks
             SET responsible_id = $1, updated_at = NOW()
             WHERE status <> 'done'
               AND (
                 ($4::boolean = true AND responsible_id = $3)
                 OR (
                   $4::boolean = false
                   AND (
                     (entity_type = 'lead' AND entity_id = ANY($2::int[]))
                     OR (entity_type = 'student' AND entity_id = ANY($5::int[]))
                   )
                 )
               )
            `,
            [toManagerId, leadIds, fromManagerId, transferAllOpenTasks, studentIds],
        );
    if (leadIds.length > 0) await client.query(
            `INSERT INTO academy_lead_assignment_history
              (lead_id, from_manager_id, to_manager_id, changed_by, comment)
             SELECT id, $1, $2, $3, $4
             FROM academy_leads
             WHERE id = ANY($5::int[])`,
            [
                fromManagerId,
                toManagerId,
                changedBy,
                'Передано при отключении модуля продаж',
                leadIds,
            ],
        );
    return {
        leadCount: leadIds.length,
        studentCount: studentIds.length,
        taskCount: taskUpdate.rowCount ?? 0,
    };
};

type UserUpdateData = {
    fullName?: string;
    position?: string | null;
    phone?: string | null;
    email?: string;
    dateOfBirth?: Date | null;
    workspace?: AcademyWorkspace;
    hasReportAccess?: boolean;
    isActive?: boolean;
};

const userUpdateColumns: Record<keyof UserUpdateData, string> = {
    fullName: 'full_name',
    position: 'position',
    phone: 'phone',
    email: 'email',
    dateOfBirth: 'date_of_birth',
    workspace: 'workspace',
    hasReportAccess: 'has_report_access',
    isActive: 'is_active',
};

const updateUserWithExecutor = async (
    executor: QueryExecutor,
    userId: number,
    updateData: UserUpdateData,
) => {
    const entries = (Object.entries(updateData) as Array<[keyof UserUpdateData, unknown]>)
        .filter(([, value]) => value !== undefined);
    if (entries.length === 0) return;

    const assignments = entries.map(([key], index) => `${userUpdateColumns[key]} = $${index + 2}`);
    await executor.query(
        `UPDATE users
         SET ${assignments.join(', ')}, updated_at = NOW()
         WHERE id = $1`,
        [userId, ...entries.map(([, value]) => value)],
    );
};

const replaceUserWorkspaces = async (
    executor: QueryExecutor,
    userId: number,
    workspaces: AcademyWorkspace[],
) => {
    await executor.query('DELETE FROM user_workspaces WHERE user_id = $1', [userId]);
    await executor.query(
        `INSERT INTO user_workspaces (user_id, workspace)
         SELECT $1, workspace
         FROM UNNEST($2::text[]) AS workspace`,
        [userId, workspaces],
    );
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

router.get('/:id/sales-lead-count', requireAdministration, async (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }
        const user = await storage.getUser(id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(await getAssignedWorkload(id));
    } catch (error) {
        logger.error('Error fetching assigned sales lead count', { error, userId: req.params.id });
        res.status(500).json({ error: 'Failed to fetch assigned sales lead count' });
    }
});

router.post('/', requireAdministration, async (req, res) => {
    try {
        const { phone, position, hasReportAccess, isActive } = req.body;
        if (typeof req.body.fullName !== 'string' || !req.body.fullName.trim()) {
            return res.status(400).json({ error: 'Full name is required' });
        }
        const fullName = req.body.fullName.trim();
        if (fullName.length > 255) return res.status(400).json({ error: 'invalidData' });
        if (phone !== undefined && phone !== null && typeof phone !== 'string') {
            return res.status(400).json({ error: 'invalidData' });
        }
        if (typeof phone === 'string' && phone.trim().length > 50) {
            return res.status(400).json({ error: 'invalidData' });
        }
        if (position !== undefined && position !== null && typeof position !== 'string') {
            return res.status(400).json({ error: 'invalidData' });
        }
        if (typeof position === 'string' && position.trim().length > 255) {
            return res.status(400).json({ error: 'invalidData' });
        }
        if (hasReportAccess !== undefined && typeof hasReportAccess !== 'boolean') {
            return res.status(400).json({ error: 'invalidData' });
        }
        if (isActive !== undefined && typeof isActive !== 'boolean') {
            return res.status(400).json({ error: 'invalidData' });
        }

        if (!workspaceSet.has(req.body.workspace)) {
            return res.status(400).json({ error: 'A valid workspace is required' });
        }
        const workspace = req.body.workspace as AcademyWorkspace;
        const workspaces = normalizeRequestedWorkspaces(req.body.workspaces, workspace);
        const dateOfBirth = parseDateOfBirth(req.body.dateOfBirth);

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
        const hashedPassword = await authService.hashPassword(temporaryPassword);
        const credentialPasswordCiphertext = encryptCredentialPassword(temporaryPassword);
        let email = providedEmail || generateLogin(fullName, workspace, unavailableLogins);
        let newUser: any = null;

        for (let attempt = 0; attempt < maxGeneratedLoginAttempts; attempt += 1) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const inserted = await client.query(
                    `INSERT INTO users
                       (email, password, credential_password_ciphertext, full_name, phone,
                        date_of_birth, position, workspace, has_report_access, is_active)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                     RETURNING
                       id, email, password,
                       credential_password_ciphertext AS "credentialPasswordCiphertext",
                       full_name AS "fullName", phone, date_of_birth AS "dateOfBirth",
                       position, workspace, has_report_access AS "hasReportAccess",
                       is_active AS "isActive", is_online AS "isOnline",
                       last_seen_at AS "lastSeenAt", created_at AS "createdAt",
                       updated_at AS "updatedAt"`,
                    [
                        email,
                        hashedPassword,
                        credentialPasswordCiphertext,
                        fullName,
                        typeof phone === 'string' ? phone.trim() || null : null,
                        dateOfBirth ?? null,
                        typeof position === 'string' ? position.trim() || null : null,
                        workspace,
                        hasReportAccess ?? false,
                        isActive !== undefined ? isActive : true,
                    ],
                );
                newUser = inserted.rows[0];
                await replaceUserWorkspaces(client, newUser.id, workspaces);
                newUser = {
                    ...newUser,
                    workspaces,
                };
                await syncAcademyTeacherForUser(newUser, client);
                await client.query(
                    `INSERT INTO audit_logs
                       (user_id, action, entity_type, entity_id, new_values)
                     VALUES ($1, 'CREATE_USER', 'user', $2, $3::jsonb)`,
                    [
                        req.user!.id,
                        newUser.id,
                        JSON.stringify([authService.sanitizeUser(newUser)]),
                    ],
                );
                await client.query('COMMIT');
                break;
            } catch (error) {
                await client.query('ROLLBACK').catch(() => undefined);
                newUser = null;
                if (!isUsersEmailUniqueViolation(error)) {
                    throw error;
                }

                if (providedEmail) {
                    return res.status(409).json({ error: 'loginAlreadyExists' });
                }

                unavailableLogins.add(email.toLowerCase());
                email = generateLogin(fullName, workspace, unavailableLogins);
            } finally {
                client.release();
            }
        }

        if (!newUser) {
            return res.status(500).json({ error: 'failedCreateUserDescription' });
        }

        try {
            await emailService.sendWelcomeEmail(newUser.email, fullName, temporaryPassword);
        } catch (emailError) {
            logger.error('Failed to send welcome email', { error: emailError, userId: newUser.id });
        }

        res.json({
            ...authService.sanitizeUser(newUser),
            temporaryPassword: canViewCredentialPassword(req) ? temporaryPassword : undefined,
        });
    } catch (error: any) {
        logger.error('Error creating user', { error });
        if (isUsersEmailUniqueViolation(error)) {
            return res.status(409).json({ error: 'loginAlreadyExists' });
        }
        res.status(error.statusCode || 500).json({ error: error.message || 'Failed to create user' });
    }
});

router.get('/:id/credentials', requireAdministration, async (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);

        if (!id) {
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
        const id = parsePositiveId(req.params.id);

        if (!id) {
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
        }).catch((error) => logger.error('Failed to audit user credential update', {
            error,
            userId: updatedUser.id,
        }));

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
        const id = parsePositiveId(req.params.id);

        if (!id) {
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
        }).catch((error) => logger.error('Failed to audit password reset', {
            error,
            userId: user.id,
        }));

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
        const id = parsePositiveId(req.params.id);
        const currentUser = req.user;

        if (!id) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        if (currentUser?.id !== id && !hasLeadershipAccess(currentUser)) {
            return res.status(403).json({ error: 'Cannot update other users profile' });
        }

        const existingUser = await storage.getUser(id);
        if (!existingUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        const updateData: UserUpdateData = {};

        if (req.body.fullName !== undefined) {
            if (typeof req.body.fullName !== 'string' || !req.body.fullName.trim() || req.body.fullName.trim().length > 255) {
                return res.status(400).json({ error: 'Full name is required' });
            }
            updateData.fullName = req.body.fullName.trim();
        }
        if (req.body.position !== undefined) {
            if (req.body.position !== null && typeof req.body.position !== 'string') {
                return res.status(400).json({ error: 'invalidData' });
            }
            const position = typeof req.body.position === 'string' ? req.body.position.trim() : '';
            if (position.length > 255) return res.status(400).json({ error: 'invalidData' });
            updateData.position = position || null;
        }
        if (req.body.phone !== undefined) {
            if (req.body.phone !== null && typeof req.body.phone !== 'string') {
                return res.status(400).json({ error: 'invalidData' });
            }
            const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
            if (phone.length > 50) return res.status(400).json({ error: 'invalidData' });
            updateData.phone = phone || null;
        }

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
            updateData.dateOfBirth = parseDateOfBirth(req.body.dateOfBirth);
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
                if (typeof req.body.hasReportAccess !== 'boolean') {
                    return res.status(400).json({ error: 'invalidData' });
                }
                updateData.hasReportAccess = req.body.hasReportAccess;
            }
            if (req.body.isActive !== undefined) {
                if (typeof req.body.isActive !== 'boolean') {
                    return res.status(400).json({ error: 'invalidData' });
                }
                updateData.isActive = req.body.isActive;
            }
        }

        if (Object.values(updateData).every((value) => value === undefined) && requestedWorkspaces === null) {
            return res.status(400).json({ error: 'invalidData' });
        }

        const client = await pool.connect();
        let transferredLeadCount = 0;
        let transferManagerId: number | null = null;
        try {
            await client.query('BEGIN');
            await client.query('SELECT pg_advisory_xact_lock($1)', [USER_ACCESS_ADVISORY_LOCK]);

            const lockedUserResult = await client.query<{
                id: number;
                full_name: string;
                workspace: AcademyWorkspace;
                is_active: boolean;
            }>(
                `SELECT id, full_name, workspace, is_active
                 FROM users
                 WHERE id = $1
                 FOR UPDATE`,
                [id],
            );
            const lockedUser = lockedUserResult.rows[0];
            if (!lockedUser) {
                throw Object.assign(new Error('User not found'), { statusCode: 404 });
            }

            const assignedRows = await client.query<{ workspace: AcademyWorkspace }>(
                'SELECT workspace FROM user_workspaces WHERE user_id = $1',
                [id],
            );
            const currentWorkspaces = getAssignedWorkspaces({
                workspace: lockedUser.workspace,
                workspaces: assignedRows.rows.map((row) => row.workspace),
            });
            const nextPrimaryWorkspace = updateData.workspace ?? lockedUser.workspace;
            const nextWorkspaces = requestedWorkspaces
                ? [...new Set([nextPrimaryWorkspace, ...requestedWorkspaces])]
                : [...new Set([nextPrimaryWorkspace, ...currentWorkspaces])];
            const nextIsActive = updateData.isActive ?? lockedUser.is_active;

            const isRemovingActiveLeadershipAccess =
                lockedUser.is_active
                && currentWorkspaces.some(isLeadershipWorkspace)
                && (!nextIsActive || !nextWorkspaces.some(isLeadershipWorkspace));
            if (isRemovingActiveLeadershipAccess) {
                const leadershipCount = await client.query<{ count: number | string }>(
                    `SELECT COUNT(*)::int AS count
                     FROM users u
                     WHERE u.is_active = true
                       AND (
                         u.workspace = 'administration'
                         OR EXISTS (
                           SELECT 1 FROM user_workspaces uw
                           WHERE uw.user_id = u.id AND uw.workspace = 'administration'
                         )
                       )`,
                );
                if (Number(leadershipCount.rows[0]?.count ?? 0) <= 1) {
                    throw Object.assign(
                        new Error('Cannot remove or deactivate the last active leadership account.'),
                        { statusCode: 403 },
                    );
                }
            }

            const losesSalesEligibility = !nextIsActive || !nextWorkspaces.includes('sales');
            if (losesSalesEligibility) {
                const workload = await getAssignedWorkload(id, client);
                const responsibilityCount = nextIsActive
                    ? workload.salesResponsibilityCount
                    : workload.offboardingResponsibilityCount;
                if (responsibilityCount > 0) {
                    transferManagerId = parsePositiveId(req.body.leadTransferManagerId);
                    if (!transferManagerId || transferManagerId === id) {
                        throw Object.assign(new Error('salesLeadTransferRequired'), {
                            statusCode: 409,
                            leadCount: responsibilityCount,
                        });
                    }
                    const transferTarget = await getActiveSalesManagerForTransfer(transferManagerId, client);
                    if (!transferTarget) {
                        throw Object.assign(new Error('Active sales manager is required'), { statusCode: 400 });
                    }
                    const transferred = await transferAssignedSalesLeads({
                        client,
                        fromManagerId: id,
                        toManagerId: transferManagerId,
                        changedBy: req.user!.id,
                        transferAllOpenTasks: !nextIsActive,
                    });
                    transferredLeadCount = transferred.leadCount + transferred.studentCount + transferred.taskCount;
                }
            }

            await updateUserWithExecutor(client, id, updateData);
            if (requestedWorkspaces) {
                await replaceUserWorkspaces(client, id, nextWorkspaces);
            } else if (!currentWorkspaces.includes(nextPrimaryWorkspace)) {
                await client.query(
                    `INSERT INTO user_workspaces (user_id, workspace)
                     VALUES ($1, $2)
                     ON CONFLICT (user_id, workspace) DO NOTHING`,
                    [id, nextPrimaryWorkspace],
                );
            }

            await syncAcademyTeacherForUser({
                id,
                fullName: updateData.fullName ?? lockedUser.full_name,
                workspace: nextPrimaryWorkspace,
                workspaces: nextWorkspaces,
                isActive: nextIsActive,
            }, client);
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

        const updatedUser = await storage.getUser(id);
        if (!updatedUser) return res.status(404).json({ error: 'User not found' });

        await storage.createAuditLog({
            userId: req.user!.id,
            action: 'UPDATE_USER',
            entityType: 'user',
            entityId: id,
            oldValues: [authService.sanitizeUser(existingUser)],
            newValues: [{
                ...authService.sanitizeUser(updatedUser),
                transferredLeadCount,
                transferManagerId,
            }],
        }).catch((error) => logger.error('Failed to audit user update', { error, userId: id }));

        res.json(authService.sanitizeUser(updatedUser));
    } catch (error) {
        logger.error('Error updating user', { error, userId: req.params.id });
        if (isUsersEmailUniqueViolation(error)) {
            return res.status(409).json({ error: 'loginAlreadyExists' });
        }
        const typedError = error as { statusCode?: number; message?: string; leadCount?: number };
        res.status(typedError.statusCode || 500).json({
            error: typedError.message || 'Failed to update user',
            ...(typedError.leadCount !== undefined ? { leadCount: typedError.leadCount } : {}),
        });
    }
});

router.delete('/:id', requireAdministration, async (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);

        if (!id) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        const user = await storage.getUser(id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (req.user!.id === id) {
            return res.status(403).json({ error: 'Cannot delete your own account.' });
        }

        const client = await pool.connect();
        let transferredLeadCount = 0;
        let transferManagerId: number | null = null;
        try {
            await client.query('BEGIN');
            await client.query('SELECT pg_advisory_xact_lock($1)', [USER_ACCESS_ADVISORY_LOCK]);

            const lockedUser = await client.query<{ id: number; is_active: boolean; has_leadership: boolean }>(
                `SELECT u.id,
                        u.is_active,
                        (
                          u.workspace = 'administration'
                          OR EXISTS (
                            SELECT 1 FROM user_workspaces uw
                            WHERE uw.user_id = u.id AND uw.workspace = 'administration'
                          )
                        ) AS has_leadership
                 FROM users u
                 WHERE u.id = $1
                 FOR UPDATE OF u`,
                [id],
            );
            if (!lockedUser.rows[0]) {
                throw Object.assign(new Error('User not found'), { statusCode: 404 });
            }

            if (lockedUser.rows[0].has_leadership && lockedUser.rows[0].is_active) {
                const leadershipCount = await client.query<{ count: number | string }>(
                    `SELECT COUNT(*)::int AS count
                     FROM users u
                     WHERE u.is_active = true
                       AND (
                         u.workspace = 'administration'
                         OR EXISTS (
                           SELECT 1 FROM user_workspaces uw
                           WHERE uw.user_id = u.id AND uw.workspace = 'administration'
                         )
                       )`,
                );
                if (Number(leadershipCount.rows[0]?.count ?? 0) <= 1) {
                    throw Object.assign(
                        new Error('Cannot delete the last active leadership account.'),
                        { statusCode: 403 },
                    );
                }
            }

            const workload = await getAssignedWorkload(id, client);
            if (workload.offboardingResponsibilityCount > 0) {
                transferManagerId = parsePositiveId(req.query.leadTransferManagerId);
                if (!transferManagerId || transferManagerId === id) {
                    throw Object.assign(new Error('salesLeadTransferRequired'), {
                        statusCode: 409,
                        leadCount: workload.offboardingResponsibilityCount,
                    });
                }
                const transferTarget = await getActiveSalesManagerForTransfer(transferManagerId, client);
                if (!transferTarget) {
                    throw Object.assign(new Error('Active sales manager is required'), { statusCode: 400 });
                }
                const transferred = await transferAssignedSalesLeads({
                    client,
                    fromManagerId: id,
                    toManagerId: transferManagerId,
                    changedBy: req.user!.id,
                    transferAllOpenTasks: true,
                });
                transferredLeadCount = transferred.leadCount + transferred.studentCount + transferred.taskCount;
            }

            await client.query(
                "UPDATE academy_teachers SET status = 'dismissed', updated_at = NOW() WHERE user_id = $1",
                [id],
            );
            await client.query('DELETE FROM users WHERE id = $1', [id]);
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

        await storage.createAuditLog({
            userId: req.user!.id,
            action: 'DELETE_USER',
            entityType: 'user',
            entityId: id,
            oldValues: [authService.sanitizeUser(user)],
            newValues: [{ transferredLeadCount, transferManagerId }],
        }).catch((error) => logger.error('Failed to audit user deletion', { error, userId: id }));
        res.json({ message: 'User deleted successfully', transferredLeadCount });
    } catch (error) {
        logger.error('Error deleting user', { error, userId: req.params.id });
        const typedError = error as { statusCode?: number; message?: string; leadCount?: number };
        res.status(typedError.statusCode || 500).json({
            error: typedError.message || 'Failed to delete user',
            ...(typedError.leadCount !== undefined ? { leadCount: typedError.leadCount } : {}),
        });
    }
});

export default router;
