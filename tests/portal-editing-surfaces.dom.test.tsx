// @vitest-environment jsdom
import type { ReactNode } from "react";
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
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  PortalProjectComparisonDto,
  PortalProjectDto,
} from "@shared/contracts/portal-resources";
import type { LmsQuizAttemptDto, LmsQuizDto } from "@shared/contracts/lms";
import type { PortalSessionDto } from "@shared/contracts/portal-identity";
import { i18n } from "../client/src/lib/i18n";
import { ProjectComparison } from "../client/src/features/lms/progress";
import { PortalQuizzes } from "../client/src/features/lms/quizzes";
import { PortalApiError } from "../client/src/features/portal-app/api";
import {
  PortalSessionProvider,
  portalSessionKey,
} from "../client/src/features/portal-app/context";

const mocks = vi.hoisted(() => ({
  projects: vi.fn(),
  comparison: vi.fn(),
  save: vi.fn(),
  quizzes: vi.fn(),
  start: vi.fn(),
  answer: vi.fn(),
  results: vi.fn(),
}));
vi.mock("../client/src/features/portal-app/realtime", () => ({
  usePortalRealtime: vi.fn(),
}));
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
        projectComparison: mocks.comparison,
        saveComparison: mocks.save,
      },
    };
  },
);
vi.mock("../client/src/features/portal-app/api", async (importActual) => {
  const actual =
    await importActual<
      typeof import("../client/src/features/portal-app/api")
    >();
  return {
    ...actual,
    portalLmsApi: {
      ...actual.portalLmsApi,
      quizzes: mocks.quizzes,
      startQuiz: mocks.start,
      answer: mocks.answer,
      quizResults: mocks.results,
    },
  };
});

const session: PortalSessionDto = {
  account: {
    id: 50,
    login: "learner",
    fullName: "Learner",
    email: null,
    phone: null,
    locale: "en",
    status: "active",
  },
  subjects: [
    {
      linkId: 10,
      studentId: 20,
      studentName: "Learner",
      kind: "self",
      relationship: null,
      studentClassification: "adult",
      status: "active",
      permissions: [
        "learning.read",
        "portfolio.edit",
        "feedback.read",
        "quizzes.attempt",
      ],
    },
  ],
  csrfToken: "editing-test",
};
const projects: PortalProjectDto[] = [1, 2, 3].map((id) => ({
  id,
  studentId: 20,
  runId: 2,
  courseName: "Design",
  title: `Project ${id}`,
  description: `Description ${id}`,
  sourceSubmissionId: null,
  links: [],
  files: [],
  coverFileId: null,
  teacherReview: null,
  version: 1,
  createdAt: `2026-10-0${id}T10:00:00Z`,
  updatedAt: "2026-10-11T10:00:00Z",
  archivedAt: null,
  shares: [],
}));
const comparison = (
  first = 1,
  latest = 3,
  version = 1,
): PortalProjectComparisonDto => ({
  firstProjectId: first,
  latestProjectId: latest,
  runId: 2,
  selectedByName: "Learner",
  selectedByRole: "student",
  version,
  updatedAt: "2026-10-11T10:00:00Z",
  firstProject: projects.find((project) => project.id === first)!,
  latestProject: projects.find((project) => project.id === latest)!,
});
const quiz: LmsQuizDto = {
  id: 7,
  recipientId: 7,
  runId: 2,
  title: "Test A",
  instructions: "Choose one answer",
  required: true,
  opensAt: "2026-10-01T00:00:00Z",
  closesAt: null,
  maxAttempts: 2,
  passPercent: 70,
  timerSeconds: null,
  attemptsUsed: 0,
  activeAttemptId: null,
  latestFinishedAttemptId: null,
  bestPercent: null,
  passed: false,
  status: "open",
};
const attempt: LmsQuizAttemptDto = {
  id: 30,
  recipientId: 7,
  quizVersionId: 1,
  attemptNumber: 1,
  version: 1,
  state: "active",
  startedAt: "2026-10-12T10:00:00Z",
  deadlineAt: null,
  serverTime: "2026-10-12T10:00:00Z",
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let client: QueryClient;
const mount = (children: ReactNode) =>
  render(
    <QueryClientProvider client={client}>
      <PortalSessionProvider>{children}</PortalSessionProvider>
    </QueryClientProvider>,
  );
const editor = () =>
  screen.getByRole("dialog", { name: i18n.t("portalEditComparison") });
const firstSelect = () =>
  within(editor()).getByRole("combobox", { name: i18n.t("portalFirstWork") });
const openEditor = async () => {
  await userEvent.click(
    await screen.findByRole("button", { name: i18n.t("portalEditComparison") }),
  );
};
const selectFirst = async (name: string) => {
  await userEvent.click(firstSelect());
  await userEvent.click(await screen.findByRole("option", { name }));
};
const closeDialog = async () => {
  await userEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: i18n.t("close"),
    }),
  );
};
const discard = async () => {
  await userEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: i18n.t("portalLeave"),
    }),
  );
};

beforeEach(() => {
  vi.resetAllMocks();
  i18n.setLanguage("en");
  sessionStorage.clear();
  history.replaceState(null, "", "/learn/progress");
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  client.setQueryData(portalSessionKey, session);
  mocks.projects.mockResolvedValue(projects);
  mocks.comparison.mockResolvedValue(comparison());
  mocks.save.mockResolvedValue(comparison(2, 3, 2));
  mocks.quizzes.mockResolvedValue([quiz]);
  mocks.start.mockResolvedValue(attempt);
  mocks.answer.mockResolvedValue({
    ...attempt,
    version: 2,
    answers: { q1: ["a"] },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
});

it("keeps comparison viewing on the page and saves edited choices only from its scoped dialog", async () => {
  const pending = deferred<PortalProjectComparisonDto>();
  mocks.save.mockReturnValue(pending.promise);
  mount(<ProjectComparison />);
  await screen.findByRole("button", { name: i18n.t("portalEditComparison") });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    screen.queryByRole("combobox", { name: i18n.t("portalFirstWork") }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: i18n.t("portalComparisonSave") }),
  ).toBeNull();
  await openEditor();
  await selectFirst("Project 2");
  const save = within(editor()).getByRole("button", {
    name: i18n.t("portalComparisonSave"),
  });
  await userEvent.click(save);
  await waitFor(() =>
    expect(mocks.save).toHaveBeenCalledWith(10, {
      runId: 2,
      firstProjectId: 2,
      latestProjectId: 3,
      version: 1,
    }),
  );
  expect(firstSelect().hasAttribute("disabled")).toBe(true);
  mocks.comparison.mockResolvedValue(comparison(2, 3, 2));
  await act(async () => pending.resolve(comparison(2, 3, 2)));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByText("Description 2")).toBeTruthy();
  expect(
    screen.queryByRole("combobox", { name: i18n.t("portalFirstWork") }),
  ).toBeNull();
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(false);
});

it("keeps a failed comparison draft inside the dialog until explicit discard and reopens canonical choices", async () => {
  mocks.save.mockRejectedValue(new PortalApiError(0, "portalOffline"));
  mount(<ProjectComparison />);
  await openEditor();
  await selectFirst("Project 2");
  await userEvent.click(
    within(editor()).getByRole("button", {
      name: i18n.t("portalComparisonSave"),
    }),
  );
  await within(editor()).findByRole("alert");
  await closeDialog();
  await userEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: i18n.t("portalCancel"),
    }),
  );
  expect(firstSelect().textContent).toBe("Project 2");
  await closeDialog();
  await discard();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await openEditor();
  expect(firstSelect().textContent).toBe("Project 1");
  await closeDialog();
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

it("does not expose comparison editing to a representative", async () => {
  client.setQueryData(portalSessionKey, {
    ...session,
    subjects: [
      {
        ...session.subjects[0],
        kind: "representative",
        relationship: "parent",
        permissions: ["learning.read", "feedback.read"],
      },
    ],
  });
  mount(<ProjectComparison />);
  await screen.findByText("Description 1");
  expect(
    screen.queryByRole("button", { name: i18n.t("portalEditComparison") }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: i18n.t("portalComparisonSave") }),
  ).toBeNull();
  expect(mocks.save).not.toHaveBeenCalled();
});

it("retains the comparison dialog and draft after a confirmed reload fails", async () => {
  mocks.save.mockRejectedValue(new PortalApiError(409, "lmsVersionConflict"));
  mount(<ProjectComparison />);
  await openEditor();
  await selectFirst("Project 2");
  await userEvent.click(
    within(editor()).getByRole("button", {
      name: i18n.t("portalComparisonSave"),
    }),
  );
  await within(editor()).findByRole("alert");
  mocks.comparison.mockRejectedValue(new PortalApiError(0, "portalOffline"));
  await userEvent.click(
    within(editor()).getByRole("button", { name: i18n.t("lmsStaffReload") }),
  );
  const confirmation = screen.getByRole("alertdialog");
  await userEvent.click(
    within(confirmation).getByRole("button", {
      name: i18n.t("lmsStaffReload"),
    }),
  );
  await within(confirmation).findByRole("alert");
  expect(screen.getByRole("alertdialog")).toBe(confirmation);
  await userEvent.click(
    within(confirmation).getByRole("button", { name: i18n.t("portalCancel") }),
  );
  expect(firstSelect().textContent).toBe("Project 2");
  expect(
    within(editor()).getByRole("button", { name: i18n.t("portalRetry") }),
  ).toBeTruthy();
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
});

it("does not close a reopened comparison editor when a discarded pending save resolves", async () => {
  const pending = deferred<PortalProjectComparisonDto>();
  mocks.save.mockReturnValue(pending.promise);
  mount(<ProjectComparison />);
  await openEditor();
  await selectFirst("Project 2");
  await userEvent.click(
    within(editor()).getByRole("button", {
      name: i18n.t("portalComparisonSave"),
    }),
  );
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  await closeDialog();
  await discard();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await openEditor();
  await selectFirst("Project 2");
  mocks.comparison.mockResolvedValue(comparison(2, 3, 2));
  await act(async () => pending.resolve(comparison(2, 3, 2)));
  expect(editor()).toBeTruthy();
  expect(firstSelect().textContent).toBe("Project 2");
});

it.each([false, true])(
  "opens the quiz dialog before starting an attempt (embedded=%s)",
  async (embedded) => {
    const pending = deferred<LmsQuizAttemptDto>();
    mocks.start.mockReturnValue(pending.promise);
    mount(<PortalQuizzes embedded={embedded} />);
    await userEvent.click(
      await screen.findByRole("button", { name: i18n.t("portalOpen") }),
    );
    const dialog = screen.getByRole("dialog", { name: "Test A" });
    expect(mocks.start).not.toHaveBeenCalled();
    const start = within(dialog).getByRole("button", {
      name: i18n.t("portalStartTest"),
    });
    await userEvent.click(start);
    await waitFor(() => expect(mocks.start).toHaveBeenCalledWith(10, 7));
    expect(start.hasAttribute("disabled")).toBe(true);
    expect(
      within(dialog).getByRole("status", { name: i18n.t("portalLoading") }),
    ).toBeTruthy();
    await act(async () => pending.resolve(attempt));
    const option = await within(dialog).findByRole("radio", {
      name: "Option A",
    });
    expect(option.closest('[role="dialog"]')).toBe(dialog);
    await userEvent.click(option);
    await waitFor(() =>
      expect(mocks.answer).toHaveBeenCalledWith(10, 30, "q1", {
        version: 1,
        optionIds: ["a"],
      }),
    );
  },
);

it("keeps quiz startup errors and retry inside the dialog", async () => {
  mocks.start.mockRejectedValueOnce(new PortalApiError(0, "portalOffline"));
  mount(<PortalQuizzes />);
  await userEvent.click(
    await screen.findByRole("button", { name: i18n.t("portalOpen") }),
  );
  const dialog = screen.getByRole("dialog");
  await userEvent.click(
    within(dialog).getByRole("button", { name: i18n.t("portalStartTest") }),
  );
  expect(
    (await within(dialog).findByRole("alert")).closest('[role="dialog"]'),
  ).toBe(dialog);
  await userEvent.click(
    within(dialog).getByRole("button", { name: i18n.t("portalStartTest") }),
  );
  await within(dialog).findByRole("radio", { name: "Option A" });
  expect(mocks.start).toHaveBeenCalledTimes(2);
});

it("keeps the active attempt open when its background quiz-list refresh fails", async () => {
  mocks.quizzes
    .mockResolvedValueOnce([quiz])
    .mockRejectedValue(new PortalApiError(0, "portalOffline"));
  mount(<PortalQuizzes />);
  await userEvent.click(
    await screen.findByRole("button", { name: i18n.t("portalOpen") }),
  );
  await userEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: i18n.t("portalStartTest"),
    }),
  );
  await within(screen.getByRole("dialog")).findByRole("radio", {
    name: "Option A",
  });
  await waitFor(() => expect(mocks.quizzes).toHaveBeenCalledTimes(2));
  const dialog = screen.getByRole("dialog", { name: "Test A" });
  expect(within(dialog).getByRole("radio", { name: "Option A" })).toBeTruthy();
  await userEvent.click(
    within(dialog).getByRole("radio", { name: "Option A" }),
  );
  await waitFor(() => expect(mocks.answer).toHaveBeenCalledOnce());
});

it("ignores a late closed quiz startup instead of replacing another selected test", async () => {
  const pending = deferred<LmsQuizAttemptDto>();
  mocks.start.mockReturnValue(pending.promise);
  mocks.quizzes.mockResolvedValue([
    quiz,
    { ...quiz, id: 8, recipientId: 8, runId: 3, title: "Test B" },
  ]);
  mount(<PortalQuizzes />);
  const open = await screen.findAllByRole("button", {
    name: i18n.t("portalOpen"),
  });
  await userEvent.click(open[0]);
  await userEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: i18n.t("portalStartTest"),
    }),
  );
  await waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
  await closeDialog();
  await discard();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await userEvent.click(
    screen.getAllByRole("button", { name: i18n.t("portalOpen") })[1],
  );
  await act(async () => pending.resolve(attempt));
  const second = screen.getByRole("dialog", { name: "Test B" });
  expect(within(second).queryByRole("radio")).toBeNull();
  expect(
    within(second).getByRole("button", { name: i18n.t("portalStartTest") }),
  ).toBeTruthy();
  expect(mocks.start).toHaveBeenCalledOnce();
});

it("lets a representative view a result inside the dialog without a startup action", async () => {
  client.setQueryData(portalSessionKey, {
    ...session,
    subjects: [
      {
        ...session.subjects[0],
        kind: "representative",
        relationship: "parent",
        permissions: ["feedback.read"],
      },
    ],
  });
  mocks.quizzes.mockResolvedValue([{ ...quiz, latestFinishedAttemptId: 30 }]);
  mocks.results.mockResolvedValue({
    ...attempt,
    state: "finished",
    percent: 100,
    passed: true,
    score: 1,
    totalScore: 1,
  });
  mount(<PortalQuizzes />);
  await userEvent.click(
    await screen.findByRole("button", { name: i18n.t("portalTestResult") }),
  );
  const dialog = screen.getByRole("dialog");
  await within(dialog).findByText("100.0%");
  expect(
    within(dialog).queryByRole("button", { name: i18n.t("portalStartTest") }),
  ).toBeNull();
  expect(mocks.start).not.toHaveBeenCalled();
});
