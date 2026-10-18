// @vitest-environment jsdom
import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render as renderWithoutTheme,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PORTAL_PERMISSIONS,
  type PortalSessionDto,
  type PortalSubjectDto,
} from "../shared/contracts/portal-identity";
import type {
  LmsAssignmentDetailDto,
  LmsDraftDto,
  LmsQuizAttemptDto,
  LmsQuizDto,
  LmsMakeupDto,
} from "../shared/contracts/lms";
import type { PortalProjectDto } from "../shared/contracts/portal-resources";
import { i18n } from "../client/src/lib/i18n";
import { ThemeProvider } from "../client/src/components/ux/ThemeProvider";
import { PortalSelect } from "../client/src/features/portal-app/controls";
import { PortalError } from "../client/src/features/portal-app/ui";
import {
  PortalSessionProvider,
  portalSubjectKey,
  usePortal,
  useSubjectQuery,
} from "../client/src/features/portal-app/context";
import {
  AssignmentContent,
  PortalAssignments,
} from "../client/src/features/lms/assignments";
import { PortalQuizzes, QuizAttempt } from "../client/src/features/lms/quizzes";
import { PortalPortfolio } from "../client/src/features/portal-app/portfolio";
import { PortalPayments } from "../client/src/features/portal-app/payments";
import { PortalApp } from "../client/src/features/portal-app/PortalApp";
import { PortalShell } from "../client/src/features/portal-app/PortalShell";
import { PortalAttendance } from "../client/src/features/lms/attendance";
import { MakeupDialog, PortalMakeup } from "../client/src/features/lms/makeup";
import {
  PortalVideo,
  portalVideoEmbed,
} from "../client/src/features/lms/video";
import { PortalUploads } from "../client/src/features/portal-app/files";
import { PortalCourse } from "../client/src/features/lms/courses";
import {
  ProjectComparison,
  PortalProgress,
} from "../client/src/features/lms/progress";
import {
  HelpDialog,
  PortalHelp,
} from "../client/src/features/lms/communication";
import { FamilyOverview, PortalDay } from "../client/src/features/lms/overview";
import { PortalNotifications } from "../client/src/features/portal-app/notifications";
import {
  portalResourcePage,
  portalResourcesApi,
} from "../client/src/features/portal-app/resources-api";
import { FinanceQuestions } from "../client/src/features/portal-app/finance-questions";
import { PortalProfile } from "../client/src/features/portal-identity/PortalProfile";
import { useAssignmentDraft } from "../client/src/features/lms/useAssignmentDraft";
import {
  PortalApiError,
  portalIdentityApi,
  collectPortalPages,
} from "../client/src/features/portal-app/api";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  draft: vi.fn(),
  submit: vi.fn(),
  withdraw: vi.fn(),
  quizzes: vi.fn(),
  startQuiz: vi.fn(),
  answer: vi.fn(),
  finishQuiz: vi.fn(),
  projects: vi.fn(),
  archiveProject: vi.fn(),
  file: vi.fn(),
  courses: vi.fn(),
  assignment: vi.fn(),
  filePolicy: vi.fn(),
  payments: vi.fn(),
  financeQuestions: vi.fn(),
  askFinance: vi.fn(),
  financeQuestion: vi.fn(),
  schedule: vi.fn(),
  makeup: vi.fn(),
  attempt: vi.fn(),
  notifications: vi.fn(),
  allNotifications: vi.fn(),
  upload: vi.fn(),
  course: vi.fn(),
  projectComparison: vi.fn(),
  saveComparison: vi.fn(),
  createThread: vi.fn(),
  communicationCourses: vi.fn(),
  assignments: vi.fn(),
  progress: vi.fn(),
  achievements: vi.fn(),
  reports: vi.fn(),
  history: vi.fn(),
  feedback: vi.fn(),
  projectsPage: vi.fn(),
  paymentsPage: vi.fn(),
  financeQuestionsPage: vi.fn(),
  sessions: vi.fn(),
  representatives: vi.fn(),
  reauthenticate: vi.fn(),
  childCredentials: vi.fn(),
  consent: vi.fn(),
  dashboard: vi.fn(),
  readNotification: vi.fn(),
  comment: vi.fn(),
  threadComment: vi.fn(),
  thread: vi.fn(),
  threads: vi.fn(),
  saveProject: vi.fn(),
  share: vi.fn(),
  readAnnouncement: vi.fn(),
}));
vi.mock("../client/src/features/portal-app/realtime", () => ({
  usePortalRealtime: vi.fn(),
}));
vi.mock("../client/src/features/portal-app/api", async (importActual) => {
  const actual =
    await importActual<
      typeof import("../client/src/features/portal-app/api")
    >();
  return {
    ...actual,
    portalIdentityApi: {
      ...actual.portalIdentityApi,
      session: mocks.session,
      sessions: mocks.sessions,
      representatives: mocks.representatives,
      reauthenticate: mocks.reauthenticate,
      childCredentials: mocks.childCredentials,
      consent: mocks.consent,
    },
    portalLmsApi: {
      ...actual.portalLmsApi,
      draft: mocks.draft,
      submit: mocks.submit,
      withdraw: mocks.withdraw,
      quizzes: mocks.quizzes,
      startQuiz: mocks.startQuiz,
      answer: mocks.answer,
      finishQuiz: mocks.finishQuiz,
      courses: mocks.courses,
      course: mocks.course,
      createThread: mocks.createThread,
      communicationCourses: mocks.communicationCourses,
      assignments: mocks.assignments,
      progress: mocks.progress,
      achievements: mocks.achievements,
      reports: mocks.reports,
      history: mocks.history,
      feedback: mocks.feedback,
      assignment: mocks.assignment,
      schedule: mocks.schedule,
      makeup: mocks.makeup,
      attempt: mocks.attempt,
      dashboard: mocks.dashboard,
      comment: mocks.comment,
      threadComment: mocks.threadComment,
      thread: mocks.thread,
      threads: mocks.threads,
      readAnnouncement: mocks.readAnnouncement,
    },
  };
});
vi.mock(
  "../client/src/features/portal-app/resources-api",
  async (importActual) => {
    const actual =
      await importActual<
        typeof import("../client/src/features/portal-app/resources-api")
      >();
    return {
      ...actual,
      portalResourcesApi: {
        ...actual.portalResourcesApi,
        projects: mocks.projects,
        archiveProject: mocks.archiveProject,
        file: mocks.file,
        filePolicy: mocks.filePolicy,
        payments: mocks.payments,
        financeQuestions: mocks.financeQuestions,
        askFinance: mocks.askFinance,
        financeQuestion: mocks.financeQuestion,
        notifications: mocks.notifications,
        allNotifications: mocks.allNotifications,
        upload: mocks.upload,
        projectComparison: mocks.projectComparison,
        saveComparison: mocks.saveComparison,
        projectsPage: mocks.projectsPage,
        paymentsPage: mocks.paymentsPage,
        financeQuestionsPage: mocks.financeQuestionsPage,
        readNotification: mocks.readNotification,
        saveProject: mocks.saveProject,
        share: mocks.share,
      },
    };
  },
);
const account = {
  id: 50,
  login: "learner",
  fullName: "Adult learner",
  email: null,
  phone: null,
  locale: "ru" as const,
  status: "active" as const,
};
const own: PortalSubjectDto = {
  linkId: 10,
  studentId: 20,
  studentName: "Learner",
  kind: "self",
  relationship: null,
  permissions: [...PORTAL_PERMISSIONS],
  status: "active",
  studentClassification: "adult",
};
const parent: PortalSubjectDto = {
  ...own,
  kind: "representative",
  relationship: "parent",
  studentClassification: "minor",
};
const draft: LmsDraftDto = {
  version: 0,
  text: "",
  links: [],
  fileIds: [],
  savedAt: null,
};
const detail: LmsAssignmentDetailDto = {
  id: 1,
  recipientId: 1,
  assignmentVersionId: 3,
  runId: 2,
  unitId: null,
  title: "Practice project",
  courseName: "Design course",
  groupName: "Group 1",
  opensAt: "2026-01-01T00:00:00Z",
  dueAt: null,
  closesAt: null,
  required: true,
  status: "assigned",
  overdue: false,
  version: 1,
  body: "Create a project.",
  gradingMode: "acceptance",
  maxScore: null,
  criteria: [],
  allowedAnswers: ["text", "links", "files"],
  fileIds: [],
  draft,
  submissions: [],
  comments: [],
};
const quiz: LmsQuizDto = {
  id: 7,
  recipientId: 7,
  runId: 2,
  title: "Test",
  instructions: "Choose the answer.",
  required: true,
  opensAt: "2026-01-01T00:00:00Z",
  closesAt: null,
  maxAttempts: 3,
  passPercent: 70,
  timerSeconds: null,
  attemptsUsed: 1,
  bestPercent: 80,
  passed: true,
  status: "assigned",
  activeAttemptId: null,
  latestFinishedAttemptId: 30,
};
const attempt: LmsQuizAttemptDto = {
  id: 30,
  recipientId: 7,
  quizVersionId: 1,
  attemptNumber: 1,
  version: 1,
  state: "active",
  startedAt: "2026-01-01T00:00:00Z",
  deadlineAt: null,
  serverTime: "2026-01-01T00:00:00Z",
  finishedAt: null,
  questions: [
    {
      id: "q1",
      text: "Choose an option",
      type: "single",
      weight: 1,
      options: [
        { id: "a", text: "Option A" },
        { id: "b", text: "Option B" },
      ],
    },
  ],
  answers: {},
  score: null,
  totalScore: null,
  percent: null,
  passed: null,
  disclosure: null,
};
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  i18n.setLanguage("ru");
  localStorage.removeItem("academy-crm-theme");
  window.matchMedia = vi.fn().mockImplementation((media: string) => ({
    matches: false,
    media,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  sessionStorage.clear();
  history.replaceState(null, "", "/learn");
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  mocks.session.mockResolvedValue({
    account,
    subjects: [own],
    csrfToken: "test-csrf",
  } satisfies PortalSessionDto);
  mocks.sessions.mockResolvedValue([]);
  mocks.representatives.mockResolvedValue([]);
  mocks.reauthenticate.mockResolvedValue({ success: true });
  mocks.childCredentials.mockResolvedValue({ success: true });
  mocks.consent.mockResolvedValue({ success: true });
  mocks.draft.mockImplementation(
    async (_link: number, _id: number, value: LmsDraftDto) => ({
      ...value,
      version: value.version + 1,
      savedAt: "2026-10-11T09:00:00Z",
    }),
  );
  mocks.submit.mockResolvedValue({ id: 8, attemptNumber: 1 });
  mocks.withdraw.mockResolvedValue({ withdrawn: true });
  mocks.quizzes.mockResolvedValue([quiz]);
  mocks.startQuiz.mockResolvedValue(attempt);
  mocks.attempt.mockResolvedValue(attempt);
  mocks.answer.mockResolvedValue({
    ...attempt,
    version: 2,
    answers: { q1: ["a"] },
  });
  mocks.finishQuiz.mockResolvedValue({
    ...attempt,
    state: "finished",
    percent: 0,
    passed: false,
    version: 2,
  });
  mocks.courses.mockResolvedValue([]);
  mocks.assignments.mockResolvedValue({
    items: [],
    nextCursor: null,
    hasMore: false,
  });
  mocks.progress.mockResolvedValue({
    attendance: { completed: 0, total: 0, percent: null, unmarked: 0 },
    assignments: { completed: 0, total: 0, percent: null },
    quizzes: { completed: 0, total: 0, percent: null },
    materials: { completed: 0, total: 0, percent: null },
  });
  mocks.achievements.mockResolvedValue([]);
  mocks.reports.mockResolvedValue([]);
  mocks.history.mockResolvedValue({
    items: [],
    nextCursor: null,
    hasMore: false,
  });
  mocks.feedback.mockResolvedValue({
    items: [],
    nextCursor: null,
    hasMore: false,
  });
  mocks.schedule.mockResolvedValue([]);
  mocks.makeup.mockResolvedValue([]);
  mocks.assignment.mockResolvedValue(detail);
  mocks.filePolicy.mockResolvedValue({ maxFileMiB: 100, studentQuotaGiB: 2 });
  mocks.payments.mockResolvedValue({
    state: "ready",
    items: [
      {
        id: 88,
        amountUzs: 500000,
        status: "paid",
        method: "card",
        type: "full",
        period: "October",
        paidAt: "2026-10-01T10:00:00Z",
        dueAt: null,
        paidUntil: "2026-11-01T10:00:00Z",
      },
    ],
    summary: {
      paidUzs: 500000,
      dueUzs: 0,
      refundedUzs: 0,
      paidUntil: "2026-11-01T10:00:00Z",
      nextPaymentAt: null,
    },
  });
  mocks.financeQuestions.mockResolvedValue([]);
  mocks.projectsPage.mockImplementation(
    async (link: number, signal: AbortSignal) => ({
      items: await mocks.projects(link, signal),
      nextCursor: null,
    }),
  );
  mocks.paymentsPage.mockImplementation(
    async (link: number, signal: AbortSignal) => ({
      ...(await mocks.payments(link, signal)),
      nextCursor: null,
    }),
  );
  mocks.financeQuestionsPage.mockImplementation(
    async (link: number, signal: AbortSignal) => ({
      items: await mocks.financeQuestions(link, signal),
      nextCursor: null,
    }),
  );
  mocks.notifications.mockResolvedValue({
    items: [],
    nextCursor: null,
    unreadCount: 0,
  });
  mocks.allNotifications.mockResolvedValue({
    items: [],
    nextCursor: null,
    unreadCount: 0,
  });
  mocks.readNotification.mockResolvedValue({ success: true });
  mocks.dashboard.mockResolvedValue({
    nextLesson: null,
    assignments: [],
    makeup: [],
    progress: {
      attendance: { completed: 0, total: 0, percent: null, unmarked: 0 },
      assignments: { completed: 0, total: 0, percent: null },
      quizzes: { completed: 0, total: 0, percent: null },
      materials: { completed: 0, total: 0, percent: null },
    },
    latestAchievement: null,
    announcements: [],
    feedback: [],
  });
  const financeQuestion = {
    id: 99,
    paymentId: 88,
    subject: "Receipt",
    status: "open",
    createdAt: "2026-10-11T09:00:00Z",
    updatedAt: "2026-10-11T09:00:00Z",
    messages: [],
  };
  mocks.askFinance.mockResolvedValue(financeQuestion);
  mocks.financeQuestion.mockResolvedValue(financeQuestion);
  mocks.projects.mockResolvedValue([]);
  mocks.projectComparison.mockResolvedValue(null);
  mocks.communicationCourses.mockResolvedValue([
    { runId: 2, courseName: "Design course", groupName: "Group 1" },
  ]);
  mocks.createThread.mockResolvedValue({ id: 66 });
  mocks.comment.mockResolvedValue({ id: 67 });
  mocks.threadComment.mockResolvedValue({ id: 68 });
  const thread = {
    id: 66,
    runId: 2,
    title: "Practice question",
    audience: "student_teacher",
    status: "open",
    authorAccountId: 50,
    createdAt: "2026-10-11T09:00:00Z",
    comments: [],
  };
  mocks.thread.mockResolvedValue(thread);
  mocks.threads.mockResolvedValue([thread]);
  mocks.saveProject.mockResolvedValue(projectFixture(70, "Saved project"));
  mocks.share.mockResolvedValue({
    id: 99,
    projectId: 70,
    version: 1,
    status: "published",
    publicUrl: null,
  });
  mocks.archiveProject.mockResolvedValue({ success: true });
  mocks.readAnnouncement.mockResolvedValue({ success: true });
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  window.scrollTo = vi.fn();
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function Ready({ children }: { children: ReactNode }) {
  const { account: current } = usePortal();
  return current ? <>{children}</> : null;
}
function render(children: ReactNode) {
  return renderWithoutTheme(children, {
    wrapper: ({ children }) => (
      <ThemeProvider defaultTheme="light">{children}</ThemeProvider>
    ),
  });
}
function mount(children: ReactNode) {
  return render(
    <QueryClientProvider client={client}>
      <PortalSessionProvider>
        <Ready>{children}</Ready>
      </PortalSessionProvider>
    </QueryClientProvider>,
  );
}
function projectFixture(id: number, title: string): PortalProjectDto {
  return {
    id,
    title,
    studentId: 20,
    description: `Current ${title}`,
    runId: 2,
    courseName: "Design course",
    sourceSubmissionId: null,
    links: [],
    files: [],
    coverFileId: null,
    teacherReview: null,
    version: 2,
    createdAt: `2026-10-${id === 70 ? "01" : "10"}T00:00:00Z`,
    updatedAt: "2026-10-11T00:00:00Z",
    archivedAt: null,
    shares: [],
  };
}

it("keeps required course selection invalid until chosen and submits the empty optional filter correctly", async () => {
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  function CourseFilters() {
    const [course, setCourse] = useState("");
    const [filter, setFilter] = useState("2");
    return <form aria-label="Course filters" onSubmit={submit}>
      <PortalSelect name="course" aria-label="Course" required value={course} onValueChange={setCourse} options={[
        { value: "2", label: "Design course" },
      ]} />
      <PortalSelect name="filter" aria-label="Filter" value={filter} onValueChange={setFilter} options={[
        { value: "", label: "All courses" }, { value: "2", label: "Design course" },
      ]} />
    </form>;
  }
  render(<CourseFilters />);
  const form = screen.getByRole("form", { name: "Course filters" }) as HTMLFormElement;
  expect(form.checkValidity()).toBe(false);
  form.requestSubmit();
  expect(submit).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Course" }));
  await userEvent.click(screen.getByRole("combobox", { name: "Course" }));
  await userEvent.click(await screen.findByRole("option", { name: "Design course" }));
  expect(form.checkValidity()).toBe(true);
  expect(new FormData(form).get("course")).toBe("2");
  await userEvent.click(screen.getByRole("combobox", { name: "Filter" }));
  await userEvent.click(await screen.findByRole("option", { name: "All courses" }));
  expect(new FormData(form).get("filter")).toBe("");
});
it("keeps a child's existing dashboard visible while the family overview refreshes", async () => {
  const familyLink: PortalSubjectDto = { ...parent, permissions: ["learning.read"] };
  mocks.session.mockResolvedValue({ account, subjects: [familyLink], csrfToken: "test-csrf" });
  const dashboard = {
    ...await mocks.dashboard(),
    nextLesson: { courseName: "Existing family lesson", scheduledAt: "2026-10-16T12:00:00Z" },
  };
  mocks.dashboard.mockResolvedValue(dashboard);
  mount(<FamilyOverview />);
  await screen.findByText(/Existing family lesson/);
  const initialRequests = mocks.dashboard.mock.calls.length;

  let complete!: (value: typeof dashboard) => void;
  mocks.dashboard.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
  let refresh!: Promise<void>;
  act(() => {
    refresh = client.invalidateQueries({ queryKey: portalSubjectKey(account, familyLink, "dashboard") });
  });
  await waitFor(() => expect(mocks.dashboard).toHaveBeenCalledTimes(initialRequests + 1));
  expect(screen.getByText(/Existing family lesson/)).toBeTruthy();
  expect(screen.queryByRole("status", { name: i18n.t("portalLoading") })).toBeNull();
  await act(async () => {
    complete({ ...dashboard, nextLesson: { ...dashboard.nextLesson, courseName: "Updated family lesson" } });
    await refresh;
  });
  await screen.findByText(/Updated family lesson/);
});
it("does not show a dashboard loader for a family member with only finance access", async () => {
  mocks.session.mockResolvedValue({ account, subjects: [{ ...parent, permissions: ["finance.read"] }], csrfToken: "test-csrf" });
  mount(<FamilyOverview />);
  await screen.findByText((text) => text.startsWith(`${i18n.t("portalDueAmount")}:`));
  expect(mocks.dashboard).not.toHaveBeenCalled();
  expect(screen.queryByRole("status", { name: i18n.t("portalLoading") })).toBeNull();
});
it("names an empty catch-up plan list without claiming that there are no lessons", async () => {
  mount(<PortalMakeup />);
  await screen.findByText(i18n.t("portalNoMakeupPlans"));
  expect(screen.queryByText(i18n.t("portalNoLessons"))).toBeNull();
});
it("shows saved notification switches after closing and reopening settings", async () => {
  const initial = {
    categories: {
      learning: { inApp: true }, schedule: { inApp: true }, feedback: { inApp: true },
      finance: { inApp: true }, family: { inApp: true }, security: { inApp: true },
    },
    weeklySummary: false,
  };
  vi.spyOn(portalResourcesApi, "preferences").mockResolvedValue(initial);
  const save = vi.spyOn(portalResourcesApi, "savePreferences").mockImplementation(async (values) => values);
  mount(<PortalNotifications />);
  await userEvent.click(await screen.findByRole("button", { name: i18n.t("portalNotificationSettings") }));
  let dialog = await screen.findByRole("dialog", { name: i18n.t("portalNotificationSettings") });
  await userEvent.click(await within(dialog).findByRole("switch", { name: i18n.t("portalWeeklySummary") }));
  await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("portalSave") }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ ...initial, weeklySummary: true }));
  await within(dialog).findByText(i18n.t("portalSaved"));
  await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("close") }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.queryByRole("alertdialog")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: i18n.t("portalNotificationSettings") }));
  dialog = await screen.findByRole("dialog", { name: i18n.t("portalNotificationSettings") });
  expect((await within(dialog).findByRole("switch", { name: i18n.t("portalWeeklySummary") })).getAttribute("aria-checked")).toBe("true");
});
it("identifies an overlong invitation password without sending activation", async () => {
  mocks.session.mockResolvedValue({ account: null, subjects: [], csrfToken: "test-csrf" });
  history.replaceState(null, "", "/learn/invite#token=invitation");
  const activate = vi.spyOn(portalIdentityApi, "activate");
  render(<PortalApp />);
  await userEvent.type(await screen.findByLabelText(i18n.t("portalFullName")), "New Learner");
  await userEvent.type(screen.getByLabelText(i18n.t("portalNewPassword")), "a".repeat(73));
  await userEvent.type(screen.getByLabelText(i18n.t("portalConfirmPassword")), "a".repeat(73));
  await userEvent.click(screen.getByRole("button", { name: i18n.t("portalActivate") }));
  expect((await screen.findByRole("alert")).textContent).toBe(i18n.t("portalPasswordTooLong"));
  expect(activate).not.toHaveBeenCalled();
});
it("scopes cached data to account, link, student and effective permissions", () => {
  const key = portalSubjectKey(account, own, "assignment", 1);
  expect(key).not.toEqual(
    portalSubjectKey({ ...account, id: 51 }, own, "assignment", 1),
  );
  expect(key).not.toEqual(
    portalSubjectKey(account, { ...own, linkId: 11 }, "assignment", 1),
  );
  expect(key).not.toEqual(
    portalSubjectKey(
      account,
      { ...own, permissions: ["learning.read"] },
      "assignment",
      1,
    ),
  );
  expect(key).toEqual(
    portalSubjectKey(
      account,
      { ...own, permissions: [...own.permissions].reverse() },
      "assignment",
      1,
    ),
  );
});
it("restores assignment filters after leaving and returning to the list without storing answers", async () => {
  mocks.assignments.mockResolvedValue({
    items: [
      {
        ...detail,
        id: 40,
        recipientId: 40,
        title: "Accepted project",
        status: "accepted",
      },
    ],
    nextCursor: null,
    hasMore: false,
  });
  const first = mount(<PortalAssignments />);
  await userEvent.click(
    await screen.findByRole("tab", { name: i18n.t("portalAccepted") }),
  );
  await userEvent.type(
    screen.getByRole("textbox", { name: i18n.t("portalSearch") }),
    "Accepted",
  );
  await screen.findByText("Accepted project");
  first.unmount();
  mount(<PortalAssignments />);
  await screen.findByText("Accepted project");
  expect(
    (
      screen.getByRole("textbox", {
        name: i18n.t("portalSearch"),
      }) as HTMLInputElement
    ).value,
  ).toBe("Accepted");
  expect(
    screen
      .getByRole("tab", { name: i18n.t("portalAccepted") })
      .getAttribute("aria-selected"),
  ).toBe("true");
  const stored = Object.values(sessionStorage).join(" ");
  expect(stored).not.toContain("Create a project.");
  expect(stored).not.toContain("Saved in another tab");
});
it.each([
  [502, "portalLoadError", "portalLmsLoadError"],
  [0, "portalOffline", "portalLmsOffline"],
  [409, "portalConflict", "portalLmsConflict"],
] as const)("keeps LMS error wording local for status %i and API code %s", (status, code, label) => {
  render(<PortalError error={new PortalApiError(status, code)} retry={vi.fn()} />);
  expect(screen.getByText(i18n.t(label))).toBeTruthy();
  expect(screen.queryByText(code)).toBeNull();
  if (i18n.t(code) !== i18n.t(label)) {
    expect(screen.queryByText(i18n.t(code))).toBeNull();
  }
});

it("collects all backend list pages with the same scope and period filters", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ items: [1, 2], hasMore: true, nextCursor: 2 }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ items: [3], hasMore: false, nextCursor: null }),
      ),
    );
  vi.stubGlobal("fetch", fetch);
  const filter = {
    runId: 4,
    from: "2026-10-01T00:00:00Z",
    to: "2026-11-01T00:00:00Z",
  };
  expect(
    await collectPortalPages<number>(10, "reports", undefined, filter),
  ).toEqual([1, 2, 3]);
  const second = new URL(fetch.mock.calls[1][0], "https://school.example");
  expect(second.pathname).toBe("/api/portal/subjects/10/reports");
  expect(second.searchParams.get("cursor")).toBe("2");
  expect(second.searchParams.get("runId")).toBe("4");
  expect(second.searchParams.get("from")).toBe(filter.from);
});
it("reads canonical resource JSON page metadata independently from headers", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        items: [{ id: 88, title: "Project" }],
        nextCursor: 88,
        hasMore: true,
      }),
      {
        headers: { "X-Next-Cursor": "99" },
      },
    ),
  );
  vi.stubGlobal("fetch", fetch);
  expect(
    await portalResourcePage<{ id: number; title: string }>(
      "/subjects/10/projects",
    ),
  ).toEqual({
    items: [{ id: 88, title: "Project" }],
    nextCursor: 88,
    hasMore: true,
  });
  expect(fetch.mock.calls[0][0]).toBe(
    "/api/portal/subjects/10/projects?limit=30",
  );
});
it.each(
  [
    [{ id: 88 }],
    { items: [], nextCursor: null },
    { items: [], nextCursor: 88, hasMore: false },
    { items: [], nextCursor: null, hasMore: true },
  ].map((body) => [body]),
)(
  "rejects missing or inconsistent resource pagination rather than dropping remaining pages",
  async (body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body))),
    );
    await expect(
      portalResourcePage("/subjects/10/projects"),
    ).rejects.toMatchObject({ status: 502, code: "portalLoadError" });
  },
);
it("preserves payment state and summary when decoding a canonical JSON page", async () => {
  const page = {
    items: [{ id: 88, amountUzs: 100 }],
    nextCursor: 88,
    hasMore: true,
    state: "needs_review",
    summary: null,
  };
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(page)));
  vi.stubGlobal("fetch", fetch);
  const actual = await vi.importActual<
    typeof import("../client/src/features/portal-app/resources-api")
  >("../client/src/features/portal-app/resources-api");
  expect(await actual.portalResourcesApi.paymentsPage(10)).toEqual(page);
  expect(fetch.mock.calls[0][0]).toBe(
    "/api/portal/subjects/10/payments?limit=30",
  );
});
it("uses the notification preferences endpoint for both reads and saves", async () => {
  const preferences = {
    categories: {
      learning: { inApp: true, },
      schedule: { inApp: true, },
      feedback: { inApp: true, },
      finance: { inApp: true, },
      family: { inApp: true, },
      security: { inApp: true, },
    },
    quietFrom: "21:00",
    quietUntil: "08:00",
    weeklySummary: false,
  };
  const fetch = vi
    .fn()
    .mockImplementation(async () => new Response(JSON.stringify(preferences)));
  vi.stubGlobal("fetch", fetch);
  expect(await portalResourcesApi.preferences()).toEqual(preferences);
  expect(await portalResourcesApi.savePreferences(preferences)).toEqual(
    preferences,
  );
  expect(fetch.mock.calls[0][0]).toBe("/api/portal/notifications/preferences");
  expect(fetch.mock.calls[1][0]).toBe("/api/portal/notifications/preferences");
  expect(fetch.mock.calls[1][1].method).toBe("PUT");
});
it("preserves the server upload rejection code instead of replacing it with a generic failure", async () => {
  class RejectedUpload {
    status = 422;
    responseText = JSON.stringify({ code: "portalFileStorageFull" });
    upload = {};
    withCredentials = false;
    timeout = 0;
    onload?: () => void;
    open = vi.fn();
    setRequestHeader = vi.fn();
    send() {
      this.onload?.();
    }
  }
  vi.stubGlobal("XMLHttpRequest", RejectedUpload);
  const actual = await vi.importActual<
    typeof import("../client/src/features/portal-app/resources-api")
  >("../client/src/features/portal-app/resources-api");
  await expect(
    actual.portalResourcesApi.upload(
      10,
      new File(["content"], "work.txt", { type: "text/plain" }),
      vi.fn(),
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ status: 422, code: "portalFileStorageFull" });
});
it("loads older projects from the resource cursor while retaining the recent project cards", async () => {
  mocks.projectsPage
    .mockResolvedValueOnce({
      items: [projectFixture(70, "Recent project")],
      nextCursor: 70,
    })
    .mockResolvedValue({
      items: [projectFixture(69, "Older project")],
      nextCursor: null,
    });
  mount(<PortalPortfolio />);
  await screen.findByText("Recent project");
  await userEvent.click(
    screen.getByRole("button", { name: i18n.t("portalLoadMore") }),
  );
  await screen.findByText("Older project");
  expect(screen.getByText("Recent project")).toBeTruthy();
  expect(mocks.projectsPage).toHaveBeenLastCalledWith(
    10,
    expect.any(AbortSignal),
    70,
  );
});
it("loads older private finance questions using the selected actor’s cursor", async () => {
  const question = {
    id: 102,
    paymentId: null,
    subject: "Recent question",
    status: "open",
    createdAt: "2026-10-11T10:00:00Z",
    updatedAt: "2026-10-11T10:00:00Z",
  };
  mocks.financeQuestionsPage
    .mockResolvedValueOnce({ items: [question], nextCursor: 102 })
    .mockResolvedValue({
      items: [{ ...question, id: 101, subject: "Earlier question" }],
      nextCursor: null,
    });
  mount(<FinanceQuestions />);
  await screen.findByText("Recent question");
  await userEvent.click(
    screen.getByRole("button", { name: i18n.t("portalLoadMore") }),
  );
  await screen.findByText("Earlier question");
  expect(screen.getByText("Recent question")).toBeTruthy();
  expect(mocks.financeQuestionsPage).toHaveBeenLastCalledWith(
    10,
    expect.any(AbortSignal),
    102,
  );
});
it("stops collecting a malformed cursor loop instead of making unbounded requests", async () => {
  const fetch = vi
    .fn()
    .mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ items: [1], hasMore: true, nextCursor: 1 }),
        ),
    );
  vi.stubGlobal("fetch", fetch);
  await expect(
    collectPortalPages<number>(10, "reports"),
  ).rejects.toBeInstanceOf(PortalApiError);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("keeps video sources unloaded until the learner requests playback and rejects deceptive providers", async () => {
  expect(
    portalVideoEmbed("https://youtube.com.evil.example/watch?v=abcdefghijk"),
  ).toBeNull();
  expect(portalVideoEmbed("http://youtu.be/abcdefghijk")).toBeNull();
  render(
    <PortalVideo
      source="https://youtu.be/abcdefghijk?autoplay=1"
      title="Learning video"
    />,
  );
  expect(document.querySelector("iframe")).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: i18n.t("portalPlayVideo") }),
  );
  const video = screen.getByTitle("Learning video") as HTMLIFrameElement;
  expect(video.src).toBe("https://www.youtube-nocookie.com/embed/abcdefghijk");
  expect(video.getAttribute("allow")).not.toContain("autoplay");
});
it("uses the configured school file size limit before starting an upload", async () => {
  mocks.filePolicy.mockResolvedValue({ maxFileMiB: 1, studentQuotaGiB: 2 });
  mount(<PortalUploads ids={[]} onChange={vi.fn()} />);
  const input = await screen.findByLabelText(i18n.t("portalUpload"));
  await waitFor(() => expect(mocks.filePolicy).toHaveBeenCalledOnce());
  await userEvent.upload(
    input,
    new File([new Uint8Array(1024 * 1024 + 1)], "large.png", {
      type: "image/png",
    }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    i18n
      .t("portalInvalidFilesLimit")
      .replace("{count}", "5")
      .replace("{size}", "1"),
  );
  expect(mocks.upload).not.toHaveBeenCalled();
});
it("retries and previews an attached file without submitting its form and confirms removal beside the file", async () => {
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  const change = vi.fn();
  mocks.file.mockRejectedValueOnce(new PortalApiError(0, "portalOffline"))
    .mockResolvedValue({
      id: 82,
      name: "Practice sheet.pdf",
      mime: "application/pdf",
      size: 100,
      state: "ready",
      downloadUrl: "/api/portal/files/82/download?linkId=10",
    });
  mount(<form onSubmit={submit}><PortalUploads ids={[82]} onChange={change} /></form>);
  await userEvent.click(await screen.findByRole("button", { name: i18n.t("portalRetry") }));
  await screen.findByText("Practice sheet.pdf");
  await userEvent.click(screen.getByRole("button", { name: i18n.t("portalOpen") }));
  const preview = await screen.findByRole("dialog", { name: "Practice sheet.pdf" });
  expect(submit).not.toHaveBeenCalled();
  await userEvent.click(within(preview).getByRole("button", { name: i18n.t("close") }));
  await userEvent.click(screen.getByRole("button", { name: `${i18n.t("portalRemove")} Practice sheet.pdf` }));
  expect(change).not.toHaveBeenCalled();
  await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: i18n.t("portalRemove") }));
  expect(change).toHaveBeenCalledWith([]);
  expect(submit).not.toHaveBeenCalled();
});
it("reaches the visible upload action by keyboard and opens its programmatic file picker", async () => {
  mount(<PortalUploads ids={[]} onChange={vi.fn()} />);
  const picker = await screen.findByLabelText(i18n.t("portalUpload"));
  const openPicker = vi.spyOn(picker, "click");
  await userEvent.tab();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: i18n.t("portalUpload") }));
  await userEvent.keyboard("{Enter}");
  expect(openPicker).toHaveBeenCalledOnce();
});
it("ignores dropped attachments while the containing form is disabled for submission", async () => {
  mount(<fieldset disabled><PortalUploads ids={[]} onChange={vi.fn()} /></fieldset>);
  const picker = await screen.findByLabelText(i18n.t("portalUpload"));
  fireEvent.drop(picker.parentElement!, {
    dataTransfer: { files: [new File(["answer"], "answer.pdf", { type: "application/pdf" })] },
  });
  expect(mocks.upload).not.toHaveBeenCalled();
});
it("keeps both concurrent uploads and existing attachments when they finish in one batch", async () => {
  let finishFirst!: (value: { id: number }) => void;
  let finishSecond!: (value: { id: number }) => void;
  mocks.upload
    .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
    .mockImplementationOnce(() => new Promise((resolve) => { finishSecond = resolve; }));
  mocks.file.mockImplementation(async (id: number) => ({
    id, name: `Attachment ${id}.pdf`, mime: "application/pdf", size: 100,
    state: "ready", downloadUrl: `/api/portal/files/${id}/download?linkId=10`,
  }));
  const changed = vi.fn();
  function Attachments() {
    const [ids, setIds] = useState([80]);
    return <PortalUploads ids={ids} onChange={(next) => { changed(next); setIds(next); }} />;
  }
  mount(<Attachments />);
  await userEvent.upload(await screen.findByLabelText(i18n.t("portalUpload")), [
    new File(["first"], "first.pdf", { type: "application/pdf" }),
    new File(["second"], "second.pdf", { type: "application/pdf" }),
  ]);
  await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(2));
  await act(async () => {
    finishFirst({ id: 81 });
    finishSecond({ id: 82 });
  });
  expect(changed).toHaveBeenLastCalledWith([80, 81, 82]);
  await screen.findByText("Attachment 80.pdf");
  await screen.findByText("Attachment 81.pdf");
  await screen.findByText("Attachment 82.pdf");
});
it("saves the learner’s selected comparison with course scope and server version", async () => {
  const first = projectFixture(70, "First project");
  const last = projectFixture(71, "Latest project");
  const saved = {
    firstProjectId: 70,
    latestProjectId: 71,
    runId: 2,
    selectedByName: "Adult learner",
    selectedByRole: "student",
    version: 1,
    updatedAt: "2026-10-11T10:00:00Z",
    firstProject: first,
    latestProject: last,
  };
  mocks.projects.mockResolvedValue([first, last]);
  mocks.projectComparison.mockResolvedValueOnce(null).mockResolvedValue(saved);
  mocks.saveComparison.mockResolvedValue(saved);
  mount(<ProjectComparison />);
  await userEvent.click(
    await screen.findByRole("button", { name: i18n.t("portalEditComparison") }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: i18n.t("portalComparisonSave") }),
  );
  expect(mocks.saveComparison).toHaveBeenCalledWith(10, {
    runId: 2,
    firstProjectId: 70,
    latestProjectId: 71,
    version: 0,
  });
  await screen.findByText(/Adult learner/);
});
it("shows the saved comparison snapshot and author without allowing a representative to replace the projects", async () => {
  mocks.session.mockResolvedValue({
    account,
    subjects: [parent],
    csrfToken: "test-csrf",
  });
  const first = projectFixture(70, "First project");
  const last = projectFixture(71, "Latest project");
  mocks.projects.mockResolvedValue([first, last]);
  mocks.projectComparison.mockResolvedValue({
    firstProjectId: 70,
    latestProjectId: 71,
    runId: 2,
    selectedByName: "Teacher Elena",
    selectedByRole: "teacher",
    version: 3,
    updatedAt: "2026-10-11T10:00:00Z",
    firstProject: { ...first, description: "Saved first snapshot" },
    latestProject: { ...last, description: "Saved latest snapshot" },
  });
  mount(<ProjectComparison />);
  await screen.findByText(/Teacher Elena/);
  expect(screen.getByText("Saved first snapshot")).toBeTruthy();
  expect(screen.queryByText("Current First project")).toBeNull();
  expect(
    screen.queryByRole("combobox", { name: i18n.t("portalFirstWork") }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: i18n.t("portalComparisonSave") }),
  ).toBeNull();
});
it("retries a help request with the same creation key and preserves its question after a lost response", async () => {
  const close = vi.fn();
  mocks.createThread.mockRejectedValueOnce(
    new PortalApiError(0, "portalOffline"),
  );
  mount(<HelpDialog open runId={2} onClose={close} />);
  const question = (await screen.findByLabelText(
    i18n.t("portalQuestionText"),
  )) as HTMLTextAreaElement;
  await userEvent.type(question, "Question about this result");
  await userEvent.click(
    screen.getByRole("button", { name: i18n.t("portalSend") }),
  );
  await screen.findByRole("alert");
  expect(question.value).toBe("Question about this result");
  expect(close).not.toHaveBeenCalled();
  const key = mocks.createThread.mock.calls[0][1].idempotencyKey;
  expect(key).toMatch(/^[0-9a-f-]{36}$/);
  await userEvent.click(
    screen.getByRole("button", { name: i18n.t("portalSend") }),
  );
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(mocks.createThread.mock.calls[1][1].idempotencyKey).toBe(key);
});
it.each(["assignment", "thread"] as const)(
  "retries a %s comment with the same send key and rotates it after confirmed success",
  async (kind) => {
    const action = kind === "assignment" ? mocks.comment : mocks.threadComment;
    action.mockRejectedValueOnce(new PortalApiError(0, "portalOffline"));
    if (kind === "assignment")
      mount(
        <AssignmentContent
          detail={{ ...detail, status: "accepted" }}
          refresh={vi.fn()}
          onClose={vi.fn()}
        />,
      );
    else {
      mount(<PortalHelp />);
      await userEvent.click(
        await screen.findByRole("button", { name: /Practice question/ }),
      );
    }
    const comment = (await screen.findByLabelText(
      i18n.t("portalComment"),
    )) as HTMLTextAreaElement;
    const sendLabel = i18n.t(
      kind === "assignment" ? "portalSendComment" : "portalSend",
    );
    await userEvent.type(comment, "First comment");
    await userEvent.click(screen.getByRole("button", { name: sendLabel }));
    await screen.findByRole("alert");
    expect(comment.value).toBe("First comment");
    const key = action.mock.calls[0][2].idempotencyKey;
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    await userEvent.click(screen.getByRole("button", { name: sendLabel }));
    await waitFor(() => expect(comment.value).toBe(""));
    expect(action.mock.calls[1][2].idempotencyKey).toBe(key);
    await userEvent.type(comment, "Second comment");
    await userEvent.click(screen.getByRole("button", { name: sendLabel }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(3));
    expect(action.mock.calls[2][2].idempotencyKey).not.toBe(key);
  },
);
it("retries project creation with the same key and uses a new key for a new successful creation", async () => {
  mocks.saveProject.mockRejectedValueOnce(
    new PortalApiError(0, "portalOffline"),
  );
  mount(<PortalPortfolio />);
  await userEvent.click(
    await screen.findByRole("button", { name: i18n.t("portalAddProject") }),
  );
  const title = (await screen.findByLabelText(
    i18n.t("portalProjectTitle"),
  )) as HTMLInputElement;
  await userEvent.type(title, "First portfolio project");
  await userEvent.click(
    screen.getByRole("button", { name: i18n.t("portalSave") }),
  );
  await screen.findByRole("alert");
  expect(title.value).toBe("First portfolio project");
  const key = mocks.saveProject.mock.calls[0][1].idempotencyKey;
  expect(key).toMatch(/^[0-9a-f-]{36}$/);
  await userEvent.click(
    screen.getByRole("button", { name: i18n.t("portalSave") }),
  );
  await waitFor(() =>
    expect(screen.queryByLabelText(i18n.t("portalProjectTitle"))).toBeNull(),
  );
  expect(mocks.saveProject.mock.calls[1][1].idempotencyKey).toBe(key);
  await userEvent.click(
    screen.getByRole("button", { name: i18n.t("portalAddProject") }),
  );
  await userEvent.type(
    await screen.findByLabelText(i18n.t("portalProjectTitle")),
    "Second portfolio project",
  );
  await userEvent.click(
    screen.getByRole("button", { name: i18n.t("portalSave") }),
  );
  await waitFor(() => expect(mocks.saveProject).toHaveBeenCalledTimes(3));
  expect(mocks.saveProject.mock.calls[2][1].idempotencyKey).not.toBe(key);
});
it("retains a share creation key and the selected public fields when retrying a lost response", async () => {
  const project = projectFixture(70, "Shareable project");
  mocks.projects.mockResolvedValue([project]);
  mocks.share.mockRejectedValueOnce(new PortalApiError(0, "portalOffline"));
  mount(<PortalPortfolio />);
  await userEvent.click(
    await screen.findByRole("button", { name: i18n.t("portalOpen") }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: i18n.t("portalShare") }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: i18n.t("portalSharePreview") }),
  );
  await userEvent.click(
    screen.getByRole("checkbox", { name: i18n.t("portalConsentDescription") }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: i18n.t("portalPublish") }),
  );
  await screen.findByRole("alert");
  const key = mocks.share.mock.calls[0][2].idempotencyKey;
  expect(key).toMatch(/^[0-9a-f-]{36}$/);
  await userEvent.click(
    screen.getByRole("button", { name: i18n.t("portalPublish") }),
  );
  await waitFor(() => expect(mocks.share).toHaveBeenCalledTimes(2));
  expect(mocks.share.mock.calls[1][2]).toEqual(mocks.share.mock.calls[0][2]);
});
it("selects a paginated own project inside the share dialog and keeps the original publication draft until switching is confirmed", async () => {
  const first = projectFixture(70, "First work");
  const second = { ...projectFixture(50, "Older selected work"), version: 9 };
  const recent = [
    first,
    ...Array.from({ length: 19 }, (_, index) =>
      projectFixture(69 - index, `Recent work ${index + 1}`),
    ),
  ];
  const foreign = { ...projectFixture(48, "Foreign work"), studentId: 999 };
  const archived = {
    ...projectFixture(49, "Archived work"),
    archivedAt: "2026-10-11T12:00:00Z",
  };
  mocks.projectsPage.mockImplementation(
    async (_link: number, _signal: AbortSignal, cursor?: number) =>
      cursor
        ? { items: [second, archived, foreign], nextCursor: null }
        : { items: recent, nextCursor: 51 },
  );
  mocks.share.mockRejectedValueOnce(new PortalApiError(0, "portalOffline"));
  mount(<PortalPortfolio />);
  await userEvent.click(
    (await screen.findAllByRole("button", { name: i18n.t("portalOpen") }))[0],
  );
  await userEvent.click(
    screen.getByRole("button", { name: i18n.t("portalShare") }),
  );
  let dialog = screen.getByRole("dialog", { name: i18n.t("portalShareTitle") });
  await userEvent.click(within(dialog).getByLabelText(i18n.t("portalShareProject")));
  expect(screen.getAllByRole("option")).toHaveLength(20);
  await userEvent.keyboard("{Escape}");
  expect(mocks.projectsPage).toHaveBeenCalledOnce();
  await userEvent.clear(
    within(dialog).getByLabelText(i18n.t("portalDisplayName")),
  );
  await userEvent.type(
    within(dialog).getByLabelText(i18n.t("portalDisplayName")),
    "First alias",
  );
  await userEvent.click(
    within(dialog).getByRole("checkbox", { name: i18n.t("portalDescription") }),
  );
  await userEvent.click(
    within(dialog).getByRole("button", { name: i18n.t("portalSharePreview") }),
  );
  await userEvent.click(
    within(dialog).getByRole("checkbox", {
      name: i18n.t("portalConsentDescription"),
    }),
  );
  await userEvent.click(
    within(dialog).getByRole("button", { name: i18n.t("portalPublish") }),
  );
  await screen.findByRole("alert");
  const originalKey = mocks.share.mock.calls[0][2].idempotencyKey;
  await userEvent.click(
    within(dialog).getByRole("button", { name: i18n.t("portalLoadMore") }),
  );
  await userEvent.click(within(dialog).getByLabelText(i18n.t("portalShareProject")));
  await screen.findByRole("option", { name: "Older selected work" });
  expect(screen.getAllByRole("option")).toHaveLength(21);
  expect(
    screen.queryByRole("option", { name: "Foreign work" }),
  ).toBeNull();
  expect(
    screen.queryByRole("option", { name: "Archived work" }),
  ).toBeNull();
  await userEvent.click(screen.getByRole("option", { name: "Older selected work" }));
  await userEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: i18n.t("portalCancel"),
    }),
  );
  expect(
    within(dialog).getByLabelText(i18n.t("portalShareProject")).textContent,
  ).toBe("First work");
  expect(within(dialog).getByText("First alias")).toBeTruthy();
  expect(mocks.share).toHaveBeenCalledOnce();
  await userEvent.click(within(dialog).getByLabelText(i18n.t("portalShareProject")));
  await userEvent.click(await screen.findByRole("option", { name: "Older selected work" }));
  await userEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: i18n.t("portalLeave"),
    }),
  );
  dialog = screen.getByRole("dialog", { name: i18n.t("portalShareTitle") });
  expect(
    (
      within(dialog).getByLabelText(
        i18n.t("portalDisplayName"),
      ) as HTMLInputElement
    ).value,
  ).toBe(account.fullName);
  await userEvent.click(
    within(dialog).getByRole("button", { name: i18n.t("portalSharePreview") }),
  );
  expect(
    within(dialog).getByText("Older selected work", { selector: "h2" }),
  ).toBeTruthy();
  await userEvent.click(
    within(dialog).getByRole("checkbox", {
      name: i18n.t("portalConsentDescription"),
    }),
  );
  await userEvent.click(
    within(dialog).getByRole("button", { name: i18n.t("portalPublish") }),
  );
  await waitFor(() => expect(mocks.share).toHaveBeenCalledTimes(2));
  expect(mocks.share.mock.calls[1].slice(0, 2)).toEqual([10, 50]);
  expect(mocks.share.mock.calls[1][2]).toMatchObject({
    projectVersion: 9,
    displayName: account.fullName,
    includeDescription: true,
    fileIds: [],
  });
  expect(mocks.share.mock.calls[1][2].idempotencyKey).not.toBe(originalKey);
  expect(mocks.projectsPage.mock.calls.every(([link]) => link === 10)).toBe(
    true,
  );
});
it("keeps representative help private unless the representative explicitly selects the student audience", async () => {
  mocks.session.mockResolvedValue({
    account,
    subjects: [parent],
    csrfToken: "test-csrf",
  });
  mount(<HelpDialog open runId={2} quizAttemptId={30} onClose={vi.fn()} />);
  await userEvent.type(
    await screen.findByLabelText(i18n.t("portalQuestionText")),
    "Question about this result",
  );
  await userEvent.type(
    screen.getByLabelText(i18n.t("portalStepLink")),
    "https://example.org/lesson#step-two",
  );
  await userEvent.click(
    screen.getByRole("button", { name: i18n.t("portalSend") }),
  );
  await waitFor(() => expect(mocks.createThread).toHaveBeenCalledOnce());
  expect(mocks.createThread.mock.calls[0][1]).toEqual(
    expect.objectContaining({
      audience: "representative_teacher",
      shareWithFamily: false,
      quizAttemptId: 30,
      stepUrl: "https://example.org/lesson#step-two",
    }),
  );
  await userEvent.click(screen.getByLabelText(i18n.t("portalAudience")));
  await userEvent.click(await screen.findByRole("option", { name: i18n.t("portalAudienceLearning") }));
  await userEvent.click(
    screen.getByRole("button", { name: i18n.t("portalSend") }),
  );
  await waitFor(() => expect(mocks.createThread).toHaveBeenCalledTimes(2));
  expect(mocks.createThread.mock.calls[1][1]).toEqual(
    expect.objectContaining({
      audience: "student_teacher",
      shareWithFamily: true,
    }),
  );
});
it("shows explicitly previewed upcoming lesson titles without offering unpublished material access", async () => {
  mocks.course.mockResolvedValue({
    id: 2,
    runId: 2,
    enrollmentId: 3,
    groupId: 4,
    groupName: "Group 1",
    courseName: "Design course",
    teacherName: "Teacher",
    status: "active",
    enrolledAt: "2026-10-01T00:00:00Z",
    endedAt: null,
    accessUntil: null,
    progress: { completed: 0, total: 0, percent: null },
    currentUnit: null,
    nextLesson: null,
    units: [
      {
        id: 7,
        title: "Upcoming topic",
        sectionTitle: "First section",
        position: 1,
        required: true,
        status: "soon",
        openAt: "2026-11-01T00:00:00Z",
        materials: [],
      },
    ],
    materials: [],
  });
  mount(<PortalCourse id={2} />);
  await screen.findByText("Upcoming topic");
  expect(screen.getByText(i18n.t("portalUpcoming"))).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Upcoming topic" })).toBeNull();
});
it("does not let a representative submit or withdraw, even with forged submit permissions", async () => {
  mocks.session.mockResolvedValue({
    account,
    subjects: [parent],
    csrfToken: "test-csrf",
  });
  mount(
    <AssignmentContent
      detail={{
        ...detail,
        status: "submitted",
        submissions: [
          {
            id: 8,
            attemptNumber: 1,
            text: "Student answer",
            links: [],
            fileIds: [],
            submittedAt: "2026-10-11T09:00:00Z",
            late: false,
            withdrawnAt: null,
            review: null,
          },
        ],
      }}
      onClose={vi.fn()}
      refresh={vi.fn()}
    />,
  );
  await screen.findByText("Student answer");
  expect(screen.queryByLabelText(i18n.t("portalAnswer"))).toBeNull();
  expect(
    screen.queryByRole("button", { name: i18n.t("portalSubmit") }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: i18n.t("portalWithdraw") }),
  ).toBeNull();
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.withdraw).not.toHaveBeenCalled();
});
it("persists the latest answer before sending an immutable submission", async () => {
  const close = vi.fn();
  mount(
    <AssignmentContent detail={detail} onClose={close} refresh={vi.fn()} />,
  );
  const text = await screen.findByLabelText(i18n.t("portalAnswer"));
  await userEvent.type(text, "My finished project");
  await userEvent.click(
    screen.getByRole("button", { name: i18n.t("portalSubmit") }),
  );
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(mocks.draft).toHaveBeenCalledExactlyOnceWith(10, 1, {
    version: 0,
    text: "My finished project",
    links: [],
    fileIds: [],
  });
  expect(mocks.submit).toHaveBeenCalledWith(
    10,
    1,
    expect.objectContaining({
      text: "My finished project",
      draftVersion: 1,
      assignmentVersionId: 3,
      idempotencyKey: expect.any(String),
    }),
  );
});
it("rejects unsafe links without sending the answer and keeps the typed text", async () => {
  mount(
    <AssignmentContent detail={detail} onClose={vi.fn()} refresh={vi.fn()} />,
  );
  await userEvent.type(
    await screen.findByLabelText(i18n.t("portalAnswer")),
    "Keep this answer",
  );
  await userEvent.type(
    screen.getByLabelText(i18n.t("portalLinks")),
    "http://example.org/work",
  );
  await userEvent.click(
    screen.getByRole("button", { name: i18n.t("portalSubmit") }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    i18n.t("portalInvalidUrl"),
  );
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(
    (screen.getByLabelText(i18n.t("portalAnswer")) as HTMLTextAreaElement)
      .value,
  ).toBe("Keep this answer");
});
it("reuses the same submission idempotency key when retrying a lost response", async () => {
  mocks.submit.mockRejectedValueOnce(new PortalApiError(0, "portalOffline"));
  const close = vi.fn();
  mount(
    <AssignmentContent detail={detail} onClose={close} refresh={vi.fn()} />,
  );
  await userEvent.type(
    await screen.findByLabelText(i18n.t("portalAnswer")),
    "Do not submit twice",
  );
  await userEvent.click(
    screen.getByRole("button", { name: i18n.t("portalSubmit") }),
  );
  await screen.findByRole("alert");
  expect(close).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: i18n.t("portalSubmit") }),
  );
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(mocks.submit).toHaveBeenCalledTimes(2);
  expect(mocks.submit.mock.calls[0]).toEqual(mocks.submit.mock.calls[1]);
  expect(mocks.draft).toHaveBeenCalledOnce();
});
it.each([
  ["monthly", "paymentTypeMonthly"],
  ["installment_1_2", "paymentTypeInstallmentOne"],
  ["installment_2_2", "paymentTypeInstallmentTwo"],
] as const)("displays payment type %s in the portal payment Dialog", async (type, translationKey) => {
  mocks.payments.mockResolvedValue({
    state: "ready",
    items: [{
      id: 88,
      amountUzs: 500000,
      status: "paid",
      method: "card",
      type,
      period: null,
      paidAt: "2026-10-01T10:00:00Z",
      dueAt: null,
      paidUntil: null,
    }],
    summary: null,
  });
  mount(<PortalPayments />);
  await userEvent.click(
    await screen.findByRole("button", { name: i18n.t("portalOpen") }),
  );

  const dialog = screen.getByRole("dialog", { name: i18n.t("portalPaymentDetails") });
  expect(within(dialog).getByText(i18n.t(translationKey))).toBeTruthy();
  expect(within(dialog).queryByText(i18n.t("portalPaymentOtherType"))).toBeNull();
});

it("opens a payment in a Dialog and sends a question with that operation context", async () => {
  mount(<PortalPayments />);
  await userEvent.click(
    await screen.findByRole("button", { name: i18n.t("portalOpen") }),
  );
  const payment = screen.getByRole("dialog");
  expect(payment.textContent).toContain(i18n.t("portalPaymentDetails"));
  expect(payment.textContent).toContain(i18n.t("paymentMethodCard"));
  await userEvent.click(
    within(payment).getByRole("button", {
      name: i18n.t("portalPaymentQuestion"),
    }),
  );
  await userEvent.type(
    await screen.findByLabelText(i18n.t("portalQuestionTitle")),
    "Receipt",
  );
  await userEvent.type(
    screen.getByLabelText(i18n.t("portalQuestionText")),
    "Please send my receipt",
  );
  await userEvent.click(
    screen.getByRole("button", { name: i18n.t("portalSend") }),
  );
  await waitFor(() => expect(mocks.askFinance).toHaveBeenCalledOnce());
  expect(mocks.askFinance).toHaveBeenCalledWith(10, {
    paymentId: 88,
    subject: "Receipt",
    body: "Please send my receipt",
    idempotencyKey: expect.any(String),
  });
});
it("returns focus to the button that opened a controlled payment Dialog", async () => {
  mount(<PortalPayments />);
  const opener = await screen.findByRole("button", {
    name: i18n.t("portalOpen"),
  });
  await userEvent.click(opener);
  const dialog = screen.getByRole("dialog");
  await userEvent.click(
    within(dialog).getByRole("button", { name: i18n.t("close") }),
  );
  await waitFor(() => expect(document.activeElement).toBe(opener));
});
it("requires a named warning before a representative resets child login and rechecks the representative’s password", async () => {
  mocks.session.mockResolvedValue({
    account,
    subjects: [{ ...parent, studentName: "Child learner" }],
    csrfToken: "test-csrf",
  });
  mount(<PortalProfile />);
  await userEvent.click(
    await screen.findByRole("button", {
      name: i18n.t("portalChildCredentials"),
    }),
  );
  const form = screen.getByRole("dialog");
  await userEvent.type(
    within(form).getByLabelText(i18n.t("portalChildLogin")),
    "child.login",
  );
  await userEvent.type(
    within(form).getByLabelText(i18n.t("portalNewPassword")),
    "ChildPassword1!",
  );
  await userEvent.type(
    within(form).getByLabelText(i18n.t("portalVerifyPassword")),
    "ParentPassword1!",
  );
  await userEvent.click(
    within(form).getByRole("button", { name: i18n.t("portalSave") }),
  );
  const warning = screen.getByRole("alertdialog");
  expect(warning.textContent).toContain("Child learner");
  expect(mocks.childCredentials).not.toHaveBeenCalled();
  expect(mocks.reauthenticate).not.toHaveBeenCalled();
  await userEvent.click(
    within(warning).getByRole("button", { name: i18n.t("portalCancel") }),
  );
  expect(mocks.childCredentials).not.toHaveBeenCalled();
  expect(
    (
      within(screen.getByRole("dialog")).getByLabelText(
        i18n.t("portalChildLogin"),
      ) as HTMLInputElement
    ).value,
  ).toBe("child.login");
  await userEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: i18n.t("portalSave"),
    }),
  );
  await userEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: i18n.t("portalSave"),
    }),
  );
  await waitFor(() =>
    expect(mocks.childCredentials).toHaveBeenCalledWith(
      10,
      "child.login",
      "ChildPassword1!",
    ),
  );
  expect(mocks.reauthenticate).toHaveBeenCalledWith("ParentPassword1!");
  expect(mocks.reauthenticate.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.childCredentials.mock.invocationCallOrder[0],
  );
});
it("uses a named AlertDialog before an adult revokes a representative’s access", async () => {
  mocks.representatives.mockResolvedValue([
    {
      linkId: 90,
      fullName: "Representative Elena",
      permissions: ["learning.read", "feedback.read"],
      status: "active",
    },
  ]);
  mount(<PortalProfile />);
  await userEvent.click(
    await screen.findByRole("button", { name: i18n.t("lmsStaffRevoke") }),
  );
  const warning = screen.getByRole("alertdialog");
  expect(warning.textContent).toContain("Representative Elena");
  expect(warning.textContent).toContain(
    i18n.t("portalRevokeAccessDescription"),
  );
  expect(mocks.consent).not.toHaveBeenCalled();
  await userEvent.type(
    within(warning).getByLabelText(i18n.t("portalVerifyPassword")),
    "CurrentPassword1!",
  );
  await userEvent.click(
    within(warning).getByRole("button", { name: i18n.t("lmsStaffRevoke") }),
  );
  await waitFor(() =>
    expect(mocks.consent).toHaveBeenCalledWith(
      90,
      ["learning.read", "feedback.read"],
      false,
    ),
  );
});
it("loads older payment history using the server cursor without replacing the summary or recent payments", async () => {
  const first = await mocks.payments();
  mocks.paymentsPage
    .mockResolvedValueOnce({ ...first, nextCursor: 88 })
    .mockResolvedValue({
      ...first,
      items: [{ ...first.items[0], id: 87, period: "September" }],
      nextCursor: null,
    });
  mount(<PortalPayments />);
  await screen.findAllByText("October");
  await userEvent.click(
    screen.getByRole("button", { name: i18n.t("portalLoadMore") }),
  );
  await screen.findAllByText("September");
  expect(mocks.paymentsPage).toHaveBeenLastCalledWith(
    10,
    expect.any(AbortSignal),
    88,
  );
  const history = within(screen.getByRole("table"));
  expect(history.getByText("October")).toBeTruthy();
  expect(history.getByText("September")).toBeTruthy();
  expect(history.getAllByRole("button", { name: /October|September/ })).toHaveLength(2);
  expect(
    screen.queryByRole("button", { name: i18n.t("portalLoadMore") }),
  ).toBeNull();
});
it("selects the child specified by a finance notification before requesting payment data", async () => {
  const child = {
    ...parent,
    linkId: 11,
    studentId: 21,
    studentName: "Child B",
  };
  mocks.session.mockResolvedValue({
    account,
    subjects: [own, child],
    csrfToken: "test-csrf",
  });
  history.replaceState(null, "", "/learn/payments?linkId=11");
  render(<PortalApp />);
  await screen.findAllByText("October");
  expect(mocks.payments).toHaveBeenCalledWith(11, expect.any(AbortSignal));
  expect(mocks.payments.mock.calls.every(([link]) => link === 11)).toBe(true);
  expect(mocks.financeQuestions.mock.calls.every(([link]) => link === 11)).toBe(
    true,
  );
  const studentModule = document.querySelector('[data-platform-module="student"]')!;
  await userEvent.click(within(studentModule as HTMLElement).getByRole("link", { name: i18n.t("portalPayments") }));
  await waitFor(() =>
    expect(mocks.payments).toHaveBeenLastCalledWith(
      10,
      expect.any(AbortSignal),
    ),
  );
  expect(within(document.querySelector("header")!).queryByText("Learner")).toBeNull();
  expect(window.location.pathname).toBe("/student-module/payments");
});
it("denies a removed child notification without loading the currently selected child data", async () => {
  history.replaceState(null, "", "/learn/payments?linkId=900");
  render(<PortalApp />);
  await screen.findByText(i18n.t("portalUnavailable"));
  expect(mocks.payments).not.toHaveBeenCalled();
  expect(mocks.financeQuestions).not.toHaveBeenCalled();
});
it("opens a new finance question when navigation changes only the query string", async () => {
  history.replaceState(null, "", "/learn/payments?linkId=10");
  render(<PortalApp />);
  await screen.findAllByText("October");
  expect(mocks.financeQuestion).not.toHaveBeenCalled();
  await act(async () => {
    history.pushState(null, "", "/learn/payments?question=99&linkId=10");
  });
  await waitFor(() =>
    expect(mocks.financeQuestion).toHaveBeenCalledWith(
      10,
      99,
      expect.any(AbortSignal),
    ),
  );
  expect(screen.getByRole("dialog").textContent).toContain("Receipt");
});
it("opens a teacher reply in its scoped thread dialog after query-only navigation", async () => {
  history.replaceState(null, "", "/learn/help?linkId=10");
  mocks.thread.mockImplementation(async (_link: number, id: number) => ({
    id,
    runId: 2,
    title: "Requested reply",
    audience: "student_teacher",
    status: "open",
    authorAccountId: 50,
    createdAt: "2026-10-11T09:00:00Z",
    comments: [
      {
        id: 70,
        authorName: "Teacher",
        body: "Reply for this question",
        fileIds: [],
        createdAt: "2026-10-11T09:00:00Z",
      },
    ],
  }));
  render(<PortalApp />);
  await screen.findByRole("button", { name: /Practice question/ });
  expect(mocks.thread).not.toHaveBeenCalled();
  await act(async () => {
    history.pushState(null, "", "/learn/help?thread=72&linkId=10");
  });
  await waitFor(() =>
    expect(mocks.thread).toHaveBeenCalledWith(10, 72, expect.any(AbortSignal)),
  );
  const dialog = await screen.findByRole("dialog");
  expect(dialog.textContent).toContain("Requested reply");
  expect(dialog.textContent).toContain("Reply for this question");
});
it("does not show another conversation when a requested thread is forbidden", async () => {
  history.replaceState(null, "", "/learn/help?thread=900&linkId=10");
  mocks.thread.mockRejectedValue(new PortalApiError(403, "portalForbidden"));
  render(<PortalApp />);
  await screen.findByRole("alert");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("Practice question")).toBeNull();
  expect(mocks.thread).toHaveBeenCalledWith(10, 900, expect.any(AbortSignal));
});
it("keeps announcement attachments and the read action inside its dialog and preserves it after a failed read confirmation", async () => {
  const dashboard = await mocks.dashboard();
  const announcement = {
    id: 81,
    runId: 2,
    title: "Next lesson announcement",
    body: "Bring the practice sheet",
    audience: "all",
    publishAt: "2026-10-11T09:00:00Z",
    pinnedUntil: null,
    fileIds: [82],
    read: false,
  };
  mocks.dashboard.mockResolvedValue({
    ...dashboard,
    announcements: [announcement],
  });
  mocks.file.mockResolvedValue({
    id: 82,
    name: "Practice sheet.pdf",
    mime: "application/pdf",
    size: 100,
    state: "ready",
    downloadUrl: "/api/portal/files/82/download?linkId=10",
  });
  mocks.readAnnouncement
    .mockRejectedValueOnce(new PortalApiError(0, "portalOffline"))
    .mockImplementation(async () => {
      mocks.dashboard.mockResolvedValue({
        ...dashboard,
        announcements: [{ ...announcement, read: true }],
      });
      return { success: true };
    });
  mount(<PortalDay />);
  await userEvent.click(
    await screen.findByRole("button", { name: announcement.title }),
  );
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByText("Practice sheet.pdf");
  expect(dialog.textContent).toContain(announcement.body);
  await userEvent.click(
    within(dialog).getByRole("button", { name: i18n.t("portalMarkRead") }),
  );
  await within(dialog).findByRole("alert");
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(dialog.textContent).toContain("Practice sheet.pdf");
  await userEvent.click(
    within(dialog).getByRole("button", { name: i18n.t("portalMarkRead") }),
  );
  await waitFor(() =>
    expect(
      within(dialog).queryByRole("button", { name: i18n.t("portalMarkRead") }),
    ).toBeNull(),
  );
  expect(mocks.readAnnouncement).toHaveBeenCalledTimes(2);
  expect(mocks.readAnnouncement).toHaveBeenLastCalledWith(10, 81);
});
it.each([
  ["completed", "portalMakeupComplete"],
  ["not_required", "portalMakeupNotRequired"],
] as const)(
  "updates an open makeup dialog to canonical %s after a practice result or attendance correction",
  async (status, label) => {
    const plan: LmsMakeupDto = {
      id: 90,
      runId: 2,
      lessonId: 4,
      topic: "Missed lesson",
      scheduledAt: "2026-10-10T09:00:00Z",
      status: "needed",
      dueAt: null,
      materials: [],
      recipientId: 3,
      quizRecipientId: null,
    };
    mocks.makeup.mockResolvedValue([plan]);
    mount(<MakeupDialog plan={plan} onClose={vi.fn()} />);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(i18n.t("portalMakeupNeeded"));
    mocks.makeup.mockResolvedValue([{ ...plan, status }]);
    await act(async () => {
      await client.invalidateQueries({
        queryKey: portalSubjectKey(account, own, "makeup"),
      });
    });
    await within(dialog).findByText(i18n.t(label));
    expect(within(dialog).queryByText(i18n.t("portalMakeupNeeded"))).toBeNull();
    if (status === "not_required")
      expect(
        within(dialog).queryByText(i18n.t("portalMakeupComplete")),
      ).toBeNull();
  },
);
it("does not present unfiltered progress as a chosen period while a date is missing", async () => {
  mount(<PortalProgress />);
  const from = await screen.findByLabelText(i18n.t("portalPeriodFrom"));
  fireEvent.change(from, { target: { value: "2026-10-01" } });
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toContain(
    i18n.t("portalPeriodInvalid"),
  );
  expect(
    screen.queryByRole("tab", { name: i18n.t("portalGrowth") }),
  ).toBeNull();
  fireEvent.change(screen.getByLabelText(i18n.t("portalPeriodTo")), {
    target: { value: "2026-10-31" },
  });
  await waitFor(() =>
    expect(mocks.progress).toHaveBeenLastCalledWith(
      10,
      expect.any(AbortSignal),
      { from: "2026-09-30T19:00:00.000Z", to: "2026-10-31T19:00:00.000Z" },
    ),
  );
});
it("shows the published report project feedback while protecting the original work for a feedback-only representative", async () => {
  mocks.session.mockResolvedValue({
    account,
    subjects: [{ ...parent, permissions: ["feedback.read"] }],
    csrfToken: "test-csrf",
  });
  mocks.reports.mockResolvedValue([
    {
      id: 55,
      runId: 2,
      periodFrom: "2026-10-01T00:00:00Z",
      periodTo: "2026-11-01T00:00:00Z",
      comment: "Progress report",
      nextSteps: "Next practice",
      version: 1,
      metrics: {
        attendance: { completed: 0, total: 0, percent: null, unmarked: 0 },
        assignments: { completed: 1, total: 2, percent: 50 },
        quizzes: { completed: 0, total: 0, percent: null },
        materials: { completed: 0, total: 0, percent: null },
      },
      publishedAt: "2026-11-01T10:00:00Z",
      authorName: "Teacher Elena",
      bestProjects: [
        {
          id: 70,
          title: "Selected project",
          description: "Private source body",
          fileIds: [99],
          links: ["https://example.org/private-source"],
          review: "Useful teacher feedback",
        },
      ],
    },
  ]);
  mount(<PortalProgress />);
  await userEvent.click(
    await screen.findByRole("tab", { name: i18n.t("portalReports") }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: /Teacher Elena/ }),
  );
  await screen.findByText("Selected project");
  expect(screen.getByText("Useful teacher feedback")).toBeTruthy();
  expect(screen.queryByText("Private source body")).toBeNull();
  expect(
    screen.queryByRole("link", { name: "https://example.org/private-source" }),
  ).toBeNull();
  expect(mocks.file).not.toHaveBeenCalled();
});
it("keeps recent feedback and scoped replies visible beside an urgent assignment", async () => {
  const dashboard = await mocks.dashboard();
  mocks.dashboard.mockResolvedValue({
    ...dashboard,
    assignments: [
      {
        ...detail,
        title: "Urgent revision",
        status: "revision_required",
        overdue: true,
      },
    ],
    feedback: [
      {
        id: 44,
        recipientId: 1,
        submissionId: 8,
        assignmentTitle: "Reviewed project",
        courseName: "Design course",
        groupName: "Group 1",
        decision: "accepted",
        comment: "The layout is clearer now.",
        score: null,
        maxScore: null,
        reviewerName: "Teacher Smith",
        createdAt: "2026-10-11T10:00:00Z",
      },
    ],
  });
  mocks.allNotifications.mockResolvedValue({
    items: [
      {
        id: 33,
        linkId: 10,
        category: "feedback",
        code: "portalNoticeThreadAnswered",
        params: { title: "My practice question" },
        href: "/learn/help?thread=66&linkId=10",
        createdAt: "2026-10-11T10:00:00Z",
        readAt: null,
      },
      {
        id: 34,
        linkId: 11,
        category: "feedback",
        code: "portalNoticeThreadAnswered",
        params: { title: "Other child private question" },
        href: "/learn/help?thread=67&linkId=11",
        createdAt: "2026-10-11T10:00:00Z",
        readAt: null,
      },
    ],
    nextCursor: null,
    unreadCount: 2,
  });
  mount(<PortalDay />);
  await screen.findByRole("heading", { name: "Urgent revision" });
  const section = screen.getByRole("region", {
    name: i18n.t("portalRecentFeedback"),
  });
  expect(section.textContent).toContain("Reviewed project");
  expect(section.textContent).toContain("The layout is clearer now.");
  expect(section.textContent).toContain("My practice question");
  expect(section.textContent).not.toContain("Other child private question");
  await userEvent.click(
    within(section).getByRole("button", { name: /Reviewed project/ }),
  );
  expect(window.location.pathname + window.location.search).toBe(
    "/learn/feedback?review=44&linkId=10",
  );
  await userEvent.click(
    within(section).getByRole("button", { name: /My practice question/ }),
  );
  expect(window.location.pathname + window.location.search).toBe(
    "/student-module/help?thread=66&linkId=10",
  );
  expect(mocks.readNotification).toHaveBeenCalledWith(33, expect.anything());
});
it("does not display dashboard feedback supplied to a representative without feedback access", async () => {
  mocks.session.mockResolvedValue({
    account,
    subjects: [{ ...parent, permissions: ["learning.read"] }],
    csrfToken: "test-csrf",
  });
  const dashboard = await mocks.dashboard();
  mocks.dashboard.mockResolvedValue({
    ...dashboard,
    feedback: [{ id: 44, assignmentTitle: "Private review" }],
  });
  mount(<PortalDay />);
  await screen.findByRole("heading", { name: i18n.t("portalFamilyOverview") });
  expect(screen.queryByText("Private review")).toBeNull();
  expect(
    screen.queryByRole("region", { name: i18n.t("portalRecentFeedback") }),
  ).toBeNull();
});
it("omits a single learner name and context avatar from the platform shell", async () => {
  mocks.session.mockResolvedValue({
    account,
    subjects: [{ ...own, studentName: "Solo Learner" }],
    csrfToken: "test-csrf",
  });
  mount(
    <PortalShell>
      <p>Content</p>
    </PortalShell>,
  );
  await screen.findByText("Content");
  const header = document.querySelector("header")!;
  expect(screen.queryByText("Solo Learner")).toBeNull();
  expect(screen.queryByText("SL")).toBeNull();
  expect(screen.queryByRole("button", { name: "Solo Learner" })).toBeNull();
  expect(within(header).getByRole("button", { name: i18n.t("currentAccount") })).toBeTruthy();
  expect(within(header).queryByRole("menu")).toBeNull();
});
it("keeps the course navigation current while viewing a nested learning route", async () => {
  history.replaceState(null, "", "/learn/courses/2/materials/3");
  const mounted = mount(
    <PortalShell>
      <p>Material content</p>
    </PortalShell>,
  );
  await screen.findByText("Material content");
  const sidebar = within(mounted.container.querySelector<HTMLElement>("[data-platform-sidebar]")!);
  expect(
    sidebar.getByRole("link", { name: i18n.t("portalCourses") })
      .getAttribute("aria-current"),
  ).toBe("page");
  expect(
    sidebar.getByRole("link", { name: i18n.t("portalToday") })
      .getAttribute("aria-current"),
  ).toBeNull();
});
it("changes the portal theme and language using the shared platform controls", async () => {
  mount(
    <PortalShell>
      <p>Content</p>
    </PortalShell>,
  );
  const theme = await screen.findByRole("button", { name: i18n.t("toggleTheme") });
  await userEvent.click(theme);
  await userEvent.click(await screen.findByRole("menuitem", { name: i18n.t("darkTheme") }));
  await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
  expect(localStorage.getItem("academy-crm-theme")).toBe("dark");

  await userEvent.click(screen.getByRole("button", { name: i18n.t("switchLanguage") }));
  await userEvent.click(await screen.findByRole("menuitem", { name: new RegExp(i18n.t("english")) }));
  await waitFor(() => expect(i18n.getCurrentLanguage()).toBe("en"));
  const header = document.querySelector("header")!;
  expect(within(header).getByRole("button", { name: i18n.t("portalNotifications") })).toBeTruthy();
});
it("switches the payment context without repeating either single learner in the header or page toolbar", async () => {
  mocks.session.mockResolvedValue({
    account,
    subjects: [
      { ...own, studentName: "Alice Brown" },
      { ...parent, linkId: 11, studentId: 21, studentName: "Child Cedar" },
    ],
    csrfToken: "test-csrf",
  });
  history.replaceState(null, "", "/learn/payments");
  render(<PortalApp />);
  await waitFor(() => expect(mocks.paymentsPage).toHaveBeenCalledWith(10, expect.any(AbortSignal), undefined));
  const header = document.querySelector("header")!;
  expect(screen.queryByText("Alice Brown")).toBeNull();
  expect(within(header).queryByText("AB")).toBeNull();
  const parentModule = document.querySelector('[data-platform-module="parent"]')!;
  await userEvent.click(within(parentModule as HTMLElement).getByRole("link", { name: i18n.t("portalPayments") }));
  await waitFor(() => expect(mocks.paymentsPage).toHaveBeenCalledWith(11, expect.any(AbortSignal), undefined));
  expect(location.pathname).toBe("/parent-module/payments");
  expect(within(header).queryByText("AB")).toBeNull();
  expect(within(header).queryByText("CC")).toBeNull();
  expect(screen.queryByText("Child Cedar")).toBeNull();
});
it("opens unread notifications in the CRM dropdown and restores focus to the bell", async () => {
  mocks.notifications.mockResolvedValue({
    items: [
      {
        id: 33,
        linkId: 10,
        category: "feedback",
        code: "portalNoticeAssignmentAccepted",
        params: { title: "Reviewed project" },
        href: "/learn/feedback?review=44&linkId=10",
        createdAt: "2026-10-11T10:00:00Z",
        readAt: null,
      },
    ],
    nextCursor: null,
    unreadCount: 1,
  });
  history.replaceState(null, "", "/learn/payments");
  render(<PortalApp />);
  const bell = await screen.findByRole("button", {
    name: i18n.t("unreadNotificationCount").replace("{count}", "1"),
  });
  await waitFor(() => expect(bell.textContent).toContain("1"));
  await userEvent.click(bell);
  const menu = await screen.findByRole("menu");
  expect(menu.textContent).toContain(i18n.t("notifications"));
  expect(menu.textContent).toContain("Reviewed project");
  expect(within(menu).getByRole("menuitem", { name: i18n.t("markAllRead") })).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(document.activeElement).toBe(bell));
});
it("shows an attendance-only parent conducted lessons without counting cancelled or unmarked lessons as absences", async () => {
  mocks.session.mockResolvedValue({
    account,
    subjects: [{ ...parent, permissions: ["attendance.read"] }],
    csrfToken: "test-csrf",
  });
  const lesson = {
    id: 1,
    lessonId: 1,
    runId: 2,
    courseName: "Design course",
    groupName: "Group 1",
    topic: "Practice lesson",
    scheduledAt: "2026-10-05T10:00:00Z",
    endsAt: "2026-10-05T11:00:00Z",
    durationMinutes: 60,
    status: "conducted",
    teacherName: "Teacher",
    schoolName: "Cyberpark",
    roomName: "Room 1",
    format: "offline",
    meetingUrl: null,
    attendance: "present",
    updatedAt: null,
  };
  mocks.schedule.mockResolvedValue([
    lesson,
    {
      ...lesson,
      id: 2,
      lessonId: 2,
      topic: "Missed lesson",
      attendance: "absent",
    },
    {
      ...lesson,
      id: 3,
      lessonId: 3,
      topic: "Unmarked lesson",
      attendance: null,
    },
    {
      ...lesson,
      id: 4,
      lessonId: 4,
      topic: "Cancelled session",
      status: "cancelled",
      attendance: "absent",
    },
  ]);
  mount(<PortalAttendance />);
  await screen.findByText("Practice lesson");
  expect(
    screen
      .getByRole("progressbar", { name: i18n.t("portalAttendance") })
      .getAttribute("aria-valuenow"),
  ).toBe("50");
  expect(screen.queryByText("Cancelled session")).toBeNull();
  expect(screen.getByText("Unmarked lesson")).toBeTruthy();
  expect(mocks.courses).not.toHaveBeenCalled();
  expect(mocks.assignment).not.toHaveBeenCalled();
});
it("requires a warning before withdrawing a submitted answer", async () => {
  mount(
    <AssignmentContent
      detail={{
        ...detail,
        status: "submitted",
        version: 4,
        submissions: [
          {
            id: 8,
            attemptNumber: 1,
            text: "Sent work",
            links: [],
            fileIds: [],
            submittedAt: "2026-10-11T09:00:00Z",
            late: false,
            withdrawnAt: null,
            review: null,
          },
        ],
      }}
      onClose={vi.fn()}
      refresh={vi.fn()}
    />,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: i18n.t("portalWithdraw") }),
  );
  expect(mocks.withdraw).not.toHaveBeenCalled();
  await userEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: i18n.t("portalWithdraw"),
    }),
  );
  await waitFor(() =>
    expect(mocks.withdraw).toHaveBeenCalledExactlyOnceWith(10, 1, 4),
  );
});
it("hides withdrawal once the teacher has started reviewing the submission", async () => {
  mount(
    <AssignmentContent
      detail={{
        ...detail,
        status: "submitted",
        canWithdraw: false,
        reviewStarted: true,
        submissions: [
          {
            id: 8,
            attemptNumber: 1,
            text: "Sent work",
            links: [],
            fileIds: [],
            submittedAt: "2026-10-11T09:00:00Z",
            late: false,
            withdrawnAt: null,
            review: null,
          },
        ],
      }}
      onClose={vi.fn()}
      refresh={vi.fn()}
    />,
  );
  await screen.findByText("Sent work");
  expect(
    screen.queryByRole("button", { name: i18n.t("portalWithdraw") }),
  ).toBeNull();
  expect(mocks.withdraw).not.toHaveBeenCalled();
});
it("shows the immutable attempt rubric and corrected feedback history", async () => {
  const review = {
    id: 90,
    decision: "accepted" as const,
    comment: "Corrected feedback",
    score: 8,
    criterionScores: { original: 8 },
    reviewerName: "Teacher",
    createdAt: "2026-10-11T09:00:00Z",
  };
  mount(
    <AssignmentContent
      detail={{
        ...detail,
        status: "accepted",
        gradingMode: "points",
        maxScore: 100,
        criteria: [{ id: "new", title: "Changed rubric", weight: 100 }],
        submissions: [
          {
            id: 8,
            attemptNumber: 1,
            title: "Original assignment",
            assignmentVersionId: 2,
            gradingMode: "points",
            maxScore: 10,
            criteria: [
              { id: "original", title: "Original criterion", weight: 100 },
            ],
            text: "Sent work",
            links: [],
            fileIds: [],
            submittedAt: "2026-10-11T09:00:00Z",
            late: false,
            withdrawnAt: null,
            review,
            reviewHistory: [
              { ...review, id: 89, comment: "First feedback", score: 7 },
              { ...review, reason: "Corrected calculation" },
            ],
          },
        ],
      }}
      onClose={vi.fn()}
      refresh={vi.fn()}
    />,
  );
  await screen.findByText("Original criterion");
  expect(screen.getByText(`${i18n.t("portalPoints")}: 8 / 10`)).toBeTruthy();
  await userEvent.click(screen.getByText(i18n.t("portalReviewHistory")));
  expect(screen.getByText("First feedback")).toBeTruthy();
  expect(screen.getByText("Corrected calculation")).toBeTruthy();
});
it("shows parent quiz results without a start or resume action", async () => {
  mocks.session.mockResolvedValue({
    account,
    subjects: [parent],
    csrfToken: "test-csrf",
  });
  mount(<PortalQuizzes />);
  await screen.findByText("Test");
  expect(
    screen.queryByRole("button", { name: i18n.t("portalStartTest") }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: i18n.t("portalResumeTest") }),
  ).toBeNull();
  expect(mocks.startQuiz).not.toHaveBeenCalled();
});
it("keeps an unsaved quiz answer visible and prevents finishing until retry succeeds", async () => {
  mocks.answer.mockRejectedValueOnce(new PortalApiError(0, "portalOffline"));
  mount(<QuizAttempt initial={attempt} />);
  await userEvent.click(await screen.findByRole("radio", { name: "Option A" }));
  await screen.findByText(i18n.t("portalLmsOffline"));
  expect((screen.getByLabelText("Option A") as HTMLInputElement).checked).toBe(
    true,
  );
  expect(
    (
      screen.getByRole("button", {
        name: i18n.t("portalFinishTest"),
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await userEvent.click(
    screen.getByRole("button", { name: i18n.t("portalRetry") }),
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: i18n.t("portalFinishTest"),
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  expect(mocks.answer).toHaveBeenCalledWith(10, 30, "q1", {
    version: 1,
    optionIds: ["a"],
  });
});
it("warns about unanswered questions before finishing the quiz", async () => {
  mount(<QuizAttempt initial={attempt} />);
  await userEvent.click(
    await screen.findByRole("button", { name: i18n.t("portalFinishTest") }),
  );
  expect(mocks.finishQuiz).not.toHaveBeenCalled();
  expect(screen.getByRole("alertdialog").textContent).toContain(
    i18n.t("portalUnanswered").replace("{count}", "1"),
  );
  await userEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: i18n.t("portalFinishTest"),
    }),
  );
  await waitFor(() =>
    expect(mocks.finishQuiz).toHaveBeenCalledExactlyOnceWith(10, 30, 1),
  );
});
it("requires confirmation before loading answers changed in another quiz tab", async () => {
  mocks.answer.mockRejectedValueOnce(
    new PortalApiError(409, "lmsVersionConflict"),
  );
  mocks.attempt.mockResolvedValue({
    ...attempt,
    version: 3,
    answers: { q1: ["b"] },
  });
  mount(<QuizAttempt initial={attempt} />);
  await userEvent.click(await screen.findByRole("radio", { name: "Option A" }));
  await userEvent.click(
    await screen.findByRole("button", { name: i18n.t("lmsStaffReload") }),
  );
  expect(mocks.attempt).not.toHaveBeenCalled();
  expect((screen.getByLabelText("Option A") as HTMLInputElement).checked).toBe(
    true,
  );
  await userEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: i18n.t("lmsStaffReload"),
    }),
  );
  await waitFor(() =>
    expect(
      (screen.getByRole("radio", { name: "Option B" }) as HTMLInputElement)
        .checked,
    ).toBe(true),
  );
  await userEvent.click(screen.getByRole("radio", { name: "Option A" }));
  await waitFor(() =>
    expect(mocks.answer).toHaveBeenLastCalledWith(10, 30, "q1", {
      version: 3,
      optionIds: ["a"],
    }),
  );
});
it("preserves a conflicting assignment answer until the learner confirms reloading", async () => {
  mocks.draft.mockRejectedValueOnce(
    new PortalApiError(409, "lmsVersionConflict"),
  );
  mocks.assignment.mockResolvedValue({
    ...detail,
    draft: { ...draft, version: 5, text: "Saved in another tab" },
  });
  mount(
    <AssignmentContent detail={detail} onClose={vi.fn()} refresh={vi.fn()} />,
  );
  await userEvent.type(
    await screen.findByLabelText(i18n.t("portalAnswer")),
    "My unsaved answer",
  );
  await userEvent.click(
    screen.getByRole("button", { name: i18n.t("portalSubmit") }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: i18n.t("lmsStaffReload") }),
  );
  expect(mocks.assignment).not.toHaveBeenCalled();
  expect(
    (screen.getByLabelText(i18n.t("portalAnswer")) as HTMLTextAreaElement)
      .value,
  ).toBe("My unsaved answer");
  await userEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: i18n.t("lmsStaffReload"),
    }),
  );
  await waitFor(() =>
    expect(
      (screen.getByLabelText(i18n.t("portalAnswer")) as HTMLTextAreaElement)
        .value,
    ).toBe("Saved in another tab"),
  );
});
it("requires confirmation before archiving a project", async () => {
  const project: PortalProjectDto = {
    id: 70,
    studentId: 20,
    title: "Portfolio project",
    description: "Description",
    runId: null,
    courseName: null,
    sourceSubmissionId: null,
    links: [],
    files: [],
    coverFileId: null,
    teacherReview: null,
    version: 4,
    createdAt: "2026-10-11T09:00:00Z",
    updatedAt: "2026-10-11T09:00:00Z",
    archivedAt: null,
    shares: [],
  };
  mocks.projects.mockResolvedValue([project]);
  mount(<PortalPortfolio />);
  await userEvent.click(
    await screen.findByRole("button", { name: i18n.t("portalOpen") }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: i18n.t("portalArchiveProject") }),
  );
  expect(mocks.archiveProject).not.toHaveBeenCalled();
  await userEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: i18n.t("portalArchiveProject"),
    }),
  );
  await waitFor(() =>
    expect(mocks.archiveProject).toHaveBeenCalledExactlyOnceWith(10, 70, 4),
  );
});
it("asks before switching a child and never shows the previous child response under the new name", async () => {
  const first = {
    ...parent,
    linkId: 10,
    studentId: 20,
    studentName: "Child A",
  };
  const second = {
    ...parent,
    linkId: 11,
    studentId: 21,
    studentName: "Child B",
  };
  mocks.session.mockResolvedValue({
    account,
    subjects: [first, second],
    csrfToken: "test-csrf",
  });
  const aborted = vi.fn();
  let complete: ((value: string) => void) | undefined;
  const load = vi.fn((link: number, signal: AbortSignal) =>
    link === 10
      ? Promise.resolve("Payment A")
      : new Promise<string>((resolve) => {
          complete = resolve;
          signal.addEventListener("abort", aborted);
        }),
  );
  function Data() {
    const { subject, setUnsaved } = usePortal();
    const [dirty, setDirty] = useState(false);
    const query = useSubjectQuery("payment-private", load);
    return (
      <>
        <span>{subject?.studentName}</span>
        <span>{query.data ?? "Waiting"}</span>
        <button
          onClick={() => {
            setDirty(!dirty);
            setUnsaved(!dirty);
          }}
        >
          Edit answer
        </button>
      </>
    );
  }
  function Switch() {
    const { subject, subjects, selectSubject } = usePortal();
    return (
      <>
        {subjects.map((item) => (
          <button key={item.linkId} onClick={() => selectSubject(item.linkId)}>
            {item.linkId}
          </button>
        ))}
        {subject && <Data key={subject.linkId} />}
      </>
    );
  }
  mount(<Switch />);
  await userEvent.click(await screen.findByRole("button", { name: "10" }));
  await screen.findByText("Payment A");
  await userEvent.click(screen.getByRole("button", { name: "Edit answer" }));
  await userEvent.click(screen.getByRole("button", { name: "11" }));
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  expect(screen.queryByText("Child B")).toBeNull();
  await userEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: i18n.t("portalLeave"),
    }),
  );
  await screen.findByText("Child B");
  expect(screen.queryByText("Payment A")).toBeNull();
  expect(
    client.getQueryData(portalSubjectKey(account, first, "payment-private")),
  ).toBeUndefined();
  await act(async () => {
    complete?.("Payment B");
  });
  await screen.findByText("Payment B");
  expect(aborted).not.toHaveBeenCalled();
});
it("cancels an old child’s pending request and ignores its eventual response after switching", async () => {
  const child = {
    ...parent,
    linkId: 11,
    studentId: 21,
    studentName: "Child B",
  };
  mocks.session.mockResolvedValue({
    account,
    subjects: [own, child],
    csrfToken: "test-csrf",
  });
  const aborted = vi.fn();
  let complete: ((value: string) => void) | undefined;
  const load = vi.fn((link: number, signal: AbortSignal) =>
    link === 10
      ? new Promise<string>((resolve) => {
          complete = resolve;
          signal.addEventListener("abort", aborted);
        })
      : Promise.resolve("Child B payment"),
  );
  function PendingChild() {
    const { subject, selectSubject } = usePortal();
    const query = useSubjectQuery("pending-payment", load);
    return (
      <>
        <span>{subject?.studentName}</span>
        <span>{query.data ?? "Waiting"}</span>
        <button onClick={() => selectSubject(11)}>Select B</button>
      </>
    );
  }
  mount(<PendingChild />);
  await waitFor(() =>
    expect(load).toHaveBeenCalledWith(10, expect.any(AbortSignal)),
  );
  await userEvent.click(screen.getByRole("button", { name: "Select B" }));
  await screen.findByText("Child B payment");
  expect(aborted).toHaveBeenCalledOnce();
  await act(async () => {
    complete?.("Old child payment");
  });
  expect(screen.queryByText("Old child payment")).toBeNull();
  expect(
    client.getQueryData(portalSubjectKey(account, own, "pending-payment")),
  ).toBeUndefined();
});

describe("server assignment drafts", () => {
  it("saves text and previously confirmed files while a new upload is pending", async () => {
    vi.useFakeTimers();
    const initial = { ...draft, fileIds: [7] };
    const hook = renderHook(
      ({ paused }) => useAssignmentDraft(10, 1, initial, paused),
      { initialProps: { paused: true } },
    );
    act(() =>
      hook.result.current.setAnswer({
        text: "Saved while uploading",
        links: [],
        fileIds: [7, 9],
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(mocks.draft).toHaveBeenCalledWith(10, 1, {
      version: 0,
      text: "Saved while uploading",
      links: [],
      fileIds: [7],
    });
    expect(hook.result.current.dirty).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(mocks.draft).toHaveBeenCalledOnce();
    hook.rerender({ paused: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(mocks.draft).toHaveBeenLastCalledWith(10, 1, {
      version: 1,
      text: "Saved while uploading",
      links: [],
      fileIds: [7, 9],
    });
    expect(hook.result.current.dirty).toBe(false);
  });
  it("saves after two seconds and uses the returned version for later edits", async () => {
    vi.useFakeTimers();
    const hook = renderHook(() => useAssignmentDraft(10, 1, draft, false));
    act(() =>
      hook.result.current.setAnswer({
        text: "First answer",
        links: [],
        fileIds: [],
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999);
    });
    expect(mocks.draft).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(hook.result.current.dirty).toBe(false);
    expect(hook.result.current.version).toBe(1);
    act(() =>
      hook.result.current.setAnswer({
        text: "Updated answer",
        links: [],
        fileIds: [],
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(mocks.draft).toHaveBeenLastCalledWith(10, 1, {
      version: 1,
      text: "Updated answer",
      links: [],
      fileIds: [],
    });
  });
  it("preserves the draft after a conflict and does not overwrite it automatically", async () => {
    vi.useFakeTimers();
    mocks.draft.mockRejectedValue(
      new PortalApiError(409, "lmsVersionConflict"),
    );
    const hook = renderHook(() => useAssignmentDraft(10, 1, draft, false));
    act(() =>
      hook.result.current.setAnswer({
        text: "Do not lose this",
        links: [],
        fileIds: [],
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(hook.result.current.answer.text).toBe("Do not lose this");
    expect(hook.result.current.dirty).toBe(true);
    expect(hook.result.current.error).toBeInstanceOf(PortalApiError);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(mocks.draft).toHaveBeenCalledOnce();
  });
});


describe("learning dialogs during background refresh", () => {
  it.each(["assignments", "assignment"] as const)(
    "keeps the assignment comment and discard guard after a failed %s refresh",
    async (area) => {
      mocks.assignments.mockResolvedValue({ items: [detail], nextCursor: null, hasMore: false });
      mount(<PortalAssignments initialId={detail.id} />);
      const comment = await screen.findByLabelText(i18n.t("portalComment"));
      await userEvent.type(comment, "Unsent assignment comment");
      mocks[area].mockRejectedValueOnce(new PortalApiError(500, "portalLoadError"));
      await act(async () => {
        await client.refetchQueries({ queryKey: portalSubjectKey(account, own, area, ...(area === "assignment" ? [detail.id] : [])), exact: true });
      });
      expect(screen.getByLabelText(i18n.t("portalComment"))).toBe(comment);
      expect((comment as HTMLTextAreaElement).value).toBe("Unsent assignment comment");
      await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: i18n.t("close") }));
      expect(await screen.findByRole("alertdialog")).toBeTruthy();
      await userEvent.click(screen.getByRole("button", { name: i18n.t("portalCancel") }));
      await userEvent.click(screen.getByRole("button", { name: i18n.t("portalSendComment") }));
      await waitFor(() => expect(mocks.comment).toHaveBeenCalledWith(10, detail.id, expect.objectContaining({ body: "Unsent assignment comment" })));
    },
  );
  it.each(["assignments", "assignment"] as const)(
    "removes the cached assignment editor after access is denied for %s",
    async (area) => {
      mocks.assignments.mockResolvedValue({ items: [detail], nextCursor: null, hasMore: false });
      mount(<PortalAssignments initialId={detail.id} />);
      const comment = await screen.findByLabelText(i18n.t("portalComment"));
      await userEvent.type(comment, "Private comment");
      mocks[area].mockRejectedValueOnce(new PortalApiError(403, "portalUnavailable"));
      await act(async () => {
        await client.refetchQueries({ queryKey: portalSubjectKey(account, own, area, ...(area === "assignment" ? [detail.id] : [])), exact: true });
      });
      await waitFor(() => expect(screen.queryByLabelText(i18n.t("portalComment"))).toBeNull());
      expect(mocks.comment).not.toHaveBeenCalled();
    },
  );
  it.each(["threads", "thread"] as const)(
    "keeps the reply dialog mounted after a failed %s refresh",
    async (area) => {
      mount(<PortalHelp initialId={66} />);
      const comment = await screen.findByLabelText(i18n.t("portalComment"));
      await userEvent.type(comment, "Unsent reply");
      mocks[area].mockRejectedValueOnce(new PortalApiError(0, "portalOffline"));
      await act(async () => {
        await client.refetchQueries({ queryKey: portalSubjectKey(account, own, area, ...(area === "thread" ? [66] : [])), exact: true });
      });
      expect(screen.getByLabelText(i18n.t("portalComment"))).toBe(comment);
      expect((comment as HTMLTextAreaElement).value).toBe("Unsent reply");
      await userEvent.click(screen.getByRole("button", { name: i18n.t("portalSend") }));
      await waitFor(() => expect(mocks.threadComment).toHaveBeenCalledWith(10, 66, expect.objectContaining({ body: "Unsent reply" })));
    },
  );
});


it("keeps an assignment comment when a teacher changes its status during editing", async () => {
  mocks.assignments.mockResolvedValue({ items: [detail], nextCursor: null, hasMore: false });
  mocks.assignment.mockResolvedValue({ ...detail, status: "submitted" });
  mount(<PortalAssignments initialId={detail.id} />);
  const comment = await screen.findByLabelText(i18n.t("portalComment"));
  await userEvent.type(comment, "Question about this work");
  mocks.assignment.mockResolvedValue({ ...detail, status: "accepted" });
  await act(async () => {
    await client.refetchQueries({ queryKey: portalSubjectKey(account, own, "assignment", detail.id), exact: true });
  });
  expect(screen.getByLabelText(i18n.t("portalComment"))).toBe(comment);
  expect((comment as HTMLTextAreaElement).value).toBe("Question about this work");
});
it("ignores a successful question request after its dialog was replaced", async () => {
  let complete!: (value: { id: number }) => void;
  mocks.createThread.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const close = vi.fn();
  const previous = mount(<HelpDialog open runId={2} onClose={close} />);
  await userEvent.type(await screen.findByLabelText(i18n.t("portalQuestionText")), "First question");
  await userEvent.click(screen.getByRole("button", { name: i18n.t("portalSend") }));
  await waitFor(() => expect(mocks.createThread).toHaveBeenCalledOnce());
  previous.unmount();
  mount(<HelpDialog open runId={2} onClose={close} />);
  const next = await screen.findByLabelText(i18n.t("portalQuestionText"));
  await userEvent.type(next, "Next question");
  await act(async () => { complete({ id: 66 }); });
  expect(close).not.toHaveBeenCalled();
  expect((next as HTMLTextAreaElement).value).toBe("Next question");
  expect(screen.getByRole("dialog")).toBeTruthy();
});
it("opens progress instead of student courses from the parent home", async () => {
  history.replaceState(null, "", "/parent-module");
  mocks.session.mockResolvedValue({ account, subjects: [parent], csrfToken: "test-csrf" });
  const dashboard = await mocks.dashboard();
  mocks.dashboard.mockResolvedValue({ ...dashboard, assignments: [], nextMaterial: { title: "Next student material", runId: 2, publicationId: 3 } });
  mount(<PortalDay />);
  await userEvent.click(await screen.findByRole("button", { name: i18n.t("portalOpen") }));
  expect(window.location.pathname).toBe("/parent-module/progress");
});
it("shows related material names without student study links to a parent", async () => {
  mocks.session.mockResolvedValue({ account, subjects: [parent], csrfToken: "test-csrf" });
  mount(<QuizAttempt initial={{ ...attempt, state: "finished", relatedMaterials: [{ publicationId: 9, runId: 2, title: "Study reference" }] }} />);
  await screen.findByText("Study reference");
  expect(screen.queryByRole("button", { name: "Study reference" })).toBeNull();
});


it("does not replace a newer conversation with a late reply from a closed dialog", async () => {
  const first = { id: 66, runId: 2, title: "First conversation", audience: "student_teacher", status: "open", authorAccountId: 50, createdAt: "2026-10-11T09:00:00Z", comments: [] };
  const next = { ...first, id: 67, title: "Next conversation" };
  mocks.threads.mockResolvedValue([first, next]);
  mocks.thread.mockImplementation(async (_link, id) => id === 66 ? first : next);
  let complete!: (value: { id: number }) => void;
  mocks.threadComment.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  mount(<PortalHelp />);
  await userEvent.click(await screen.findByRole("button", { name: /First conversation/ }));
  await userEvent.type(await screen.findByLabelText(i18n.t("portalComment")), "Pending reply");
  await userEvent.click(screen.getByRole("button", { name: i18n.t("portalSend") }));
  await waitFor(() => expect(mocks.threadComment).toHaveBeenCalledOnce());
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: i18n.t("close") }));
  await userEvent.click(await screen.findByRole("button", { name: i18n.t("portalLeave") }));
  await userEvent.click(await screen.findByRole("button", { name: /Next conversation/ }));
  const reply = await screen.findByLabelText(i18n.t("portalComment"));
  await userEvent.type(reply, "New conversation draft");
  await act(async () => { complete({ id: 68 }); });
  expect(screen.getByRole("dialog", { name: "Next conversation" })).toBeTruthy();
  expect((reply as HTMLTextAreaElement).value).toBe("New conversation draft");
});


it.each(["dashboard", "course", "makeup"] as const)(
  "keeps a nested assignment draft through a failed %s refresh",
  async (area) => {
    mocks.assignments.mockResolvedValue({ items: [detail], nextCursor: null, hasMore: false });
    if (area === "dashboard") {
      const dashboard = await mocks.dashboard();
      mocks.dashboard.mockResolvedValue({ ...dashboard, assignments: [detail] });
      mount(<PortalDay />);
      await userEvent.click((await screen.findAllByRole("button", { name: i18n.t("portalOpen") }))[0]);
    } else if (area === "course") {
      mocks.course.mockResolvedValue({ id: 2, runId: 2, enrollmentId: 3, groupId: 4, groupName: "Group 1", courseName: "Design course", teacherName: "Teacher", status: "active", enrolledAt: "2026-10-01T00:00:00Z", endedAt: null, accessUntil: null, progress: { completed: 0, total: 0, percent: null }, currentUnit: null, nextLesson: null, units: [], materials: [] });
      mount(<PortalCourse id={2} />);
      await userEvent.click(await screen.findByRole("tab", { name: i18n.t("portalAssignments") }));
      await userEvent.click((await screen.findAllByText(detail.title))[0]);
    } else {
      const plan: LmsMakeupDto = { id: 90, runId: 2, lessonId: 4, topic: "Missed lesson", scheduledAt: "2026-10-10T09:00:00Z", status: "needed", dueAt: null, materials: [], recipientId: detail.id, quizRecipientId: null };
      mocks.makeup.mockResolvedValue([plan]);
      mount(<PortalMakeup />);
      await userEvent.click(await screen.findByRole("button", { name: i18n.t("portalOpen") }));
      await userEvent.click(await screen.findByRole("button", { name: i18n.t("portalPractice") }));
    }
    const comment = await screen.findByLabelText(i18n.t("portalComment"));
    await userEvent.type(comment, "Nested draft");
    mocks[area].mockRejectedValueOnce(new PortalApiError(500, "portalLoadError"));
    await act(async () => {
      await client.refetchQueries({ queryKey: portalSubjectKey(account, own, area, ...(area === "course" ? [2] : [])), exact: true });
    });
    expect(screen.getByLabelText(i18n.t("portalComment"))).toBe(comment);
    expect((comment as HTMLTextAreaElement).value).toBe("Nested draft");
  },
);
it("does not close the next assignment after a discarded submission finishes", async () => {
  let complete!: (value: { id: number; attemptNumber: number }) => void;
  mocks.submit.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const close = vi.fn();
  const previous = mount(<AssignmentContent detail={detail} refresh={vi.fn()} onClose={close} />);
  await userEvent.type(await screen.findByLabelText(i18n.t("portalAnswer")), "First answer");
  await userEvent.click(screen.getByRole("button", { name: i18n.t("portalSubmit") }));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
  previous.unmount();
  mount(<AssignmentContent detail={{ ...detail, id: 2 }} refresh={vi.fn()} onClose={close} />);
  const next = await screen.findByLabelText(i18n.t("portalAnswer"));
  await userEvent.type(next, "Next answer");
  await act(async () => { complete({ id: 8, attemptNumber: 1 }); });
  expect(close).not.toHaveBeenCalled();
  expect((next as HTMLTextAreaElement).value).toBe("Next answer");
});


it.each([
  ["/learn/help?thread=66", "/parent-module/help?thread=66&linkId=11"],
  ["/student-module/help?thread=66", "/parent-module/progress"],
] as const)("keeps a parent home notice bound to its trusted child for %s", async (href, destination) => {
  const child = { ...parent, linkId: 11, studentId: 21, studentName: "Child" };
  history.replaceState(null, "", "/parent-module");
  mocks.session.mockResolvedValue({ account, subjects: [own, child], csrfToken: "test-csrf" });
  mocks.allNotifications.mockResolvedValue({ items: [{ id: 801, linkId: 11, category: "feedback", code: "portalNoticeThreadAnswered", params: { title: "Mixed role notice" }, href, readAt: null, createdAt: "2026-10-11T09:00:00Z" }], nextCursor: null, unreadCount: 1 });
  mount(<PortalDay />);
  const notice = await screen.findByRole("button", { name: /Mixed role notice/ });
  expect((notice as HTMLButtonElement).disabled).toBe(href.startsWith("/student-module"));
  await userEvent.click(await screen.findByRole("button", { name: i18n.t("portalOpen") }));
  expect(window.location.pathname + window.location.search).toBe(destination);
});


it("does not refetch account notices when a read request finishes after home unmount", async () => {
  let complete!: (value: { success: boolean }) => void;
  mocks.readNotification.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  mocks.allNotifications.mockResolvedValue({ items: [{ id: 802, linkId: 10, category: "feedback", code: "portalNoticeThreadAnswered", params: { title: "Pending notice" }, href: "/learn/help?thread=66", readAt: null, createdAt: "2026-10-11T09:00:00Z" }], nextCursor: null, unreadCount: 1 });
  const home = mount(<PortalDay />);
  await userEvent.click(await screen.findByRole("button", { name: i18n.t("portalOpen") }));
  await waitFor(() => expect(mocks.readNotification).toHaveBeenCalledOnce());
  home.unmount();
  const requests = mocks.allNotifications.mock.calls.length;
  await act(async () => { complete({ success: true }); });
  expect(mocks.allNotifications).toHaveBeenCalledTimes(requests);
});
