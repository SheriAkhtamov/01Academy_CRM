import type { PortalActorContext } from "../../portal-identity/domain/actor-context";
import type { LmsProgressMetric, LmsQuizInput } from "@shared/contracts/lms";
export type LmsStaffActor = {
  userId: number;
  isLeadership: boolean;
  modules: readonly string[];
  requestId?: string;
};
export class LmsError extends Error {
  fieldErrors?: Record<string, string>;
  constructor(
    public readonly code: string,
    public readonly statusCode = 400,
  ) {
    super(code);
  }
}
export const requirePortalPermission = (
  actor: PortalActorContext,
  permission: string,
  selfOnly = false,
) => {
  if (
    !actor.permissions.includes(
      permission as (typeof actor.permissions)[number],
    ) ||
    (selfOnly && actor.kind !== "self")
  )
    throw new LmsError("portalAccessDenied", 403);
};
export const progressMetric = (
  completed: number,
  total: number,
): LmsProgressMetric => ({
  completed,
  total,
  percent: total > 0 ? Math.round((completed / total) * 1000) / 10 : null,
});
export const scoreQuiz = (
  questions: LmsQuizInput["questions"],
  answers: Record<string, string[]>,
  passPercent: number,
) => {
  let score = 0;
  const totalScore = questions.reduce(
    (sum, question) => sum + question.weight,
    0,
  );
  if (totalScore <= 0) throw new LmsError("lmsQuizQuestionsInvalid");
  for (const question of questions) {
    const selected = new Set(answers[question.id] ?? []);
    const correct = new Set(question.correctOptionIds);
    if (
      selected.size === correct.size &&
      [...selected].every((id) => correct.has(id))
    )
      score += question.weight;
  }
  const rawPercent = (score / totalScore) * 100;
  return {
    score,
    totalScore,
    percent: Math.round(rawPercent * 10) / 10,
    passed: rawPercent >= passPercent,
  };
};
export const shouldDiscloseQuiz = (
  disclosure: LmsQuizInput["disclosure"],
  finished: boolean,
  closesAt: string | null,
  attemptsUsed: number,
  maxAttempts: number,
  now: Date,
) =>
  finished &&
  (disclosure === "practice" ||
    (disclosure === "closed" && !!closesAt && +new Date(closesAt) <= +now) ||
    (disclosure === "exhausted" && attemptsUsed >= maxAttempts));
export const quizQuestionsForPortal = (questions: LmsQuizInput["questions"]) =>
  questions.map(
    ({ correctOptionIds: _correct, explanation: _explanation, ...question }) =>
      question,
  );
export const requireVersion = (actual: number, expected: number) => {
  if (actual !== expected) throw new LmsError("lmsVersionConflict", 409);
};
export const requireAssignmentOpen = (
  row: { status: string; opensAt: string; closesAt: string | null },
  now: Date,
) => {
  if (!["assigned", "revision_required"].includes(row.status))
    throw new LmsError("lmsAssignmentStateConflict", 409);
  if (
    +new Date(row.opensAt) > +now ||
    (row.closesAt && +new Date(row.closesAt) <= +now)
  )
    throw new LmsError("lmsAssignmentClosed", 409);
};
