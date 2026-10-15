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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LmsQuizAttemptDto } from "@shared/contracts/lms";
import { i18n } from "../client/src/lib/i18n";
import { QuizAttempt } from "../client/src/features/lms/quizzes";
import { PortalApiError } from "../client/src/features/portal-app/api";

const mocks = vi.hoisted(() => ({
  answer: vi.fn(),
  attempt: vi.fn(),
  finish: vi.fn(),
  start: vi.fn(),
  unsaved: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("../client/src/features/portal-app/context", () => ({
  PortalFormScope: ({ children }: { children: ReactNode }) => children,
  usePortalFormScope: () => ({
    id: "quiz-clock",
    guarded: (action: () => void) => action(),
  }),
  usePortal: () => ({
    subject: { linkId: 10, studentName: "Learner", kind: "self" },
    allowed: () => true,
    guarded: (action: () => void) => action(),
    setUnsaved: mocks.unsaved,
  }),
  useInvalidateSubject: () => mocks.invalidate,
  useSubjectQuery: vi.fn(),
}));
vi.mock("../client/src/features/portal-app/api", async (importActual) => {
  const actual =
    await importActual<
      typeof import("../client/src/features/portal-app/api")
    >();
  return {
    ...actual,
    portalLmsApi: {
      ...actual.portalLmsApi,
      answer: mocks.answer,
      attempt: mocks.attempt,
      finishQuiz: mocks.finish,
      startQuiz: mocks.start,
    },
  };
});
const initial: LmsQuizAttemptDto = {
  id: 30,
  recipientId: 7,
  quizVersionId: 1,
  attemptNumber: 1,
  version: 1,
  state: "active",
  startedAt: "2026-10-12T10:00:00Z",
  deadlineAt: "2026-10-12T10:00:20Z",
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
const closed: LmsQuizAttemptDto = {
  ...initial,
  version: 3,
  state: "finished",
  serverTime: "2026-10-12T10:00:20Z",
  finishedAt: "2026-10-12T10:00:20Z",
  answers: { q1: ["a"] },
  score: 1,
  totalScore: 1,
  percent: 100,
  passed: true,
};
let client: QueryClient;
const mount = () =>
  render(
    <QueryClientProvider client={client}>
      <QuizAttempt initial={initial} />
    </QueryClientProvider>,
  );
const advance = async (milliseconds: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
};
beforeEach(() => {
  i18n.setLanguage("ru");
  vi.clearAllMocks();
  vi.useFakeTimers({
    toFake: ["Date", "performance", "setInterval", "clearInterval"],
  });
  vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  mocks.answer.mockResolvedValue({
    ...initial,
    version: 2,
    serverTime: "2026-10-12T10:00:05Z",
    answers: { q1: ["a"] },
  });
  mocks.attempt.mockResolvedValue(closed);
});
afterEach(async () => {
  cleanup();
  client.clear();
  vi.useRealTimers();
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.restoreAllMocks();
});

describe("server-authoritative quiz time", () => {
  it.each([
    ["forward", "2031-10-12T10:00:00Z"],
    ["backward", "2020-10-12T10:00:00Z"],
  ])(
    "keeps answers available after a %s wall-clock jump and closes from the saved server attempt",
    async (_direction, changedTime) => {
      mount();
      vi.setSystemTime(new Date(changedTime));
      await advance(1000);
      const option = screen.getByRole("radio", { name: "Option A" });
      expect(option.hasAttribute("disabled")).toBe(false);
      expect(mocks.attempt).not.toHaveBeenCalled();
      await userEvent.click(option);
      await waitFor(() =>
        expect(mocks.answer).toHaveBeenCalledWith(10, 30, "q1", {
          version: 1,
          optionIds: ["a"],
        }),
      );
      await screen.findByText(i18n.t("portalSaved"));
      expect((option as HTMLInputElement).checked).toBe(true);
      await advance(15_000);
      expect(await screen.findByText(i18n.t("portalTestResult"))).toBeTruthy();
      expect(mocks.attempt).toHaveBeenCalledWith(10, 30);
      expect(screen.queryByRole("radio")).toBeNull();
      expect(mocks.start).not.toHaveBeenCalled();
      expect(mocks.finish).not.toHaveBeenCalled();
    },
  );

  it("uses an active server poll to keep the answer available until the server closes it", async () => {
    mocks.attempt
      .mockResolvedValueOnce({ ...initial, serverTime: "2026-10-12T10:00:19Z" })
      .mockResolvedValueOnce(closed);
    mount();
    vi.setSystemTime(new Date("2031-10-12T10:00:00Z"));
    await advance(20_000);
    await waitFor(() => expect(mocks.attempt).toHaveBeenCalledOnce());
    expect(
      screen.getByRole("radio", { name: "Option A" }).hasAttribute("disabled"),
    ).toBe(false);
    await advance(1000);
    expect(await screen.findByText(i18n.t("portalTestResult"))).toBeTruthy();
    expect(mocks.attempt).toHaveBeenCalledTimes(2);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("accepts a closed server result from a confirmed conflict reload after a backward clock jump", async () => {
    mocks.answer.mockRejectedValue(
      new PortalApiError(409, "lmsVersionConflict"),
    );
    mount();
    await userEvent.click(screen.getByRole("radio", { name: "Option A" }));
    await screen.findByText(i18n.t("lmsVersionConflict"));
    vi.setSystemTime(new Date("2020-10-12T10:00:00Z"));
    await userEvent.click(
      screen.getByRole("button", { name: i18n.t("lmsStaffReload") }),
    );
    const warning = screen.getByRole("alertdialog");
    expect(mocks.attempt).not.toHaveBeenCalled();
    await userEvent.click(
      within(warning).getByRole("button", { name: i18n.t("lmsStaffReload") }),
    );
    expect(await screen.findByText(i18n.t("portalTestResult"))).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(mocks.attempt).toHaveBeenCalledOnce();
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
