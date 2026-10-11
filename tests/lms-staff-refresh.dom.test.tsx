// @vitest-environment jsdom
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LmsReviewQueueDto,
  LmsStaffReviewDetailDto,
  LmsStaffRunDto,
  LmsStaffSummaryDto,
} from "@shared/contracts/lms";
import type {
  PortalProjectComparisonDto,
  PortalProjectDto,
} from "@shared/contracts/portal-resources";
import { i18n } from "../client/src/lib/i18n";
import {
  lmsStaffApi,
  LmsStaffApiError,
} from "../client/src/features/lms-staff/api";
import {
  useStaffQuery,
  useStaffRuns,
} from "../client/src/features/lms-staff/queries";
import {
  ReviewSheet,
  StaffReviews,
} from "../client/src/features/lms-staff/reviews";
import { StaffComparison } from "../client/src/features/lms-staff/comparison";
import { LearningGroupTabs } from "../client/src/features/lms-staff/group-tabs";

let client: QueryClient;
let visible = true;
const mount = (content: React.ReactNode) =>
  render(<QueryClientProvider client={client}>{content}</QueryClientProvider>);
const advance = async (milliseconds: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
};
const reviewRow: LmsReviewQueueDto = {
  id: 1,
  recipientId: 1,
  studentId: 1,
  unitId: null,
  opensAt: "2026-10-11T10:00:00Z",
  dueAt: null,
  closesAt: null,
  required: true,
  status: "submitted",
  overdue: false,
  version: 1,
  submissionId: 9,
  studentName: "Separate producer learner",
  runId: 3,
  groupName: "Group A",
  courseName: "Course A",
  assignmentVersionId: 11,
  title: "New submitted work",
  submittedAt: "2026-10-12T10:00:00Z",
  attemptNumber: 1,
  late: false,
  reviewStartedBy: null,
};
const reviewDetail = (): LmsStaffReviewDetailDto => ({
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
  gradingMode: "points",
  maxScore: 10,
  criteria: [{ id: "craft", title: "Craft", weight: 100 }],
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
});
const metric = { completed: 0, total: 0, percent: null };
const student: LmsStaffSummaryDto = {
  runId: 3,
  studentId: 1,
  studentName: "Learner",
  progress: {
    attendance: { ...metric, unmarked: 0 },
    assignments: metric,
    quizzes: metric,
    materials: metric,
  },
  openHelp: 0,
  absences: 0,
  assignmentResults: [],
  quizResults: [],
};
const projects = [1, 2, 3].map(
  (id) =>
    ({
      id,
      studentId: 1,
      courseName: "Course",
      coverFileId: null,
      version: 1,
      archivedAt: null,
      shares: [],
      runId: 3,
      title: `Project ${id}`,
      description: `Description ${id}`,
      links: [],
      files: [],
      teacherReview: null,
      sourceSubmissionId: null,
      createdAt: "2026-10-11T10:00:00Z",
      updatedAt: "2026-10-11T10:00:00Z",
    }) satisfies PortalProjectDto,
);
const comparison = (version = 1): PortalProjectComparisonDto => ({
  firstProjectId: 1,
  latestProjectId: 3,
  runId: 3,
  selectedByName: "Teacher",
  selectedByRole: "teacher",
  version,
  updatedAt: "2026-10-11T10:00:00Z",
  firstProject: projects[0],
  latestProject: projects[2],
});

beforeEach(() => {
  i18n.setLanguage("ru");
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  visible = true;
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (visible ? "visible" : "hidden"),
  });
  focusManager.setFocused(undefined);
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
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("Unexpected network request"))),
  );
});
afterEach(async () => {
  cleanup();
  client.clear();
  vi.useRealTimers();
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  visible = true;
  focusManager.setFocused(undefined);
});

describe("staff refresh without a shared process event", () => {
  it("refreshes a mounted review queue at 30 seconds without invalidation or window focus", async () => {
    let rows: LmsReviewQueueDto[] = [];
    const load = vi
      .spyOn(lmsStaffApi, "reviews")
      .mockImplementation(async () => rows);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    mount(<StaffReviews />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    rows = [reviewRow];
    await advance(29_999);
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(reviewRow.studentName)).toBeNull();
    await advance(1);
    expect(await screen.findByText(reviewRow.studentName)).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("refreshes mounted run choices when another process creates a run", async () => {
    let runs: (LmsStaffRunDto & { courseId: number })[] = [];
    const load = vi
      .spyOn(lmsStaffApi, "runs")
      .mockImplementation(async () => runs);
    function Runs() {
      const query = useStaffRuns();
      return (
        <output>{query.data?.map((run) => run.groupName).join(",")}</output>
      );
    }
    mount(<Runs />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    runs = [
      {
        groupId: 4,
        groupName: "New run group",
        courseId: 5,
        courseName: "Course",
        teacherName: null,
        status: "active",
        studentCount: 1,
        courseVersionId: 7,
        runId: 6,
        format: "online",
        meetingUrl: null,
        version: 1,
        permissions: [],
      },
    ];
    await advance(30_000);
    expect(await screen.findByText("New run group")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not poll a hidden page and stops when its view unmounts", async () => {
    let rows: LmsReviewQueueDto[] = [];
    const load = vi
      .spyOn(lmsStaffApi, "reviews")
      .mockImplementation(async () => rows);
    const view = mount(<StaffReviews />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    rows = [reviewRow];
    visible = false;
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await advance(90_000);
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(reviewRow.studentName)).toBeNull();
    view.unmount();
    visible = true;
    await advance(90_000);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("makes no requests for a disabled query or a feature that is switched off", async () => {
    const disabledLoad = vi.fn(async () => []);
    const runs = vi.spyOn(lmsStaffApi, "runs");
    function Disabled() {
      useStaffQuery("disabled", null, disabledLoad);
      return null;
    }
    mount(
      <>
        <Disabled />
        <LearningGroupTabs enabled={false} groupId={13}>
          <span>Existing students</span>
        </LearningGroupTabs>
      </>,
    );
    expect(screen.getByText("Existing students")).toBeTruthy();
    await advance(120_000);
    expect(disabledLoad).not.toHaveBeenCalled();
    expect(runs).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves a dirty review Sheet and its started version while a producer update arrives and a decision is pending", async () => {
    let detail = reviewDetail();
    const load = vi
      .spyOn(lmsStaffApi, "review")
      .mockImplementation(async () => detail);
    vi.spyOn(lmsStaffApi, "startReview").mockResolvedValue({
      version: 2,
      reviewStartedBy: 11,
    });
    let rejectDecision!: (error: Error) => void;
    const decision = vi.spyOn(lmsStaffApi, "decision").mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectDecision = reject;
        }),
    );
    mount(<ReviewSheet id={4} onClose={vi.fn()} onNext={vi.fn()} />);
    const sheet = await screen.findByRole("dialog", { name: "Learner" });
    const comment = await screen.findByLabelText(i18n.t("lmsStaffComment"), {
      selector: "#review-comment",
    });
    const score = screen.getByLabelText(i18n.t("lmsStaffScore"));
    await userEvent.type(comment, "Preserved review draft");
    await userEvent.type(score, "7");
    detail = {
      ...detail,
      version: 8,
      comments: [
        {
          id: 9,
          body: "Producer comment",
          fileIds: [],
          audience: "family_teacher",
          createdAt: "2026-10-12T11:00:00Z",
          authorName: "Teacher",
        },
      ],
    };
    await advance(30_000);
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("dialog", { name: "Learner" })).toBe(sheet);
    expect((comment as HTMLTextAreaElement).value).toBe(
      "Preserved review draft",
    );
    expect((score as HTMLInputElement).value).toBe("7");
    await userEvent.click(
      screen.getByRole("button", { name: i18n.t("lmsStaffAccept") }),
    );
    expect(decision).toHaveBeenCalledWith(
      4,
      expect.objectContaining({
        version: 2,
        comment: "Preserved review draft",
        criterionScores: { craft: 7 },
      }),
    );
    detail = { ...detail, version: 9 };
    await advance(30_000);
    expect((comment as HTMLTextAreaElement).value).toBe(
      "Preserved review draft",
    );
    expect((score as HTMLInputElement).value).toBe("7");
    expect(
      screen
        .getByRole("button", { name: i18n.t("lmsStaffAccept") })
        .hasAttribute("disabled"),
    ).toBe(true);
    await act(async () =>
      rejectDecision(new LmsStaffApiError(409, "lmsVersionConflict")),
    );
    expect(await screen.findByText(i18n.t("lmsVersionConflict"))).toBeTruthy();
    expect((comment as HTMLTextAreaElement).value).toBe(
      "Preserved review draft",
    );
    expect(screen.getByRole("dialog", { name: "Learner" })).toBe(sheet);
  });

  it("keeps project comparison selections bound to the version opened before a producer update", async () => {
    let selected = comparison(1);
    vi.spyOn(lmsStaffApi, "projects").mockResolvedValue(projects);
    const load = vi
      .spyOn(lmsStaffApi, "comparison")
      .mockImplementation(async () => selected);
    const save = vi
      .spyOn(lmsStaffApi, "saveComparison")
      .mockRejectedValue(new LmsStaffApiError(409, "portalVersionConflict"));
    mount(<StaffComparison student={student} onClose={vi.fn()} />);
    const first = await screen.findByLabelText(i18n.t("portalFirstWork"));
    await userEvent.selectOptions(first, "2");
    selected = { ...comparison(8), firstProjectId: 3, latestProjectId: 1 };
    await advance(30_000);
    expect(load).toHaveBeenCalledTimes(2);
    expect((first as HTMLSelectElement).value).toBe("2");
    await userEvent.click(
      screen.getByRole("button", { name: i18n.t("portalComparisonSave") }),
    );
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        firstProjectId: 2,
        latestProjectId: 3,
        version: 1,
      }),
    );
    expect((first as HTMLSelectElement).value).toBe("2");
    expect(
      screen.getByRole("dialog", { name: i18n.t("portalComparison") }),
    ).toBeTruthy();
  });
});
