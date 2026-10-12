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
import type { LmsStaffRunDto } from "@shared/contracts/lms";
import type { LearningRolloutDto } from "@shared/contracts/learning-rollout";
import { i18n } from "../client/src/lib/i18n";
import { LearningManagement } from "../client/src/features/lms-staff/management";
import { LearningGroupTabs } from "../client/src/features/lms-staff/group-tabs";
import { StaffDialog } from "../client/src/features/lms-staff/ui";
import LearningRolloutSettings from "../client/src/features/learning-rollout/LearningRolloutSettings";
vi.mock("../client/src/features/learning-rollout/SchoolSettingsCard", () => ({
  SchoolSettingsCard: () => null,
}));
vi.mock("../client/src/features/portal-access", () => ({
  PortalDeliveryFailuresButton: () => null,
}));
const group = (
  id = 13,
  extra: Partial<LmsStaffRunDto> = {},
): LmsStaffRunDto => ({
  groupId: id,
  groupName: `Group ${id}`,
  courseName: "Course",
  courseId: 4,
  runId: id + 20,
  teacherName: "Teacher",
  status: "active",
  studentCount: 2,
  courseVersionId: 5,
  version: 1,
  format: "offline",
  setupStatus: "ready",
  permissions: ["content.manage"],
  ...extra,
});
const rollout = (enabled: boolean): LearningRolloutDto => ({
  capabilities: {
    portalEnabled: false,
    learningEnabled: enabled,
    invitationsEnabled: false,
    publicPortfolioEnabled: false,
  },
  flags: [
    {
      key: "learning",
      enabled,
      allGroups: true,
      groupIds: [],
      version: 2,
      updatedAt: null,
    },
  ],
  groups: [
    { id: 13, name: "Group 13" },
    { id: 14, name: "Group 14" },
  ],
});
let client: QueryClient;
let rows: LmsStaffRunDto[];
let calls: Array<{ path: string; method: string; body: unknown }>;
let denied: boolean;
const mount = (element: React.ReactNode) =>
  render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
const selectGroup = async (id = 13) =>
  userEvent.selectOptions(
    await screen.findByLabelText(i18n.t("lmsStaffGroup")),
    String(id),
  );
beforeEach(() => {
  i18n.setLanguage("ru");
  rows = [group(), group(14)];
  calls = [];
  denied = false;
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
      const body = denied
        ? { code: "portalUnavailable" }
        : url.endsWith("/configuration")
          ? rollout(method === "PUT")
          : method !== "GET"
            ? { id: 33 }
            : url.includes("/runs?")
              ? rows
              : [];
      return new Response(JSON.stringify(body), {
        status: denied ? 403 : 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
});
afterEach(async () => {
  cleanup();
  client.clear();
  vi.useRealTimers();
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.unstubAllGlobals();
});
describe("CRM group learning preparation", () => {
  it.each(["ru", "en"] as const)(
    "shows every prepared CRM group and opens its workspace without a creation step in %s",
    async (language) => {
      i18n.setLanguage(language);
      mount(<LearningManagement />);
      const selector = await screen.findByLabelText(i18n.t("lmsStaffGroup"));
      expect(
        within(selector)
          .getAllByRole("option")
          .map((option) => (option as HTMLOptionElement).value),
      ).toEqual(["", "13", "14"]);
      for (const id of [13, 14]) {
        await selectGroup(id);
        await screen.findByRole("button", {
          name: i18n.t("lmsStaffAddMaterial"),
        });
        expect(
          screen.queryByRole("button", { name: i18n.t("lmsStaffCreateRun") }),
        ).toBeNull();
        expect(
          screen.queryByRole("button", {
            name: i18n.t("lmsStaffSelectFormat"),
          }),
        ).toBeNull();
      }
      expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
      expect(calls.some((call) => call.path.includes("runId=33"))).toBe(true);
      expect(calls.some((call) => call.path.includes("runId=34"))).toBe(true);
    },
  );
  it("refreshes a preparing group automatically while keeping the existing group dialog and roster", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    rows = [group(13, { runId: null, setupStatus: "preparing" })];
    mount(
      <StaffDialog open onClose={vi.fn()} titleKey="lmsStaffGroup">
        <LearningGroupTabs groupId={13} enabled>
          <p>Existing roster</p>
        </LearningGroupTabs>
      </StaffDialog>,
    );
    await userEvent.click(
      await screen.findByRole("tab", { name: i18n.t("lmsStaffMaterials") }),
    );
    expect(
      await screen.findByText(i18n.t("lmsStaffGroupPreparing")),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: i18n.t("lmsStaffSelectFormat") }),
    ).toBeNull();
    rows = [group()];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await screen.findByRole("button", { name: i18n.t("lmsStaffAddMaterial") });
    expect(
      screen.getByRole("dialog", { name: i18n.t("lmsStaffGroup") }),
    ).toBeTruthy();
    await userEvent.click(
      screen.getByRole("tab", { name: i18n.t("lmsStaffStudents") }),
    );
    expect(screen.getByText("Existing roster")).toBeTruthy();
    expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
  });
  it("adds a new CRM group to the existing selector after refresh without issuing creation commands", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    rows = [group()];
    mount(<LearningManagement />);
    const selector = await screen.findByLabelText(i18n.t("lmsStaffGroup"));
    expect(
      within(selector).queryByRole("option", { name: "Group 14 · Course" }),
    ).toBeNull();
    rows = [group(), group(14)];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(
      await within(selector).findByRole("option", {
        name: "Group 14 · Course",
      }),
    ).toBeTruthy();
    await selectGroup(14);
    await screen.findByRole("button", { name: i18n.t("lmsStaffAddMaterial") });
    expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
  });
  it("retries a pending management group by reading runs and opens it after preparation", async () => {
    rows = [group(13, { runId: null, setupStatus: "preparing" })];
    mount(<LearningManagement />);
    await selectGroup();
    expect(
      await screen.findByText(i18n.t("lmsStaffGroupPreparing")),
    ).toBeTruthy();
    rows = [group()];
    await userEvent.click(
      screen.getByRole("button", { name: i18n.t("lmsStaffRetry") }),
    );
    await screen.findByRole("button", { name: i18n.t("lmsStaffAddMaterial") });
    expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
  });
  it("shows a missing course in the group list and a concrete correction state without endless retries", async () => {
    rows = [
      group(13, {
        runId: null,
        courseId: null,
        courseName: null,
        setupStatus: "needs_course",
      }),
    ];
    mount(<LearningManagement />);
    await selectGroup();
    expect(
      screen.getByRole("option", {
        name: `Group 13 · ${i18n.t("lmsStaffCourseNotSelected")}`,
      }),
    ).toBeTruthy();
    expect(screen.getByText(i18n.t("lmsStaffGroupNeedsCourse"))).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: i18n.t("lmsStaffRetry") }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: i18n.t("lmsStaffSelectFormat") }),
    ).toBeNull();
    expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
  });
  it("shows a programme requiring review without automatically choosing a different version", async () => {
    rows = [group(13, { runId: null, setupStatus: "needs_program_review" })];
    mount(<LearningManagement />);
    await selectGroup();
    expect(screen.getByText(i18n.t("lmsStaffGroupProgramReview"))).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: i18n.t("lmsStaffRetry") }),
    ).toBeNull();
    expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
  });
  it("keeps an existing group workspace and results available while linking review to its pinned programme", async () => {
    rows = [
      group(13, {
        setupStatus: "needs_program_review",
        permissions: ["content.manage", "results.manage"],
      }),
    ];
    mount(<LearningManagement />);
    await selectGroup();
    await screen.findByRole("button", { name: i18n.t("lmsStaffAddMaterial") });
    expect(screen.getByText(i18n.t("lmsStaffGroupProgramReview"))).toBeTruthy();
    await userEvent.click(
      screen.getByRole("tab", { name: i18n.t("lmsStaffResults") }),
    );
    await waitFor(() =>
      expect(
        calls.some((call) => call.path.includes("/results?runId=33")),
      ).toBe(true),
    );
    await userEvent.click(
      screen.getByRole("button", { name: i18n.t("lmsStaffReviewProgram") }),
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole("tab", { name: i18n.t("lmsStaffProgram") })
          .getAttribute("aria-selected"),
      ).toBe("true"),
    );
    await waitFor(() =>
      expect(
        calls.some((call) => call.path.includes("/runs/33/course-versions")),
      ).toBe(true),
    );
    expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
  });
  it("opens programme review inside a Dialog while preserving the group roster and materials", async () => {
    rows = [group(13, { setupStatus: "needs_program_review" })];
    mount(
      <LearningGroupTabs groupId={13} enabled>
        <p>Existing roster</p>
      </LearningGroupTabs>,
    );
    expect(await screen.findByText("Existing roster")).toBeTruthy();
    await userEvent.click(
      await screen.findByRole("tab", { name: i18n.t("lmsStaffMaterials") }),
    );
    await screen.findByRole("button", { name: i18n.t("lmsStaffAddMaterial") });
    await userEvent.click(
      screen.getByRole("button", { name: i18n.t("lmsStaffReviewProgram") }),
    );
    expect(
      await screen.findByRole("dialog", { name: i18n.t("lmsStaffProgram") }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        calls.some((call) => call.path.includes("/runs/33/course-versions")),
      ).toBe(true),
    );
    expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
  });
  it("keeps existing materials available but does not query a programme when its course is absent", async () => {
    rows = [
      group(13, {
        setupStatus: "needs_program_review",
        courseId: null,
        courseName: null,
      }),
    ];
    mount(<LearningManagement />);
    await selectGroup();
    await screen.findByRole("button", { name: i18n.t("lmsStaffAddMaterial") });
    expect(screen.getByText(i18n.t("lmsStaffGroupProgramReview"))).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: i18n.t("lmsStaffReviewProgram") }),
    ).toBeNull();
    expect(
      screen.queryByRole("tab", { name: i18n.t("lmsStaffProgram") }),
    ).toBeNull();
    expect(calls.some((call) => call.path.includes("/course-versions"))).toBe(
      false,
    );
    expect(calls.some((call) => /undefined|null/.test(call.path))).toBe(false);
    expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
  });
  it.each([undefined, ["results.manage"]])(
    "does not offer a manual format command without content permission %j",
    async (permissions) => {
      rows = [
        group(13, { runId: null, setupStatus: "needs_format", permissions }),
      ];
      mount(<LearningManagement />);
      await selectGroup();
      expect(screen.getByText(i18n.t("lmsStaffGroupNeedsFormat"))).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: i18n.t("lmsStaffSelectFormat") }),
      ).toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
    },
  );
  it("keeps a manual format exception in a Dialog and submits only after the explicit choice", async () => {
    rows = [group(13, { runId: null, setupStatus: "needs_format" })];
    mount(
      <LearningGroupTabs groupId={13} enabled>
        <p>Existing roster</p>
      </LearningGroupTabs>,
    );
    await userEvent.click(
      await screen.findByRole("tab", { name: i18n.t("lmsStaffMaterials") }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: i18n.t("lmsStaffSelectFormat") }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: i18n.t("lmsStaffSelectFormat"),
    });
    await userEvent.selectOptions(
      within(dialog).getByLabelText(i18n.t("lmsStaffFormat")),
      "online",
    );
    await userEvent.type(
      within(dialog).getByLabelText(i18n.t("lmsStaffMeeting")),
      "https://example.org/lesson",
    );
    expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
    await userEvent.click(
      within(dialog).getByRole("button", { name: i18n.t("lmsStaffSave") }),
    );
    await waitFor(() =>
      expect(calls.filter((call) => call.method !== "GET")).toEqual([
        {
          path: "/api/lms-management/runs",
          method: "POST",
          body: {
            groupId: 13,
            format: "online",
            meetingUrl: "https://example.org/lesson",
          },
        },
      ]),
    );
  });
  it("retains format editing in the existing settings Dialog for a prepared group", async () => {
    mount(<LearningManagement />);
    await selectGroup();
    await userEvent.click(
      await screen.findByRole("button", {
        name: i18n.t("lmsStaffRunSettings"),
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: i18n.t("lmsStaffRunSettings"),
    });
    expect(
      within(dialog).getByLabelText(i18n.t("lmsStaffFormat")),
    ).toBeTruthy();
    expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
  });
  it("shows a denied read without attempting to prepare groups", async () => {
    denied = true;
    mount(<LearningManagement />);
    expect(await screen.findByText(i18n.t("portalUnavailable"))).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: i18n.t("lmsStaffRetry") }),
    );
    expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("invalidates cached group runs only after a confirmed global learning change", async () => {
    client.setQueryDefaults(["lms-management"], { gcTime: Infinity });
    client.setQueryData(["lms-management", "runs"], rows);
    mount(<LearningRolloutSettings />);
    await userEvent.click(
      await screen.findByRole("button", {
        name: i18n.t("lmsRolloutConfiguration"),
      }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("checkbox", {
        name: i18n.t("lmsRolloutEnable"),
      }),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: i18n.t("lmsRolloutSave") }),
    );
    expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
    expect(
      client.getQueryState(["lms-management", "runs"])?.isInvalidated,
    ).toBe(false);
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: i18n.t("lmsRolloutSave"),
      }),
    );
    await waitFor(() =>
      expect(
        client.getQueryState(["lms-management", "runs"])?.isInvalidated,
      ).toBe(true),
    );
    expect(calls.filter((call) => call.method !== "GET")).toEqual([
      {
        path: "/api/lms-management/configuration",
        method: "PUT",
        body: {
          key: "learning",
          enabled: true,
          allGroups: true,
          groupIds: [],
          version: 2,
        },
      },
    ]);
  });
});
