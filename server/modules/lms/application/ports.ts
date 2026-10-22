import type { PortalActorContext } from "../../portal-identity/domain/actor-context";
import type { LmsStaffActor } from "../domain/policy";
import type {
  LmsAssignmentDetailDto,
  LmsAssignmentDto,
  LmsAssignmentInput,
  LmsDraftInput,
  LmsSubmitInput,
  LmsReviewInput,
  LmsPage,
  LmsCourseDto,
  LmsCourseDetailDto,
  LmsMaterialDto,
  LmsMaterialInput,
  LmsScheduleDto,
  LmsProgressDto,
  LmsQuizDto,
  LmsQuizInput,
  LmsQuizAnswerInput,
  LmsQuizAttemptDto,
  LmsAchievementDto,
  LmsHistoryDto,
  LmsReportDto,
  LmsReportInput,
  LmsAnnouncementDto,
  LmsAnnouncementInput,
  LmsThreadDto,
  LmsThreadInput,
  LmsCommentInput,
  LmsMakeupDto,
  LmsUnitDto,
  LmsRunUpdateInput,
  LmsListOptions,
  LmsAnalyticsDto,
  LmsAnalyticsInput,
  LmsTeacherSummaryDto,
} from "@shared/contracts/lms";
export interface LearningPort {
  teacherSummary(actor: LmsStaffActor): Promise<LmsTeacherSummaryDto>;
  analytics(
    actor: LmsStaffActor,
    input: LmsAnalyticsInput,
  ): Promise<LmsAnalyticsDto>;
  setUnitPreview(
    actor: LmsStaffActor,
    runId: number,
    unitId: number,
    input: { enabled: boolean; visibleFrom: string; openAt: string },
  ): Promise<unknown>;
  updateRun(
    actor: LmsStaffActor,
    runId: number,
    input: LmsRunUpdateInput,
  ): Promise<unknown>;
  staffPermissions(
    actor: LmsStaffActor,
    page?: LmsListOptions,
  ): Promise<unknown>;
  changeStaffPermissions(
    actor: LmsStaffActor,
    userId: number,
    input: { permissions: string[]; reason: string },
  ): Promise<unknown>;
  managementLessons(
    actor: LmsStaffActor,
    runId: number,
    page?: LmsListOptions,
  ): Promise<unknown>;
  bindLesson(
    actor: LmsStaffActor,
    runId: number,
    lessonId: number,
    input: {
      unitId: number | null;
      format: "offline" | "online" | null;
      meetingUrl: string | null;
    },
  ): Promise<unknown>;
  courseVersions(
    actor: LmsStaffActor,
    runId: number,
    page?: LmsListOptions,
  ): Promise<unknown>;
  communicationCourses(
    actor: PortalActorContext,
    page?: LmsListOptions,
  ): Promise<
    { id: number; runId: number; courseName: string; groupName: string }[]
  >;
  courses(
    actor: PortalActorContext,
    page?: LmsListOptions,
  ): Promise<LmsCourseDto[]>;
  course(actor: PortalActorContext, id: number, enrollmentId?: number): Promise<LmsCourseDetailDto>;
  materials(
    actor: PortalActorContext,
    runId?: number,
    page?: LmsListOptions,
  ): Promise<LmsMaterialDto[]>;
  unit(actor: PortalActorContext, id: number): Promise<LmsUnitDto>;
  readMaterial(
    actor: PortalActorContext,
    id: number,
    read: boolean,
  ): Promise<unknown>;
  schedule(
    actor: PortalActorContext,
    from: string,
    to: string,
    page?: LmsListOptions,
    knownMaterials?: readonly LmsMaterialDto[],
  ): Promise<LmsScheduleDto[]>;
  attendance(
    actor: PortalActorContext,
    page?: LmsListOptions,
  ): Promise<LmsScheduleDto[]>;
  progress(
    actor: PortalActorContext,
    runId?: number,
    period?: { from: string; to: string },
    knownMaterials?: readonly LmsMaterialDto[],
  ): Promise<LmsProgressDto>;
  createRun(
    actor: LmsStaffActor,
    input: {
      groupId: number;
      courseVersionId?: number;
      format: string;
      meetingUrl: string | null;
    },
  ): Promise<unknown>;
  createMaterial(
    actor: LmsStaffActor,
    input: LmsMaterialInput,
  ): Promise<unknown>;
  managementUnits(
    actor: LmsStaffActor,
    runId: number,
    page?: LmsListOptions,
  ): Promise<
    { id: number; title: string; position: number; required: boolean }[]
  >;
  managementGroups(
    actor: LmsStaffActor,
    page?: LmsListOptions,
  ): Promise<unknown>;
  managementMaterials(
    actor: LmsStaffActor,
    runId: number,
    page?: LmsListOptions,
  ): Promise<unknown>;
  reviseMaterial(
    actor: LmsStaffActor,
    id: number,
    input: LmsMaterialInput,
  ): Promise<unknown>;
  archiveMaterial(actor: LmsStaffActor, id: number): Promise<unknown>;
  publishExistingMaterial(
    actor: LmsStaffActor,
    id: number,
    input: { publishAt: string; recipientEnrollmentIds?: number[] },
  ): Promise<unknown>;
  enrollments(
    actor: LmsStaffActor,
    runId: number,
    page?: LmsListOptions,
  ): Promise<
    {
      id: number;
      studentId: number;
      studentName: string;
      status: string;
      enrolledAt: string;
      endedAt: string | null;
    }[]
  >;
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
  ): Promise<unknown>;
  completeCourse(
    actor: LmsStaffActor,
    runId: number,
    studentId: number,
    reason: string,
  ): Promise<unknown>;
  reopenCourse(
    actor: LmsStaffActor,
    runId: number,
    studentId: number,
    reason: string,
  ): Promise<unknown>;
  results(
    actor: LmsStaffActor,
    runId: number,
    page?: LmsListOptions,
  ): Promise<unknown>;
}
export interface AssignmentsPort {
  feedback(
    actor: PortalActorContext,
    limit?: number,
    cursor?: number,
  ): Promise<unknown>;
  feedbackItem(actor: PortalActorContext, id: number): Promise<unknown>;
  dashboard(actor: PortalActorContext): Promise<LmsAssignmentDto[]>;
  managementList(
    actor: LmsStaffActor,
    runId: number,
    page?: LmsListOptions,
  ): Promise<unknown>;
  managementDetail(actor: LmsStaffActor, id: number): Promise<unknown>;
  addComment(
    actor: PortalActorContext,
    id: number,
    input: LmsCommentInput,
  ): Promise<unknown>;
  staffComment(
    actor: LmsStaffActor,
    id: number,
    input: LmsCommentInput,
  ): Promise<unknown>;
  list(
    actor: PortalActorContext,
    limit?: number,
    cursor?: number,
  ): Promise<LmsPage<LmsAssignmentDto>>;
  detail(
    actor: PortalActorContext,
    id: number,
  ): Promise<LmsAssignmentDetailDto>;
  saveDraft(
    actor: PortalActorContext,
    id: number,
    input: LmsDraftInput,
  ): Promise<unknown>;
  submit(
    actor: PortalActorContext,
    id: number,
    input: LmsSubmitInput,
  ): Promise<unknown>;
  withdraw(
    actor: PortalActorContext,
    id: number,
    version: number,
  ): Promise<unknown>;
  create(actor: LmsStaffActor, input: LmsAssignmentInput): Promise<unknown>;
  reviewQueue(
    actor: LmsStaffActor,
    runId?: number,
    page?: LmsListOptions,
  ): Promise<unknown>;
  reviewDetail(actor: LmsStaffActor, id: number): Promise<unknown>;
  startReview(
    actor: LmsStaffActor,
    id: number,
    version: number,
  ): Promise<unknown>;
  review(
    actor: LmsStaffActor,
    id: number,
    input: LmsReviewInput,
  ): Promise<unknown>;
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
  ): Promise<unknown>;
  reopen(
    actor: LmsStaffActor,
    id: number,
    input: { version: number; dueAt: string | null; reason: string },
  ): Promise<unknown>;
  updateRecipient(
    actor: LmsStaffActor,
    id: number,
    input: {
      version: number;
      dueAt?: string | null;
      status?: string;
      reason: string;
    },
  ): Promise<unknown>;
}
export interface QuizzesPort {
  managementDetail(actor: LmsStaffActor, id: number): Promise<unknown>;
  list(actor: PortalActorContext, page?: LmsListOptions): Promise<LmsQuizDto[]>;
  start(
    actor: PortalActorContext,
    recipientId: number,
  ): Promise<LmsQuizAttemptDto>;
  results(
    actor: PortalActorContext,
    recipientId: number,
  ): Promise<LmsQuizAttemptDto>;
  get(actor: PortalActorContext, id: number): Promise<LmsQuizAttemptDto>;
  answer(
    actor: PortalActorContext,
    id: number,
    questionId: string,
    input: LmsQuizAnswerInput,
  ): Promise<LmsQuizAttemptDto>;
  finish(
    actor: PortalActorContext,
    id: number,
    version: number,
  ): Promise<LmsQuizAttemptDto>;
  create(actor: LmsStaffActor, input: LmsQuizInput): Promise<unknown>;
  managementList(
    actor: LmsStaffActor,
    runId: number,
    page?: LmsListOptions,
  ): Promise<unknown>;
  extraAttempt(
    actor: LmsStaffActor,
    id: number,
    reason: string,
    idempotencyKey: string,
  ): Promise<unknown>;
  finishExpired(): Promise<unknown>;
}
export interface EngagementPort {
  makeupOptions(actor: LmsStaffActor, id: number): Promise<unknown>;
  managementMakeup(
    actor: LmsStaffActor,
    runId: number,
    page?: LmsListOptions,
  ): Promise<unknown>;
  managementAwards(
    actor: LmsStaffActor,
    runId: number,
    page?: LmsListOptions,
  ): Promise<unknown>;
  managementReports(
    actor: LmsStaffActor,
    runId: number,
    page?: LmsListOptions,
  ): Promise<unknown>;
  makeup(
    actor: PortalActorContext,
    page?: LmsListOptions,
    knownMaterials?: readonly LmsMaterialDto[],
  ): Promise<LmsMakeupDto[]>;
  beginMakeup(actor: PortalActorContext, id: number): Promise<unknown>;
  manageMakeup(
    actor: LmsStaffActor,
    id: number,
    input: {
      recipientId?: number | null;
      quizRecipientId?: number | null;
      dueAt?: string | null;
      complete?: boolean;
    },
  ): Promise<unknown>;
  achievements(
    actor: PortalActorContext,
    filter?: { runId?: number; from?: string; to?: string },
    page?: LmsListOptions,
  ): Promise<LmsAchievementDto[]>;
  history(
    actor: PortalActorContext,
    limit?: number,
    cursor?: number,
    filter?: { runId?: number; from?: string; to?: string },
  ): Promise<LmsPage<LmsHistoryDto>>;
  reports(
    actor: PortalActorContext,
    filter?: { runId?: number; from?: string; to?: string },
    page?: LmsListOptions,
  ): Promise<LmsReportDto[]>;
  publishReport(actor: LmsStaffActor, input: LmsReportInput): Promise<unknown>;
  award(
    actor: LmsStaffActor,
    input: {
      runId: number;
      studentId: number;
      title: string;
      reason: string;
      eventKey: string;
    },
  ): Promise<unknown>;
  revokeAward(
    actor: LmsStaffActor,
    id: number,
    reason: string,
  ): Promise<unknown>;
  announcements(
    actor: PortalActorContext,
    page?: LmsListOptions,
  ): Promise<LmsAnnouncementDto[]>;
  readAnnouncement(actor: PortalActorContext, id: number): Promise<unknown>;
  createAnnouncement(
    actor: LmsStaffActor,
    input: LmsAnnouncementInput,
  ): Promise<unknown>;
  managementAnnouncements(
    actor: LmsStaffActor,
    runId: number,
    page?: LmsListOptions,
  ): Promise<unknown>;
  threads(
    actor: PortalActorContext,
    page?: LmsListOptions,
  ): Promise<LmsThreadDto[]>;
  threadDetail(actor: PortalActorContext, id: number): Promise<LmsThreadDto>;
  createThread(
    actor: PortalActorContext,
    input: LmsThreadInput,
  ): Promise<unknown>;
  addComment(
    actor: PortalActorContext,
    id: number,
    input: LmsCommentInput,
  ): Promise<unknown>;
  threadStatus(
    actor: PortalActorContext,
    id: number,
    status: string,
  ): Promise<unknown>;
  managementThreads(
    actor: LmsStaffActor,
    runId?: number,
    page?: LmsListOptions,
  ): Promise<unknown>;
  managementThreadDetail(actor: LmsStaffActor, id: number): Promise<unknown>;
  staffComment(
    actor: LmsStaffActor,
    id: number,
    input: LmsCommentInput,
  ): Promise<unknown>;
  staffThreadStatus(
    actor: LmsStaffActor,
    id: number,
    status: string,
  ): Promise<unknown>;
}
export type LmsPorts = {
  learning: LearningPort;
  assignments: AssignmentsPort;
  quizzes: QuizzesPort;
  engagement: EngagementPort;
};
