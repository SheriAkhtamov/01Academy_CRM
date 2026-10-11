import type { PortalActorContext } from "../../portal-identity/domain/actor-context";
import type {
  LmsDashboardDto,
  LmsProgressDto,
  LmsMaterialInput,
  LmsAssignmentInput,
  LmsDraftInput,
  LmsSubmitInput,
  LmsReviewInput,
  LmsQuizInput,
  LmsQuizAnswerInput,
  LmsThreadInput,
  LmsCommentInput,
  LmsAnnouncementInput,
  LmsReportInput,
  LmsRunUpdateInput,
  LmsListOptions,
  LmsPage,
  LmsFeedbackDto,
  LmsAnalyticsInput,
} from "@shared/contracts/lms";
import {
  requirePortalPermission,
  LmsError,
  type LmsStaffActor,
} from "../domain/policy";
import type { LmsPorts } from "./ports";
const emptyProgress = (): LmsProgressDto => ({
  attendance: { completed: 0, total: 0, percent: null, unmarked: 0 },
  assignments: { completed: 0, total: 0, percent: null },
  quizzes: { completed: 0, total: 0, percent: null },
  materials: { completed: 0, total: 0, percent: null },
});
export class LmsService {
  constructor(readonly ports: LmsPorts) {}
  teacherSummary(actor: LmsStaffActor) {
    return this.ports.learning.teacherSummary(actor);
  }
  analytics(actor: LmsStaffActor, input: LmsAnalyticsInput) {
    if (!actor.isLeadership) throw new LmsError("portalAccessDenied", 403);
    return this.ports.learning.analytics(actor, input);
  }
  async staffCollection(
    actor: LmsStaffActor,
    name:
      | "runs"
      | "enrollments"
      | "materials"
      | "assignments"
      | "reviews"
      | "quizzes"
      | "makeup"
      | "achievements"
      | "reports"
      | "announcements"
      | "threads"
      | "results"
      | "units"
      | "lessons"
      | "course-versions"
      | "staff-permissions",
    page: LmsListOptions,
    runId?: number,
  ): Promise<LmsPage<{ id: number }>> {
    const options = { ...page, limit: page.limit + 1 };
    const { learning, assignments, quizzes, engagement } = this.ports;
    const value = await (name === "runs"
      ? learning.managementGroups(actor, options)
      : name === "staff-permissions"
        ? learning.staffPermissions(actor, options)
        : name === "enrollments"
          ? learning.enrollments(actor, runId!, options)
          : name === "materials"
            ? learning.managementMaterials(actor, runId!, options)
            : name === "assignments"
              ? assignments.managementList(actor, runId!, options)
              : name === "reviews"
                ? assignments.reviewQueue(actor, runId, options)
                : name === "quizzes"
                  ? quizzes.managementList(actor, runId!, options)
                  : name === "makeup"
                    ? engagement.managementMakeup(actor, runId!, options)
                    : name === "achievements"
                      ? engagement.managementAwards(actor, runId!, options)
                      : name === "reports"
                        ? engagement.managementReports(actor, runId!, options)
                        : name === "announcements"
                          ? engagement.managementAnnouncements(
                              actor,
                              runId!,
                              options,
                            )
                          : name === "threads"
                            ? engagement.managementThreads(
                                actor,
                                runId,
                                options,
                              )
                            : name === "results"
                              ? learning.results(actor, runId!, options)
                              : name === "units"
                                ? learning.managementUnits(
                                    actor,
                                    runId!,
                                    options,
                                  )
                                : name === "lessons"
                                  ? learning.managementLessons(
                                      actor,
                                      runId!,
                                      options,
                                    )
                                  : learning.courseVersions(
                                      actor,
                                      runId!,
                                      options,
                                    ));
    const items = value as { id: number }[];
    const hasMore = items.length > page.limit;
    const visible = items.slice(0, page.limit);
    return {
      items: visible,
      hasMore,
      nextCursor: hasMore ? (visible.at(-1)?.id ?? null) : null,
    };
  }
  async portalCollection(
    actor: PortalActorContext,
    name:
      | "courses"
      | "materials"
      | "attendance"
      | "quizzes"
      | "makeup"
      | "achievements"
      | "reports"
      | "announcements"
      | "threads"
      | "communication-courses",
    page: LmsListOptions,
    filter?: { runId?: number; from?: string; to?: string },
  ): Promise<LmsPage<{ id: number }>> {
    const options = { ...page, limit: page.limit + 1 };
    const items = await (name === "communication-courses"
      ? this.communicationCourses(actor, options)
      : name === "achievements"
        ? this.achievements(actor, filter, options)
        : name === "reports"
          ? this.reports(actor, filter, options)
          : this[name](actor, options));
    const hasMore = items.length > page.limit;
    const visible = items.slice(0, page.limit);
    return {
      items: visible,
      nextCursor: hasMore ? (visible.at(-1)?.id ?? null) : null,
      hasMore,
    };
  }
  setUnitPreview(
    actor: LmsStaffActor,
    runId: number,
    unitId: number,
    input: { enabled: boolean; visibleFrom: string; openAt: string },
  ) {
    return this.ports.learning.setUnitPreview(actor, runId, unitId, input);
  }
  async dashboard(actor: PortalActorContext): Promise<LmsDashboardDto> {
    const learning = actor.permissions.includes("learning.read");
    const attendance = actor.permissions.includes("attendance.read");
    if (
      !learning &&
      !attendance &&
      !actor.permissions.includes("finance.read") &&
      !actor.permissions.includes("feedback.read")
    )
      throw new LmsError("portalAccessDenied", 403);
    const now = new Date();
    const end = new Date(+now + 30 * 86400000).toISOString();
    const materialSnapshot = learning
      ? this.ports.learning.materials(actor)
      : Promise.resolve([]);
    const [
      materials,
      schedule,
      assignments,
      makeup,
      progress,
      achievements,
      announcements,
    ] = await Promise.all([
      materialSnapshot,
      learning || attendance
        ? materialSnapshot.then((materials) =>
            this.ports.learning.schedule(
              actor,
              now.toISOString(),
              end,
              undefined,
              materials,
            ),
          )
        : [],
      learning ? this.ports.assignments.dashboard(actor) : [],
      learning || attendance
        ? materialSnapshot.then((materials) =>
            this.ports.engagement.makeup(actor, undefined, materials),
          )
        : [],
      learning || attendance
        ? materialSnapshot.then((materials) =>
            this.ports.learning.progress(
              actor,
              undefined,
              undefined,
              materials,
            ),
          )
        : emptyProgress(),
      learning ? this.ports.engagement.achievements(actor) : [],
      learning ? this.ports.engagement.announcements(actor) : [],
    ]);
    const filteredProgress = {
      ...progress,
      attendance: attendance ? progress.attendance : emptyProgress().attendance,
      assignments: learning
        ? progress.assignments
        : emptyProgress().assignments,
      quizzes: learning ? progress.quizzes : emptyProgress().quizzes,
      materials: learning ? progress.materials : emptyProgress().materials,
    };
    return {
      feedback: actor.permissions.includes("feedback.read")
        ? ((
            (await this.ports.assignments.feedback(
              actor,
              3,
            )) as LmsPage<LmsFeedbackDto>
          ).items ?? [])
        : [],
      nextLesson:
        schedule.find((lesson) => lesson.status !== "cancelled") ?? null,
      nextMaterial: learning
        ? (materials
            .filter((material) => !material.read)
            .map((material) => ({
              runId: material.runId,
              publicationId: material.publicationId,
              title: material.title,
            }))[0] ?? null)
        : null,
      assignments,
      makeup: makeup.filter(
        (plan) => plan.status === "needed" || plan.status === "in_progress",
      ),
      progress: filteredProgress,
      latestAchievement: achievements.find((award) => !award.revokedAt) ?? null,
      announcements,
    };
  }
  courses(actor: PortalActorContext, page?: LmsListOptions) {
    requirePortalPermission(actor, "learning.read");
    return this.ports.learning.courses(actor, page);
  }
  course(actor: PortalActorContext, id: number) {
    requirePortalPermission(actor, "learning.read");
    return this.ports.learning.course(actor, id);
  }
  unit(actor: PortalActorContext, id: number) {
    requirePortalPermission(actor, "learning.read");
    return this.ports.learning.unit(actor, id);
  }
  materials(actor: PortalActorContext, page?: LmsListOptions) {
    requirePortalPermission(actor, "learning.read");
    return this.ports.learning.materials(actor, undefined, page);
  }
  readMaterial(actor: PortalActorContext, id: number, read: boolean) {
    requirePortalPermission(actor, "learning.read", true);
    return this.ports.learning.readMaterial(actor, id, read);
  }
  schedule(
    actor: PortalActorContext,
    from: string,
    to: string,
    page?: LmsListOptions,
  ) {
    if (!actor.permissions.includes("learning.read"))
      requirePortalPermission(actor, "attendance.read");
    return this.ports.learning.schedule(actor, from, to, page);
  }
  async schedulePage(
    actor: PortalActorContext,
    from: string,
    to: string,
    page: LmsListOptions,
  ) {
    const rows = await this.schedule(actor, from, to, {
      ...page,
      limit: page.limit + 1,
    });
    const hasMore = rows.length > page.limit;
    const items = rows.slice(0, page.limit);
    return {
      items,
      hasMore,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }
  attendance(actor: PortalActorContext, page?: LmsListOptions) {
    requirePortalPermission(actor, "attendance.read");
    return this.ports.learning.attendance(actor, page);
  }
  async progress(
    actor: PortalActorContext,
    runId?: number,
    period?: { from: string; to: string },
  ) {
    requirePortalPermission(actor, "learning.read");
    const progress = await this.ports.learning.progress(actor, runId, period);
    return {
      ...progress,
      attendance: actor.permissions.includes("attendance.read")
        ? progress.attendance
        : emptyProgress().attendance,
    };
  }
  assignments(actor: PortalActorContext, limit?: number, cursor?: number) {
    requirePortalPermission(actor, "learning.read");
    return this.ports.assignments.list(actor, limit, cursor);
  }
  async assignment(actor: PortalActorContext, id: number) {
    requirePortalPermission(actor, "learning.read");
    const detail = await this.ports.assignments.detail(actor, id);
    if (!actor.permissions.includes("feedback.read"))
      return {
        ...detail,
        comments: [],
        submissions: detail.submissions.map((submission) => ({
          ...submission,
          review: null,
          reviewHistory: [],
        })),
      };
    return detail;
  }
  draft(actor: PortalActorContext, id: number, input: LmsDraftInput) {
    requirePortalPermission(actor, "assignments.submit", true);
    return this.ports.assignments.saveDraft(actor, id, input);
  }
  submit(actor: PortalActorContext, id: number, input: LmsSubmitInput) {
    requirePortalPermission(actor, "assignments.submit", true);
    return this.ports.assignments.submit(actor, id, input);
  }
  withdraw(actor: PortalActorContext, id: number, version: number) {
    requirePortalPermission(actor, "assignments.submit", true);
    return this.ports.assignments.withdraw(actor, id, version);
  }
  async withdrawAssignment(
    actor: PortalActorContext,
    id: number,
    version: number,
  ) {
    const detail = await this.assignment(actor, id);
    const submission = detail.submissions[0];
    if (!submission) throw new LmsError("lmsNotFound", 404);
    return this.withdraw(actor, submission.id, version);
  }
  quizzes(actor: PortalActorContext, page?: LmsListOptions) {
    if (!actor.permissions.includes("learning.read"))
      requirePortalPermission(actor, "feedback.read");
    return this.ports.quizzes.list(actor, page).then((items) =>
      items.map((item) => ({
        ...item,
        instructions: actor.permissions.includes("learning.read")
          ? item.instructions
          : "",
        activeAttemptId: actor.kind === "self" ? item.activeAttemptId : null,
        bestPercent: actor.permissions.includes("feedback.read")
          ? item.bestPercent
          : null,
        latestFinishedAttemptId: actor.permissions.includes("feedback.read")
          ? item.latestFinishedAttemptId
          : null,
      })),
    );
  }
  startQuiz(actor: PortalActorContext, id: number) {
    requirePortalPermission(actor, "quizzes.attempt", true);
    return this.ports.quizzes.start(actor, id);
  }
  quizAttempt(actor: PortalActorContext, id: number) {
    requirePortalPermission(actor, "quizzes.attempt", true);
    return this.ports.quizzes.get(actor, id);
  }
  answerQuiz(
    actor: PortalActorContext,
    id: number,
    questionId: string,
    input: LmsQuizAnswerInput,
  ) {
    requirePortalPermission(actor, "quizzes.attempt", true);
    return this.ports.quizzes.answer(actor, id, questionId, input);
  }
  finishQuiz(actor: PortalActorContext, id: number, version: number) {
    requirePortalPermission(actor, "quizzes.attempt", true);
    return this.ports.quizzes.finish(actor, id, version);
  }
  makeup(actor: PortalActorContext, page?: LmsListOptions) {
    if (!actor.permissions.includes("learning.read"))
      requirePortalPermission(actor, "attendance.read");
    return this.ports.engagement.makeup(actor, page);
  }
  beginMakeup(actor: PortalActorContext, id: number) {
    requirePortalPermission(actor, "learning.read", true);
    return this.ports.engagement.beginMakeup(actor, id);
  }
  achievements(
    actor: PortalActorContext,
    filter?: { runId?: number; from?: string; to?: string },
    page?: LmsListOptions,
  ) {
    requirePortalPermission(actor, "learning.read");
    return this.ports.engagement.achievements(actor, filter, page);
  }
  history(
    actor: PortalActorContext,
    limit?: number,
    cursor?: number,
    filter?: { runId?: number; from?: string; to?: string },
  ) {
    requirePortalPermission(actor, "learning.read");
    return this.ports.engagement.history(actor, limit, cursor, filter);
  }
  async reports(
    actor: PortalActorContext,
    filter?: { runId?: number; from?: string; to?: string },
    page?: LmsListOptions,
  ) {
    requirePortalPermission(actor, "feedback.read");
    const reports = await this.ports.engagement.reports(actor, filter, page);
    return reports.map((report) => ({
      ...report,
      bestProjects: report.bestProjects?.map((project) =>
        actor.permissions.includes("learning.read")
          ? project
          : { ...project, description: "", fileIds: [], links: [] },
      ),
      metrics: {
        ...report.metrics,
        attendance: actor.permissions.includes("attendance.read")
          ? report.metrics.attendance
          : emptyProgress().attendance,
        assignments: actor.permissions.includes("learning.read")
          ? report.metrics.assignments
          : emptyProgress().assignments,
        quizzes: actor.permissions.includes("learning.read")
          ? report.metrics.quizzes
          : emptyProgress().quizzes,
        materials: actor.permissions.includes("learning.read")
          ? report.metrics.materials
          : emptyProgress().materials,
      },
    }));
  }
  announcements(actor: PortalActorContext, page?: LmsListOptions) {
    requirePortalPermission(actor, "learning.read");
    return this.ports.engagement.announcements(actor, page);
  }
  readAnnouncement(actor: PortalActorContext, id: number) {
    requirePortalPermission(actor, "learning.read");
    return this.ports.engagement.readAnnouncement(actor, id);
  }
  threads(actor: PortalActorContext, page?: LmsListOptions) {
    requirePortalPermission(actor, "communication.create");
    return this.ports.engagement.threads(actor, page);
  }
  thread(actor: PortalActorContext, id: number) {
    requirePortalPermission(actor, "communication.create");
    return this.ports.engagement.threadDetail(actor, id);
  }
  createThread(actor: PortalActorContext, input: LmsThreadInput) {
    requirePortalPermission(actor, "communication.create");
    return this.ports.engagement.createThread(actor, input);
  }
  comment(actor: PortalActorContext, id: number, input: LmsCommentInput) {
    requirePortalPermission(actor, "communication.create");
    return this.ports.engagement.addComment(actor, id, input);
  }
  threadStatus(actor: PortalActorContext, id: number, status: string) {
    requirePortalPermission(actor, "communication.create");
    return this.ports.engagement.threadStatus(actor, id, status);
  }
  runs(actor: LmsStaffActor) {
    return this.ports.learning.managementGroups(actor);
  }
  createRun(
    actor: LmsStaffActor,
    input: {
      groupId: number;
      courseVersionId?: number;
      format: string;
      meetingUrl: string | null;
    },
  ) {
    return this.ports.learning.createRun(actor, input);
  }
  enrollments(actor: LmsStaffActor, id: number) {
    return this.ports.learning.enrollments(actor, id);
  }
  staffMaterials(actor: LmsStaffActor, id: number) {
    return this.ports.learning.managementMaterials(actor, id);
  }
  createMaterial(actor: LmsStaffActor, input: LmsMaterialInput) {
    return this.ports.learning.createMaterial(actor, input);
  }
  reviseMaterial(actor: LmsStaffActor, id: number, input: LmsMaterialInput) {
    return this.ports.learning.reviseMaterial(actor, id, input);
  }
  publishMaterial(
    actor: LmsStaffActor,
    id: number,
    input: { publishAt: string; recipientEnrollmentIds?: number[] },
  ) {
    return this.ports.learning.publishExistingMaterial(actor, id, input);
  }
  archiveMaterial(actor: LmsStaffActor, id: number) {
    return this.ports.learning.archiveMaterial(actor, id);
  }
  createAssignment(actor: LmsStaffActor, input: LmsAssignmentInput) {
    return this.ports.assignments.create(actor, input);
  }
  reviewQueue(actor: LmsStaffActor, id?: number) {
    return this.ports.assignments.reviewQueue(actor, id);
  }
  reviewDetail(actor: LmsStaffActor, id: number) {
    return this.ports.assignments.reviewDetail(actor, id);
  }
  startReview(actor: LmsStaffActor, id: number, version: number) {
    return this.ports.assignments.startReview(actor, id, version);
  }
  review(actor: LmsStaffActor, id: number, input: LmsReviewInput) {
    return this.ports.assignments.review(actor, id, input);
  }
  updateRecipient(
    actor: LmsStaffActor,
    id: number,
    input: {
      version: number;
      dueAt?: string | null;
      status?: string;
      reason: string;
    },
  ) {
    return this.ports.assignments.updateRecipient(actor, id, input);
  }
  staffQuizzes(actor: LmsStaffActor, id: number) {
    return this.ports.quizzes.managementList(actor, id);
  }
  createQuiz(actor: LmsStaffActor, input: LmsQuizInput) {
    return this.ports.quizzes.create(actor, input);
  }
  extraQuizAttempt(
    actor: LmsStaffActor,
    id: number,
    reason: string,
    idempotencyKey: string,
  ) {
    return this.ports.quizzes.extraAttempt(actor, id, reason, idempotencyKey);
  }
  manageMakeup(
    actor: LmsStaffActor,
    id: number,
    input: {
      recipientId?: number | null;
      quizRecipientId?: number | null;
      dueAt?: string | null;
      complete?: boolean;
    },
  ) {
    return this.ports.engagement.manageMakeup(actor, id, input);
  }
  publishReport(actor: LmsStaffActor, input: LmsReportInput) {
    return this.ports.engagement.publishReport(actor, input);
  }
  award(
    actor: LmsStaffActor,
    input: {
      runId: number;
      studentId: number;
      title: string;
      reason: string;
      eventKey: string;
    },
  ) {
    return this.ports.engagement.award(actor, input);
  }
  revokeAward(actor: LmsStaffActor, id: number, reason: string) {
    return this.ports.engagement.revokeAward(actor, id, reason);
  }
  staffAnnouncements(actor: LmsStaffActor, id: number) {
    return this.ports.engagement.managementAnnouncements(actor, id);
  }
  createAnnouncement(actor: LmsStaffActor, input: LmsAnnouncementInput) {
    return this.ports.engagement.createAnnouncement(actor, input);
  }
  staffThreads(actor: LmsStaffActor, id?: number) {
    return this.ports.engagement.managementThreads(actor, id);
  }
  staffThread(actor: LmsStaffActor, id: number) {
    return this.ports.engagement.managementThreadDetail(actor, id);
  }
  staffComment(actor: LmsStaffActor, id: number, input: LmsCommentInput) {
    return this.ports.engagement.staffComment(actor, id, input);
  }
  staffThreadStatus(actor: LmsStaffActor, id: number, status: string) {
    return this.ports.engagement.staffThreadStatus(actor, id, status);
  }
  results(actor: LmsStaffActor, id: number) {
    return this.ports.learning.results(actor, id);
  }
  createCourseVersion(
    actor: LmsStaffActor,
    input: {
      idempotencyKey?: string;
      courseId: number;
      sections: {
        title: string;
        units: { title: string; required: boolean }[];
      }[];
      publish: boolean;
    },
  ) {
    return this.ports.learning.createCourseVersion(actor, input);
  }
  completeCourse(
    actor: LmsStaffActor,
    runId: number,
    studentId: number,
    reason: string,
  ) {
    return this.ports.learning.completeCourse(actor, runId, studentId, reason);
  }
  reopenCourse(
    actor: LmsStaffActor,
    runId: number,
    studentId: number,
    reason: string,
  ) {
    return this.ports.learning.reopenCourse(actor, runId, studentId, reason);
  }
  assignEnrollment(
    actor: LmsStaffActor,
    runId: number,
    input: {
      enrollmentId: number;
      assignmentVersionIds: number[];
      opensAt: string;
      dueAt: string | null;
      reason: string;
    },
  ) {
    return this.ports.assignments.assignEnrollment(actor, runId, input);
  }
  reopenAssignment(
    actor: LmsStaffActor,
    id: number,
    input: { version: number; dueAt: string | null; reason: string },
  ) {
    return this.ports.assignments.reopen(actor, id, input);
  }
  communicationCourses(actor: PortalActorContext, page?: LmsListOptions) {
    requirePortalPermission(actor, "communication.create");
    return this.ports.learning.communicationCourses(actor, page);
  }
  staffAssignments(actor: LmsStaffActor, runId: number) {
    return this.ports.assignments.managementList(actor, runId);
  }
  assignmentComment(
    actor: PortalActorContext,
    id: number,
    input: LmsCommentInput,
  ) {
    requirePortalPermission(actor, "communication.create");
    return this.ports.assignments.addComment(actor, id, input);
  }
  staffAssignmentComment(
    actor: LmsStaffActor,
    id: number,
    input: LmsCommentInput,
  ) {
    return this.ports.assignments.staffComment(actor, id, input);
  }
  quizResults(actor: PortalActorContext, id: number) {
    requirePortalPermission(actor, "feedback.read");
    return this.ports.quizzes.results(actor, id);
  }
  staffUnits(actor: LmsStaffActor, runId: number) {
    return this.ports.learning.managementUnits(actor, runId);
  }
  staffAssignment(actor: LmsStaffActor, id: number) {
    return this.ports.assignments.managementDetail(actor, id);
  }
  staffLessons(actor: LmsStaffActor, runId: number) {
    return this.ports.learning.managementLessons(actor, runId);
  }
  bindLesson(
    actor: LmsStaffActor,
    runId: number,
    lessonId: number,
    input: {
      unitId: number | null;
      format: "offline" | "online" | null;
      meetingUrl: string | null;
    },
  ) {
    return this.ports.learning.bindLesson(actor, runId, lessonId, input);
  }
  courseVersions(actor: LmsStaffActor, runId: number) {
    return this.ports.learning.courseVersions(actor, runId);
  }
  staffQuiz(actor: LmsStaffActor, id: number) {
    return this.ports.quizzes.managementDetail(actor, id);
  }
  staffMakeup(actor: LmsStaffActor, runId: number) {
    return this.ports.engagement.managementMakeup(actor, runId);
  }
  staffAwards(actor: LmsStaffActor, runId: number) {
    return this.ports.engagement.managementAwards(actor, runId);
  }
  staffReports(actor: LmsStaffActor, runId: number) {
    return this.ports.engagement.managementReports(actor, runId);
  }
  feedback(actor: PortalActorContext, limit?: number, cursor?: number) {
    requirePortalPermission(actor, "feedback.read");
    return this.ports.assignments.feedback(actor, limit, cursor);
  }
  feedbackItem(actor: PortalActorContext, id: number) {
    requirePortalPermission(actor, "feedback.read");
    return this.ports.assignments.feedbackItem(actor, id);
  }
  staffPermissions(actor: LmsStaffActor) {
    return this.ports.learning.staffPermissions(actor);
  }
  changeStaffPermissions(
    actor: LmsStaffActor,
    userId: number,
    input: { permissions: string[]; reason: string },
  ) {
    return this.ports.learning.changeStaffPermissions(actor, userId, input);
  }
  makeupOptions(actor: LmsStaffActor, id: number) {
    return this.ports.engagement.makeupOptions(actor, id);
  }
  updateRun(actor: LmsStaffActor, runId: number, input: LmsRunUpdateInput) {
    return this.ports.learning.updateRun(actor, runId, input);
  }
}
