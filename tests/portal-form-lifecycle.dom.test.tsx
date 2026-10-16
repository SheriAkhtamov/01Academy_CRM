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
import { useLocation } from "wouter";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ThemeProvider } from "../client/src/components/ux/ThemeProvider";
import { PortalProfile } from "../client/src/features/portal-identity/PortalProfile";
import { PortalShell } from "../client/src/features/portal-app/PortalShell";
import { PortalNotifications } from "../client/src/features/portal-app/notifications";
import { PortalPortfolio } from "../client/src/features/portal-app/portfolio";
import { FinanceQuestions } from "../client/src/features/portal-app/finance-questions";
import { PortalHelp } from "../client/src/features/lms/communication";
import {
  PortalSchedule,
  portalWeekRange,
} from "../client/src/features/lms/schedule";
import {
  PortalAttendance,
  portalMonthRange,
} from "../client/src/features/lms/attendance";
import type { LmsScheduleDto } from "../shared/contracts/lms";
import {
  PortalSessionProvider,
  portalSessionKey,
  usePortal,
} from "../client/src/features/portal-app/context";
import { i18n, type TranslationKey } from "../client/src/lib/i18n";
import {
  PORTAL_PERMISSIONS,
  type PortalSessionDto,
} from "../shared/contracts/portal-identity";
import type {
  PortalNotificationPreferencesDto,
  PortalProjectDto,
} from "../shared/contracts/portal-resources";

const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  sessions: vi.fn(),
  representatives: vi.fn(),
  logout: vi.fn(),
  notifications: vi.fn(),
  preferences: vi.fn(),
  savePreferences: vi.fn(),
  projectsPage: vi.fn(),
  threads: vi.fn(),
  thread: vi.fn(),
  threadComment: vi.fn(),
  courses: vi.fn(),
  schedule: vi.fn(),
  makeup: vi.fn(),
  filePolicy: vi.fn(),
  financeQuestionsPage: vi.fn(),
  financeQuestion: vi.fn(),
  replyFinance: vi.fn(),
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
      profile: mocks.profile,
      sessions: mocks.sessions,
      representatives: mocks.representatives,
      logout: mocks.logout,
    },
    portalLmsApi: {
      ...actual.portalLmsApi,
      threads: mocks.threads,
      thread: mocks.thread,
      threadComment: mocks.threadComment,
      courses: mocks.courses,
      schedule: mocks.schedule,
      makeup: mocks.makeup,
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
      portalResourcesApi: { ...actual.portalResourcesApi, ...mocks },
    };
  },
);

const account = {
  id: 50,
  fullName: "Learner",
  login: "learner",
  email: null,
  phone: null,
  locale: "ru" as const,
  status: "active" as const,
};
const session: PortalSessionDto = {
  account,
  subjects: [
    {
      linkId: 10,
      studentId: 20,
      studentName: "Learner",
      kind: "self",
      relationship: null,
      permissions: [...PORTAL_PERMISSIONS],
      status: "active",
      studentClassification: "adult",
    },
  ],
  csrfToken: "test-csrf",
};
const preferences: PortalNotificationPreferencesDto = {
  categories: {
    learning: { inApp: true },
    schedule: { inApp: true },
    feedback: { inApp: true },
    finance: { inApp: true },
    family: { inApp: true },
    security: { inApp: true },
  },
  weeklySummary: false,
};
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
const financeQuestion = {
  id: 99,
  paymentId: null,
  subject: "Receipt question",
  status: "open",
  createdAt: "2026-10-11T09:00:00Z",
  updatedAt: "2026-10-11T09:00:00Z",
  messages: [],
};
function project(id: number): PortalProjectDto {
  return {
    id,
    studentId: 20,
    title: `Project ${id}`,
    description: "Project description",
    runId: 2,
    courseName: "Design",
    sourceSubmissionId: null,
    links: [],
    files: [],
    coverFileId: null,
    teacherReview: null,
    version: 1,
    createdAt: "2026-10-11T09:00:00Z",
    updatedAt: "2026-10-11T09:00:00Z",
    archivedAt: null,
    shares: [],
  };
}
function scheduleLesson(
  runId: number,
  courseName: string,
  from: string,
): LmsScheduleDto {
  const starts = Date.parse(from) + 9 * 3600000;
  return {
    id: runId,
    lessonId: runId,
    runId,
    courseName,
    groupName: "Group 1",
    topic: `Lesson ${courseName}`,
    scheduledAt: new Date(starts).toISOString(),
    endsAt: new Date(starts + 3600000).toISOString(),
    durationMinutes: 60,
    status: "planned",
    teacherName: "Teacher",
    schoolName: null,
    roomName: null,
    format: "online",
    meetingUrl: null,
    attendance: null,
    updatedAt: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const copy = (key: TranslationKey) => i18n.t(key);
let client: QueryClient;

beforeEach(() => {
  vi.resetAllMocks();
  i18n.setLanguage("ru");
  sessionStorage.clear();
  localStorage.clear();
  history.replaceState(null, "", "/learn");
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
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
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  window.scrollTo = vi.fn();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(portalSessionKey, session);
  mocks.sessions.mockResolvedValue([]);
  mocks.representatives.mockResolvedValue([]);
  mocks.logout.mockResolvedValue({ success: true });
  mocks.notifications.mockResolvedValue({
    items: [],
    nextCursor: null,
    hasMore: false,
    unreadCount: 0,
  });
  mocks.preferences.mockResolvedValue(preferences);
  mocks.projectsPage.mockResolvedValue({
    items: [project(70), project(71)],
    nextCursor: null,
    hasMore: false,
  });
  mocks.threads.mockResolvedValue([thread]);
  mocks.thread.mockResolvedValue(thread);
  mocks.courses.mockResolvedValue([]);
  mocks.schedule.mockResolvedValue([]);
  mocks.makeup.mockResolvedValue([]);
  mocks.filePolicy.mockResolvedValue({ maxFileMiB: 100, studentQuotaGiB: 2 });
  mocks.financeQuestionsPage.mockResolvedValue({
    items: [financeQuestion],
    nextCursor: null,
    hasMore: false,
  });
  mocks.financeQuestion.mockResolvedValue(financeQuestion);
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function Ready({ children }: { children: ReactNode }) {
  return usePortal().account ? children : null;
}
function mount(children: ReactNode) {
  return render(
    <ThemeProvider defaultTheme="light">
      <QueryClientProvider client={client}>
        <PortalSessionProvider>
          <Ready>{children}</Ready>
        </PortalSessionProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

// This component-level harness keeps the profile body as a background form to
// check guard ownership. Production profile dialogs/routes are covered in
// portal-profile-modal.dom.test.tsx.
function ProfileNavigation() {
  const [path] = useLocation();
  const { account: current, subject } = usePortal();
  return (
    <PortalShell>
      <div key={`${current?.id}:${subject?.linkId}:${path}`}>
        <p data-testid="profile-subject">{subject?.studentName}</p>
        {path === "/learn/schedule" ? <PortalSchedule /> : <PortalProfile />}
      </div>
    </PortalShell>
  );
}
function mountParentProfile() {
  const first = {
    ...session.subjects[0],
    kind: "representative" as const,
    relationship: "parent" as const,
    studentClassification: "minor" as const,
  };
  client.setQueryData(portalSessionKey, {
    ...session,
    subjects: [
      first,
      { ...first, linkId: 11, studentId: 21, studentName: "Second learner" },
    ],
  } satisfies PortalSessionDto);
  sessionStorage.setItem(`portal-context-${account.id}`, String(first.linkId));
  history.replaceState(null, "", "/learn");
  return mount(<ProfileNavigation />);
}
const childForms = [
  { titleKey: "portalChangePassword", inputKey: "portalCurrentPassword" },
  { titleKey: "portalChildCredentials", inputKey: "portalChildLogin" },
] as const;
async function editProfile(user: ReturnType<typeof userEvent.setup>) {
  const input = await screen.findByLabelText(copy("portalFullName"));
  await user.clear(input);
  await user.type(input, "Unsaved profile name");
  return input as HTMLInputElement;
}

it.each(childForms)(
  "closes an untouched $titleKey dialog without discarding a dirty profile",
  async ({ titleKey }) => {
    const user = userEvent.setup();
    mountParentProfile();
    const profile = await editProfile(user);
    await user.click(screen.getByRole("button", { name: copy(titleKey) }));
    const dialog = await screen.findByRole("dialog", { name: copy(titleKey) });
    await user.click(
      within(dialog).getByRole("button", { name: copy("close") }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(profile.value).toBe("Unsaved profile name");
    await user.click(
      screen.getByRole("link", { name: copy("portalSchedule") }),
    );
    expect(
      await screen.findByRole("alertdialog", {
        name: copy("portalUnsavedTitle"),
      }),
    ).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: copy("portalCancel") }),
    );
    expect(window.location.pathname).toBe("/learn");
    expect(profile.value).toBe("Unsaved profile name");
  },
);

it.each(childForms)(
  "discards only the dirty $titleKey form and keeps the profile guarded for route, learner and sign-out actions",
  async ({ titleKey, inputKey }) => {
    const user = userEvent.setup();
    mountParentProfile();
    const profile = await editProfile(user);
    await user.click(screen.getByRole("button", { name: copy(titleKey) }));
    const dialog = await screen.findByRole("dialog", { name: copy(titleKey) });
    const childInput = within(dialog).getByLabelText(
      copy(inputKey),
    ) as HTMLInputElement;
    await user.type(childInput, "unsaved-child-value");
    await user.click(
      within(dialog).getByRole("button", { name: copy("close") }),
    );
    await screen.findByRole("alertdialog", {
      name: copy("portalUnsavedTitle"),
    });
    await user.click(
      screen.getByRole("button", { name: copy("portalCancel") }),
    );
    expect(childInput.value).toBe("unsaved-child-value");
    await user.click(
      within(dialog).getByRole("button", { name: copy("close") }),
    );
    await user.click(
      await screen.findByRole("button", { name: copy("portalLeave") }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(profile.value).toBe("Unsaved profile name");
    await user.click(
      screen.getByRole("link", { name: copy("portalSchedule") }),
    );
    await screen.findByRole("alertdialog", {
      name: copy("portalUnsavedTitle"),
    });
    await user.click(
      screen.getByRole("button", { name: copy("portalCancel") }),
    );
    expect(window.location.pathname).toBe("/learn");
    await user.click(screen.getByRole("button", { name: "Learner" }));
    await user.click(screen.getByRole("menuitem", { name: "Second learner" }));
    await screen.findByRole("alertdialog", {
      name: copy("portalUnsavedTitle"),
    });
    await user.click(
      screen.getByRole("button", { name: copy("portalCancel") }),
    );
    expect(screen.getByTestId("profile-subject").textContent).toBe("Learner");
    await user.click(screen.getByRole("button", { name: copy("currentAccount") }));
    await user.click(screen.getByRole("menuitem", { name: copy("portalSignOut") }));
    await screen.findByRole("alertdialog", {
      name: copy("portalUnsavedTitle"),
    });
    await user.click(
      screen.getByRole("button", { name: copy("portalCancel") }),
    );
    expect(mocks.logout).not.toHaveBeenCalled();
    expect(profile.value).toBe("Unsaved profile name");
  },
);

it.each(["route", "learner"] as const)(
  "confirms one dirty %s transition and opens a clean profile afterwards",
  async (target) => {
    const user = userEvent.setup();
    mountParentProfile();
    await editProfile(user);
    if (target === "route") {
      await user.click(
        screen.getByRole("link", { name: copy("portalSchedule") }),
      );
    } else {
      await user.click(screen.getByRole("button", { name: "Learner" }));
      await user.click(
        screen.getByRole("menuitem", { name: "Second learner" }),
      );
    }
    const confirmation = await screen.findByRole("alertdialog", {
      name: copy("portalUnsavedTitle"),
    });
    await user.click(
      within(confirmation).getByRole("button", { name: copy("portalLeave") }),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    if (target === "route") {
      await screen.findByRole("heading", { name: copy("portalSchedule") });
      await user.click(
        screen.getByRole("link", { name: copy("portalProfile") }),
      );
    } else {
      await waitFor(() =>
        expect(screen.getByTestId("profile-subject").textContent).toBe(
          "Second learner",
        ),
      );
    }
    const profile = (await screen.findByLabelText(
      copy("portalFullName"),
    )) as HTMLInputElement;
    expect(profile.value).toBe(account.fullName);
    await user.click(
      screen.getByRole("button", { name: copy("portalChangePassword") }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: copy("portalChangePassword"),
    });
    await user.click(
      within(dialog).getByRole("button", { name: copy("close") }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: copy("portalChangePassword") })).toBeNull(),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    const profileDialog = screen.queryByRole("dialog", { name: copy("portalProfile") });
    if (profileDialog)
      await user.click(within(profileDialog).getByRole("button", { name: copy("close") }));
    await user.click(
      screen.getByRole("link", { name: copy("portalSchedule") }),
    );
    await screen.findByRole("heading", { name: copy("portalSchedule") });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  },
);

it("keeps profile edits made while saving and only reports a clean saved profile", async () => {
  const user = userEvent.setup();
  const pending = deferred<typeof account>();
  mocks.profile.mockReturnValueOnce(pending.promise);
  mount(<PortalProfile />);
  const input = await screen.findByLabelText(copy("portalFullName"));
  await user.clear(input);
  await user.type(input, "Saved name");
  await user.click(screen.getByRole("button", { name: copy("portalSave") }));
  await waitFor(() =>
    expect(mocks.profile).toHaveBeenCalledWith({
      fullName: "Saved name",
      locale: "ru",
    }),
  );
  await user.clear(input);
  await user.type(input, "Later draft");
  await act(async () => {
    pending.resolve({ ...account, fullName: "Saved name" });
  });
  await waitFor(() =>
    expect(
      client.getQueryData<PortalSessionDto>(portalSessionKey)?.account
        ?.fullName,
    ).toBe("Saved name"),
  );
  expect((input as HTMLInputElement).value).toBe("Later draft");
  expect(screen.queryByText(copy("portalSaved"))).toBeNull();
  expect(
    client.getQueryData<PortalSessionDto>(portalSessionKey)?.subjects,
  ).toEqual(session.subjects);
  expect(
    client.getQueryData<PortalSessionDto>(portalSessionKey)?.csrfToken,
  ).toBe("test-csrf");
  await user.clear(input);
  await user.type(input, "Saved name");
  expect(await screen.findByText(copy("portalSaved"))).toBeTruthy();
  await user.type(input, " edited");
  expect(screen.queryByText(copy("portalSaved"))).toBeNull();
});

it("keeps preferences edited during a save and hides the saved status for a newer draft", async () => {
  const user = userEvent.setup();
  const pending = deferred<PortalNotificationPreferencesDto>();
  mocks.savePreferences.mockReturnValueOnce(pending.promise);
  mount(<PortalNotifications />);
  await user.click(
    await screen.findByRole("button", {
      name: copy("portalNotificationSettings"),
    }),
  );
  const weekly = await screen.findByRole("switch", {
    name: copy("portalWeeklySummary"),
  });
  await user.click(weekly);
  await user.click(screen.getByRole("button", { name: copy("portalSave") }));
  await waitFor(() =>
    expect(mocks.savePreferences).toHaveBeenCalledWith({
      ...preferences,
      weeklySummary: true,
    }),
  );
  await user.click(weekly);
  await act(async () => {
    pending.resolve({ ...preferences, weeklySummary: true });
  });
  await waitFor(() =>
    expect(
      client.getQueryData<PortalNotificationPreferencesDto>([
        "portal-account",
        account.id,
        "preferences",
      ])?.weeklySummary,
    ).toBe(true),
  );
  expect(weekly.getAttribute("aria-checked")).toBe("false");
  expect(screen.queryByText(copy("portalSaved"))).toBeNull();
  await user.click(weekly);
  expect(await screen.findByText(copy("portalSaved"))).toBeTruthy();
});

it.each(["signed-out", "another-account"] as const)(
  "ignores a late profile save after the session changes to %s",
  async (kind) => {
    const user = userEvent.setup();
    const pending = deferred<typeof account>();
    mocks.profile.mockReturnValueOnce(pending.promise);
    mount(<PortalProfile />);
    const input = await screen.findByLabelText(copy("portalFullName"));
    await user.clear(input);
    await user.type(input, "Saved name");
    await user.click(screen.getByRole("button", { name: copy("portalSave") }));
    await waitFor(() => expect(mocks.profile).toHaveBeenCalledTimes(1));
    const replacement: PortalSessionDto = {
      account:
        kind === "signed-out"
          ? null
          : { ...account, id: 90, fullName: "Other learner" },
      subjects:
        kind === "signed-out"
          ? []
          : [{ ...session.subjects[0], linkId: 110, studentId: 120 }],
      csrfToken: "replacement-csrf",
    };
    await act(async () => {
      client.setQueryData(portalSessionKey, replacement);
    });
    await act(async () => {
      pending.resolve({ ...account, fullName: "Saved name" });
    });
    await waitFor(() =>
      expect(client.getQueryData(portalSessionKey)).toEqual(replacement),
    );
  },
);

it("closes an untouched share form immediately and protects an edited alias on close or project change", async () => {
  const user = userEvent.setup();
  mount(<PortalPortfolio />);
  async function openShare() {
    const open = await screen.findAllByRole("button", {
      name: copy("portalOpen"),
    });
    await user.click(open[0]);
    await user.click(screen.getByRole("button", { name: copy("portalShare") }));
    return screen.findByRole("dialog", { name: copy("portalShareTitle") });
  }
  let dialog = await openShare();
  await user.click(within(dialog).getByRole("button", { name: copy("close") }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: copy("portalShareTitle") }),
    ).toBeNull(),
  );
  expect(screen.queryByRole("alertdialog")).toBeNull();
  dialog = await openShare();
  const alias = within(dialog).getByLabelText(copy("portalDisplayName"));
  await user.clear(alias);
  await user.type(alias, "Draft alias");
  await user.click(
    within(dialog).getByRole("combobox", { name: copy("portalShareProject") }),
  );
  await user.click(screen.getByRole("option", { name: "Project 71" }));
  expect(
    await screen.findByRole("alertdialog", {
      name: copy("portalUnsavedTitle"),
    }),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: copy("portalCancel") }));
  expect((alias as HTMLInputElement).value).toBe("Draft alias");
  expect(within(dialog).getByRole("combobox").textContent).toContain(
    "Project 70",
  );
  await user.click(within(dialog).getByRole("button", { name: copy("close") }));
  expect(
    await screen.findByRole("alertdialog", {
      name: copy("portalUnsavedTitle"),
    }),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: copy("portalCancel") }));
  expect((alias as HTMLInputElement).value).toBe("Draft alias");
});

it("keeps the project draft and selected course visible when the course catalog fails and is retried", async () => {
  const user = userEvent.setup();
  mocks.courses
    .mockRejectedValueOnce(new Error("catalog unavailable"))
    .mockResolvedValueOnce([
      { runId: 2, courseName: "Design", groupName: "Group 1" },
    ]);
  mount(<PortalPortfolio />);
  await user.click(
    (
      await screen.findAllByRole("button", {
        name: copy("portalOpen"),
      })
    )[0],
  );
  await user.click(
    screen.getByRole("button", {
      name: copy("portalEditProject"),
    }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: copy("portalEditProject"),
  });
  const course = within(dialog).getByRole("combobox", {
    name: copy("portalCourses"),
  });
  const retry = await within(dialog).findByRole("button", {
    name: copy("portalRetry"),
  });
  expect(course.matches(":disabled")).toBe(true);
  expect(course.textContent).toContain("Design");
  const description = within(dialog).getByLabelText(copy("portalDescription"));
  await user.clear(description);
  await user.type(description, "Unsaved description");
  await user.click(retry);
  await waitFor(() => expect(course.matches(":disabled")).toBe(false));
  expect(course.textContent).toContain("Design · Group 1");
  expect((description as HTMLTextAreaElement).value).toBe(
    "Unsaved description",
  );
  expect(mocks.courses).toHaveBeenCalledTimes(2);
});

it("keeps the chosen schedule course named through loading, weeks without that course and reopening the page", async () => {
  const user = userEvent.setup();
  const next = deferred<LmsScheduleDto[]>();
  const empty = deferred<LmsScheduleDto[]>();
  mocks.schedule
    .mockResolvedValueOnce([
      scheduleLesson(2, "Design A", portalWeekRange(0).from),
    ])
    .mockReturnValueOnce(next.promise)
    .mockReturnValueOnce(empty.promise);
  const view = mount(<PortalSchedule />);
  const course = await screen.findByRole("combobox", {
    name: copy("portalCourses"),
  });
  await user.click(course);
  await user.click(await screen.findByRole("option", { name: "Design A" }));
  await user.click(
    screen.getByRole("button", { name: copy("portalNextWeek") }),
  );
  await waitFor(() => expect(mocks.schedule).toHaveBeenCalledTimes(2));
  expect(course.textContent).toContain("Design A");
  expect(
    screen.getByRole("status", { name: copy("portalLoading") }),
  ).toBeTruthy();
  await act(async () => {
    next.resolve([scheduleLesson(3, "Design B", portalWeekRange(1).from)]);
  });
  expect(await screen.findByText(copy("portalNoLessons"))).toBeTruthy();
  expect(course.textContent).toContain("Design A");
  await user.click(course);
  expect(screen.getByRole("option", { name: "Design A" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "Design B" })).toBeTruthy();
  await user.keyboard("{Escape}");
  await user.click(
    screen.getByRole("button", { name: copy("portalNextWeek") }),
  );
  await waitFor(() => expect(mocks.schedule).toHaveBeenCalledTimes(3));
  expect(course.textContent).toContain("Design A");
  await act(async () => {
    empty.resolve([]);
  });
  expect(await screen.findByText(copy("portalNoLessons"))).toBeTruthy();
  expect(course.textContent).toContain("Design A");
  view.unmount();
  mount(<PortalSchedule />);
  expect(
    (await screen.findByRole("combobox", { name: copy("portalCourses") }))
      .textContent,
  ).toContain("Design A");
});

it("keeps the chosen attendance course named while another month loads and contains only another course", async () => {
  const user = userEvent.setup();
  const first = deferred<LmsScheduleDto[]>();
  const next = deferred<LmsScheduleDto[]>();
  mocks.schedule
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(next.promise);
  mount(<PortalAttendance />);
  const month = (await screen.findByLabelText(
    copy("portalMonth"),
  )) as HTMLInputElement;
  await act(async () => {
    first.resolve([
      {
        ...scheduleLesson(2, "Design A", portalMonthRange(month.value).from),
        status: "conducted",
        attendance: "present",
      },
    ]);
  });
  const course = screen.getByRole("combobox", { name: copy("portalCourses") });
  await user.click(course);
  await user.click(await screen.findByRole("option", { name: "Design A" }));
  const [year, number] = month.value.split("-").map(Number);
  const nextDate = new Date(Date.UTC(year, number, 1));
  const nextMonth = `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, "0")}`;
  fireEvent.change(month, { target: { value: nextMonth } });
  await waitFor(() => expect(mocks.schedule).toHaveBeenCalledTimes(2));
  expect(course.textContent).toContain("Design A");
  expect(
    screen.getByRole("status", { name: copy("portalLoading") }),
  ).toBeTruthy();
  await act(async () => {
    next.resolve([
      {
        ...scheduleLesson(3, "Design B", portalMonthRange(nextMonth).from),
        status: "conducted",
        attendance: "absent",
      },
    ]);
  });
  await screen.findAllByText(copy("portalNoLessons"));
  expect(course.textContent).toContain("Design A");
  expect(screen.queryByText("Lesson Design B")).toBeNull();
  await user.click(course);
  expect(screen.getByRole("option", { name: "Design A" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "Design B" })).toBeTruthy();
  expect(mocks.schedule.mock.calls[1].slice(0, 3)).toEqual([
    10,
    portalMonthRange(nextMonth).from,
    portalMonthRange(nextMonth).to,
  ]);
});

it.each(["matching", "missing"] as const)(
  "restores the saved week from legacy schedule preferences with a %s course",
  async (kind) => {
    const scope = `${account.id}:${session.subjects[0].linkId}:${[...session.subjects[0].permissions].sort().join(",")}`;
    const key = `portal-view:${scope}:schedule`;
    sessionStorage.setItem(key, JSON.stringify({ offset: "1", course: "2" }));
    const range = portalWeekRange(1);
    mocks.schedule.mockResolvedValueOnce([
      scheduleLesson(
        kind === "matching" ? 2 : 3,
        kind === "matching" ? "Design A" : "Design B",
        range.from,
      ),
    ]);
    mount(<PortalSchedule />);
    const course = await screen.findByRole("combobox", {
      name: copy("portalCourses"),
    });
    await waitFor(() =>
      expect(mocks.schedule.mock.calls[0].slice(0, 3)).toEqual([
        10,
        range.from,
        range.to,
      ]),
    );
    await waitFor(() =>
      expect(course.textContent).toContain(
        kind === "matching" ? "Design A" : copy("portalAllCourses"),
      ),
    );
    await waitFor(() =>
      expect(JSON.parse(sessionStorage.getItem(key)!)).toMatchObject({
        offset: "1",
        course: kind === "matching" ? "2" : "",
      }),
    );
  },
);

it.each(["thread", "finance"] as const)(
  "freezes the %s reply draft while sending and re-enables it after success",
  async (kind) => {
    const user = userEvent.setup();
    const pending = deferred<{ id: number }>();
    const send = kind === "thread" ? mocks.threadComment : mocks.replyFinance;
    send.mockReturnValueOnce(pending.promise);
    if (kind === "finance")
      history.replaceState(null, "", "/learn/payments?question=99");
    mount(
      kind === "thread" ? <PortalHelp initialId={66} /> : <FinanceQuestions />,
    );
    const input = await screen.findByLabelText(copy("portalComment"));
    await user.type(input, "Submitted draft");
    await user.click(screen.getByRole("button", { name: copy("portalSend") }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(input.matches(":disabled")).toBe(true);
    await user.type(input, " newer text");
    expect((input as HTMLTextAreaElement).value).toBe("Submitted draft");
    expect(send.mock.calls[0][2]).toMatchObject({ body: "Submitted draft" });
    await act(async () => {
      pending.resolve({ id: 123 });
    });
    await waitFor(() => expect(input.matches(":disabled")).toBe(false));
    expect((input as HTMLTextAreaElement).value).toBe("");
    await user.type(input, "Next draft");
    expect((input as HTMLTextAreaElement).value).toBe("Next draft");
  },
);
