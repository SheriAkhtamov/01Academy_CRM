// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LmsStaffAssignmentDetailDto,
  LmsStaffRunDto,
} from "@shared/contracts/lms";
import { i18n } from "../client/src/lib/i18n";
import { StaffAssignments } from "../client/src/features/lms-staff/assignments";
import { LearningManagement } from "../client/src/features/lms-staff/management";
import { LearningGroupTabs } from "../client/src/features/lms-staff/group-tabs";
const enrollments = [
  {
    id: 1,
    studentId: 1,
    studentName: "Learner",
    status: "active",
    enrolledAt: "2026-10-01T00:00:00Z",
    endedAt: null,
  },
];
const detail = (accepted = true): LmsStaffAssignmentDetailDto => ({
  id: 7,
  runId: 3,
  unitId: null,
  assignmentVersionId: 8,
  title: "Practice",
  body: "Task",
  required: true,
  opensAt: "2026-10-01T00:00:00Z",
  dueAt: "2026-10-15T00:00:00Z",
  recipientCount: 1,
  acceptedCount: accepted ? 1 : 0,
  submittedCount: accepted ? 0 : 1,
  revisionCount: 0,
  gradingMode: "acceptance",
  maxScore: null,
  criteria: [],
  allowedAnswers: ["text"],
  fileIds: [],
  recipients: [
    {
      id: 9,
      studentId: 1,
      studentName: "Learner",
      enrollmentId: 1,
      status: accepted ? "accepted" : "submitted",
      latestSubmissionId: 12,
      opensAt: "2026-10-01T00:00:00Z",
      dueAt: "2026-10-15T00:00:00Z",
      version: 4,
    },
  ],
});
const run = (permissions?: string[]): LmsStaffRunDto & { courseId: number } => ({
  groupId: 13,
  groupName: "Group",
  courseName: "Course",
  courseId: 4,
  runId: 3,
  permissions,
  teacherName: "Teacher",
  status: "active",
  studentCount: 1,
  courseVersionId: 2,
});
let client: QueryClient;
let currentDetail: LmsStaffAssignmentDetailDto;
let currentRun: LmsStaffRunDto;
let calls: Array<{ path: string; method: string; body: unknown }>;
const wrap = (element: React.ReactNode) => (
  <QueryClientProvider client={client}>{element}</QueryClientProvider>
);
const mount = (element: React.ReactNode) => render(wrap(element));
const openRecipient = async () => {
  await userEvent.click(
    await screen.findByRole("button", { name: i18n.t("portalOpen") }),
  );
  const assignment = await screen.findByRole("dialog", {
    name: i18n.t("lmsStaffAssignments"),
  });
  await userEvent.click(
    await within(assignment).findByRole("button", {
      name: i18n.t("lmsStaffEdit"),
    }),
  );
  return screen.findByRole("dialog", { name: i18n.t("lmsStaffEdit") });
};
beforeEach(() => {
  i18n.setLanguage("ru");
  calls = [];
  currentDetail = detail();
  currentRun = run(["assignments.manage"]);
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
        path: url,
        method,
        body: options.body ? JSON.parse(String(options.body)) : null,
      });
      const body =
        method !== "GET"
          ? { id: 9, version: 5 }
          : url.includes("/runs?")
            ? [currentRun]
            : url.includes("/enrollments?")
              ? enrollments
              : url.includes("/assignments/7")
                ? currentDetail
                : url.includes("/assignments?")
                  ? [currentDetail]
                  : [];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
});
afterEach(async () => {
  cleanup();
  client.clear();
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.unstubAllGlobals();
});
describe("explicit review permission", () => {
  it("keeps accepted deadline editing available while withholding correction and reopening by default", async () => {
    mount(<StaffAssignments runId={3} enrollments={enrollments} />);
    const editor = await openRecipient();
    expect(
      screen.queryByRole("button", { name: i18n.t("lmsStaffCorrectReview") }),
    ).toBeNull();
    expect(
      within(editor).queryByRole("option", {
        name: i18n.t("portalRevisionRequired"),
      }),
    ).toBeNull();
    const due = within(editor).getByLabelText(i18n.t("lmsStaffDueAt"), {
      selector: "input",
    });
    expect((due as HTMLInputElement).disabled).toBe(false);
    await userEvent.type(
      within(editor).getByLabelText(i18n.t("lmsStaffReason")),
      "More time",
    );
    await userEvent.click(
      within(editor).getByRole("button", { name: i18n.t("lmsStaffSave") }),
    );
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.path === "/api/lms-management/assignments/9/recipient" &&
            call.method === "PATCH",
        ),
      ).toBe(true),
    );
    expect(calls.some((call) => call.path.endsWith("/reopen"))).toBe(false);
    expect(calls.find((call) => call.method === "PATCH")?.body).toMatchObject({
      version: 4,
      reason: "More time",
    });
  });
  it("retains excused and cancelled assignment actions without review permission and confirms the selected action", async () => {
    currentDetail = detail(false);
    mount(
      <StaffAssignments
        runId={3}
        enrollments={enrollments}
        canReview={false}
      />,
    );
    const editor = await openRecipient();
    expect(
      within(editor).getByRole("option", { name: i18n.t("portalExcused") }),
    ).toBeTruthy();
    expect(
      within(editor).getByRole("option", { name: i18n.t("portalCancelled") }),
    ).toBeTruthy();
    await userEvent.selectOptions(
      within(editor).getByLabelText(i18n.t("portalAssignments")),
      "excused",
    );
    await userEvent.type(
      within(editor).getByLabelText(i18n.t("lmsStaffReason")),
      "Approved absence",
    );
    await userEvent.click(
      within(editor).getByRole("button", { name: i18n.t("lmsStaffSave") }),
    );
    expect(calls.filter((call) => call.method !== "GET")).toHaveLength(0);
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: i18n.t("lmsStaffSave"),
      }),
    );
    await waitFor(() =>
      expect(calls.find((call) => call.method === "PATCH")?.body).toMatchObject(
        { status: "excused", version: 4 },
      ),
    );
  });
  it("allows correction and confirmed reopening with an explicit grant", async () => {
    mount(<StaffAssignments runId={3} enrollments={enrollments} canReview />);
    await userEvent.click(
      await screen.findByRole("button", { name: i18n.t("portalOpen") }),
    );
    const assignment = await screen.findByRole("dialog", {
      name: i18n.t("lmsStaffAssignments"),
    });
    expect(
      await within(assignment).findByRole("button", {
        name: i18n.t("lmsStaffCorrectReview"),
      }),
    ).toBeTruthy();
    await userEvent.click(
      within(assignment).getByRole("button", { name: i18n.t("lmsStaffEdit") }),
    );
    const editor = await screen.findByRole("dialog", {
      name: i18n.t("lmsStaffEdit"),
    });
    await userEvent.selectOptions(
      within(editor).getByLabelText(i18n.t("portalAssignments")),
      "reopen",
    );
    await userEvent.type(
      within(editor).getByLabelText(i18n.t("lmsStaffReason")),
      "Another attempt",
    );
    await userEvent.click(
      within(editor).getByRole("button", { name: i18n.t("lmsStaffSave") }),
    );
    expect(calls.filter((call) => call.method !== "GET")).toHaveLength(0);
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: i18n.t("lmsStaffSave"),
      }),
    );
    await waitFor(() =>
      expect(
        calls.find((call) => call.path.endsWith("/reopen"))?.body,
      ).toMatchObject({ version: 4, reason: "Another attempt" }),
    );
  });
  it("blocks a pending reopen confirmation when the grant is withdrawn", async () => {
    const view = mount(
      <StaffAssignments runId={3} enrollments={enrollments} canReview />,
    );
    const editor = await openRecipient();
    await userEvent.selectOptions(
      within(editor).getByLabelText(i18n.t("portalAssignments")),
      "reopen",
    );
    await userEvent.type(
      within(editor).getByLabelText(i18n.t("lmsStaffReason")),
      "Another attempt",
    );
    await userEvent.click(
      within(editor).getByRole("button", { name: i18n.t("lmsStaffSave") }),
    );
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    view.rerender(
      wrap(
        <StaffAssignments
          runId={3}
          enrollments={enrollments}
          canReview={false}
        />,
      ),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    const save = within(
      await screen.findByRole("dialog", { name: i18n.t("lmsStaffEdit") }),
    ).getByRole("button", { name: i18n.t("lmsStaffSave") });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(save);
    expect(calls.filter((call) => call.method !== "GET")).toHaveLength(0);
  });
  it.each([undefined, ["assignments.manage"]])(
    "hides management review entry points and avoids review requests with permissions %j",
    async (permissions) => {
      currentRun = run(permissions);
      mount(<LearningManagement initialTab="reviews" />);
      await userEvent.selectOptions(
        await screen.findByLabelText(i18n.t("lmsStaffGroup")),
        "13",
      );
      await screen.findByRole("tab", { name: i18n.t("lmsStaffAssignments") });
      expect(
        screen.queryByRole("button", { name: i18n.t("lmsStaffReviews") }),
      ).toBeNull();
      expect(
        screen.queryByRole("tab", { name: i18n.t("lmsStaffReviews") }),
      ).toBeNull();
      expect(calls.some((call) => call.path.includes("/reviews"))).toBe(false);
    },
  );
  it.each([undefined, ["assignments.manage"]])(
    "hides group review entry points and avoids review requests with permissions %j",
    async (permissions) => {
      currentRun = run(permissions);
      mount(
        <LearningGroupTabs groupId={13} enabled>
          <span>Roster</span>
        </LearningGroupTabs>,
      );
      await userEvent.click(
        await screen.findByRole("tab", { name: i18n.t("lmsStaffAssignments") }),
      );
      await screen.findByRole("button", {
        name: i18n.t("lmsStaffAddAssignment"),
      });
      expect(
        screen.queryByRole("tab", { name: i18n.t("lmsStaffReviews") }),
      ).toBeNull();
      expect(calls.some((call) => call.path.includes("/reviews"))).toBe(false);
    },
  );
  it("closes the global review queue after its explicit permission disappears", async () => {
    currentRun = run(["assignments.manage", "reviews.manage"]);
    mount(<LearningManagement />);
    await userEvent.click(
      await screen.findByRole("button", { name: i18n.t("lmsStaffReviews") }),
    );
    expect(
      await screen.findByRole("dialog", { name: i18n.t("lmsStaffReviews") }),
    ).toBeTruthy();
    act(() =>
      client.setQueryData(
        ["lms-management", "runs"],
        [run(["assignments.manage"])],
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      screen.queryByRole("button", { name: i18n.t("lmsStaffReviews") }),
    ).toBeNull();
  });
});
