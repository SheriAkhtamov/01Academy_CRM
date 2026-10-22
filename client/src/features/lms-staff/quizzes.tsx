import { isLmsLearningRecipient } from "@shared/contracts/lms";
import { DateTimeInput } from '@/components/ui/date-time-input';
import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  lmsQuizSchema,
  type LmsQuizInput,
  type LmsStaffEnrollmentDto,
  type LmsStaffQuizRecipientDto,
} from "@shared/contracts/lms";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { lmsStaffApi } from "./api";
import { useStaffQuery, useStaffInvalidate } from "./queries";
import {
  StaffDialog,
  StaffField,
  StaffLoading,
  StaffError,
  StaffEmpty,
  StaffRecipients,
  StaffConfirm,
  staffDateInput,
  staffDateIso,
  useStaffError,
} from "./ui";
export function StaffQuizzes({
  runId,
  enrollments,
}: {
  runId: number;
  enrollments: LmsStaffEnrollmentDto[];
}) {
  const { t } = useTranslation();
  const [create, setCreate] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const query = useStaffQuery("quizzes", runId, (signal) =>
    lmsStaffApi.quizzes(runId, signal),
  );
  if (query.isPending) return <StaffLoading />;
  if (query.error)
    return (
      <StaffError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between gap-3">
        <h2 className="text-xl font-semibold">{t("lmsStaffQuizzes")}</h2>
        <Button onClick={() => setCreate(true)}>{t("lmsStaffPublish")}</Button>
      </div>
      {!query.data.length && <StaffEmpty />}
      <div className="grid gap-4 md:grid-cols-2">
        {query.data.map((item) => (
          <Card key={item.id}>
            <CardContent className="space-y-3 p-4">
              <h3 className="break-words font-semibold">{item.title}</h3>
              <p className="text-sm">
                {t("lmsStaffPassPercent")}: {item.passPercent}%
              </p>
              <Button variant="outline" onClick={() => setSelected(item.id)}>
                {t("lmsStaffQuizResults")}
              </Button>
              <p className="text-sm">
                {t("lmsStaffAttemptLimit")}: {item.maxAttempts}
              </p>
              <p className="text-sm">
                {t("lmsStaffRecipientsCount").replace(
                  "{count}",
                  String(item.recipientCount),
                )}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      {create && (
        <QuizEditor
          runId={runId}
          enrollments={enrollments}
          onClose={() => setCreate(false)}
        />
      )}
      {selected && (
        <QuizResults id={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
function QuizResults({ id, onClose }: { id: number; onClose: () => void }) {
  const { t } = useTranslation();
  const message = useStaffError();
  const invalidate = useStaffInvalidate();
  const query = useStaffQuery("quiz-detail", id, (signal) =>
    lmsStaffApi.quiz(id, signal),
  );
  const [recipient, setRecipient] = useState<LmsStaffQuizRecipientDto | null>(
    null,
  );
  const [reason, setReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );
  const action = useMutation({
    mutationFn: () =>
      lmsStaffApi.extraAttempt(recipient!.id, reason, idempotencyKey),
    onSuccess: () => {
      setRecipient(null);
      setReason("");
      void invalidate();
      void query.refetch();
    },
  });
  return (
    <StaffDialog
      open
      onClose={onClose}
      titleKey="lmsStaffQuizResults"
      description={query.data?.title}
      pending={action.isPending}
    >
      {query.isPending ? (
        <StaffLoading />
      ) : query.error ? (
        <StaffError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      ) : (
        <div className="space-y-4">
          {query.data?.recipients.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"
            >
              <div className="min-w-0 space-y-1">
                <p className="break-words font-medium">{item.studentName}</p>
                <p className="text-sm">
                  {t("lmsStaffAttemptLimit")}: {item.attemptsUsed}/
                  {item.maxAttempts}
                </p>
                <p className="text-sm">
                  {t("lmsStaffScore")}:{" "}
                  {item.bestPercent === null ? "—" : `${item.bestPercent}%`}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setRecipient(item);
                  setReason("");
                  setIdempotencyKey(crypto.randomUUID());
                }}
              >
                {t("lmsStaffExtraAttempt")}
              </Button>
            </div>
          ))}
        </div>
      )}
      {recipient && (
        <StaffDialog
          open
          onClose={() => setRecipient(null)}
          titleKey="lmsStaffExtraAttempt"
          description={recipient.studentName}
          dirty={Boolean(reason)}
          pending={action.isPending}
        >
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              action.mutate();
            }}
          >
            <StaffField id="extra-attempt-reason" labelKey="lmsStaffReason">
              <Textarea
                id="extra-attempt-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                required
                maxLength={2000}
              />
            </StaffField>
            {action.error && (
              <p role="alert" className="text-sm text-destructive">
                {message(action.error)}
              </p>
            )}
            <Button disabled={action.isPending || !reason.trim()}>
              {t("lmsStaffExtraAttempt")}
            </Button>
          </form>
        </StaffDialog>
      )}
    </StaffDialog>
  );
}
export function QuizEditor({
  runId,
  enrollments,
  onClose,
}: {
  runId: number;
  enrollments: LmsStaffEnrollmentDto[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const errorText = useStaffError();
  const invalidate = useStaffInvalidate();
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [required, setRequired] = useState(true);
  const [opens, setOpens] = useState(staffDateInput(new Date().toISOString()));
  const [close, setClose] = useState("");
  const [pass, setPass] = useState("70");
  const [maxAttempts, setMaxAttempts] = useState("3");
  const [timer, setTimer] = useState(false);
  const [seconds, setSeconds] = useState("600");
  const [disclosure, setDisclosure] = useState<
    "practice" | "closed" | "exhausted"
  >("practice");
  const [shuffleQuestions, setShuffleQuestions] = useState(false);
  const [shuffleOptions, setShuffleOptions] = useState(false);
  const [questions, setQuestions] = useState<LmsQuizInput["questions"]>([]);
  const [remove, setRemove] = useState<string | null>(null);
  const [selected, setSelected] = useState(
    enrollments
      .filter(isLmsLearningRecipient)
      .map((item) => item.id),
  );
  const [validation, setValidation] = useState("");
  const action = useMutation({
    mutationFn: lmsStaffApi.createQuiz,
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });
  const addQuestion = () =>
    setQuestions((items) => [
      ...items,
      {
        id: crypto.randomUUID(),
        text: "",
        type: "single",
        weight: 1,
        options: [
          { id: crypto.randomUUID(), text: "" },
          { id: crypto.randomUUID(), text: "" },
        ],
        correctOptionIds: [],
        explanation: "",
      },
    ]);
  const updateQuestion = (
    id: string,
    change: Partial<LmsQuizInput["questions"][number]>,
  ) =>
    setQuestions((items) =>
      items.map((item) => (item.id === id ? { ...item, ...change } : item)),
    );
  function submit(event: FormEvent) {
    event.preventDefault();
    setValidation("");
    if (!selected.length) {
      setValidation(t("lmsStaffNoRecipients"));
      return;
    }
    const parsed = lmsQuizSchema.safeParse({
      idempotencyKey,
      runId,
      title,
      instructions,
      required,
      opensAt: staffDateIso(opens),
      closesAt: close ? staffDateIso(close) : null,
      passPercent: Number(pass),
      maxAttempts: Number(maxAttempts),
      timerSeconds: timer ? Number(seconds) : null,
      disclosure,
      shuffleQuestions,
      shuffleOptions,
      questions,
      recipientEnrollmentIds: selected,
    });
    if (!parsed.success) {
      setValidation(t("lmsStaffInvalidQuiz"));
      return;
    }
    action.mutate(parsed.data);
  }
  return (
    <StaffDialog
      open
      onClose={onClose}
      titleKey="lmsStaffQuizzes"
      dirty={Boolean(title || instructions || questions.length)}
      pending={action.isPending}
    >
      <form onSubmit={submit} className="space-y-5">
        <StaffField id="quiz-title" labelKey="lmsStaffTitleField">
          <Input
            id="quiz-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            maxLength={255}
          />
        </StaffField>
        <StaffField id="quiz-instructions" labelKey="lmsStaffBody">
          <Textarea
            id="quiz-instructions"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            rows={3}
          />
        </StaffField>
        <div className="grid gap-4 sm:grid-cols-2">
          <StaffField id="quiz-opens" labelKey="lmsStaffOpensAt">
            <DateTimeInput
              id="quiz-opens"
              value={opens}
              onValueChange={(value) => setOpens(value)}
              required
            />
          </StaffField>
          <StaffField id="quiz-close" labelKey="lmsStaffHardClose">
            <DateTimeInput
              id="quiz-close"
              value={close}
              onValueChange={(value) => setClose(value)}
              required={disclosure === "closed"}
            />
          </StaffField>
          <StaffField id="quiz-pass" labelKey="lmsStaffPassPercent">
            <Input
              id="quiz-pass"
              type="number"
              min={0}
              max={100}
              value={pass}
              onChange={(event) => setPass(event.target.value)}
              required
            />
          </StaffField>
          <StaffField id="quiz-attempts" labelKey="lmsStaffAttemptLimit">
            <Input
              id="quiz-attempts"
              type="number"
              min={1}
              max={20}
              value={maxAttempts}
              onChange={(event) => setMaxAttempts(event.target.value)}
              required
            />
          </StaffField>
          <StaffField id="quiz-disclosure" labelKey="lmsStaffDisclosure">
            <select
              id="quiz-disclosure"
              className="min-h-11 w-full rounded-md border bg-background px-3"
              value={disclosure}
              onChange={(event) =>
                setDisclosure(event.target.value as typeof disclosure)
              }
            >
              <option value="practice">
                {t("lmsStaffDisclosurePractice")}
              </option>
              <option value="closed">{t("lmsStaffDisclosureClosed")}</option>
              <option value="exhausted">
                {t("lmsStaffDisclosureExhausted")}
              </option>
            </select>
          </StaffField>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={required}
              onChange={(event) => setRequired(event.target.checked)}
            />
            {t("lmsStaffRequired")}
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={timer}
              onChange={(event) => setTimer(event.target.checked)}
            />
            {t("lmsStaffTimerSeconds")}
          </label>
        </div>
        {timer && (
          <StaffField id="quiz-timer" labelKey="lmsStaffTimerSeconds">
            <Input
              id="quiz-timer"
              type="number"
              min={30}
              max={86400}
              value={seconds}
              onChange={(event) => setSeconds(event.target.value)}
              required
            />
          </StaffField>
        )}
        <div className="space-y-2">
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={shuffleQuestions}
              onChange={(event) => setShuffleQuestions(event.target.checked)}
            />
            {t("lmsStaffShuffleQuestions")}
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={shuffleOptions}
              onChange={(event) => setShuffleOptions(event.target.checked)}
            />
            {t("lmsStaffShuffleOptions")}
          </label>
        </div>
        <div className="space-y-4">
          {questions.map((question, index) => (
            <fieldset
              key={question.id}
              className="space-y-4 rounded-xl border p-4"
            >
              <legend className="px-2 font-semibold">
                {t("lmsStaffQuestion")} {index + 1}
              </legend>
              <StaffField
                id={`quiz-question-${question.id}`}
                labelKey="lmsStaffQuestion"
              >
                <Textarea
                  id={`quiz-question-${question.id}`}
                  value={question.text}
                  onChange={(event) =>
                    updateQuestion(question.id, { text: event.target.value })
                  }
                  required
                />
              </StaffField>
              <div className="grid gap-4 sm:grid-cols-2">
                <select
                  aria-label={t("lmsStaffQuestion")}
                  className="min-h-11 w-full rounded-md border bg-background px-3"
                  value={question.type}
                  onChange={(event) => {
                    const type = event.target.value as typeof question.type;
                    if (type === "boolean") {
                      updateQuestion(question.id, {
                        type,
                        options: [
                          { id: "true", text: t("lmsStaffTrue") },
                          { id: "false", text: t("lmsStaffFalse") },
                        ],
                        correctOptionIds: [],
                      });
                    } else
                      updateQuestion(question.id, {
                        type,
                        correctOptionIds:
                          type === "single"
                            ? question.correctOptionIds.slice(0, 1)
                            : question.correctOptionIds,
                      });
                  }}
                >
                  <option value="single">{t("lmsStaffSingle")}</option>
                  <option value="multiple">{t("lmsStaffMultiple")}</option>
                  <option value="boolean">{t("lmsStaffBoolean")}</option>
                </select>
                <StaffField
                  id={`quiz-weight-${question.id}`}
                  labelKey="lmsStaffScore"
                >
                  <Input
                    id={`quiz-weight-${question.id}`}
                    type="number"
                    min={1}
                    max={1000}
                    value={question.weight}
                    onChange={(event) =>
                      updateQuestion(question.id, {
                        weight: Number(event.target.value),
                      })
                    }
                    required
                  />
                </StaffField>
              </div>
              <div className="space-y-3">
                {question.options.map((option, optionIndex) => (
                  <div
                    key={option.id}
                    className="grid gap-2 rounded-md bg-muted/30 p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <StaffField
                      id={`quiz-option-${question.id}-${option.id}`}
                      labelKey="lmsStaffOption"
                    >
                      <Input
                        id={`quiz-option-${question.id}-${option.id}`}
                        value={option.text}
                        onChange={(event) =>
                          updateQuestion(question.id, {
                            options: question.options.map((item) =>
                              item.id === option.id
                                ? { ...item, text: event.target.value }
                                : item,
                            ),
                          })
                        }
                        required
                        disabled={question.type === "boolean"}
                      />
                    </StaffField>
                    <label className="flex min-h-11 items-center gap-2">
                      <input
                        type={
                          question.type === "multiple" ? "checkbox" : "radio"
                        }
                        name={`correct-${question.id}`}
                        checked={question.correctOptionIds.includes(option.id)}
                        onChange={(event) =>
                          updateQuestion(question.id, {
                            correctOptionIds:
                              question.type === "multiple"
                                ? event.target.checked
                                  ? [...question.correctOptionIds, option.id]
                                  : question.correctOptionIds.filter(
                                      (id) => id !== option.id,
                                    )
                                : [option.id],
                          })
                        }
                      />
                      {t("lmsStaffCorrectAnswer")} {optionIndex + 1}
                    </label>
                  </div>
                ))}
              </div>
              {question.type !== "boolean" && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={question.options.length >= 20}
                  onClick={() =>
                    updateQuestion(question.id, {
                      options: [
                        ...question.options,
                        { id: crypto.randomUUID(), text: "" },
                      ],
                    })
                  }
                >
                  {t("lmsStaffAddOption")}
                </Button>
              )}
              <StaffField
                id={`quiz-explanation-${question.id}`}
                labelKey="lmsStaffExplanation"
              >
                <Textarea
                  id={`quiz-explanation-${question.id}`}
                  value={question.explanation}
                  onChange={(event) =>
                    updateQuestion(question.id, {
                      explanation: event.target.value,
                    })
                  }
                />
              </StaffField>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setRemove(question.id)}
              >
                {t("portalRemove")}
              </Button>
            </fieldset>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={questions.length >= 100}
          onClick={addQuestion}
        >
          {t("lmsStaffAddQuestion")}
        </Button>
        <StaffRecipients
          items={enrollments}
          selected={selected}
          onChange={setSelected}
        />
        {(validation || action.error) && (
          <p role="alert" className="text-sm text-destructive">
            {validation || errorText(action.error)}
          </p>
        )}
        <div className="flex justify-end">
          <Button disabled={action.isPending}>{t("lmsStaffPublish")}</Button>
        </div>
      </form>
      <StaffConfirm
        open={remove !== null}
        onOpenChange={(open) => {
          if (!open) setRemove(null);
        }}
        titleKey="lmsStaffRemoveQuestionTitle"
        description="lmsStaffRemoveQuestionBody"
        action="portalRemove"
        onConfirm={() => {
          setQuestions((items) => items.filter((item) => item.id !== remove));
          setRemove(null);
        }}
      />
    </StaffDialog>
  );
}
