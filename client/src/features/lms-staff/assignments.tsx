import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  lmsAssignmentSchema,
  type LmsStaffEnrollmentDto,
  type LmsStaffRecipientDto,
  type LmsStaffAssignmentDto,
  type LmsStaffAssignmentDetailDto,
} from "@shared/contracts/lms";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LearningText } from "../learning-content/text";
import { LmsStaffApiError, lmsStaffApi } from "./api";
import { useStaffQuery, useStaffInvalidate, useStaffRuns } from "./queries";
import {
  StaffDialog,
  StaffField,
  StaffLoading,
  StaffError,
  StaffEmpty,
  StaffRecipients,
  StaffConfirm,
  StaffStatus,
  staffDateInput,
  staffDateIso,
  useStaffError,
  useStaffFormat,
} from "./ui";
import { StaffEditor } from "./editor";
import { StaffUploads } from "./files";
import { ReviewSheet } from "./reviews";
export function StaffAssignments({
  runId,
  enrollments,
  canReview = false,
}: {
  runId: number;
  enrollments: LmsStaffEnrollmentDto[];
  canReview?: boolean;
}) {
  const { t } = useTranslation();
  const date = useStaffFormat();
  const query = useStaffQuery("assignments", runId, (signal) =>
    lmsStaffApi.assignments(runId, signal),
  );
  const [create, setCreate] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [newStudents, setNewStudents] = useState(false);
  const [copy, setCopy] = useState<LmsStaffAssignmentDetailDto | null>(null);
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{t("lmsStaffAssignments")}</h2>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!query.data.length}
            onClick={() => setNewStudents(true)}
          >
            {t("lmsStaffNewStudents")}
          </Button>
          <Button onClick={() => setCreate(true)}>
            {t("lmsStaffAddAssignment")}
          </Button>
        </div>
      </div>
      {!query.data.length && <StaffEmpty />}
      <div className="space-y-3">
        {query.data.map((item) => (
          <Card key={item.id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div className="min-w-0 space-y-2">
                <h3 className="break-words font-semibold">{item.title}</h3>
                {item.dueAt && (
                  <p className="text-sm text-muted-foreground">
                    {t("lmsStaffDueAt")}: {date(item.dueAt)}
                  </p>
                )}
                <div className="flex flex-wrap gap-3 text-sm">
                  <span>
                    {t("lmsStaffRecipientsCount").replace(
                      "{count}",
                      String(item.recipientCount),
                    )}
                  </span>
                  <span>
                    {t("portalAccepted")}: {item.acceptedCount}
                  </span>
                  <span>
                    {t("portalSubmitted")}: {item.submittedCount}
                  </span>
                  <span>
                    {t("portalRevisionRequired")}: {item.revisionCount}
                  </span>
                </div>
              </div>
              <Button variant="outline" onClick={() => setSelected(item.id)}>
                {t("portalOpen")}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      {create && (
        <AssignmentEditor
          runId={runId}
          enrollments={enrollments}
          onClose={() => setCreate(false)}
        />
      )}
      <AssignmentDetails
        id={selected}
        runId={runId}
        onClose={() => setSelected(null)}
        canReview={canReview}
        onCopy={(assignment) => {
          setSelected(null);
          setCopy(assignment);
        }}
      />
      {newStudents && (
        <AssignNewStudents
          runId={runId}
          enrollments={enrollments}
          assignments={query.data}
          onClose={() => setNewStudents(false)}
        />
      )}
      {copy && <CopyAssignment initial={copy} onClose={() => setCopy(null)} />}
    </div>
  );
}
function AssignmentEditor({
  runId,
  enrollments,
  onClose,
  initial,
}: {
  runId: number;
  enrollments: LmsStaffEnrollmentDto[];
  onClose: () => void;
  initial?: LmsStaffAssignmentDetailDto;
}) {
  const { t } = useTranslation();
  const message = useStaffError();
  const invalidate = useStaffInvalidate();
  const units = useStaffQuery("units", runId, (signal) =>
    lmsStaffApi.units(runId, signal),
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [unit, setUnit] = useState("");
  const [opens, setOpens] = useState(staffDateInput(new Date().toISOString()));
  const [due, setDue] = useState("");
  const [close, setClose] = useState("");
  const [required, setRequired] = useState(initial?.required ?? true);
  const [mode, setMode] = useState<"acceptance" | "points">(
    initial?.gradingMode ?? "acceptance",
  );
  const [maxScore, setMaxScore] = useState(String(initial?.maxScore ?? 100));
  const [criteria, setCriteria] = useState<
    Array<{ id: string; title: string; weight: number }>
  >(initial?.criteria ?? []);
  const [remove, setRemove] = useState<string | null>(null);
  const [selected, setSelected] = useState(
    enrollments
      .filter((item) => item.status === "active")
      .map((item) => item.id),
  );
  const [allowed, setAllowed] = useState<Array<"text" | "links" | "files">>(
    (initial?.allowedAnswers ?? ["text", "links", "files"]) as Array<
      "text" | "links" | "files"
    >,
  );
  const [fileIds, setFileIds] = useState<number[]>(initial?.fileIds ?? []);
  const [idempotencyKey] = useState(crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState("");
  const action = useMutation({
    mutationFn: lmsStaffApi.createAssignment,
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    setValidation("");
    if (!selected.length) {
      setValidation(t("lmsStaffNoRecipients"));
      return;
    }
    if (
      criteria.length &&
      Math.abs(criteria.reduce((sum, item) => sum + item.weight, 0) - 100) >
        0.001
    ) {
      setValidation(t("lmsStaffInvalidCriteria"));
      return;
    }
    const parsed = lmsAssignmentSchema.safeParse({
      idempotencyKey,
      copySourceAssignmentId: initial?.id,
      copySourceAssignmentVersionId: initial?.assignmentVersionId,
      runId,
      unitId: unit ? Number(unit) : null,
      title,
      body,
      opensAt: staffDateIso(opens),
      dueAt: due ? staffDateIso(due) : null,
      closesAt: close ? staffDateIso(close) : null,
      required,
      gradingMode: mode,
      maxScore: mode === "points" ? Number(maxScore) : null,
      criteria,
      allowedAnswers: allowed,
      recipientEnrollmentIds: selected,
      fileIds,
    });
    if (!parsed.success) {
      setValidation(t("portalInvalidData"));
      return;
    }
    action.mutate(parsed.data);
  }
  return (
    <StaffDialog
      open
      onClose={onClose}
      titleKey={initial ? "lmsStaffCopyAssignment" : "lmsStaffAddAssignment"}
      dirty={Boolean(title || body || criteria.length || fileIds.length)}
      pending={action.isPending}
    >
      <form onSubmit={submit} className="space-y-5">
        <StaffField id="assignment-title" labelKey="lmsStaffTitleField">
          <Input
            id="assignment-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            maxLength={255}
          />
        </StaffField>
        <StaffField id="assignment-unit" labelKey="portalLessons">
          <select
            id="assignment-unit"
            className="min-h-11 w-full rounded-md border bg-background px-3"
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
          >
            <option value="">{t("lmsStaffNoLesson")}</option>
            {units.data?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </StaffField>
        <StaffField id="assignment-body" labelKey="lmsStaffBody">
          <StaffEditor
            id="assignment-body"
            value={body}
            onChange={setBody}
            required
          />
        </StaffField>
        <div className="grid gap-4 sm:grid-cols-2">
          <StaffField id="assignment-open" labelKey="lmsStaffOpensAt">
            <Input
              id="assignment-open"
              type="datetime-local"
              value={opens}
              onChange={(event) => setOpens(event.target.value)}
              required
            />
          </StaffField>
          <StaffField id="assignment-due" labelKey="lmsStaffDueAt">
            <Input
              id="assignment-due"
              type="datetime-local"
              value={due}
              onChange={(event) => setDue(event.target.value)}
            />
          </StaffField>
          <StaffField id="assignment-close" labelKey="lmsStaffHardClose">
            <Input
              id="assignment-close"
              type="datetime-local"
              value={close}
              onChange={(event) => setClose(event.target.value)}
            />
          </StaffField>
          <StaffField id="assignment-grade" labelKey="lmsStaffGradingMode">
            <select
              id="assignment-grade"
              className="min-h-11 w-full rounded-md border bg-background px-3"
              value={mode}
              onChange={(event) => setMode(event.target.value as typeof mode)}
            >
              <option value="acceptance">{t("lmsStaffAcceptance")}</option>
              <option value="points">{t("lmsStaffScore")}</option>
            </select>
          </StaffField>
          {mode === "points" && (
            <StaffField id="assignment-max" labelKey="lmsStaffMaxScore">
              <Input
                id="assignment-max"
                type="number"
                min={1}
                value={maxScore}
                onChange={(event) => setMaxScore(event.target.value)}
                required
              />
            </StaffField>
          )}
        </div>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            checked={required}
            onChange={(event) => setRequired(event.target.checked)}
          />
          {t("lmsStaffRequired")}
        </label>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("portalAnswer")}</legend>
          <div className="flex flex-wrap gap-4">
            {(["text", "links", "files"] as const).map((kind) => (
              <label key={kind} className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  checked={allowed.includes(kind)}
                  onChange={(event) =>
                    setAllowed(
                      event.target.checked
                        ? [...allowed, kind]
                        : allowed.filter((value) => value !== kind),
                    )
                  }
                />
                {t(
                  kind === "text"
                    ? "portalAnswer"
                    : kind === "links"
                      ? "portalLinks"
                      : "portalFiles",
                )}
              </label>
            ))}
          </div>
        </fieldset>
        <section className="space-y-3">
          <h3 className="font-medium">{t("portalCriteria")}</h3>
          {criteria.map((criterion, index) => (
            <div
              key={criterion.id}
              className="grid gap-3 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_100px_auto]"
            >
              <StaffField
                id={`criterion-title-${criterion.id}`}
                labelKey="lmsStaffTitleField"
              >
                <Input
                  id={`criterion-title-${criterion.id}`}
                  value={criterion.title}
                  onChange={(event) =>
                    setCriteria((items) =>
                      items.map((item) =>
                        item.id === criterion.id
                          ? { ...item, title: event.target.value }
                          : item,
                      ),
                    )
                  }
                  required
                />
              </StaffField>
              <StaffField
                id={`criterion-weight-${criterion.id}`}
                labelKey="lmsStaffWeight"
              >
                <Input
                  id={`criterion-weight-${criterion.id}`}
                  type="number"
                  min={1}
                  max={100}
                  value={criterion.weight}
                  onChange={(event) =>
                    setCriteria((items) =>
                      items.map((item) =>
                        item.id === criterion.id
                          ? { ...item, weight: Number(event.target.value) }
                          : item,
                      ),
                    )
                  }
                  required
                />
              </StaffField>
              <Button
                type="button"
                variant="ghost"
                aria-label={`${t("portalRemove")} ${index + 1}`}
                onClick={() => setRemove(criterion.id)}
              >
                {t("portalRemove")}
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setCriteria((items) => [
                ...items,
                { id: crypto.randomUUID(), title: "", weight: 100 },
              ])
            }
          >
            {t("lmsStaffAddCriterion")}
          </Button>
        </section>
        <StaffUploads
          fileRunIds={
            initial
              ? Object.fromEntries(
                  initial.fileIds.map((id) => [id, initial.runId]),
                )
              : undefined
          }
          runId={runId}
          ids={fileIds}
          onChange={setFileIds}
          onBusyChange={setBusy}
        />
        <StaffRecipients
          items={enrollments}
          selected={selected}
          onChange={setSelected}
        />
        {(validation || action.error) && (
          <p role="alert" className="text-sm text-destructive">
            {validation || message(action.error)}
          </p>
        )}
        <div className="flex justify-end">
          <Button disabled={action.isPending || busy}>
            {t("lmsStaffPublish")}
          </Button>
        </div>
      </form>
      <StaffConfirm
        open={remove !== null}
        onOpenChange={(open) => {
          if (!open) setRemove(null);
        }}
        titleKey="lmsStaffRemoveCriterionTitle"
        description="lmsStaffRemoveCriterionBody"
        action="portalRemove"
        onConfirm={() => {
          setCriteria((items) => items.filter((item) => item.id !== remove));
          setRemove(null);
        }}
      />
    </StaffDialog>
  );
}
function CopyAssignment({
  initial,
  onClose,
}: {
  initial: LmsStaffAssignmentDetailDto;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const runs = useStaffRuns();
  const [runId, setRunId] = useState(initial.runId);
  const [ready, setReady] = useState(false);
  const enrollments = useStaffQuery("enrollments", runId, (signal) =>
    lmsStaffApi.enrollments(runId, signal),
  );
  if (ready && enrollments.data)
    return (
      <AssignmentEditor
        runId={runId}
        enrollments={enrollments.data}
        initial={initial}
        onClose={onClose}
      />
    );
  return (
    <StaffDialog
      open
      onClose={onClose}
      titleKey="lmsStaffCopyAssignment"
      description={initial.title}
    >
      {runs.isPending || enrollments.isPending ? (
        <StaffLoading />
      ) : runs.error || enrollments.error ? (
        <StaffError
          error={runs.error ?? enrollments.error}
          retry={() => {
            void runs.refetch();
            void enrollments.refetch();
          }}
        />
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setReady(true);
          }}
        >
          <StaffField id="copy-assignment-run" labelKey="lmsStaffGroup">
            <select
              id="copy-assignment-run"
              className="min-h-11 w-full rounded-md border bg-background px-3"
              value={runId}
              onChange={(event) => setRunId(Number(event.target.value))}
            >
              {runs.data
                ?.filter(
                  (run) =>
                    run.runId &&
                    (!run.permissions ||
                      run.permissions.includes("assignments.manage")),
                )
                .map((run) => (
                  <option key={run.groupId} value={run.runId!}>
                    {run.courseName || t("lmsStaffCourseNotSelected")} ·{" "}
                    {run.groupName}
                  </option>
                ))}
            </select>
          </StaffField>
          <Button
            disabled={
              !enrollments.data?.some((student) => student.status === "active")
            }
          >
            {t("portalContinue")}
          </Button>
        </form>
      )}
    </StaffDialog>
  );
}
function AssignmentDetails({
  id,
  runId,
  onClose,
  canReview,
  onCopy,
}: {
  id: number | null;
  runId: number;
  onClose: () => void;
  canReview: boolean;
  onCopy: (assignment: LmsStaffAssignmentDetailDto) => void;
}) {
  const { t } = useTranslation();
  const query = useStaffQuery("assignment", id, (signal) =>
    lmsStaffApi.assignment(id!, signal),
  );
  const [recipient, setRecipient] = useState<LmsStaffRecipientDto | null>(null);
  const [correction, setCorrection] = useState<number | null>(null);
  return (
    <>
      <StaffDialog
        open={id !== null}
        onClose={onClose}
        titleKey="lmsStaffAssignments"
        description={query.data?.title}
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
          query.data && (
            <div className="space-y-5">
              <Button variant="outline" onClick={() => onCopy(query.data!)}>
                {t("lmsStaffCopyAssignment")}
              </Button>
              <LearningText text={query.data.body} />
              <div className="space-y-3">
                {query.data.recipients.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="break-words font-medium">
                        {item.studentName}
                      </p>
                      <StaffStatus state={item.status} />
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => setRecipient(item)}
                    >
                      {t("lmsStaffEdit")}
                    </Button>
                    {canReview &&
                      item.latestSubmissionId &&
                      ["accepted", "revision_required"].includes(
                        item.status,
                      ) && (
                        <Button
                          variant="outline"
                          onClick={() =>
                            setCorrection(item.latestSubmissionId!)
                          }
                        >
                          {t("lmsStaffCorrectReview")}
                        </Button>
                      )}
                  </div>
                ))}
              </div>
            </div>
          )
        )}
      </StaffDialog>
      {recipient && (
        <RecipientEditor
          key={recipient.id}
          recipient={recipient}
          canReview={canReview}
          onClose={() => setRecipient(null)}
          onSaved={() => {
            setRecipient(null);
            void query.refetch();
          }}
        />
      )}
      {canReview && correction && (
        <ReviewSheet
          id={correction}
          onClose={() => {
            setCorrection(null);
            void query.refetch();
          }}
          onNext={() => {
            setCorrection(null);
            void query.refetch();
          }}
        />
      )}
    </>
  );
}
function RecipientEditor({
  recipient,
  canReview,
  onClose,
  onSaved,
}: {
  recipient: LmsStaffRecipientDto;
  canReview: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const errorText = useStaffError();
  const invalidate = useStaffInvalidate();
  const [due, setDue] = useState(staffDateInput(recipient.dueAt));
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<
    "assigned" | "excused" | "cancelled" | "reopen" | ""
  >("");
  const [confirm, setConfirm] = useState(false);
  const action = useMutation({
    mutationFn: () => {
      if (status === "reopen" && !canReview)
        throw new LmsStaffApiError(403, "portalUnavailable");
      return status === "reopen"
        ? lmsStaffApi.reopenAssignment(recipient.id, {
            version: recipient.version,
            dueAt: due ? staffDateIso(due) : null,
            reason,
          })
        : lmsStaffApi.recipient(recipient.id, {
            version: recipient.version,
            dueAt: due ? staffDateIso(due) : null,
            ...(status
              ? { status: status as "assigned" | "excused" | "cancelled" }
              : {}),
            reason,
          });
    },
    onSuccess: () => {
      void invalidate();
      onSaved();
    },
  });
  return (
    <StaffDialog
      open
      onClose={onClose}
      titleKey="lmsStaffEdit"
      description={recipient.studentName}
      dirty={Boolean(reason)}
      pending={action.isPending}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (status === "reopen" && !canReview) return;
          if (status) setConfirm(true);
          else action.mutate();
        }}
      >
        <StaffField id="recipient-due" labelKey="lmsStaffDueAt">
          <Input
            id="recipient-due"
            type="datetime-local"
            value={due}
            onChange={(event) => setDue(event.target.value)}
          />
        </StaffField>
        <StaffField id="recipient-status" labelKey="portalAssignments">
          <select
            id="recipient-status"
            className="min-h-11 w-full rounded-md border bg-background px-3"
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="">{t("lmsStaffDueAt")}</option>
            {recipient.status === "accepted" ? (
              canReview && (
                <option value="reopen">{t("portalRevisionRequired")}</option>
              )
            ) : (
              <>
                <option value="excused">{t("portalExcused")}</option>
                <option value="cancelled">{t("portalCancelled")}</option>
              </>
            )}
          </select>
        </StaffField>
        <StaffField id="recipient-reason" labelKey="lmsStaffReason">
          <Textarea
            id="recipient-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
          />
        </StaffField>
        {action.error && (
          <p role="alert" className="text-sm text-destructive">
            {errorText(action.error)}
          </p>
        )}
        <Button
          disabled={action.isPending || (status === "reopen" && !canReview)}
        >
          {t("lmsStaffSave")}
        </Button>
      </form>
      <StaffConfirm
        open={confirm && (status !== "reopen" || canReview)}
        onOpenChange={setConfirm}
        titleKey="lmsStaffRecipientChangeTitle"
        description="lmsStaffRecipientChangeBody"
        action="lmsStaffSave"
        pending={action.isPending}
        error={action.error}
        onConfirm={() => action.mutate()}
      >
        <p>{recipient.studentName}</p>
      </StaffConfirm>
    </StaffDialog>
  );
}
function AssignNewStudents({
  runId,
  enrollments,
  assignments,
  onClose,
}: {
  runId: number;
  enrollments: LmsStaffEnrollmentDto[];
  assignments: LmsStaffAssignmentDto[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const errorText = useStaffError();
  const invalidate = useStaffInvalidate();
  const [enrollment, setEnrollment] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [due, setDue] = useState("");
  const [reason, setReason] = useState("");
  const [validation, setValidation] = useState("");
  const action = useMutation({
    mutationFn: () =>
      lmsStaffApi.assignEnrollment(runId, {
        enrollmentId: Number(enrollment),
        assignmentVersionIds: selected,
        opensAt: new Date().toISOString(),
        dueAt: due ? staffDateIso(due) : null,
        reason,
      }),
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });
  return (
    <StaffDialog
      open
      onClose={onClose}
      titleKey="lmsStaffNewStudents"
      dirty={Boolean(reason || selected.length)}
      pending={action.isPending}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!selected.length) {
            setValidation(t("portalInvalidData"));
            return;
          }
          action.mutate();
        }}
      >
        <StaffField id="new-student" labelKey="lmsStaffForStudent">
          <select
            id="new-student"
            className="min-h-11 w-full rounded-md border bg-background px-3"
            value={enrollment}
            onChange={(event) => setEnrollment(event.target.value)}
            required
          >
            <option value="">{t("lmsStaffRecipients")}</option>
            {enrollments
              .filter((item) => item.status === "active")
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.studentName}
                </option>
              ))}
          </select>
        </StaffField>
        <fieldset className="space-y-2">
          <legend>{t("lmsStaffAssignments")}</legend>
          {assignments.map((item) => (
            <label key={item.id} className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                checked={selected.includes(item.assignmentVersionId)}
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? [...selected, item.assignmentVersionId]
                      : selected.filter(
                          (id) => id !== item.assignmentVersionId,
                        ),
                  )
                }
              />
              {item.title}
            </label>
          ))}
        </fieldset>
        <StaffField id="new-student-due" labelKey="lmsStaffDueAt">
          <Input
            id="new-student-due"
            type="datetime-local"
            value={due}
            onChange={(event) => setDue(event.target.value)}
          />
        </StaffField>
        <StaffField id="new-student-reason" labelKey="lmsStaffReason">
          <Textarea
            id="new-student-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
          />
        </StaffField>
        {(validation || action.error) && (
          <p role="alert" className="text-sm text-destructive">
            {validation || errorText(action.error)}
          </p>
        )}
        <Button disabled={action.isPending}>{t("lmsStaffPublish")}</Button>
      </form>
    </StaffDialog>
  );
}
