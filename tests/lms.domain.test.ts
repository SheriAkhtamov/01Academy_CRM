import { describe, expect, it } from "vitest";
import {
  lmsQuizSchema,
  lmsAssignmentSchema,
  lmsDraftSchema,
} from "@shared/contracts/lms";
import {
  progressMetric,
  quizQuestionsForPortal,
  requireAssignmentOpen,
  requirePortalPermission,
  scoreQuiz,
  shouldDiscloseQuiz,
} from "../server/modules/lms/domain/policy";
import type { PortalActorContext } from "../server/modules/portal-identity/domain/actor-context";
const questions = [
  {
    id: "one",
    text: "Single",
    type: "single" as const,
    weight: 1,
    options: [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
    ],
    correctOptionIds: ["a"],
    explanation: "Explanation",
  },
  {
    id: "many",
    text: "Multiple",
    type: "multiple" as const,
    weight: 2,
    options: [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
      { id: "c", text: "C" },
    ],
    correctOptionIds: ["a", "c"],
    explanation: "Explanation",
  },
];
describe("LMS learning domain", () => {
  it("keeps empty denominators unknown and attendance separate from assignment completion", () => {
    expect(progressMetric(0, 0)).toEqual({
      completed: 0,
      total: 0,
      percent: null,
    });
    expect(progressMetric(2, 3).percent).toBe(66.7);
  });
  it("requires exact multi-select answer and compares pass threshold before rounding", () => {
    expect(scoreQuiz(questions, { one: ["a"], many: ["a"] }, 33.34)).toEqual({
      score: 1,
      totalScore: 3,
      percent: 33.3,
      passed: false,
    });
    expect(
      scoreQuiz(questions, { one: ["b"], many: ["c", "a"] }, 66.66).passed,
    ).toBe(true);
    expect(scoreQuiz(questions, { many: ["a", "b", "c"] }, 1).score).toBe(0);
  });
  it("never exposes answer keys or explanations in active question DTOs", () => {
    const serialized = JSON.stringify(quizQuestionsForPortal(questions));
    expect(serialized).not.toContain("correctOptionIds");
    expect(serialized).not.toContain("explanation");
    expect(serialized).toContain("options");
  });
  it("discloses control answers only on configured server condition", () => {
    const now = new Date("2026-10-11T10:00:00Z");
    expect(
      shouldDiscloseQuiz("closed", true, "2026-10-11T11:00:00Z", 3, 3, now),
    ).toBe(false);
    expect(shouldDiscloseQuiz("exhausted", true, null, 2, 3, now)).toBe(false);
    expect(
      shouldDiscloseQuiz("closed", true, "2026-10-11T09:00:00Z", 1, 3, now),
    ).toBe(true);
    expect(shouldDiscloseQuiz("practice", false, null, 3, 3, now)).toBe(false);
  });
  it("prevents a representative from submitting or taking tests even with forged capability", () => {
    const actor = {
      kind: "representative",
      permissions: ["assignments.submit", "quizzes.attempt"],
    } as PortalActorContext;
    expect(() =>
      requirePortalPermission(actor, "assignments.submit", true),
    ).toThrow("portalAccessDenied");
    expect(() =>
      requirePortalPermission(actor, "quizzes.attempt", true),
    ).toThrow("portalAccessDenied");
  });
  it("accepts late assignments unless explicitly hard closed, using server time", () => {
    const row = {
      status: "assigned",
      opensAt: "2026-10-10T00:00:00Z",
      closesAt: null,
    };
    expect(() =>
      requireAssignmentOpen(row, new Date("2026-10-11T00:00:00Z")),
    ).not.toThrow();
    expect(() =>
      requireAssignmentOpen(
        { ...row, closesAt: "2026-10-10T12:00:00Z" },
        new Date("2026-10-11T00:00:00Z"),
      ),
    ).toThrow("lmsAssignmentClosed");
  });
  it("rejects malformed criteria, unsafe content, and answer keys outside their options", () => {
    const base = {
      runId: 1,
      title: "Assignment",
      body: "Practice",
      opensAt: "2026-10-11T00:00:00Z",
      dueAt: null,
      recipientEnrollmentIds: [1],
    };
    expect(
      lmsAssignmentSchema.safeParse({
        ...base,
        criteria: [{ id: "x", title: "X", weight: 20 }],
      }).success,
    ).toBe(false);
    expect(
      lmsDraftSchema.safeParse({ version: 0, text: "<script>bad()</script>" })
        .success,
    ).toBe(false);
    expect(() =>
      lmsDraftSchema.safeParse({ version: 0, links: ["not a URL"] }),
    ).not.toThrow();
    expect(
      lmsDraftSchema.safeParse({ version: 0, links: ["not a URL"] }).success,
    ).toBe(false);
    expect(
      lmsQuizSchema.safeParse({
        runId: 1,
        title: "Quiz",
        opensAt: base.opensAt,
        recipientEnrollmentIds: [1],
        questions: [{ ...questions[0], correctOptionIds: ["z"] }],
      }).success,
    ).toBe(false);
  });
});
