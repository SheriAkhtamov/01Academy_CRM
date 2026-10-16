// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  LmsAssignmentDetailDto,
  LmsFeedbackDto,
  LmsScheduleDto,
} from "../shared/contracts/lms";
import type { PortalSessionDto } from "../shared/contracts/portal-identity";
import { PortalSchedule, portalWeekRange } from "../client/src/features/lms/schedule";
import { PortalFeedback } from "../client/src/features/lms/feedback";
import { PortalApiError } from "../client/src/features/portal-app/api";
import {
  PortalSessionProvider,
  portalSessionKey,
  portalSubjectKey,
} from "../client/src/features/portal-app/context";
import { ThemeProvider } from "../client/src/components/ux/ThemeProvider";
import { i18n } from "../client/src/lib/i18n";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  schedule: vi.fn(),
  feedback: vi.fn(),
  feedbackDetail: vi.fn(),
  assignment: vi.fn(),
}));
vi.mock("../client/src/features/portal-app/realtime", () => ({
  usePortalRealtime: vi.fn(),
}));
vi.mock("../client/src/features/portal-app/api", async (importActual) => {
  const actual = await importActual<typeof import("../client/src/features/portal-app/api")>();
  return {
    ...actual,
    portalIdentityApi: { ...actual.portalIdentityApi, session: mocks.session },
    portalLmsApi: {
      ...actual.portalLmsApi,
      schedule: mocks.schedule,
      feedback: mocks.feedback,
      feedbackDetail: mocks.feedbackDetail,
      assignment: mocks.assignment,
    },
  };
});

const session: PortalSessionDto = {
  account: {
    id: 50, login: "parent", fullName: "Parent", email: null, phone: null,
    locale: "en", status: "active",
  },
  subjects: [{
    linkId: 10, studentId: 20, studentName: "Child", kind: "representative",
    relationship: "parent", status: "active", studentClassification: "minor",
    permissions: ["learning.read", "attendance.read", "feedback.read", "communication.create"],
  }],
  csrfToken: "observer-csrf",
};
const assignment: LmsAssignmentDetailDto = {
  id: 1, recipientId: 1, assignmentVersionId: 3, runId: 2, unitId: null,
  title: "Practice project", courseName: "Design", groupName: "Group 1",
  opensAt: "2026-01-01T00:00:00Z", dueAt: null, closesAt: null, required: true,
  status: "assigned", overdue: false, version: 1, body: "Project instructions",
  gradingMode: "acceptance", maxScore: null, criteria: [], allowedAnswers: ["text"],
  fileIds: [], draft: { version: 0, text: "", links: [], fileIds: [], savedAt: null },
  submissions: [], comments: [],
};
const feedback: LmsFeedbackDto = {
  id: 9, recipientId: 1, submissionId: 7, assignmentTitle: "Practice project",
  courseName: "Design", groupName: "Group 1", decision: "accepted",
  comment: "Teacher feedback", score: null, maxScore: null,
  reviewerName: "Teacher", createdAt: "2026-10-16T08:00:00Z",
};
let client: QueryClient;
let lesson: LmsScheduleDto;
function mount(children: ReactNode, student = false) {
  const current: PortalSessionDto = student
    ? { ...session, subjects: [{ ...session.subjects[0], kind: "self", relationship: null }] }
    : session;
  client.setQueryData(portalSessionKey, current);
  mocks.session.mockResolvedValue(current);
  return render(
    <ThemeProvider defaultTheme="light">
      <QueryClientProvider client={client}>
        <PortalSessionProvider>{children}</PortalSessionProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}
async function openLesson() {
  await userEvent.click(await screen.findByRole("button", { name: /Practice lesson/ }));
  return screen.getByRole("dialog");
}
async function openScheduleAssignment() {
  await openLesson();
  await userEvent.click(screen.getByRole("button", { name: /Practice project/ }));
  return screen.findByRole("dialog", { name: i18n.t("portalAssignments") });
}
async function openFeedbackAssignment() {
  const detail = await screen.findByRole("dialog", { name: i18n.t("portalFeedback") });
  await userEvent.click(await within(detail).findByRole("button", { name: i18n.t("portalOpen") }));
  return screen.findByRole("dialog", { name: i18n.t("portalAssignments") });
}
async function refetch(area: "schedule" | "feedback" | "feedback-detail") {
  await act(async () => {
    await client.refetchQueries({ queryKey: portalSubjectKey(session.account!, session.subjects[0], area) });
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  i18n.setLanguage("en");
  history.replaceState(null, "", "/parent-module/schedule");
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  lesson = {
    id: 3, lessonId: 3, runId: 2, unitId: 4, courseName: "Design", groupName: "Group 1",
    topic: "Practice lesson", scheduledAt: portalWeekRange(0).days[0],
    endsAt: new Date(+new Date(portalWeekRange(0).days[0]) + 3600000).toISOString(),
    durationMinutes: 60, status: "scheduled", teacherName: "Teacher",
    schoolName: "Academy", roomName: "Room 1", format: "offline", meetingUrl: null,
    attendance: null, updatedAt: null,
    materials: [{
      id: 8, publicationId: 8, materialVersionId: 9, runId: 2, unitId: 4,
      title: "Lesson material", body: "Study material", category: "text",
      links: [], fileIds: [], publishedAt: "2026-10-16T08:00:00Z", read: false,
    }],
    assignments: [{ recipientId: 1, title: "Practice project", status: "assigned" }],
  };
  mocks.schedule.mockResolvedValue([lesson]);
  mocks.feedback.mockResolvedValue({ items: [feedback], nextCursor: null, hasMore: false });
  mocks.feedbackDetail.mockResolvedValue(feedback);
  mocks.assignment.mockResolvedValue(assignment);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });

it("keeps parent lesson materials read only and assignment observation inside its Dialog", async () => {
  mount(<PortalSchedule />);
  const detail = await openLesson();
  expect(within(detail).getByText("Lesson material")).toBeTruthy();
  expect(within(detail).queryByRole("button", { name: "Lesson material" })).toBeNull();
  expect(within(detail).queryByRole("button", { name: i18n.t("portalMaterial") })).toBeNull();
  await userEvent.click(within(detail).getByRole("button", { name: /Practice project/ }));
  await screen.findByRole("dialog", { name: i18n.t("portalAssignments") });
  await screen.findByText("Project instructions");
  expect(mocks.assignment).toHaveBeenCalledWith(10, 1, expect.any(AbortSignal));
  expect(screen.queryByLabelText(i18n.t("portalAnswer"))).toBeNull();
  expect(location.pathname).toBe("/parent-module/schedule");
});

it.each([
  ["Lesson material", "/student-module/courses/2/materials/8"],
  ["portalMaterial", "/student-module/courses/2"],
] as const)("preserves the student lesson %s link", async (label, expected) => {
  history.replaceState(null, "", "/student-module/schedule");
  mount(<PortalSchedule />, true);
  const detail = await openLesson();
  await userEvent.click(within(detail).getByRole("button", { name: label === "portalMaterial" ? i18n.t(label) : label }));
  expect(location.pathname).toBe(expected);
});

it("opens the parent feedback assignment in a nested readonly Dialog", async () => {
  history.replaceState(null, "", "/parent-module/feedback?review=9");
  mount(<PortalFeedback initialId={9} />);
  await openFeedbackAssignment();
  await screen.findByText("Project instructions");
  expect(mocks.assignment).toHaveBeenCalledWith(10, 1, expect.any(AbortSignal));
  expect(screen.queryByLabelText(i18n.t("portalAnswer"))).toBeNull();
  expect(location.pathname + location.search).toBe("/parent-module/feedback?review=9");
});

it("preserves the student feedback assignment destination", async () => {
  history.replaceState(null, "", "/student-module/feedback?review=9");
  mount(<PortalFeedback initialId={9} />, true);
  const detail = await screen.findByRole("dialog", { name: i18n.t("portalFeedback") });
  await userEvent.click(await within(detail).findByRole("button", { name: i18n.t("portalOpen") }));
  expect(location.pathname).toBe("/student-module/assignments/1");
  expect(mocks.assignment).not.toHaveBeenCalled();
});

it.each([401, 403, 404])("removes the lesson and nested assignment draft after schedule access error %s", async (status) => {
  mount(<PortalSchedule />);
  await openScheduleAssignment();
  await userEvent.type(await screen.findByLabelText(i18n.t("portalComment")), "Private question");
  mocks.schedule.mockRejectedValueOnce(new PortalApiError(status, "portalUnavailable"));
  await refetch("schedule");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.queryByLabelText(i18n.t("portalComment"))).toBeNull();
});

it.each([500, 0])("retains the nested lesson draft and its close guard after schedule error %s", async (status) => {
  mount(<PortalSchedule />);
  const assignmentDialog = await openScheduleAssignment();
  const comment = await screen.findByLabelText(i18n.t("portalComment"));
  await userEvent.type(comment, "Unsent question");
  mocks.schedule.mockRejectedValueOnce(new PortalApiError(status, "portalLoadError"));
  await refetch("schedule");
  expect(screen.getByLabelText(i18n.t("portalComment"))).toBe(comment);
  expect((comment as HTMLTextAreaElement).value).toBe("Unsent question");
  await userEvent.click(within(assignmentDialog).getByRole("button", { name: i18n.t("close") }));
  await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: i18n.t("portalCancel") }));
  expect((comment as HTMLTextAreaElement).value).toBe("Unsent question");
});

it.each(["feedback", "feedback-detail"] as const)("retains the parent assignment draft through a failed %s refresh", async (area) => {
  history.replaceState(null, "", "/parent-module/feedback?review=9");
  mount(<PortalFeedback initialId={9} />);
  const feedbackDialog = await screen.findByRole("dialog", { name: i18n.t("portalFeedback") });
  await openFeedbackAssignment();
  const comment = await screen.findByLabelText(i18n.t("portalComment"));
  await userEvent.type(comment, "Question for teacher");
  mocks[area === "feedback" ? "feedback" : "feedbackDetail"].mockRejectedValueOnce(new PortalApiError(500, "portalLoadError"));
  await refetch(area);
  expect(screen.getByLabelText(i18n.t("portalComment"))).toBe(comment);
  fireEvent.click(within(feedbackDialog).getByRole("button", { name: i18n.t("close"), hidden: true }));
  await screen.findByRole("alertdialog");
  await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: i18n.t("portalCancel") }));
  expect((comment as HTMLTextAreaElement).value).toBe("Question for teacher");
});

it("removes the parent feedback assignment draft after detail access is revoked", async () => {
  history.replaceState(null, "", "/parent-module/feedback?review=9");
  mount(<PortalFeedback initialId={9} />);
  await openFeedbackAssignment();
  await userEvent.type(await screen.findByLabelText(i18n.t("portalComment")), "Private question");
  mocks.feedbackDetail.mockRejectedValueOnce(new PortalApiError(403, "portalUnavailable"));
  await refetch("feedback-detail");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: i18n.t("portalAssignments") })).toBeNull());
  expect(screen.queryByLabelText(i18n.t("portalComment"))).toBeNull();
});
