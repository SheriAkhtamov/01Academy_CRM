// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LmsStaffReviewDetailDto,
  LmsStaffSummaryDto,
} from "@shared/contracts/lms";
import { i18n } from "../client/src/lib/i18n";
import { StaffAssignments } from "../client/src/features/lms-staff/assignments";
import { StaffMaterials } from "../client/src/features/lms-staff/materials";
import {
  ReviewContent,
  StaffReviews,
} from "../client/src/features/lms-staff/reviews";
import { LearningText } from "../client/src/features/learning-content/text";
import { StaffResultJournal } from "../client/src/features/lms-staff/result-journal";
import { StaffResults } from "../client/src/features/lms-staff/results";
import { LearningTeacherSummary } from "../client/src/features/lms-staff/teacher-summary";
import { LearningGroupTabs } from "../client/src/features/lms-staff/group-tabs";
import { LearningManagement } from "../client/src/features/lms-staff/management";
let client: QueryClient;
let calls: Array<{ url: string; method: string; body: unknown }>;
const enrollments = [
  {
    id: 1,
    studentId: 1,
    studentName: "Learner",
    status: "active",
    enrolledAt: "2026-01-01T00:00:00Z",
    endedAt: null,
  },
  {
    id: 2,
    studentId: 2,
    studentName: "Other learner",
    status: "active",
    enrolledAt: "2026-01-01T00:00:00Z",
    endedAt: null,
  },
];
const mount = (element: React.ReactNode) =>
  render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
beforeEach(() => {
  i18n.setLanguage("ru");
  calls = [];
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options: RequestInit = {}) => {
      const method = options.method ?? "GET";
      calls.push({
        url,
        method,
        body: options.body ? JSON.parse(String(options.body)) : null,
      });
      return new Response(
        JSON.stringify(method === "GET" ? [] : { id: 1, version: 2 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }),
  );
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
});
describe("staff LMS interaction", () => {
  it("opens the dedicated report workspace directly at results after the group is selected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push({ url, method: "GET", body: null });
        const body = url.includes("/runs?")
          ? [
              {
                groupId: 13,
                groupName: "Assigned group",
                courseName: "Course",
                courseId: 4,
                runId: 3,
              },
            ]
          : url.includes("/enrollments?")
            ? enrollments
            : [];
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    mount(<LearningManagement initialTab="results" />);
    await userEvent.selectOptions(
      await screen.findByLabelText(i18n.t("lmsStaffGroup")),
      "13",
    );
    const results = await screen.findByRole("tab", {
      name: i18n.t("lmsStaffResults"),
    });
    expect(results.getAttribute("aria-selected")).toBe("true");
    await waitFor(() =>
      expect(calls.some((call) => call.url.includes("/results?runId=3"))).toBe(
        true,
      ),
    );
    expect(calls.some((call) => call.url.includes("/materials?"))).toBe(false);
  });
  const reviewRows = [
    {
      submissionId: 1,
      studentName: "Later learner",
      runId: 3,
      groupName: "Group A",
      courseName: "Course A",
      assignmentVersionId: 11,
      title: "Later assignment",
      submittedAt: "2026-10-11T11:00:00Z",
      attemptNumber: 1,
      late: false,
      reviewStartedBy: 1,
      reviewStartedName: "Assigned teacher",
    },
    {
      submissionId: 2,
      studentName: "Earlier learner",
      runId: 3,
      groupName: "Group A",
      courseName: "Course A",
      assignmentVersionId: 12,
      title: "Earlier assignment",
      submittedAt: "2026-10-11T10:00:00Z",
      attemptNumber: 2,
      late: true,
      reviewStartedBy: null,
    },
    {
      submissionId: 3,
      studentName: "Other group learner",
      runId: 4,
      groupName: "Group B",
      courseName: "Course A",
      assignmentVersionId: 13,
      title: "Other group assignment",
      submittedAt: "2026-10-11T09:00:00Z",
      attemptNumber: 1,
      late: false,
      reviewStartedBy: null,
    },
    {
      submissionId: 4,
      studentName: "Other course learner",
      runId: 5,
      groupName: "Group C",
      courseName: "Course B",
      assignmentVersionId: 14,
      title: "Other course assignment",
      submittedAt: "2026-10-11T08:00:00Z",
      attemptNumber: 1,
      late: false,
      reviewStartedBy: null,
    },
  ];
  const queueFetch = () =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push({ url, method: "GET", body: null });
        return new Response(JSON.stringify(reviewRows), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
  it("shows the review DataTable oldest first and narrows it by course, group and assignment", async () => {
    queueFetch();
    mount(<StaffReviews />);
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("row")[1].textContent).toContain(
      "Other course learner",
    );
    expect(within(table).getByText("Assigned teacher")).toBeTruthy();
    expect(calls[0].url).toBe("/api/lms-management/reviews?limit=100");
    await userEvent.selectOptions(
      screen.getByLabelText(i18n.t("course")),
      "Course A",
    );
    expect(within(table).queryByText("Other course learner")).toBeNull();
    await userEvent.selectOptions(
      screen.getByLabelText(i18n.t("lmsStaffGroup")),
      "3",
    );
    expect(within(table).queryByText("Other group learner")).toBeNull();
    await userEvent.selectOptions(
      screen.getByLabelText(i18n.t("lmsStaffAssignments")),
      "12",
    );
    expect(within(table).queryByText("Later learner")).toBeNull();
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(within(table).getByText("Earlier learner")).toBeTruthy();
    expect(within(table).getByText(i18n.t("portalOverdue"))).toBeTruthy();
  });
  it("keeps the filtered review queue as phone cards with explicit open actions", async () => {
    queueFetch();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    mount(<StaffReviews runId={3} />);
    expect(await screen.findByText("Earlier learner")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(
      screen.getAllByRole("button", { name: i18n.t("portalOpen") }),
    ).toHaveLength(4);
    expect(calls[0].url).toBe("/api/lms-management/reviews?runId=3&limit=100");
  });
  it("preserves the existing students content and makes zero requests in a disabled group wrapper", async () => {
    const open = vi.fn();
    mount(
      <LearningGroupTabs groupId={13} enabled={false}>
        <button onClick={open}>Learner modal</button>
      </LearningGroupTabs>,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Learner modal" }),
    );
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(calls).toEqual([]);
  });
  it("opens prepared group learning Tabs inside the existing modal content without a per-group creation step", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: RequestInit = {}) => {
        const method = options.method ?? "GET";
        calls.push({
          url,
          method,
          body: options.body ? JSON.parse(String(options.body)) : null,
        });
        const body =
          method === "POST"
            ? { id: 3 }
            : url.includes("/runs?")
              ? [
                  {
                    groupId: 13,
                    groupName: "Assigned group",
                    courseName: "Course",
                    runId: 3,
                    setupStatus: "ready",
                  },
                ]
              : url.includes("/enrollments?")
                ? enrollments
                : [];
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    mount(
      <LearningGroupTabs groupId={13} enabled>
        <p>Existing students</p>
      </LearningGroupTabs>,
    );
    expect(screen.getByText("Existing students")).toBeTruthy();
    await userEvent.click(
      await screen.findByRole("tab", { name: i18n.t("lmsStaffMaterials") }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls.filter((call) => call.method === "POST")).toEqual([]);
    await screen.findByRole("button", { name: i18n.t("lmsStaffAddMaterial") });
    expect(
      screen.queryByRole("button", { name: i18n.t("lmsStaffCreateRun") }),
    ).toBeNull();
    expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(
      screen.getByRole("tab", { name: i18n.t("lmsStaffStudents") }),
    );
    expect(screen.getByText("Existing students")).toBeTruthy();
  });
  it("makes no LMS homepage request while the employee feature is disabled", () => {
    const { container } = mount(<LearningTeacherSummary enabled={false} />);
    expect(container.textContent).toBe("");
    expect(calls).toEqual([]);
  });
  it("opens filtered teacher counter Dialogs and prepares material for the selected near lesson", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: RequestInit = {}) => {
        calls.push({ url, method: options.method ?? "GET", body: null });
        const body = url.endsWith("/summary")
          ? {
              pendingReviews: 0,
              openHelp: 1,
              unpreparedLessons: 1,
              runs: [
                {
                  runId: 3,
                  courseId: 4,
                  groupName: "Assigned group",
                  canManageSchedule: true,
                  pendingReviews: 0,
                  openHelp: 1,
                  unpreparedLessons: [
                    {
                      lessonId: 7,
                      topic: "Near lesson",
                      scheduledAt: "2026-10-12T10:00:00Z",
                      unitId: 9,
                    },
                  ],
                },
              ],
            }
          : url.includes("/threads?")
            ? [
                {
                  id: 1,
                  title: "Open request",
                  studentName: "Learner",
                  status: "open",
                  createdAt: "2026-10-11T10:00:00Z",
                },
                {
                  id: 2,
                  title: "Closed request",
                  studentName: "Learner",
                  status: "resolved",
                  createdAt: "2026-10-11T10:00:00Z",
                },
              ]
            : url.includes("/enrollments?")
              ? enrollments
              : url.includes("/units?")
                ? [{ id: 9, title: "Selected unit" }]
                : [];
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    mount(<LearningTeacherSummary enabled />);
    await userEvent.click(
      await screen.findByRole("button", {
        name: new RegExp(i18n.t("lmsStaffTeacherOpenHelp")),
      }),
    );
    const requests = await screen.findByRole("dialog", {
      name: i18n.t("lmsStaffTeacherOpenHelp"),
    });
    expect(await within(requests).findByText("Open request")).toBeTruthy();
    expect(within(requests).queryByText("Closed request")).toBeNull();
    expect(
      calls.filter(
        (call) =>
          call.url.includes("/enrollments?") || call.url.includes("/units?"),
      ),
    ).toEqual([]);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await userEvent.click(
      screen.getByRole("button", {
        name: new RegExp(i18n.t("lmsStaffTeacherUnpreparedLessons")),
      }),
    );
    const lessons = await screen.findByRole("dialog", {
      name: i18n.t("lmsStaffTeacherUnpreparedLessons"),
    });
    expect(within(lessons).getByText("Near lesson")).toBeTruthy();
    await userEvent.click(
      within(lessons).getByRole("button", {
        name: i18n.t("lmsStaffAddMaterial"),
      }),
    );
    const material = await screen.findByRole("dialog", {
      name: i18n.t("lmsStaffAddMaterial"),
    });
    await waitFor(() =>
      expect(
        (
          within(material).getByLabelText(
            i18n.t("portalLessons"),
          ) as HTMLSelectElement
        ).value,
      ).toBe("9"),
    );
    expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(2);
  });
  const journalStudents = (): LmsStaffSummaryDto[] => {
    const metric = { completed: 0, total: 0, percent: null };
    return [1, 2, 3].map((studentId) => ({
      runId: 3,
      studentId,
      studentName: `Learner ${studentId}`,
      progress: {
        attendance: { ...metric, unmarked: 0 },
        assignments: metric,
        quizzes: metric,
        materials: metric,
      },
      openHelp: studentId === 3 ? 1 : 0,
      absences: studentId === 3 ? 1 : 0,
      assignmentResults:
        studentId === 3
          ? []
          : [
              {
                id: studentId,
                assignmentId: 7,
                studentId,
                title: "Graded task",
                status: studentId === 1 ? "assigned" : "revision_required",
                submissionId: studentId === 1 ? null : 11,
                score: studentId === 1 ? null : 0,
                maxScore: 10,
                gradingMode: "points",
                dueAt: null,
              },
            ],
      quizResults:
        studentId === 3
          ? []
          : [
              {
                id: studentId,
                quizId: 8,
                studentId,
                title: "Quiz result",
                status: "assigned",
                bestPercent: studentId === 1 ? null : 0,
                passed: false,
                attemptsUsed: studentId === 1 ? 0 : 1,
              },
            ],
    }));
  };
  it("shows an assignment/test journal with distinct empty and zero grades and all four student filters", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    mount(
      <StaffResultJournal students={journalStudents()} onSelect={vi.fn()} />,
    );
    const table = screen.getByRole("table", {
      name: i18n.t("lmsStaffJournal"),
    });
    expect(
      within(table).getByRole("columnheader", { name: /Graded task/ }),
    ).toBeTruthy();
    expect(
      within(table).getByRole("columnheader", { name: /Quiz result/ }),
    ).toBeTruthy();
    expect(within(table).getByText("0 / 10")).toBeTruthy();
    expect(within(table).getByText("0%")).toBeTruthy();
    expect(
      within(table).getAllByText(i18n.t("lmsStaffJournalNoResult")),
    ).toHaveLength(2);
    expect(
      within(table).getAllByText(i18n.t("lmsStaffJournalNotAssigned")),
    ).toHaveLength(2);
    for (const [filter, name] of [
      ["notSubmitted", "Learner 1"],
      ["revision", "Learner 2"],
      ["help", "Learner 3"],
      ["absences", "Learner 3"],
    ]) {
      await userEvent.selectOptions(
        screen.getByLabelText(i18n.t("lmsStaffJournalFilter")),
        filter,
      );
      expect(
        within(table)
          .getAllByRole("button")
          .map((button) => button.textContent),
      ).toEqual([name]);
    }
  });
  it("selects one student on a phone and retains modal student result actions", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(journalStudents()), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    mount(<StaffResults runId={3} />);
    const select = await screen.findByLabelText(i18n.t("student"));
    expect(screen.queryByRole("table")).toBeNull();
    await userEvent.selectOptions(select, "2");
    expect(screen.getByText("0 / 10")).toBeTruthy();
    expect(screen.getByText("0%")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Learner 2" }));
    const dialog = screen.getByRole("dialog", {
      name: i18n.t("lmsStaffResults"),
    });
    expect(
      within(dialog).getByRole("button", {
        name: i18n.t("lmsStaffPublishReport"),
      }),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("button", {
        name: i18n.t("lmsStaffResultHistory"),
      }),
    ).toBeTruthy();
  });
  it("publishes explicit recipients and server dates from the assignment modal", async () => {
    mount(<StaffAssignments runId={3} enrollments={enrollments} />);
    await userEvent.click(
      await screen.findByRole("button", {
        name: i18n.t("lmsStaffAddAssignment"),
      }),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    await userEvent.type(
      screen.getByLabelText(i18n.t("lmsStaffTitleField")),
      "Practice",
    );
    await userEvent.type(
      screen.getByLabelText(i18n.t("lmsStaffBody")),
      "Complete a task",
    );
    await userEvent.click(screen.getByLabelText("Other learner"));
    await userEvent.click(
      screen.getByRole("button", { name: i18n.t("lmsStaffPublish") }),
    );
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.url === "/api/lms-management/assignments" &&
            call.method === "POST",
        ),
      ).toBe(true),
    );
    const call = calls.find(
      (call) =>
        call.url === "/api/lms-management/assignments" &&
        call.method === "POST",
    );
    expect(call?.body).toMatchObject({
      title: "Practice",
      runId: 3,
      recipientEnrollmentIds: [1],
      gradingMode: "acceptance",
      fileIds: [],
    });
    expect((call?.body as { opensAt: string }).opensAt).toMatch(/Z$/);
  });
  it("keeps unsaved authoring content inside the modal until discard confirmation", async () => {
    mount(<StaffAssignments runId={3} enrollments={enrollments} />);
    await userEvent.click(
      await screen.findByRole("button", {
        name: i18n.t("lmsStaffAddAssignment"),
      }),
    );
    await userEvent.type(
      screen.getByLabelText(i18n.t("lmsStaffTitleField")),
      "Unsaved title",
    );
    await userEvent.keyboard("{Escape}");
    const confirmation = await screen.findByRole("alertdialog");
    expect(
      within(confirmation).getByText(i18n.t("portalUnsavedDescription")),
    ).toBeTruthy();
    await userEvent.click(
      within(confirmation).getByRole("button", {
        name: i18n.t("lmsStaffCancel"),
      }),
    );
    expect(
      (screen.getByLabelText(i18n.t("lmsStaffTitleField")) as HTMLInputElement)
        .value,
    ).toBe("Unsaved title");
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });
  it("requires confirmation before withdrawing published material", async () => {
    vi.mocked(fetch).mockImplementation(async (url, options = {}) => {
      const method = options.method ?? "GET";
      calls.push({ url: String(url), method, body: null });
      return new Response(
        JSON.stringify(
          method === "GET"
            ? [
                {
                  id: 7,
                  runId: 3,
                  unitId: null,
                  state: "published",
                  materialVersionId: 8,
                  version: 1,
                  title: "Material",
                  body: "Content",
                  category: "lesson",
                  links: [],
                  fileIds: [],
                  publishAt: "2026-10-11T10:00:00Z",
                },
              ]
            : {},
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    mount(<StaffMaterials runId={3} enrollments={enrollments} />);
    await userEvent.click(
      await screen.findByRole("button", {
        name: i18n.t("lmsStaffArchiveMaterial"),
      }),
    );
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
    const confirmation = screen.getByRole("alertdialog");
    await userEvent.click(
      within(confirmation).getByRole("button", {
        name: i18n.t("lmsStaffArchiveMaterial"),
      }),
    );
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.url === "/api/lms-management/materials/7/archive" &&
            call.method === "POST",
        ),
      ).toBe(true),
    );
  });
  it("requires revision feedback and preserves the comment on review conflict", async () => {
    vi.mocked(fetch).mockImplementation(async (url, options = {}) => {
      const method = options.method ?? "GET";
      calls.push({
        url: String(url),
        method,
        body: options.body ? JSON.parse(String(options.body)) : null,
      });
      const conflict = String(url).endsWith("/decision");
      return new Response(
        JSON.stringify(
          conflict ? { code: "lmsVersionConflict" } : { version: 2 },
        ),
        {
          status: conflict ? 409 : 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });
    const detail: LmsStaffReviewDetailDto = {
      id: 1,
      recipientId: 1,
      assignmentVersionId: 2,
      runId: 3,
      unitId: null,
      title: "Work",
      courseName: "Course",
      groupName: "Group",
      opensAt: "2026-01-01T00:00:00Z",
      dueAt: null,
      closesAt: null,
      required: true,
      status: "submitted",
      overdue: false,
      version: 1,
      body: "Task",
      gradingMode: "acceptance",
      maxScore: null,
      criteria: [],
      allowedAnswers: ["text"],
      fileIds: [],
      draft: { version: 0, text: "", links: [], fileIds: [], savedAt: null },
      submissions: [
        {
          id: 4,
          attemptNumber: 1,
          text: "Answer",
          links: [],
          fileIds: [],
          submittedAt: "2026-10-11T10:00:00Z",
          late: false,
          withdrawnAt: null,
          review: null,
        },
      ],
      comments: [],
      studentId: 1,
      studentName: "Learner",
      submissionId: 4,
      reviewStartedBy: null,
    };
    mount(
      <ReviewContent
        detail={detail}
        onClose={vi.fn()}
        onNext={vi.fn()}
        onDirtyChange={vi.fn()}
        reload={vi.fn()}
      />,
    );
    await userEvent.click(
      screen.getByRole("tab", { name: i18n.t("lmsStaffGradingMode") }),
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: i18n.t("lmsStaffReturn") })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    await userEvent.click(
      screen.getByRole("button", { name: i18n.t("lmsStaffReturn") }),
    );
    expect(screen.getByText(i18n.t("lmsStaffReviewRequired"))).toBeTruthy();
    expect(calls.filter((call) => call.url.endsWith("/decision"))).toHaveLength(
      0,
    );
    await userEvent.type(
      screen.getByLabelText(i18n.t("lmsStaffComment")),
      "Please improve the result",
    );
    await userEvent.click(
      screen.getByRole("button", { name: i18n.t("lmsStaffReturn") }),
    );
    await screen.findByText(i18n.t("lmsVersionConflict"));
    expect(
      (screen.getByLabelText(i18n.t("lmsStaffComment")) as HTMLTextAreaElement)
        .value,
    ).toBe("Please improve the result");
    expect(
      calls.find((call) => call.url.endsWith("/decision"))?.body,
    ).toMatchObject({
      version: 2,
      decision: "revision_required",
      comment: "Please improve the result",
    });
  });
  it("renders code and HTML as text and permits only safe authored links", () => {
    mount(
      <LearningText
        text={
          "# Topic\n**Bold**\n- Item\n```\n<script>alert(1)</script>\n```\n[Good](https://academy.example/lesson)\n[Bad](https://user:password@academy.example)"
        }
      />,
    );
    expect(screen.getByRole("heading", { name: "Topic" })).toBeTruthy();
    expect(screen.getByText("<script>alert(1)</script>")).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: "Good" }).getAttribute("href"),
    ).toBe("https://academy.example/lesson");
  });
});
