import type { Router } from 'express';
import type { PoolClient } from 'pg';
import { getAssignedModules, type AcademyAccessModule, type AcademyModule } from '@shared/academy';
import { logger } from '../lib/logger';
import { sendHttpError } from '../lib/http-errors';
import { authService } from '../services/auth';
import { requireAdministration } from '../middleware/auth.middleware';
import { revokeUserAuthenticationArtifacts } from '../services/session-security';
import { disconnectRealtimeUser } from '../realtime/realtime-hub';

type QueryExecutor = Pick<PoolClient, 'query'>;

type Workload = {
  offboardingResponsibilityCount: number;
};

type TransferResult = {
  leadCount: number;
  studentCount: number;
  taskCount: number;
};

type UserRecord = Parameters<typeof authService.sanitizeUser>[0];

type UserArchiveAuditEntry = {
  userId: number;
  action: string;
  entityType: string;
  entityId: number;
  oldValues: unknown[];
  newValues: unknown[];
};

type RegisterUserArchiveRoutesDependencies = {
  connectDatabase: () => Promise<PoolClient>;
  getUser: (id: number) => Promise<UserRecord | undefined>;
  createAuditLog: (entry: UserArchiveAuditEntry) => Promise<unknown>;
  parsePositiveId: (value: unknown) => number | null;
  userAccessAdvisoryLock: number;
  getAssignedWorkload: (userId: number, executor: QueryExecutor) => Promise<Workload>;
  getActiveSalesManagerForTransfer: (userId: number, executor: QueryExecutor) => Promise<unknown>;
  transferAssignedSalesLeads: (options: {
    client: PoolClient;
    fromManagerId: number;
    toManagerId: number;
    changedBy: number;
    transferAllOpenTasks: boolean;
  }) => Promise<TransferResult>;
  syncAcademyTeacherForUser: (user: {
    id: number;
    fullName: string;
    module: AcademyModule;
    modules?: AcademyAccessModule[] | null;
    isActive?: boolean | null;
  }, executor: QueryExecutor) => Promise<void>;
};

export const registerUserArchiveRoutes = (
  router: Router,
  dependencies: RegisterUserArchiveRoutesDependencies,
) => {
  const {
    connectDatabase,
    getUser,
    createAuditLog,
    parsePositiveId,
    userAccessAdvisoryLock,
    getAssignedWorkload,
    getActiveSalesManagerForTransfer,
    transferAssignedSalesLeads,
    syncAcademyTeacherForUser,
  } = dependencies;

  router.post('/:id/archive', requireAdministration, async (req, res) => {
    try {
      const id = parsePositiveId(req.params.id);
      if (!id) return res.status(400).json({ error: 'Invalid user ID' });
      if (req.user!.id === id) {
        return res.status(403).json({ error: 'cannotArchiveOwnAccount' });
      }

      const existingUser = await getUser(id);
      if (!existingUser) return res.status(404).json({ error: 'User not found' });

      const client = await connectDatabase();
      let transferredResponsibilityCount = 0;
      let transferManagerId: number | null = null;
      let alreadyArchived = false;
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [userAccessAdvisoryLock]);

        const lockedResult = await client.query<{
          id: number;
          is_active: boolean | null;
          is_archived: boolean;
          has_leadership: boolean;
        }>(
          `SELECT u.id,
                  u.is_active,
                  u.is_archived,
                  (
                    u.module = 'administration'
                    OR EXISTS (
                      SELECT 1 FROM user_modules uw
                      WHERE uw.user_id = u.id AND uw.module = 'administration'
                    )
                  ) AS has_leadership
           FROM users u
           WHERE u.id = $1
           FOR UPDATE OF u`,
          [id],
        );
        const lockedUser = lockedResult.rows[0];
        if (!lockedUser) {
          throw Object.assign(new Error('User not found'), { statusCode: 404 });
        }

        if (lockedUser.is_archived) {
          alreadyArchived = true;
          await client.query('COMMIT');
        } else {
          if (lockedUser.has_leadership && lockedUser.is_active) {
            const leadershipCount = await client.query<{ count: number | string }>(
              `SELECT COUNT(*)::int AS count
               FROM users u
               WHERE u.is_active = true
                 AND u.is_archived = false
                 AND (
                   u.module = 'administration'
                   OR EXISTS (
                     SELECT 1 FROM user_modules uw
                     WHERE uw.user_id = u.id AND uw.module = 'administration'
                   )
                 )`,
            );
            if (Number(leadershipCount.rows[0]?.count ?? 0) <= 1) {
              throw Object.assign(new Error('cannotArchiveLastLeadershipAccount'), { statusCode: 403 });
            }
          }

          const workload = await getAssignedWorkload(id, client);
          if (workload.offboardingResponsibilityCount > 0) {
            transferManagerId = parsePositiveId(req.body?.leadTransferManagerId);
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
            transferredResponsibilityCount = transferred.leadCount
              + transferred.studentCount
              + transferred.taskCount;
          }

          await client.query(
            `UPDATE users
             SET is_archived = true,
                 archived_at = NOW(),
                 archived_by = $2,
                 archived_previous_is_active = COALESCE(is_active, false),
                 archived_previous_online_pbx_incoming_enabled = online_pbx_incoming_enabled,
                 is_active = false,
                 is_online = false,
                 online_pbx_incoming_enabled = false,
                 updated_at = NOW()
             WHERE id = $1`,
            [id, req.user!.id],
          );
          await client.query(
            "UPDATE academy_teachers SET status = 'dismissed', updated_at = NOW() WHERE user_id = $1",
            [id],
          );
          await revokeUserAuthenticationArtifacts(id, { executor: client });
          await client.query('COMMIT');
        }
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      const archivedUser = await getUser(id);
      if (!archivedUser) return res.status(404).json({ error: 'User not found' });

      if (!alreadyArchived) {
        disconnectRealtimeUser(id);
        await createAuditLog({
          userId: req.user!.id,
          action: 'ARCHIVE_USER',
          entityType: 'user',
          entityId: id,
          oldValues: [authService.sanitizeUser(existingUser)],
          newValues: [{
            ...authService.sanitizeUser(archivedUser),
            transferredResponsibilityCount,
            transferManagerId,
          }],
        }).catch((error) => logger.error('Failed to audit user archive', { error, userId: id }));
      }

      res.json({
        ...authService.sanitizeUser(archivedUser),
        alreadyArchived,
        transferredResponsibilityCount,
      });
    } catch (error) {
      logger.error('Error archiving user', { error, userId: req.params.id });
      const typedError = error as { leadCount?: number };
      return sendHttpError(res, error, 'Failed to archive user', {
        ...(typedError.leadCount !== undefined ? { leadCount: typedError.leadCount } : {}),
      });
    }
  });

  router.post('/:id/restore', requireAdministration, async (req, res) => {
    try {
      const id = parsePositiveId(req.params.id);
      if (!id) return res.status(400).json({ error: 'Invalid user ID' });

      const existingUser = await getUser(id);
      if (!existingUser) return res.status(404).json({ error: 'User not found' });

      const client = await connectDatabase();
      let alreadyRestored = false;
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [userAccessAdvisoryLock]);
        const lockedResult = await client.query<{
          id: number;
          full_name: string;
          module: AcademyModule;
          is_archived: boolean;
          archived_previous_is_active: boolean | null;
          archived_previous_online_pbx_incoming_enabled: boolean | null;
        }>(
          `SELECT id,
                  full_name,
                  module,
                  is_archived,
                  archived_previous_is_active,
                  archived_previous_online_pbx_incoming_enabled
           FROM users
           WHERE id = $1
           FOR UPDATE`,
          [id],
        );
        const lockedUser = lockedResult.rows[0];
        if (!lockedUser) {
          throw Object.assign(new Error('User not found'), { statusCode: 404 });
        }

        if (!lockedUser.is_archived) {
          alreadyRestored = true;
          await client.query('COMMIT');
        } else {
          const nextIsActive = lockedUser.archived_previous_is_active === true;
          const nextIncomingEnabled = nextIsActive
            && lockedUser.archived_previous_online_pbx_incoming_enabled === true;
          const assignedRows = await client.query<{ module: AcademyAccessModule }>(
            'SELECT module FROM user_modules WHERE user_id = $1',
            [id],
          );
          const modules = getAssignedModules({
            module: lockedUser.module,
            modules: assignedRows.rows.map((row) => row.module),
          });

          await client.query(
            `UPDATE users
             SET is_archived = false,
                 archived_at = NULL,
                 archived_by = NULL,
                 is_active = $2,
                 online_pbx_incoming_enabled = $3,
                 archived_previous_is_active = NULL,
                 archived_previous_online_pbx_incoming_enabled = NULL,
                 updated_at = NOW()
             WHERE id = $1`,
            [id, nextIsActive, nextIncomingEnabled],
          );
          await syncAcademyTeacherForUser({
            id,
            fullName: lockedUser.full_name,
            module: lockedUser.module,
            modules,
            isActive: nextIsActive,
          }, client);
          await client.query('COMMIT');
        }
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      const restoredUser = await getUser(id);
      if (!restoredUser) return res.status(404).json({ error: 'User not found' });

      if (!alreadyRestored) {
        await createAuditLog({
          userId: req.user!.id,
          action: 'RESTORE_USER',
          entityType: 'user',
          entityId: id,
          oldValues: [authService.sanitizeUser(existingUser)],
          newValues: [authService.sanitizeUser(restoredUser)],
        }).catch((error) => logger.error('Failed to audit user restore', { error, userId: id }));
      }

      res.json({ ...authService.sanitizeUser(restoredUser), alreadyRestored });
    } catch (error) {
      logger.error('Error restoring user', { error, userId: req.params.id });
      return sendHttpError(res, error, 'Failed to restore user');
    }
  });
};
