import { Router } from "express";
import { z } from "zod";
import {
  lmsIdSchema,
  lmsPageSchema,
  lmsRunSchema,
  lmsMaterialSchema,
  lmsPublishSchema,
  lmsAssignmentSchema,
  lmsReviewSchema,
  lmsVersionSchema,
  lmsRecipientUpdateSchema,
  lmsQuizSchema,
  lmsReasonSchema,
  lmsAnnouncementSchema,
  lmsCommentSchema,
  lmsThreadStatusSchema,
  lmsReportSchema,
  lmsAchievementSchema,
  lmsEnrollmentAssignmentsSchema,
  lmsReopenAssignmentSchema,
  lmsCourseVersionSchema,
  lmsCompletionSchema,
  lmsLessonBindingSchema,
  lmsStaffPermissionsSchema,
  lmsRunUpdateSchema,
  lmsUnitPreviewSchema,
  lmsAnalyticsSchema,
  lmsExtraAttemptSchema,
} from "@shared/contracts/lms";
import type { LmsService } from "../application/lms-service";
import {
  lmsHandler,
  readInput,
  type LmsFeatureGate,
  type LmsStaffActorResolver,
} from "./router-support";
/** Mount after staff session auth at /api/lms-management. */
export function createLmsManagementRouter(
  service: LmsService,
  resolveStaff: LmsStaffActorResolver,
  gate: LmsFeatureGate = () => false,
) {
  const router = Router();
  const id = (request: Parameters<LmsStaffActorResolver>[0]) =>
    readInput(lmsIdSchema, request.params.id);
  const run = (request: Parameters<LmsStaffActorResolver>[0]) =>
    readInput(lmsIdSchema, request.query.runId);
  const handle = (action: Parameters<typeof lmsHandler>[0]) =>
    lmsHandler(action, gate);
  router.get(
    "/summary",
    handle(async (request) =>
      service.teacherSummary(await resolveStaff(request)),
    ),
  );
  router.get(
    "/analytics",
    handle(async (request) =>
      service.analytics(
        await resolveStaff(request),
        readInput(lmsAnalyticsSchema, request.query),
      ),
    ),
  );
  router.get(
    "/runs",
    handle(async (request) =>
      service.staffCollection(
        await resolveStaff(request),
        "runs",
        readInput(lmsPageSchema, request.query),
      ),
    ),
  );
  router.post(
    "/runs",
    handle(async (request) =>
      service.createRun(
        await resolveStaff(request),
        readInput(lmsRunSchema, request.body),
      ),
    ),
  );
  router.get(
    "/runs/:id/enrollments",
    handle(async (request) =>
      service.staffCollection(
        await resolveStaff(request),
        "enrollments",
        readInput(lmsPageSchema, request.query),
        id(request),
      ),
    ),
  );
  router.get(
    "/materials",
    handle(async (request) =>
      service.staffCollection(
        await resolveStaff(request),
        "materials",
        readInput(lmsPageSchema, request.query),
        run(request),
      ),
    ),
  );
  router.post(
    "/materials",
    handle(async (request) =>
      service.createMaterial(
        await resolveStaff(request),
        readInput(lmsMaterialSchema, request.body),
      ),
    ),
  );
  router.patch(
    "/materials/:id",
    handle(async (request) =>
      service.reviseMaterial(
        await resolveStaff(request),
        id(request),
        readInput(lmsMaterialSchema, request.body),
      ),
    ),
  );
  router.post(
    "/materials/:id/publish",
    handle(async (request) =>
      service.publishMaterial(
        await resolveStaff(request),
        id(request),
        readInput(lmsPublishSchema, request.body),
      ),
    ),
  );
  router.post(
    "/materials/:id/archive",
    handle(async (request) =>
      service.archiveMaterial(await resolveStaff(request), id(request)),
    ),
  );
  router.post(
    "/assignments",
    handle(async (request) =>
      service.createAssignment(
        await resolveStaff(request),
        readInput(lmsAssignmentSchema, request.body),
      ),
    ),
  );
  router.patch(
    "/assignments/:id/recipient",
    handle(async (request) =>
      service.updateRecipient(
        await resolveStaff(request),
        id(request),
        readInput(lmsRecipientUpdateSchema, request.body),
      ),
    ),
  );
  router.get(
    "/reviews",
    handle(async (request) =>
      service.staffCollection(
        await resolveStaff(request),
        "reviews",
        readInput(lmsPageSchema, request.query),
        request.query.runId ? run(request) : undefined,
      ),
    ),
  );
  router.get(
    "/reviews/:id",
    handle(async (request) =>
      service.reviewDetail(await resolveStaff(request), id(request)),
    ),
  );
  router.post(
    "/reviews/:id/start",
    handle(async (request) =>
      service.startReview(
        await resolveStaff(request),
        id(request),
        readInput(lmsVersionSchema, request.body).version,
      ),
    ),
  );
  router.post(
    "/reviews/:id/decision",
    handle(async (request) =>
      service.review(
        await resolveStaff(request),
        id(request),
        readInput(lmsReviewSchema, request.body),
      ),
    ),
  );
  router.get(
    "/quizzes",
    handle(async (request) =>
      service.staffCollection(
        await resolveStaff(request),
        "quizzes",
        readInput(lmsPageSchema, request.query),
        run(request),
      ),
    ),
  );
  router.post(
    "/quizzes",
    handle(async (request) =>
      service.createQuiz(
        await resolveStaff(request),
        readInput(lmsQuizSchema, request.body),
      ),
    ),
  );
  router.post(
    "/quizzes/:id/extra-attempt",
    handle(async (request) => {
      const input = readInput(lmsExtraAttemptSchema, request.body);
      return service.extraQuizAttempt(
        await resolveStaff(request),
        id(request),
        input.reason,
        input.idempotencyKey,
      );
    }),
  );
  router.patch(
    "/makeup/:id",
    handle(async (request) =>
      service.manageMakeup(
        await resolveStaff(request),
        id(request),
        readInput(
          z.object({
            recipientId: lmsIdSchema.nullable().optional(),
            quizRecipientId: lmsIdSchema.nullable().optional(),
            dueAt: z.string().datetime().nullable().optional(),
            complete: z.boolean().optional(),
          }),
          request.body,
        ),
      ),
    ),
  );
  router.get(
    "/announcements",
    handle(async (request) =>
      service.staffCollection(
        await resolveStaff(request),
        "announcements",
        readInput(lmsPageSchema, request.query),
        run(request),
      ),
    ),
  );
  router.post(
    "/announcements",
    handle(async (request) =>
      service.createAnnouncement(
        await resolveStaff(request),
        readInput(lmsAnnouncementSchema, request.body),
      ),
    ),
  );
  router.get(
    "/threads",
    handle(async (request) =>
      service.staffCollection(
        await resolveStaff(request),
        "threads",
        readInput(lmsPageSchema, request.query),
        request.query.runId ? run(request) : undefined,
      ),
    ),
  );
  router.get(
    "/threads/:id",
    handle(async (request) =>
      service.staffThread(await resolveStaff(request), id(request)),
    ),
  );
  router.post(
    "/threads/:id/comments",
    handle(async (request) =>
      service.staffComment(
        await resolveStaff(request),
        id(request),
        readInput(lmsCommentSchema, request.body),
      ),
    ),
  );
  router.patch(
    "/threads/:id",
    handle(async (request) =>
      service.staffThreadStatus(
        await resolveStaff(request),
        id(request),
        readInput(lmsThreadStatusSchema, request.body).status,
      ),
    ),
  );
  router.get(
    "/results",
    handle(async (request) =>
      service.staffCollection(
        await resolveStaff(request),
        "results",
        readInput(lmsPageSchema, request.query),
        run(request),
      ),
    ),
  );
  router.post(
    "/reports",
    handle(async (request) =>
      service.publishReport(
        await resolveStaff(request),
        readInput(lmsReportSchema, request.body),
      ),
    ),
  );
  router.post(
    "/achievements",
    handle(async (request) =>
      service.award(
        await resolveStaff(request),
        readInput(lmsAchievementSchema, request.body),
      ),
    ),
  );
  router.post(
    "/achievements/:id/revoke",
    handle(async (request) =>
      service.revokeAward(
        await resolveStaff(request),
        id(request),
        readInput(lmsReasonSchema, request.body).reason,
      ),
    ),
  );
  router.post(
    "/course-versions",
    handle(async (request) =>
      service.createCourseVersion(
        await resolveStaff(request),
        readInput(lmsCourseVersionSchema, request.body),
      ),
    ),
  );
  router.post(
    "/course-completions",
    handle(async (request) => {
      const input = readInput(lmsCompletionSchema, request.body);
      return service.completeCourse(
        await resolveStaff(request),
        input.runId,
        input.studentId,
        input.reason,
      );
    }),
  );
  router.post(
    "/course-completions/reopen",
    handle(async (request) => {
      const input = readInput(lmsCompletionSchema, request.body);
      return service.reopenCourse(
        await resolveStaff(request),
        input.runId,
        input.studentId,
        input.reason,
      );
    }),
  );
  router.post(
    "/runs/:id/assignments/enrollment",
    handle(async (request) =>
      service.assignEnrollment(
        await resolveStaff(request),
        id(request),
        readInput(lmsEnrollmentAssignmentsSchema, request.body),
      ),
    ),
  );
  router.post(
    "/assignments/:id/reopen",
    handle(async (request) =>
      service.reopenAssignment(
        await resolveStaff(request),
        id(request),
        readInput(lmsReopenAssignmentSchema, request.body),
      ),
    ),
  );
  router.get(
    "/assignments",
    handle(async (request) =>
      service.staffCollection(
        await resolveStaff(request),
        "assignments",
        readInput(lmsPageSchema, request.query),
        run(request),
      ),
    ),
  );
  router.post(
    "/assignments/:id/comments",
    handle(async (request) =>
      service.staffAssignmentComment(
        await resolveStaff(request),
        id(request),
        readInput(lmsCommentSchema, request.body),
      ),
    ),
  );
  router.get(
    "/runs/:id/units",
    handle(async (request) =>
      service.staffCollection(
        await resolveStaff(request),
        "units",
        readInput(lmsPageSchema, request.query),
        id(request),
      ),
    ),
  );
  router.put(
    "/runs/:id/units/:unitId/preview",
    handle(async (request) =>
      service.setUnitPreview(
        await resolveStaff(request),
        id(request),
        readInput(lmsIdSchema, request.params.unitId),
        readInput(lmsUnitPreviewSchema, request.body),
      ),
    ),
  );
  router.get(
    "/assignments/:id",
    handle(async (request) =>
      service.staffAssignment(await resolveStaff(request), id(request)),
    ),
  );
  router.get(
    "/runs/:id/lessons",
    handle(async (request) =>
      service.staffCollection(
        await resolveStaff(request),
        "lessons",
        readInput(lmsPageSchema, request.query),
        id(request),
      ),
    ),
  );
  router.put(
    "/runs/:id/lesson-bindings/:lessonId",
    handle(async (request) =>
      service.bindLesson(
        await resolveStaff(request),
        id(request),
        readInput(lmsIdSchema, request.params.lessonId),
        readInput(lmsLessonBindingSchema, request.body),
      ),
    ),
  );
  router.get(
    "/runs/:id/course-versions",
    handle(async (request) =>
      service.courseVersions(await resolveStaff(request), id(request)),
    ),
  );
  router.get(
    "/quizzes/:id",
    handle(async (request) =>
      service.staffQuiz(await resolveStaff(request), id(request)),
    ),
  );
  router.get(
    "/makeup",
    handle(async (request) =>
      service.staffCollection(
        await resolveStaff(request),
        "makeup",
        readInput(lmsPageSchema, request.query),
        run(request),
      ),
    ),
  );
  router.get(
    "/achievements",
    handle(async (request) =>
      service.staffCollection(
        await resolveStaff(request),
        "achievements",
        readInput(lmsPageSchema, request.query),
        run(request),
      ),
    ),
  );
  router.get(
    "/reports",
    handle(async (request) =>
      service.staffCollection(
        await resolveStaff(request),
        "reports",
        readInput(lmsPageSchema, request.query),
        run(request),
      ),
    ),
  );
  router.get(
    "/staff-permissions",
    handle(async (request) =>
      service.staffCollection(
        await resolveStaff(request),
        "staff-permissions",
        readInput(lmsPageSchema, request.query),
      ),
    ),
  );
  router.put(
    "/staff-permissions/:id",
    handle(async (request) =>
      service.changeStaffPermissions(
        await resolveStaff(request),
        id(request),
        readInput(lmsStaffPermissionsSchema, request.body),
      ),
    ),
  );
  router.get(
    "/makeup/:id/options",
    handle(async (request) =>
      service.makeupOptions(await resolveStaff(request), id(request)),
    ),
  );
  router.patch(
    "/runs/:id",
    handle(async (request) =>
      service.updateRun(
        await resolveStaff(request),
        id(request),
        readInput(lmsRunUpdateSchema, request.body),
      ),
    ),
  );
  return router;
}
