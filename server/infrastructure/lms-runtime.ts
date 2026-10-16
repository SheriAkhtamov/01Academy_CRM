import crypto from "node:crypto";
import type { Server, IncomingMessage } from "node:http";
import {
  Router,
  type Express,
  type Request,
  type RequestHandler,
} from "express";
import type { Pool } from "pg";
import { getAssignedModules, hasLeadershipAccess } from "@shared/academy";
import type { AppConfig } from "../config";
import { logger } from "../lib/logger";
import { learningNotificationCopy } from "../lib/learning-notification-copy";
import {
  createPortalCrypto,
  createPostgresPortalRepository,
  createPortalIdentityRouter,
  createPortalAccessRouter,
  PortalIdentityService,
  PortalError,
  PortalDirectoryRepository,
  createPortalAdminRouter,
} from "../modules/portal-identity";
import type {
  PortalActorContext,
  PortalStaffActor,
  PortalRepository,
} from "../modules/portal-identity";
import { LmsService } from "../modules/lms/application/lms-service";
import { PgLearningRepository } from "../modules/lms/infrastructure/learning-repository";
import { PgCrmLearningPreparationRepository } from "../modules/lms/infrastructure/crm-preparation-repository";
import { PgAssignmentRepository } from "../modules/lms/infrastructure/assignment-repository";
import { PgQuizRepository } from "../modules/lms/infrastructure/quiz-repository";
import { PgEngagementRepository } from "../modules/lms/infrastructure/engagement-repository";
import { createLmsPortalRouter } from "../modules/lms/http/portal.router";
import { createLmsManagementRouter } from "../modules/lms/http/management.router";
import { PortalResourceService } from "../modules/portal-resources/application/resource-service";
import {
  PostgresPortalResourceRepository,
  authorizeLmsFiles,
} from "../modules/portal-resources/infrastructure/postgres-repository";
import { reportProjectSnapshots } from "../modules/portal-resources/infrastructure/project-repository";
import {
  LocalResourceFileStore,
  createResourceTokenCodec,
} from "../modules/portal-resources/infrastructure/file-store";
import { cleanupResourceQuarantine } from "../modules/portal-resources/infrastructure/storage-reservation";
import { createResourceUploadParser } from "../modules/portal-resources/infrastructure/upload-parser";
import {
  PortalNotificationWorker,
  type PortalNotificationWorkerOptions,
} from "../modules/portal-resources/infrastructure/notification-worker";
import {
  createPortalResourceRouter,
  createPublicPortfolioRouter,
  createStaffResourceRouter,
} from "../modules/portal-resources/http/router";
import { createLearningConfigurationRouter } from "../modules/portal-resources/http/configuration-router";
import { PostgresAcademyPortalAccessRepository } from "../modules/portal-identity/infrastructure/academy-access-repository";
import { AcademyPortalAccessService } from "../modules/portal-identity/application/academy-access-service";
import { createPortalProfilePhotos } from "../modules/portal-identity/infrastructure/profile-photos";
import { createAcademyPortalAccessRouter } from "../modules/portal-identity/http/academy-access-router";
import { LearningFeatureController } from "./learning-flags";
import {
  createPortalSessionMiddleware,
  portalCsrfProtection,
} from "./portal-session";
import {
  createPortalWebSocketGateway,
  type PortalWebSocketGateway,
  type PortalRealtimeContext,
} from "../realtime/portal-websocket-gateway";
import { createPortalRateLimiters } from "./portal-rate-limiters";
import {
  LEARNING_PROCESS_ROLES,
  validateLearningRoles,
  isPhysicalLearningFileWrite,
  type LearningExecution,
} from "./learning-execution";
import type { LearningJobName, LearningJobRunner } from "./learning-job-runner";

export type LearningRuntimeExecution = LearningExecution & {
  runJob?: LearningJobRunner;
  strictInitialization?: boolean;
  configureLegacyPortfolioAvailability?: (
    available: ((groupId: number) => Promise<boolean> | boolean) | null,
  ) => void;
};
const requireStaffAuth: RequestHandler = (request, response, next) => {
  void import("../middleware/auth.middleware")
    .then(({ requireAuth }) => requireAuth(request, response, next))
    .catch(next);
};

const rejectUnavailable: RequestHandler = (_request, response) => {
  response.status(404).json({ code: "portalUnavailable" });
};
export const resolveLearningStaff = async (request: Request) => {
  if (!request.user?.isActive || request.user.isArchived)
    throw new PortalError("portalAuthenticationRequired", 401);
  return {
    userId: request.user.id,
    modules: getAssignedModules(request.user),
    isLeadership: hasLeadershipAccess(request.user),
    ...(request.requestId ? { requestId: request.requestId } : {}),
  };
};

/** A disabled runtime does not query new tables, create directories or start jobs. */
export function createLearningRuntime(
  pool: Pool,
  config: AppConfig,
  execution: LearningRuntimeExecution = {
    mode: "api",
    roles: LEARNING_PROCESS_ROLES,
  },
) {
  const roles = validateLearningRoles(execution.roles, execution.mode);
  const api = roles.includes("api");
  const flags = new LearningFeatureController(pool, config);
  const portal = config.portal;
  const enabled = Boolean(portal?.enabled);
  const rateLimiters =
    enabled && api && config.server.environment === "production"
      ? createPortalRateLimiters()
      : null;
  const beforeBodyParser: RequestHandler = (request, response, next) => {
    if (
      execution.fileWrites === "external" &&
      isPhysicalLearningFileWrite(request.method, request.path)
    )
      return response.status(503).json({ code: "portalUnavailable" });
    if (!rateLimiters) return next();
    if (/^\/api\/portal(?:\/|$)/.test(request.path))
      return rateLimiters.edge(request, response, next);
    if (/^\/api\/public\/portfolio(?:\/|$)/.test(request.path))
      return rateLimiters.publicPortfolio(request, response, next);
    next();
  };
  let portalGateway: PortalWebSocketGateway | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshAll = false;
  const refreshStudents = new Set<number>(),
    refreshAccounts = new Set<number>();
  const schedulePortalRefresh = (scope?: {
    studentIds?: readonly number[];
    accountIds?: readonly number[];
  }) => {
    if (!portalGateway || stopped) return;
    if (!scope || (!scope.studentIds?.length && !scope.accountIds?.length))
      refreshAll = true;
    else {
      scope.studentIds?.forEach((id) => refreshStudents.add(id));
      scope.accountIds?.forEach((id) => refreshAccounts.add(id));
    }
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      const request = refreshAll
        ? { force: true }
        : {
            force: true,
            studentIds: [...refreshStudents],
            accountIds: [...refreshAccounts],
          };
      refreshAll = false;
      refreshStudents.clear();
      refreshAccounts.clear();
      void portalGateway?.refresh(request).catch(() => undefined);
    }, 150);
    refreshTimer.unref();
  };
  const portalRevision = async (contexts: readonly PortalRealtimeContext[]) => {
    const studentIds = [
        ...new Set(contexts.flatMap((context) => context.studentIds)),
      ],
      accountIds = [...new Set(contexts.map((context) => context.accountId))];
    const result = await pool.query<{ revision: string }>(
      `SELECT md5(jsonb_build_array(
      (SELECT jsonb_agg(value ORDER BY value.student_id) FROM (SELECT student_id,max(id) AS id FROM lms_learning_events WHERE student_id=ANY($1::integer[]) GROUP BY student_id) value),
      (SELECT jsonb_agg(value ORDER BY value.student_id) FROM (SELECT student_id,max(id) AS id FROM lms_resource_audit WHERE student_id=ANY($1::integer[]) GROUP BY student_id) value),
      (SELECT jsonb_agg(value ORDER BY value.account_id) FROM (SELECT account_id,max(id) AS id FROM portal_notifications WHERE account_id=ANY($2::bigint[]) GROUP BY account_id) value),
      (SELECT jsonb_agg(value ORDER BY value.owner_account_id,value.run_id) FROM (SELECT owner_account_id,run_id,max(checked_at) AS checked_at FROM lms_files WHERE owner_account_id=ANY($2::bigint[]) OR run_id IN(SELECT run.id FROM lms_group_runs run JOIN academy_student_group_enrollments enrollment ON enrollment.group_id=run.group_id WHERE enrollment.student_id=ANY($1::integer[])) GROUP BY owner_account_id,run_id) value)
    )::text) AS revision`,
      [studentIds, accountIds],
    );
    return result.rows[0].revision;
  };
  if (api)
    execution.configureLegacyPortfolioAvailability?.(
      enabled ? (groupId) => flags.enabledForGroup("learning", groupId) : null,
    );
  const canManageLearning = async (request: Request) => {
    if (!flags.capabilities().learningEnabled) return false;
    const actor = await resolveLearningStaff(request);
    if (actor.isLeadership || actor.modules.includes("teacher")) return true;
    return Boolean(
      (
        await pool.query(
          "SELECT user_id FROM lms_staff_permissions WHERE user_id=$1 AND permission<>'access.manage' LIMIT 1",
          [actor.userId],
        )
      ).rowCount,
    );
  };
  const canManageAccess = async (request: Request) => {
    const staff = await resolveLearningStaff(request);
    if (staff.isLeadership) return true;
    if (!enabled || !staff.modules.includes("sales")) return false;
    return Boolean(
      (
        await pool.query(
          "SELECT user_id FROM lms_staff_permissions WHERE user_id=$1 AND permission='access.manage'",
          [staff.userId],
        )
      ).rowCount,
    );
  };
  const resolvePortalStaff = async (
    request: Request,
  ): Promise<PortalStaffActor> => {
    const actor = await resolveLearningStaff(request);
    return {
      staffId: actor.userId,
      modules: actor.modules,
      canManageAccess: await canManageAccess(request),
      requestId: request.requestId,
    };
  };
  const encryptionKey =
    portal?.tokenEncryptionKey ?? crypto.randomBytes(32).toString("base64");
  const identityRepository = createPostgresPortalRepository(pool, { initialCredentials: true });
  const identity = new PortalIdentityService(
    identityRepository,
    createPortalCrypto(encryptionKey),
    {
      appUrl: config.server.appUrl,
      allowInvitations: Boolean(portal?.allowInvitations),
      invitationsEnabledForStudent: (studentId, repository) =>
        flags.enabledForStudent("invitations", studentId, () =>
          repository.getStudentEnrollmentGroupIds(studentId),
        ),
    },
  );
  const academyAccessRepository = new PostgresAcademyPortalAccessRepository(pool, createPortalCrypto(encryptionKey), encryptionKey, {
    enabled: () => flags.capabilities().invitationsEnabled,
    enabledForStudent: (studentId, groups) => flags.enabledForStudent("invitations", studentId, () => groups),
  });
  const academyAccess = new AcademyPortalAccessService(academyAccessRepository, () => flags.capabilities().invitationsEnabled);
  const resources: PortalResourceService = new PortalResourceService(
    new PostgresPortalResourceRepository(
      pool,
      (groupId) => flags.enabledForGroup("learning", groupId),
      () => ({
        studentBytes: flags.settings().studentQuotaGiB * 1024 ** 3,
        schoolBytes: flags.settings().schoolQuotaGiB * 1024 ** 3,
      }),
      (sql, studentId, runId) =>
        learning
          .awardAutomatic(
            sql,
            studentId,
            runId,
            "first_project",
            `first-project:${studentId}:${runId}`,
            "lmsAchievementFirstProject",
            "lmsAchievementFirstProjectReason",
          )
          .then(() => undefined),
    ),
    new LocalResourceFileStore(),
    createResourceTokenCodec(encryptionKey),
    {
      appUrl: config.server.appUrl.replace(/\/$/, ""),
      publicPortfolioEnabled: (studentId) =>
        flags.enabledForStudent("public_portfolio", studentId),
    },
  );
  const learning: PgLearningRepository = new PgLearningRepository(
    pool,
    authorizeLmsFiles,
    (groupId) => flags.enabledForGroup("learning", groupId),
    {
      achievementTemplate: (rule) =>
        flags
          .settings()
          .achievementTemplates.find(
            (template) => template.rule === rule.split(":")[0],
          ) ?? null,
      copyFiles: (actor, ids, sourceRunId, targetRunId, key) =>
        resources.cloneStaffFiles(actor, ids, sourceRunId, targetRunId, key),
      crmPreparationDefaultFormat: () => flags.settings().crmPreparation.defaultFormat,
      reportProjects: reportProjectSnapshots,
      afterReview: async (sql, actor, event) => {
        const accepted = (
          await sql.query(
            `SELECT project.id FROM academy_portfolio_projects project JOIN lms_submissions submission ON submission.id=project.source_submission_id WHERE project.student_id=$1 AND project.lms_run_id=$2 AND project.archived_at IS NULL AND submission.withdrawn_at IS NULL
        AND EXISTS(SELECT 1 FROM lms_reviews review WHERE review.submission_id=submission.id AND review.decision='accepted' AND review.id=(SELECT max(latest.id) FROM lms_reviews latest WHERE latest.submission_id=submission.id)) LIMIT 1`,
            [event.studentId, event.runId],
          )
        ).rows[0];
        if (accepted)
          await learning.awardAutomatic(
            sql,
            event.studentId,
            event.runId,
            "first_project",
            `first-project:${event.studentId}:${event.runId}`,
            "lmsAchievementFirstProject",
            "lmsAchievementFirstProjectReason",
            actor.userId,
            actor.requestId,
          );
        else {
          const revoked = (
            await sql.query<{ id: string }>(
              "UPDATE lms_achievements SET revoked_at=now(),revoked_by=$3,revoke_reason=$4 WHERE student_id=$1 AND run_id=$2 AND rule='first_project' AND revoked_at IS NULL RETURNING id",
              [event.studentId, event.runId, actor.userId, event.reason],
            )
          ).rows;
          for (const award of revoked) {
            await sql.query(
              "INSERT INTO lms_learning_events(student_id,run_id,type,object_id,event_key,data) VALUES($1,$2,'achievement_revoked',$3,$4,$5::jsonb) ON CONFLICT(event_key) DO NOTHING",
              [
                event.studentId,
                event.runId,
                award.id,
                `first-project-revoked:${award.id}:${event.submissionId}:${crypto.randomUUID()}`,
                JSON.stringify({ reason: event.reason }),
              ],
            );
            await sql.query(
              "INSERT INTO lms_learning_audit(user_id,run_id,entity_type,entity_id,action,reason,request_id) VALUES($1,$2,'achievement',$3,'achievement.revoked',$4,$5)",
              [
                actor.userId,
                event.runId,
                award.id,
                event.reason,
                actor.requestId ?? null,
              ],
            );
          }
        }
      },
    },
  );
  const assignments = new PgAssignmentRepository(pool, learning);
  const quizzes = new PgQuizRepository(pool, learning);
  const engagement = new PgEngagementRepository(pool, learning);
  const service = new LmsService({
    learning,
    assignments,
    quizzes,
    engagement,
  });
  const notificationOptions: PortalNotificationWorkerOptions = {
    pool,
    enabled: () => flags.capabilities().learningEnabled,
    enabledForGroup: (groupId) => flags.enabledForGroup("learning", groupId),
    enabledForStudent: (studentId) =>
      flags.enabledForStudent("learning", studentId),
    authorizeLink: (accountId, linkId, permission) =>
      identity.resolveAccountActor(accountId, linkId, permission),
    staffCopy: (code, params) => {
      const text = learningNotificationCopy(code, params);
      return { title: text, message: text };
    },
  };
  const notifications = new PortalNotificationWorker(notificationOptions);
  const requestActors = new WeakMap<
    Request,
    Map<number, Promise<PortalActorContext>>
  >();
  const actor = (
    request: Request,
    linkId: number,
  ): Promise<PortalActorContext> => {
    if (!request.portalSession?.accountId)
      throw new PortalError("portalAuthenticationRequired", 401);
    let values = requestActors.get(request);
    if (!values) {
      values = new Map();
      requestActors.set(request, values);
    }
    let resolved = values.get(linkId);
    if (!resolved) {
      const session = request.portalSession;
      resolved = (async () => {
        const current = await identity.resolveAccountActor(
          session.accountId!,
          linkId,
          undefined,
          session.id,
        );
        if (!(await flags.enabledForStudent("learning", current.studentId)))
          throw new PortalError("portalUnavailable", 404);
        return { ...current, requestId: request.requestId };
      })();
      values.set(linkId, resolved);
    }
    return resolved;
  };
  const account = async (request: Request) => {
    if (
      !request.portalSession?.accountId ||
      !(await identity.resolveSession(request.portalSession.id))
    )
      throw new PortalError("portalAuthenticationRequired", 401);
    return request.portalSession.accountId;
  };
  const learningGate = async (request: Request) => {
    if (!flags.capabilities().learningEnabled) return false;
    if (request.params.linkId) {
      await actor(request, Number(request.params.linkId));
      return true;
    }
    return true;
  };
  function registerRoutes(app: Express) {
    if (!api)
      throw new Error("LMS worker processes cannot register HTTP routes");
    app.use((request, response, next) => {
      if (
        enabled &&
        ["POST", "PUT", "PATCH", "DELETE"].includes(request.method) &&
        (/^\/api\/(?:portal|lms-management)(?:\/|$)/.test(request.path) ||
          /^\/api\/academy\/(?:students|lessons|groups)(?:\/|$)/.test(
            request.path,
          ))
      )
        response.once("finish", () => {
          if (response.statusCode >= 400) return;
          const actors = requestActors.get(request);
          if (actors?.size) {
            void Promise.allSettled(actors.values()).then((results) => {
              const studentIds = results.flatMap((result) =>
                result.status === "fulfilled" ? [result.value.studentId] : [],
              );
              schedulePortalRefresh({ studentIds });
            });
          } else if (
            request.portalSession?.accountId &&
            /^\/api\/portal\/notifications(?:\/|$)/.test(request.originalUrl)
          )
            schedulePortalRefresh({
              accountIds: [request.portalSession.accountId],
            });
          else {
            const studentId = request.originalUrl.match(
              /^\/api\/academy\/students\/([1-9]\d*)(?:\/|$)/,
            )?.[1];
            schedulePortalRefresh(
              studentId ? { studentIds: [Number(studentId)] } : undefined,
            );
          }
        });
      next();
    });
    app.use(
      ["/api/lms-management", "/api/academy/students/:studentId/portal-access"],
      (_request, response, next) => {
        response.setHeader("Cache-Control", "private, no-store");
        next();
      },
    );
    app.use("/api/lms-management", requireStaffAuth);
    app.use(
      "/api/lms-management",
      createLearningConfigurationRouter(
        flags,
        resolveLearningStaff,
        canManageAccess,
        canManageLearning,
      ),
    );
    if (!enabled) {
      app.use("/api/portal", rejectUnavailable);
      app.use("/api/public/portfolio", rejectUnavailable);
      app.use(
        "/api/academy/students/:studentId/portal-access",
        rejectUnavailable,
      );
      app.use("/api/lms-management", rejectUnavailable);
      return;
    }
    const routeLimits = rateLimiters ?? {
      edge: ((_request, _response, next) => next()) as RequestHandler,
      account: ((_request, _response, next) => next()) as RequestHandler,
      publicPortfolio: ((_request, _response, next) =>
        next()) as RequestHandler,
    };
    const portalRouter = Router();
    portalRouter.use((request, response, next) =>
      flags.capabilities().portalEnabled
        ? next()
        : rejectUnavailable(request, response, next),
    );
    portalRouter.use(
      routeLimits.edge,
      createPortalSessionMiddleware({
        secret: portal!.sessionSecret!,
        secure: config.server.environment === "production",
        service: identity,
      }),
      routeLimits.account,
      portalCsrfProtection,
    );
    portalRouter.get("/support", (_request, response) =>
      response.json({
        schoolName: "01 Academy",
        phone: portal?.support?.phone ?? null,
        email: portal?.support?.email ?? null,
      }),
    );
    portalRouter.get("/file-policy", (_request, response) =>
      response.json({
        maxFileMiB: flags.settings().maxFileMiB,
        studentQuotaGiB: flags.settings().studentQuotaGiB,
      }),
    );
    portalRouter.use(createPortalIdentityRouter({ service: identity, photos: createPortalProfilePhotos() }));
    portalRouter.use(
      "/subjects",
      createLmsPortalRouter(service, actor, learningGate),
    );
    portalRouter.use(
      createPortalResourceRouter(
        resources,
        { actor, account },
        createResourceUploadParser(),
      ),
    );
    app.use("/api/portal", portalRouter);
    app.use(
      "/api/public/portfolio",
      routeLimits.publicPortfolio,
      createPublicPortfolioRouter(resources),
    );
    app.use(
      "/api/academy/students/:studentId/portal-access",
      requireStaffAuth,
      (request, response, next) =>
        flags.capabilities().portalEnabled
          ? next()
          : rejectUnavailable(request, response, next),
      createPortalAccessRouter({
        service: identity,
        resolveStaffActor: resolvePortalStaff,
        canInvite: (studentId) =>
          flags.enabledForStudent("invitations", studentId),
      }),
    );
    app.use("/api/lms-management", createAcademyPortalAccessRouter(academyAccess, resolvePortalStaff));
    app.use(
      "/api/lms-management",
      createPortalAdminRouter({
        repository: new PortalDirectoryRepository(pool),
        resolveStaffActor: resolvePortalStaff,
        enabled: () => flags.capabilities().portalEnabled,
      }),
    );
    app.use(
      "/api/lms-management",
      (request, response, next) => {
        if (!flags.capabilities().learningEnabled)
          return rejectUnavailable(request, response, next);
        next();
      },
      createLmsManagementRouter(service, resolveLearningStaff, learningGate),
      createStaffResourceRouter(
        resources,
        resolveLearningStaff,
        createResourceUploadParser(),
      ),
    );
  }
  const timers: ReturnType<typeof setInterval>[] = [];
  const running = new Set<Promise<void>>();
  let stopped = false;
  let lastFlagRefreshAt: number | null = null;
  let refreshing: Promise<void> | null = null;
  const refreshFlags = () => {
    if (refreshing) return refreshing;
    const task = flags.refresh().then(() => {
      lastFlagRefreshAt = Date.now();
    });
    const current = task.finally(() => {
      if (refreshing === current) refreshing = null;
    });
    refreshing = current;
    return current;
  };
  const schedule = (
    name: string,
    period: number,
    work: () => Promise<unknown>,
  ) => {
    let busy = false;
    const timer = setInterval(() => {
      if (busy || stopped) return;
      busy = true;
      const task = work()
        .then(() => undefined)
        .catch((error: unknown) => {
          logger.error(`Learning ${name} failed`, { error });
        })
        .finally(() => {
          busy = false;
          running.delete(task);
        });
      running.add(task);
    }, period);
    if (execution.mode === "api") timer.unref();
    timers.push(timer);
  };
  const job = (
    name: LearningJobName,
    period: number,
    work: (signal?: AbortSignal) => Promise<void>,
  ) =>
    schedule(name, period, async () => {
      if (refreshing) await refreshing;
      if (stopped) return;
      if (execution.runJob) await execution.runJob(name, work);
      else await work();
    });
  const ensureLease = (signal?: AbortSignal) => {
    signal?.throwIfAborted();
  };
  return {
    registerRoutes,
    identity,
    resources,
    flags,
    beforeBodyParser,
    closeWebSocket: async () => {
      await portalGateway?.close();
    },
    attachWebSocket(
      server: Server,
      clientIp?: (request: IncomingMessage) => string,
    ) {
      if (!api)
        throw new Error(
          "LMS worker processes cannot attach WebSocket gateways",
        );
      if (portalGateway) return;
      portalGateway = createPortalWebSocketGateway(server, {
        identity,
        sessionSecret:
          portal?.sessionSecret ?? crypto.randomBytes(32).toString("base64url"),
        appUrl: config.server.appUrl,
        enabled: () => flags.capabilities().portalEnabled,
        isActorEnabled: (actor) =>
          flags.enabledForStudent("learning", actor.studentId),
        readRevision: portalRevision,
        clientIp,
      });
    },
    async start() {
      if (!enabled || stopped || timers.length) return;
      try {
        await refreshFlags();
      } catch (error) {
        if (execution.mode === "worker" || execution.strictInitialization)
          throw error;
        logger.error(
          "Learning initialization failed; existing CRM remains available",
          { error },
        );
      }
      schedule("flags", 15_000, async () => {
        await refreshFlags();
        await portalGateway?.refresh();
      });
      if (roles.includes("lifecycle"))
        job("lifecycle", 15_000, async (signal) => {
          if (!flags.capabilities().learningEnabled) return;
          ensureLease(signal);
          await new PgCrmLearningPreparationRepository(pool, {
            enabled: () => flags.capabilities().learningEnabled,
            groupIds: portal?.groupIds,
            defaultFormat: () => flags.settings().crmPreparation.defaultFormat,
          }).runOnce({kind:"system"}, signal);
          ensureLease(signal);
          await learning.reconcileGroupLifecycle();
          ensureLease(signal);
          await quizzes.finishExpired();
        });
      if (roles.includes("credentials"))
        job("credentials", 15_000, async (signal) => {
          if (flags.capabilities().invitationsEnabled) await academyAccessRepository.provisioning.runOnce(signal);
        });
      if (roles.includes("notifications"))
        job("notifications", 15_000, async () => {
          if (flags.capabilities().learningEnabled)
            await notifications.runOnce();
        });
      if (roles.includes("files"))
        job("files", 30_000, async () => {
          if (flags.capabilities().learningEnabled) {
            await resources.validateFiles();
            await portalGateway?.refresh();
          }
        });
      if (roles.includes("maintenance"))
        job("maintenance", 3_600_000, async (signal) => {
          if (flags.capabilities().learningEnabled) {
            ensureLease(signal);
            await resources.cleanupFiles();
            ensureLease(signal);
            await cleanupResourceQuarantine();
          }
          ensureLease(signal);
          if (flags.capabilities().portalEnabled)
            await pool.query(
              "DELETE FROM portal_sessions WHERE absolute_expires_at<=now() OR last_seen_at<=now()-interval '24 hours'",
            );
        });
    },
    health: () => ({
      ready: !stopped && flags.capabilities().portalEnabled,
      roles,
      lastFlagRefreshAt,
    }),
    async stop() {
      stopped = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      for (const timer of timers) clearInterval(timer);
      const finished = await Promise.allSettled([
        Promise.resolve().then(() => portalGateway?.close()),
        Promise.resolve().then(() => {
          if (api) execution.configureLegacyPortfolioAvailability?.(null);
        }),
        ...running,
      ]);
      const failed = finished.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    },
  };
}
