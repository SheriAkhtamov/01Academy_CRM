import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import type { LmsQuizAttemptDto } from "@shared/contracts/lms";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { portalLmsApi, PortalApiError } from "../portal-app/api";
import {
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

export function PortalQuizzes({
  courseId,
  quizId,
}: {
  courseId?: number;
  quizId?: number;
}) {
  const { t } = useTranslation();
  const message = usePortalError();
  const { subject, allowed, guarded } = usePortal();
  const invalidate = useInvalidateSubject();
  const [attempt, setAttempt] = useState<LmsQuizAttemptDto | null>(null);
  const [title, setTitle] = useState("");
  const [runId, setRunId] = useState<number | undefined>(courseId);
  const query = useSubjectQuery(
    "quizzes",
    portalLmsApi.quizzes,
    [],
    allowed("learning.read") ? "learning.read" : "feedback.read",
  );
  const result = useMutation({
    mutationFn: (id: number) => portalLmsApi.quizResults(subject!.linkId, id),
    onSuccess: setAttempt,
  });
  const start = useMutation({
    mutationFn: (id: number) => portalLmsApi.startQuiz(subject!.linkId, id),
    onSuccess: setAttempt,
  });
  if (query.isPending) return <PortalLoading />;
  if (query.error)
    return (
      <PortalError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  const items = query.data.filter(
    (item) =>
      (!courseId || item.runId === courseId) && (!quizId || item.id === quizId),
  );
  return (
    <>
      <PortalTitle labelKey="portalTests" />
      {items.length === 0 && <PortalEmpty labelKey="portalNoTests" />}
      {(start.error || result.error) && (
        <p role="alert" className="text-destructive">
          {message(start.error || result.error)}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {items.map((item) => (
          <Card key={item.id}>
            <CardHeader>
              <CardTitle className="text-lg">{item.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
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
              {item.latestFinishedAttemptId && allowed("feedback.read") && (
                <Button
                  variant="outline"
                  className="min-h-11"
                  disabled={result.isPending}
                  onClick={() => {
                    setTitle(item.title);
                    setRunId(item.runId);
                    result.mutate(item.id);
                  }}
                >
                  {t("portalTestResult")}
                </Button>
              )}
              {allowed("quizzes.attempt", true) && (
                <Button
                  className="min-h-11"
                  disabled={
                    start.isPending ||
                    (item.attemptsUsed >= item.maxAttempts &&
                      !item.activeAttemptId)
                  }
                  onClick={() => {
                    setTitle(item.title);
                    setRunId(item.runId);
                    start.mutate(item.id);
                  }}
                >
                  {t(
                    item.activeAttemptId
                      ? "portalResumeTest"
                      : "portalStartTest",
                  )}
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      <Dialog
        open={Boolean(attempt)}
        onOpenChange={(open) => {
          if (!open)
            guarded(() => {
              setAttempt(null);
              void invalidate();
            });
        }}
      >
        <DialogContent className="portal-ui max-w-2xl">
          <DialogTitle>{title || t("portalTests")}</DialogTitle>
          <DialogDescription>{subject?.studentName}</DialogDescription>
          {attempt && (
            <QuizAttempt
              key={`${subject?.linkId}:${attempt.id}`}
              initial={attempt}
              onChange={setAttempt}
              runId={runId}
              title={title}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
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
  const [now, setNow] = useState(Date.now());
  const [offset] = useState(+new Date(initial.serverTime) - Date.now());
  const question = attempt.questions[index];
  const checked = selection ?? attempt.answers[question?.id] ?? [];
  const save = useMutation({
    mutationFn: (optionIds: string[]) =>
      portalLmsApi.answer(subject!.linkId, attempt.id, question.id, {
        version: attempt.version,
        optionIds,
      }),
    onSuccess: (data) => {
      setAttempt(data);
      onChange?.(data);
      setSelection(null);
    },
  });
  const end = useMutation({
    mutationFn: () =>
      portalLmsApi.finishQuiz(subject!.linkId, attempt.id, attempt.version),
    onSuccess: (data) => {
      setAttempt(data);
      onChange?.(data);
      setFinish(false);
      void invalidate();
    },
  });
  const reload = useMutation({
    mutationFn: () => portalLmsApi.attempt(subject!.linkId, attempt.id),
    onSuccess: (data) => {
      setAttempt(data);
      onChange?.(data);
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
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [attempt.state, attempt.deadlineAt]);
  useEffect(() => {
    if (
      attempt.state === "active" &&
      attempt.deadlineAt &&
      now + offset >= +new Date(attempt.deadlineAt) &&
      subject
    ) {
      void portalLmsApi
        .attempt(subject.linkId, attempt.id)
        .then((data) => {
          setAttempt(data);
          onChange?.(data);
        })
        .catch(() => {});
    }
  }, [
    now,
    offset,
    attempt.deadlineAt,
    attempt.state,
    attempt.id,
    subject,
    onChange,
  ]);
  const active = attempt.state === "active" && allowed("quizzes.attempt", true);
  const unanswered = attempt.questions.filter(
    (item) => !attempt.answers[item.id]?.length,
  ).length;
  if (!active)
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">{t("portalTestResult")}</h2>
        <p className="text-3xl font-semibold">
          {attempt.percent?.toFixed(1) ?? "—"}%
        </p>
        <p>{t(attempt.passed ? "portalPassed" : "portalNotPassed")}</p>
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
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => setHelp(true)}
          >
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
  return (
    <div className="space-y-5">
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
        <legend className="mb-4 text-lg font-medium">{question.text}</legend>
        {question.options.map((option) => (
          <label
            key={option.id}
            className="flex min-h-12 cursor-pointer items-start gap-3 rounded-md border p-3"
          >
            <input
              className="mt-1 h-4 w-4"
              type={question.type === "multiple" ? "checkbox" : "radio"}
              name={question.id}
              checked={checked.includes(option.id)}
              disabled={
                save.isPending ||
                end.isPending ||
                Boolean(
                  attempt.deadlineAt &&
                  now + offset >= +new Date(attempt.deadlineAt),
                )
              }
              onChange={() => {
                const ids =
                  question.type === "multiple"
                    ? checked.includes(option.id)
                      ? checked.filter((id) => id !== option.id)
                      : [...checked, option.id]
                    : [option.id];
                setSelection(ids);
                save.mutate(ids);
              }}
            />
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
      <div className="flex flex-wrap justify-between gap-3">
        <Button
          variant="outline"
          className="min-h-11"
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
            className="min-h-11"
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
            className="min-h-11"
            disabled={save.isPending || selection !== null || end.isPending}
            onClick={() => setFinish(true)}
          >
            {t("portalFinishTest")}
          </Button>
        )}
      </div>
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
        <Button
          key={item.publicationId}
          variant="outline"
          className="min-h-11 w-full justify-start whitespace-normal text-left"
          onClick={() =>
            guarded(() =>
              navigate(
                `/learn/courses/${item.runId}/materials/${item.publicationId}`,
              ),
            )
          }
        >
          {item.title}
        </Button>
      ))}
    </section>
  );
}
