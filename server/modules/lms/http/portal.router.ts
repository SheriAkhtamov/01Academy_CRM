import { Router } from "express";
import {
  lmsIdSchema,
  lmsPageSchema,
  lmsDraftSchema,
  lmsSubmitSchema,
  lmsVersionSchema,
  lmsQuizAnswerSchema,
  lmsScheduleQuerySchema,
  lmsThreadSchema,
  lmsCommentSchema,
  lmsThreadStatusSchema,
  lmsProgressQuerySchema,
} from "@shared/contracts/lms";
import type { LmsService } from "../application/lms-service";
import {
  lmsHandler,
  readInput,
  type LmsFeatureGate,
  type LmsPortalActorResolver,
} from "./router-support";
/** Mount at /api/portal/subjects. All requests resolve the current link again. */
export function createLmsPortalRouter(
  service: LmsService,
  resolveActor: LmsPortalActorResolver,
  gate: LmsFeatureGate = () => false,
) {
  const router = Router();
  const actor = (request: Parameters<LmsPortalActorResolver>[0]) =>
    resolveActor(request, readInput(lmsIdSchema, request.params.linkId));
  const id = (request: Parameters<LmsPortalActorResolver>[0]) =>
    readInput(lmsIdSchema, request.params.id);
  const handle = (action: Parameters<typeof lmsHandler>[0]) =>
    lmsHandler(action, gate);
  router.get(
    "/:linkId/dashboard",
    handle(async (request) => service.dashboard(await actor(request))),
  );
  router.get(
    "/:linkId/courses",
    handle(async (request) =>
      service.portalCollection(
        await actor(request),
        "courses",
        readInput(lmsPageSchema, request.query),
      ),
    ),
  );
  router.get(
    "/:linkId/courses/:id",
    handle(async (request) =>
      service.course(await actor(request), id(request)),
    ),
  );
  router.get(
    "/:linkId/lessons/:id",
    handle(async (request) => service.unit(await actor(request), id(request))),
  );
  router.get(
    "/:linkId/materials",
    handle(async (request) =>
      service.portalCollection(
        await actor(request),
        "materials",
        readInput(lmsPageSchema, request.query),
      ),
    ),
  );
  router.put(
    "/:linkId/materials/:id/read",
    handle(async (request) =>
      service.readMaterial(await actor(request), id(request), true),
    ),
  );
  router.delete(
    "/:linkId/materials/:id/read",
    handle(async (request) =>
      service.readMaterial(await actor(request), id(request), false),
    ),
  );
  router.get(
    "/:linkId/assignments",
    handle(async (request) => {
      const page = readInput(lmsPageSchema, request.query);
      return service.assignments(await actor(request), page.limit, page.cursor);
    }),
  );
  router.get(
    "/:linkId/assignments/:id",
    handle(async (request) =>
      service.assignment(await actor(request), id(request)),
    ),
  );
  router.put(
    "/:linkId/assignments/:id/draft",
    handle(async (request) =>
      service.draft(
        await actor(request),
        id(request),
        readInput(lmsDraftSchema, request.body),
      ),
    ),
  );
  router.post(
    "/:linkId/assignments/:id/submissions",
    handle(async (request) =>
      service.submit(
        await actor(request),
        id(request),
        readInput(lmsSubmitSchema, request.body),
      ),
    ),
  );
  router.post(
    "/:linkId/assignments/:id/withdraw",
    handle(async (request) =>
      service.withdrawAssignment(
        await actor(request),
        id(request),
        readInput(lmsVersionSchema, request.body).version,
      ),
    ),
  );
  router.post(
    "/:linkId/submissions/:id/withdraw",
    handle(async (request) =>
      service.withdraw(
        await actor(request),
        id(request),
        readInput(lmsVersionSchema, request.body).version,
      ),
    ),
  );
  router.get(
    "/:linkId/quizzes",
    handle(async (request) =>
      service.portalCollection(
        await actor(request),
        "quizzes",
        readInput(lmsPageSchema, request.query),
      ),
    ),
  );
  router.post(
    "/:linkId/quizzes/:id/attempts",
    handle(async (request) =>
      service.startQuiz(await actor(request), id(request)),
    ),
  );
  router.get(
    "/:linkId/attempts/:id",
    handle(async (request) =>
      service.quizAttempt(await actor(request), id(request)),
    ),
  );
  router.put(
    "/:linkId/attempts/:id/answers/:questionId",
    handle(async (request) =>
      service.answerQuiz(
        await actor(request),
        id(request),
        request.params.questionId,
        readInput(lmsQuizAnswerSchema, request.body),
      ),
    ),
  );
  router.post(
    "/:linkId/attempts/:id/finish",
    handle(async (request) =>
      service.finishQuiz(
        await actor(request),
        id(request),
        readInput(lmsVersionSchema, request.body).version,
      ),
    ),
  );
  router.get(
    "/:linkId/progress",
    handle(async (request) => {
      const filter = readInput(lmsProgressQuerySchema, request.query);
      return service.progress(
        await actor(request),
        filter.runId,
        filter.from && filter.to
          ? { from: filter.from, to: filter.to }
          : undefined,
      );
    }),
  );
  router.get(
    "/:linkId/attendance",
    handle(async (request) =>
      service.portalCollection(
        await actor(request),
        "attendance",
        readInput(lmsPageSchema, request.query),
      ),
    ),
  );
  router.get(
    "/:linkId/schedule",
    handle(async (request) => {
      const range = readInput(lmsScheduleQuerySchema, request.query);
      return service.schedulePage(
        await actor(request),
        range.from,
        range.to,
        readInput(lmsPageSchema, request.query),
      );
    }),
  );
  router.get(
    "/:linkId/makeup",
    handle(async (request) =>
      service.portalCollection(
        await actor(request),
        "makeup",
        readInput(lmsPageSchema, request.query),
      ),
    ),
  );
  router.post(
    "/:linkId/makeup/:id/start",
    handle(async (request) =>
      service.beginMakeup(await actor(request), id(request)),
    ),
  );
  router.get(
    "/:linkId/history",
    handle(async (request) => {
      const page = readInput(lmsPageSchema, request.query);
      return service.history(
        await actor(request),
        page.limit,
        page.cursor,
        readInput(lmsProgressQuerySchema, request.query),
      );
    }),
  );
  router.get(
    "/:linkId/achievements",
    handle(async (request) =>
      service.portalCollection(
        await actor(request),
        "achievements",
        readInput(lmsPageSchema, request.query),
        readInput(lmsProgressQuerySchema, request.query),
      ),
    ),
  );
  router.get(
    "/:linkId/reports",
    handle(async (request) =>
      service.portalCollection(
        await actor(request),
        "reports",
        readInput(lmsPageSchema, request.query),
        readInput(lmsProgressQuerySchema, request.query),
      ),
    ),
  );
  router.get(
    "/:linkId/announcements",
    handle(async (request) =>
      service.portalCollection(
        await actor(request),
        "announcements",
        readInput(lmsPageSchema, request.query),
      ),
    ),
  );
  router.post(
    "/:linkId/announcements/:id/read",
    handle(async (request) =>
      service.readAnnouncement(await actor(request), id(request)),
    ),
  );
  router.get(
    "/:linkId/threads",
    handle(async (request) =>
      service.portalCollection(
        await actor(request),
        "threads",
        readInput(lmsPageSchema, request.query),
      ),
    ),
  );
  router.get(
    "/:linkId/threads/:id",
    handle(async (request) =>
      service.thread(await actor(request), id(request)),
    ),
  );
  router.post(
    "/:linkId/threads",
    handle(async (request) =>
      service.createThread(
        await actor(request),
        readInput(lmsThreadSchema, request.body),
      ),
    ),
  );
  router.post(
    "/:linkId/threads/:id/comments",
    handle(async (request) =>
      service.comment(
        await actor(request),
        id(request),
        readInput(lmsCommentSchema, request.body),
      ),
    ),
  );
  router.patch(
    "/:linkId/threads/:id",
    handle(async (request) =>
      service.threadStatus(
        await actor(request),
        id(request),
        readInput(lmsThreadStatusSchema, request.body).status,
      ),
    ),
  );
  router.get(
    "/:linkId/communication-courses",
    handle(async (request) =>
      service.portalCollection(
        await actor(request),
        "communication-courses",
        readInput(lmsPageSchema, request.query),
      ),
    ),
  );
  router.post(
    "/:linkId/assignments/:id/comments",
    handle(async (request) =>
      service.assignmentComment(
        await actor(request),
        id(request),
        readInput(lmsCommentSchema, request.body),
      ),
    ),
  );
  router.get(
    "/:linkId/quizzes/:id/results",
    handle(async (request) =>
      service.quizResults(await actor(request), id(request)),
    ),
  );
  router.get(
    "/:linkId/feedback",
    handle(async (request) => {
      const page = readInput(lmsPageSchema, request.query);
      return service.feedback(await actor(request), page.limit, page.cursor);
    }),
  );
  router.get(
    "/:linkId/feedback/:id",
    handle(async (request) =>
      service.feedbackItem(await actor(request), id(request)),
    ),
  );
  return router;
}
