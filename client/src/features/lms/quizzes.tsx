import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import type { LmsQuizAttemptDto, LmsQuizDto } from "@shared/contracts/lms";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { portalLmsApi, PortalApiError } from "../portal-app/api";
import {
  PortalFormScope,
  usePortalFormScope,
  usePortal,
  useSubjectQuery,
  useInvalidateSubject,
} from "../portal-app/context";
import {
  PortalDialogContent as DialogContent,
  PortalLoading,
  PortalError,
  PortalEmpty,
  PortalTitle,
  ConfirmAction,
  usePortalError,
  usePortalFormat,
} from "../portal-app/ui";
import { HelpDialog } from "./communication";
import { PortalActionRow } from "../portal-app/controls";

export function PortalQuizzes({
  courseId,
  quizId,
  embedded = false,
}: {
  courseId?: number;
  quizId?: number;
  embedded?: boolean;
}) {
  const quizScope = usePortalFormScope();
  const { t } = useTranslation();
  const { subject, allowed } = usePortal();
  const invalidate = useInvalidateSubject();
  const [selected, setSelected] = useState<{
    quiz: LmsQuizDto;
    result: boolean;
  } | null>(null);
  const query = useSubjectQuery(
    "quizzes",
    portalLmsApi.quizzes,
    [],
    allowed("learning.read") ? "learning.read" : "feedback.read",
  );
  if (query.isPending)
    return <PortalLoading variant={embedded ? "section" : "page"} />;
  if (query.error && query.data === undefined)
    return (
      <PortalError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  const items = (query.data ?? []).filter(
    (item) =>
      (!courseId || item.runId === courseId) && (!quizId || item.id === quizId),
  );
  return (
    <>
      {embedded ? (
        <h2 className="text-base font-semibold">{t("portalTests")}</h2>
      ) : (
        <PortalTitle labelKey="portalTests" />
      )}
      {query.error && (
        <PortalError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      )}
      {items.length === 0 && <PortalEmpty labelKey="portalNoTests" />}
      <div className="grid gap-4 md:grid-cols-2">
        {items.map((item) => (
          <Card key={item.id}>
            <CardHeader className="p-4 pb-0">
              <CardTitle className="text-base">{item.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4 text-sm">
              <p className="whitespace-pre-wrap text-sm">{item.instructions}</p>
              <p>
                {t("portalAttemptsRemaining")}:{" "}
                {Math.max(0, item.maxAttempts - item.attemptsUsed)}
              </p>
              {item.bestPercent !== null && (
                <p>
                  {t("portalBestResult")}: {item.bestPercent.toFixed(1)}% ·{" "}
                  {t(item.passed ? "portalPassed" : "portalNotPassed")}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/70 pt-3">
                {item.latestFinishedAttemptId && allowed("feedback.read") && (
                  <Button
                    variant="outline"
                    onClick={() => setSelected({ quiz: item, result: true })}
                  >
                    {t("portalTestResult")}
                  </Button>
                )}
                {allowed("quizzes.attempt", true) && (
                  <Button
                    disabled={
                      item.attemptsUsed >= item.maxAttempts &&
                      !item.activeAttemptId
                    }
                    onClick={() => setSelected({ quiz: item, result: false })}
                  >
                    {t("portalOpen")}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <PortalFormScope id={quizScope.id}>
        <Dialog
          open={Boolean(selected)}
          onOpenChange={(open) => {
            if (!open)
              quizScope.guarded(() => {
                setSelected(null);
                void invalidate();
              });
          }}
        >
          <DialogContent className="portal-ui max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {selected?.quiz.title || t("portalTests")}
              </DialogTitle>
              <DialogDescription>{subject?.studentName}</DialogDescription>
            </DialogHeader>
            {selected && (
              <QuizSession
                key={`${subject?.linkId}:${selected.quiz.id}:${selected.result}`}
                quiz={selected.quiz}
                readOnly={selected.result}
              />
            )}
          </DialogContent>
        </Dialog>
      </PortalFormScope>
    </>
  );
}
function QuizSession({
  quiz,
  readOnly,
}: {
  quiz: LmsQuizDto;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const message = usePortalError();
  const { subject, allowed, setUnsaved } = usePortal();
  const invalidate = useInvalidateSubject();
  const [attempt, setAttempt] = useState<LmsQuizAttemptDto | null>(null);
  const result = useSubjectQuery(
    "quiz-result",
    (link) => portalLmsApi.quizResults(link, quiz.id),
    [quiz.id],
    "feedback.read",
    readOnly,
  );
  const start = useMutation({
    mutationFn: () => portalLmsApi.startQuiz(subject!.linkId, quiz.id),
    onSuccess: (data) => {
      setAttempt(data);
      void invalidate();
    },
  });
  useEffect(() => {
    setUnsaved(start.isPending);
    return () => setUnsaved(false);
  }, [start.isPending, setUnsaved]);
  if (readOnly) {
    if (result.isPending) return <PortalLoading variant="section" />;
    if (result.error)
      return (
        <PortalError
          error={result.error}
          retry={() => {
            void result.refetch();
          }}
        />
      );
  }
  const current = readOnly ? result.data : attempt;
  if (current)
    return (
      <QuizAttempt initial={current} runId={quiz.runId} title={quiz.title} />
    );
  return (
    <div className="space-y-4 text-sm">
      <p className="whitespace-pre-wrap">{quiz.instructions}</p>
      <p>
        {t("portalAttemptsRemaining")}:{" "}
        {Math.max(0, quiz.maxAttempts - quiz.attemptsUsed)}
      </p>
      {start.isPending && <PortalLoading variant="section" />}
      {start.error && (
        <p role="alert" className="text-destructive">
          {message(start.error, "portalSaveError")}
        </p>
      )}
      {allowed("quizzes.attempt", true) && (
        <DialogFooter className="border-t border-border/70 pt-4">
          <Button
            disabled={
              start.isPending ||
              (quiz.attemptsUsed >= quiz.maxAttempts && !quiz.activeAttemptId)
            }
            onClick={() => start.mutate()}
          >
            {t(quiz.activeAttemptId ? "portalResumeTest" : "portalStartTest")}
          </Button>
        </DialogFooter>
      )}
    </div>
  );
}
export function QuizAttempt({
  initial,
  onChange,
  runId,
  title,
}: {
  initial: LmsQuizAttemptDto;
  onChange?: (attempt: LmsQuizAttemptDto) => void;
  runId?: number;
  title?: string;
}) {
  const { t } = useTranslation();
  const message = usePortalError();
  const format = usePortalFormat();
  const { subject, allowed, setUnsaved } = usePortal();
  const invalidate = useInvalidateSubject();
  const [help, setHelp] = useState(false);
  const [attempt, setAttempt] = useState(initial);
  const [index, setIndex] = useState(0);
  const [selection, setSelection] = useState<string[] | null>(null);
  const [finish, setFinish] = useState(false);
  const [reloadOpen, setReloadOpen] = useState(false);
  const [now, setNow] = useState(() => performance.now());
  const [serverClock, setServerClock] = useState(() => ({
    serverTime: +new Date(initial.serverTime),
    receivedAt: performance.now(),
  }));
  const serverNow =
    serverClock.serverTime + Math.max(0, now - serverClock.receivedAt);
  const syncAttempt = useCallback(
    (data: LmsQuizAttemptDto) => {
      const receivedAt = performance.now();
      setAttempt(data);
      setServerClock({ serverTime: +new Date(data.serverTime), receivedAt });
      setNow(receivedAt);
      if (data.state !== "active") setSelection(null);
      onChange?.(data);
    },
    [onChange],
  );
  const question = attempt.questions[index];
  const checked = selection ?? attempt.answers[question?.id] ?? [];
  const save = useMutation({
    mutationFn: (optionIds: string[]) =>
      portalLmsApi.answer(subject!.linkId, attempt.id, question.id, {
        version: attempt.version,
        optionIds,
      }),
    onSuccess: (data) => {
      syncAttempt(data);
      setSelection(null);
    },
  });
  const end = useMutation({
    mutationFn: () =>
      portalLmsApi.finishQuiz(subject!.linkId, attempt.id, attempt.version),
    onSuccess: (data) => {
      syncAttempt(data);
      setFinish(false);
      void invalidate();
    },
  });
  const reload = useMutation({
    mutationFn: () => portalLmsApi.attempt(subject!.linkId, attempt.id),
    onSuccess: (data) => {
      syncAttempt(data);
      setSelection(null);
      setReloadOpen(false);
      save.reset();
    },
  });
  const conflict =
    save.error instanceof PortalApiError && save.error.status === 409;
  useEffect(() => {
    setUnsaved(selection !== null);
    return () => setUnsaved(false);
  }, [selection, setUnsaved]);
  useEffect(() => {
    if (attempt.state !== "active" || !attempt.deadlineAt) return;
    const interval = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(interval);
  }, [attempt.state, attempt.deadlineAt]);
  useEffect(() => {
    if (
      attempt.state === "active" &&
      attempt.deadlineAt &&
      serverNow >= +new Date(attempt.deadlineAt) &&
      subject
    ) {
      void portalLmsApi
        .attempt(subject.linkId, attempt.id)
        .then(syncAttempt)
        .catch(() => {});
    }
  }, [
    serverNow,
    attempt.deadlineAt,
    attempt.state,
    attempt.id,
    subject,
    syncAttempt,
  ]);
  const active = attempt.state === "active" && allowed("quizzes.attempt", true);
  const unanswered = attempt.questions.filter(
    (item) => !attempt.answers[item.id]?.length,
  ).length;
  if (!active)
    return (
      <div className="space-y-4 text-sm">
        <h2 className="text-base font-semibold">{t("portalTestResult")}</h2>
        <p className="text-[26px] font-bold tabular-nums tracking-tight">
          {attempt.percent?.toFixed(1) ?? "—"}%
        </p>
        <Badge variant={attempt.passed ? "success" : "warning"}>
          {t(attempt.passed ? "portalPassed" : "portalNotPassed")}
        </Badge>
        {attempt.score !== null && (
          <p>
            {t("portalPoints")}: {attempt.score} / {attempt.totalScore}
          </p>
        )}
        {attempt.disclosure?.map((item) => (
          <div
            key={item.questionId}
            className="space-y-2 rounded-md border p-4"
          >
            <h3 className="font-medium">
              {
                attempt.questions.find((value) => value.id === item.questionId)
                  ?.text
              }
            </h3>
            <p>
              {attempt.questions
                .find((value) => value.id === item.questionId)
                ?.options.filter((option) =>
                  item.correctOptionIds.includes(option.id),
                )
                .map((option) => option.text)
                .join(", ")}
            </p>
            <p className="whitespace-pre-wrap">{item.explanation}</p>
          </div>
        ))}
        {allowed("learning.read") &&
          Boolean(attempt.relatedMaterials?.length) && (
            <QuizRelatedMaterials items={attempt.relatedMaterials!} />
          )}
        {runId && allowed("communication.create") && (
          <Button variant="outline" onClick={() => setHelp(true)}>
            {t("portalNeedHelp")}
          </Button>
        )}
        <HelpDialog
          open={help}
          onClose={() => setHelp(false)}
          runId={runId}
          quizAttemptId={attempt.id}
        />
      </div>
    );
  const answerDisabled =
    save.isPending ||
    end.isPending ||
    Boolean(attempt.deadlineAt && serverNow >= +new Date(attempt.deadlineAt));
  const chooseOption = (optionId: string) => {
    const ids =
      question.type === "multiple"
        ? checked.includes(optionId)
          ? checked.filter((id) => id !== optionId)
          : [...checked, optionId]
        : [optionId];
    setSelection(ids);
    save.mutate(ids);
  };
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap justify-between gap-3">
        <p>
          {t("portalQuestionNumber")
            .replace("{number}", String(index + 1))
            .replace("{total}", String(attempt.questions.length))}
        </p>
        {attempt.deadlineAt && (
          <p className="text-sm">
            {t("portalDeadline")}: {format.time(attempt.deadlineAt)}
          </p>
        )}
      </div>
      <Progress
        value={
          (100 * (attempt.questions.length - unanswered)) /
          attempt.questions.length
        }
        aria-label={t("portalProgress")}
      />
      <fieldset className="space-y-3">
        <legend className="mb-3 text-base font-semibold">
          {question.text}
        </legend>
        {question.options.map((option) => (
          <label
            key={option.id}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/50 ${checked.includes(option.id) ? "border-primary/40 bg-primary/5" : "border-border/70"}`}
          >
            {question.type === "multiple" ? (
              <Checkbox
                className="mt-0.5"
                checked={checked.includes(option.id)}
                disabled={answerDisabled}
                onCheckedChange={() => chooseOption(option.id)}
              />
            ) : (
              <input
                className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                type="radio"
                name={question.id}
                checked={checked.includes(option.id)}
                disabled={answerDisabled}
                onChange={() => chooseOption(option.id)}
              />
            )}
            <span className="min-w-0 break-words">{option.text}</span>
          </label>
        ))}
      </fieldset>
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {save.isPending
          ? t("portalSaving")
          : save.error
            ? message(save.error, "portalSaveError")
            : t("portalSaved")}
      </p>
      {save.error && selection && (
        <Button
          variant="outline"
          disabled={save.isPending}
          onClick={() =>
            conflict ? setReloadOpen(true) : save.mutate(selection)
          }
        >
          {t(conflict ? "lmsStaffReload" : "portalRetry")}
        </Button>
      )}
      <DialogFooter className="border-t border-border/70 pt-4 sm:justify-between">
        <Button
          variant="outline"
          disabled={index === 0 || save.isPending || selection !== null}
          onClick={() => {
            setIndex(index - 1);
            save.reset();
          }}
        >
          {t("portalBack")}
        </Button>
        {index < attempt.questions.length - 1 ? (
          <Button
            disabled={save.isPending || selection !== null}
            onClick={() => {
              setIndex(index + 1);
              save.reset();
            }}
          >
            {t("portalNext")}
          </Button>
        ) : (
          <Button
            disabled={save.isPending || selection !== null || end.isPending}
            onClick={() => setFinish(true)}
          >
            {t("portalFinishTest")}
          </Button>
        )}
      </DialogFooter>
      <ConfirmAction
        open={finish}
        onOpenChange={setFinish}
        titleKey="portalFinishTestTitle"
        objectName={title}
        description={t("portalUnanswered").replace(
          "{count}",
          String(unanswered),
        )}
        action="portalFinishTest"
        pending={end.isPending}
        error={end.error ? message(end.error, "portalSaveError") : undefined}
        onConfirm={() => end.mutate()}
      />
      <ConfirmAction
        open={reloadOpen}
        onOpenChange={setReloadOpen}
        titleKey="portalReloadTestTitle"
        objectName={title}
        description="portalReloadTestDescription"
        action="lmsStaffReload"
        pending={reload.isPending}
        error={
          reload.error ? message(reload.error, "portalLoadError") : undefined
        }
        onConfirm={() => reload.mutate()}
      />
    </div>
  );
}
function QuizRelatedMaterials({
  items,
}: {
  items: NonNullable<LmsQuizAttemptDto["relatedMaterials"]>;
}) {
  const { t } = useTranslation();
  const { guarded } = usePortal();
  const [, navigate] = useLocation();
  return (
    <section className="space-y-2">
      <h3 className="font-semibold">{t("portalRepeatMaterials")}</h3>
      {items.map((item) => (
        <PortalActionRow
          key={item.publicationId}
          onClick={() =>
            guarded(() =>
              navigate(
                `/learn/courses/${item.runId}/materials/${item.publicationId}`,
              ),
            )
          }
        >
          {item.title}
        </PortalActionRow>
      ))}
    </section>
  );
}
