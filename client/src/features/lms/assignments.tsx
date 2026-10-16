import { useEffect, useRef, useState, type FormEvent } from "react";
import { usePortalLocation as useLocation } from "../portal-app/navigation";
import { useMutation } from "@tanstack/react-query";
import type { LmsAssignmentDetailDto } from "@shared/contracts/lms";
import { LearningText } from "@/features/learning-content/text";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable } from "@/components/ux/DataTable";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { PortalApiError, portalLmsApi } from "../portal-app/api";
import {
  PortalFormScope,
  usePortalFormScope,
  usePortal,
  useSubjectQuery,
  useInvalidateSubject,
} from "../portal-app/context";
import {
  PortalDialogContent as DialogContent,
  PortalError,
  isPortalAccessError,
  PortalLoading,
  PortalEmpty,
  PortalStatus,
  PortalTitle,
  ConfirmAction,
  safeHttps,
  usePortalError,
  usePortalFormat,
} from "../portal-app/ui";
import { PortalFiles, PortalUploads } from "../portal-app/files";
import { usePortalFormMounted } from "../portal-app/usePortalFormMounted";
import { PortalSelect, PortalToolbar } from "../portal-app/controls";
import { HelpDialog } from "./communication";
import { useAssignmentDraft } from "./useAssignmentDraft";
import { usePortalViewState } from "../portal-app/view-state";

const statuses = [
  ["assigned", "portalAssigned"],
  ["submitted", "portalSubmitted"],
  ["revision_required", "portalRevisionRequired"],
  ["accepted", "portalAccepted"],
] as const;
export function PortalAssignments({
  courseId,
  initialId,
  unitId,
  embedded = false,
}: {
  courseId?: number;
  initialId?: number;
  unitId?: number;
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const format = usePortalFormat();
  const query = useSubjectQuery("assignments", portalLmsApi.assignments);
  const [view, setView] = usePortalViewState(
    `assignments:${courseId ?? "all"}:${unitId ?? "all"}`,
    { status: "assigned", search: "", course: String(courseId ?? "") },
  );
  const { status, search, course } = view;
  const [selected, setSelected] = useState<number | null>(initialId ?? null);
  if (query.isPending)
    return (
      <PortalLoading variant={embedded || courseId ? "section" : "page"} />
    );
  if (query.data === undefined || isPortalAccessError(query.error))
    return (
      <PortalError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  const courses = [
    ...new Map(
      query.data.items.map((item) => [item.runId, item.courseName]),
    ).entries(),
  ];
  const items = query.data.items
    .filter(
      (item) =>
        item.status === status &&
        (!courseId || item.runId === courseId) &&
        (!unitId || item.unitId === unitId) &&
        (!course || item.runId === Number(course)) &&
        item.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    )
    .sort(
      (a, b) =>
        +new Date(a.dueAt ?? "9999-01-01") - +new Date(b.dueAt ?? "9999-01-01"),
    );
  return (
    <>
      {query.error && (
        <PortalError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      )}
      {embedded || courseId ? (
        <h2 className="text-base font-semibold">
          {t(embedded ? "portalPractice" : "portalAssignments")}
        </h2>
      ) : (
        <PortalTitle labelKey="portalAssignments" />
      )}
      <PortalToolbar>
        <Input
          className="w-full sm:max-w-sm"
          aria-label={t("portalSearch")}
          placeholder={t("portalSearch")}
          value={search}
          onChange={(event) =>
            setView((previous) => ({ ...previous, search: event.target.value }))
          }
        />
        {!courseId && (
          <PortalSelect
            className="w-full sm:w-64"
            aria-label={t("portalCourses")}
            value={course}
            onValueChange={(value) =>
              setView((previous) => ({
                ...previous,
                course: value,
              }))
            }
            options={[
              { value: "", label: t("portalAllCourses") },
              ...courses.map(([id, name]) => ({
                value: String(id),
                label: name,
              })),
            ]}
          />
        )}
      </PortalToolbar>
      <Tabs
        value={status}
        onValueChange={(value) =>
          setView((previous) => ({ ...previous, status: value }))
        }
      >
        <TabsList className="max-w-full">
          {statuses.map(([value, key]) => (
            <TabsTrigger key={value} value={value}>
              {t(key)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <DataTable
        focusOnRowClick
        data={items}
        keyExtractor={(item) => String(item.id)}
        rootClassName="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm"
        filterKey={`${status}:${course}:${search}`}
        onRowClick={(item) => setSelected(item.id)}
        emptyState={<PortalEmpty embedded labelKey="portalNoAssignments" />}
        columns={[
          {
            key: "title",
            header: t("portalAssignments"),
            mobilePrimary: true,
            render: (item) => <span className="font-medium">{item.title}</span>,
          },
          {
            key: "courseName",
            header: t("portalCourses"),
            render: (item) => (
              <div className="space-y-1">
                <p>{item.courseName}</p>
                <p className="text-xs text-muted-foreground">
                  {item.groupName}
                </p>
              </div>
            ),
          },
          {
            key: "dueAt",
            header: t("portalDue"),
            render: (item) => (
              <div className="space-y-1">
                <span>{item.dueAt ? format.date(item.dueAt) : "—"}</span>
                {item.overdue && (
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                    {t("portalOverdue")}
                  </p>
                )}
              </div>
            ),
          },
          {
            key: "status",
            header: t("status"),
            render: (item) => <PortalStatus status={item.status} />,
          },
          {
            key: "actions",
            header: "",
            mobileHidden: true,
            cellClassName: "w-24 text-right",
            render: (item) => (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelected(item.id)}
              >
                {t("portalOpen")}
              </Button>
            ),
          },
        ]}
      />
      <AssignmentDialog id={selected} onClose={() => setSelected(null)} />
    </>
  );
}
export function AssignmentDialog({
  id,
  onClose,
}: {
  id: number | null;
  onClose: () => void;
}) {
  const assignmentScope = usePortalFormScope();
  const { t } = useTranslation();
  const { subject } = usePortal();
  return (
    <PortalFormScope id={assignmentScope.id}>
      <Dialog
        open={id !== null}
        onOpenChange={(open) => {
          if (!open) assignmentScope.guarded(onClose);
        }}
      >
        <DialogContent className="portal-ui max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("portalAssignments")}</DialogTitle>
            <DialogDescription>{subject?.studentName}</DialogDescription>
          </DialogHeader>
          {id !== null && (
            <AssignmentDetail
              key={`${subject?.linkId}:${id}`}
              id={id}
              onClose={onClose}
            />
          )}
        </DialogContent>
      </Dialog>
    </PortalFormScope>
  );
}
function AssignmentDetail({
  id,
  onClose,
}: {
  id: number;
  onClose: () => void;
}) {
  const query = useSubjectQuery(
    "assignment",
    (link, signal) => portalLmsApi.assignment(link, id, signal),
    [id],
  );
  if (query.isPending) return <PortalLoading variant="section" />;
  if (query.data === undefined || isPortalAccessError(query.error))
    return (
      <PortalError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  return (
    <>
      {query.error && (
        <PortalError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      )}
      <AssignmentContent
        key={query.data.id}
        detail={query.data}
        onClose={onClose}
        refresh={() => {
          void query.refetch();
        }}
      />
    </>
  );
}
export function AssignmentContent({
  detail,
  onClose,
  refresh,
}: {
  detail: LmsAssignmentDetailDto;
  onClose: () => void;
  refresh: () => void;
}) {
  const { t } = useTranslation();
  const format = usePortalFormat();
  const message = usePortalError();
  const { subject, allowed, guarded, setUnsaved } = usePortal();
  const mounted = usePortalFormMounted();
  const invalidate = useInvalidateSubject();
  const [, navigate] = useLocation();
  const [withdraw, setWithdraw] = useState(false);
  const [help, setHelp] = useState(false);
  const [comment, setComment] = useState("");
  const [commentKey, setCommentKey] = useState(() => crypto.randomUUID());
  const [shareComment, setShareComment] = useState(false);
  useEffect(() => {
    setUnsaved(Boolean(comment));
    return () => setUnsaved(false);
  }, [comment, setUnsaved]);
  const canSubmit =
    allowed("assignments.submit", true) &&
    ["assigned", "revision_required"].includes(detail.status) &&
    (!detail.closesAt || new Date(detail.closesAt) > new Date());
  const commentAction = useMutation({
    mutationFn: () =>
      portalLmsApi.comment(subject!.linkId, detail.id, {
        idempotencyKey: commentKey,
        body: comment,
        audience: "family_teacher",
        fileIds: [],
        shareWithFamily:
          subject?.kind === "representative" ? shareComment : false,
      }),
    onSuccess: () => {
      if (!mounted.current) return;
      setComment("");
      setCommentKey(crypto.randomUUID());
      setShareComment(false);
      refresh();
    },
  });
  const withdrawAction = useMutation({
    mutationFn: () =>
      portalLmsApi.withdraw(subject!.linkId, detail.id, detail.version),
    onSuccess: () => {
      void invalidate();
      if (!mounted.current) return;
      setWithdraw(false);
      refresh();
    },
  });
  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-2">
        <h2 className="text-base font-semibold">{detail.title}</h2>
        <p className="text-sm text-muted-foreground">
          {detail.courseName} · {detail.groupName}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <PortalStatus status={detail.status} />
          {detail.dueAt && (
            <span className="text-sm">
              {t("portalDue")}: {format.date(detail.dueAt)}
            </span>
          )}
          {detail.closesAt && (
            <span className="text-sm">
              {t("portalDeadline")}: {format.date(detail.closesAt)}
            </span>
          )}
        </div>
        <LearningText text={detail.body} />
      </div>
      {detail.criteria.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-semibold">{t("portalCriteria")}</h3>
          <ul className="list-disc space-y-1 pl-5">
            {detail.criteria.map((item) => (
              <li key={item.id}>
                {item.title} · {item.weight}%
              </li>
            ))}
          </ul>
        </section>
      )}
      <PortalFiles ids={detail.fileIds} />
      {allowed("communication.create") && (
        <Button type="button" variant="outline" onClick={() => setHelp(true)}>
          {t("portalNeedHelp")}
        </Button>
      )}
      {canSubmit && subject && (
        <AssignmentAnswer
          detail={detail}
          linkId={subject.linkId}
          onClose={onClose}
          onReload={refresh}
        />
      )}
      {detail.submissions.length > 0 && (
        <section className="space-y-4">
          <h3 className="font-semibold">{t("portalHistory")}</h3>
          {detail.submissions.map((submission) => (
            <Card key={submission.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {t("portalAttempt")} {submission.attemptNumber}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {format.date(submission.submittedAt)} ·{" "}
                    {format.time(submission.submittedAt)}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t("portalComparisonStudent")} · {subject?.studentName}
                </p>
                {submission.title && submission.title !== detail.title && (
                  <h4 className="font-medium">{submission.title}</h4>
                )}
                <p className="whitespace-pre-wrap">{submission.text}</p>
                {submission.links.filter(safeHttps).map((link) => (
                  <a
                    key={link}
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block break-all text-primary underline"
                  >
                    {link}
                  </a>
                ))}
                <PortalFiles ids={submission.fileIds} />
                {submission.review && (
                  <div className="space-y-2 rounded-md bg-muted/60 p-3">
                    <PortalStatus status={submission.review.decision} />
                    <p className="whitespace-pre-wrap">
                      {submission.review.comment}
                    </p>
                    {(submission.criteria ?? detail.criteria).length > 0 && (
                      <ul className="space-y-1 text-sm">
                        {(submission.criteria ?? detail.criteria).map(
                          (criterion) => (
                            <li
                              key={criterion.id}
                              className="flex justify-between gap-3"
                            >
                              <span>{criterion.title}</span>
                              <span>
                                {submission.review?.criterionScores[
                                  criterion.id
                                ] ?? "—"}
                              </span>
                            </li>
                          ),
                        )}
                      </ul>
                    )}
                    {submission.review.score !== null && (
                      <p>
                        {t("portalPoints")}: {submission.review.score}
                        {(submission.maxScore ?? detail.maxScore) !== null &&
                          ` / ${submission.maxScore ?? detail.maxScore}`}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      {submission.review.reviewerName} ·{" "}
                      {format.date(submission.review.createdAt)}
                    </p>
                    {submission.review.decision === "accepted" &&
                      allowed("portfolio.edit", true) && (
                        <Button
                          variant="outline"
                          onClick={() =>
                            guarded(() => {
                              onClose();
                              navigate(
                                `/learn/portfolio?submission=${submission.id}`,
                              );
                            })
                          }
                        >
                          {t("portalAddProject")}
                        </Button>
                      )}
                  </div>
                )}
                {allowed("feedback.read") &&
                  Boolean(
                    submission.reviewHistory &&
                      submission.reviewHistory.length > 1,
                  ) && (
                    <details className="rounded-md border p-3">
                      <summary className="cursor-pointer font-medium">
                        {t("portalReviewHistory")}
                      </summary>
                      <div className="space-y-3 pt-3">
                        {submission.reviewHistory?.map((review) => (
                          <section
                            key={review.id}
                            className="space-y-2 rounded-md bg-muted/50 p-3"
                          >
                            <PortalStatus status={review.decision} />
                            <p className="whitespace-pre-wrap">
                              {review.comment}
                            </p>
                            {review.score !== null && (
                              <p>
                                {t("portalPoints")}: {review.score}
                              </p>
                            )}
                            {review.reason && (
                              <p className="whitespace-pre-wrap">
                                {review.reason}
                              </p>
                            )}
                            <p className="text-sm text-muted-foreground">
                              {review.reviewerName} ·{" "}
                              {format.date(review.createdAt)}
                            </p>
                          </section>
                        ))}
                      </div>
                    </details>
                  )}
              </CardContent>
            </Card>
          ))}
        </section>
      )}
      {detail.status === "submitted" &&
        allowed("assignments.submit", true) &&
        detail.canWithdraw !== false &&
        !detail.reviewStarted &&
        !detail.submissions[0]?.review && (
          <Button variant="outline" onClick={() => setWithdraw(true)}>
            {t("portalWithdraw")}
          </Button>
        )}
      {detail.status === "submitted" &&
        detail.reviewStarted &&
        allowed("communication.create") && (
          <Button variant="outline" onClick={() => setHelp(true)}>
            {t("portalRequestRevision")}
          </Button>
        )}
      {allowed("feedback.read") && (
        <section className="space-y-3">
          <h3 className="font-semibold">{t("portalFeedback")}</h3>
          {detail.comments.map((item) => (
            <div key={item.id} className="space-y-1 rounded-md border p-3">
              <p className="text-sm font-medium">
                {item.authorName} · {format.date(item.createdAt)}
              </p>
              <LearningText text={item.body} />
              <PortalFiles ids={item.fileIds} />
            </div>
          ))}
          {allowed("communication.create") && (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (comment.trim()) commentAction.mutate();
              }}
            >
              <fieldset
                disabled={commentAction.isPending}
                className="min-w-0 space-y-4"
              >
                <Label htmlFor="assignment-comment">{t("portalComment")}</Label>
                <Textarea
                  id="assignment-comment"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  required
                />
                {subject?.kind === "representative" && (
                  <label className="flex min-h-11 cursor-pointer items-center gap-3">
                    <Checkbox
                      checked={shareComment}
                      onCheckedChange={(value) =>
                        setShareComment(value === true)
                      }
                    />
                    {t("portalShareCommentFamily")}
                  </label>
                )}
                {commentAction.error && (
                  <p role="alert" className="text-destructive">
                    {message(commentAction.error, "portalSaveError")}
                  </p>
                )}
                <DialogFooter className="pt-2">
                  <Button disabled={commentAction.isPending || !comment.trim()}>
                    {t("portalSendComment")}
                  </Button>
                </DialogFooter>
              </fieldset>
            </form>
          )}
        </section>
      )}
      <HelpDialog
        open={help}
        onClose={() => setHelp(false)}
        runId={detail.runId}
        unitId={detail.unitId ?? undefined}
        recipientId={detail.recipientId}
        defaultTopic={
          detail.reviewStarted ? "portalHelpFeedback" : "portalHelpAssignment"
        }
      />
      <ConfirmAction
        open={withdraw}
        onOpenChange={setWithdraw}
        titleKey="portalWithdrawTitle"
        objectName={detail.title}
        description="portalWithdrawDescription"
        action="portalWithdraw"
        pending={withdrawAction.isPending}
        error={
          withdrawAction.error
            ? message(withdrawAction.error, "portalSaveError")
            : undefined
        }
        onConfirm={() => withdrawAction.mutate()}
      />
    </div>
  );
}
function AssignmentAnswer({
  detail,
  linkId,
  onClose,
  onReload,
}: {
  detail: LmsAssignmentDetailDto;
  linkId: number;
  onClose: () => void;
  onReload: () => void;
}) {
  const { t } = useTranslation();
  const message = usePortalError();
  const { setUnsaved } = usePortal();
  const invalidate = useInvalidateSubject();
  const mounted = usePortalFormMounted();
  const [uploading, setUploading] = useState(false);
  const [validation, setValidation] = useState("");
  const [reloadOpen, setReloadOpen] = useState(false);
  const draft = useAssignmentDraft(linkId, detail.id, detail.draft, uploading);
  const [linkText, setLinkText] = useState(detail.draft.links.join("\n"));
  const reload = useMutation({
    mutationFn: draft.reload,
    onSuccess: (data) => {
      setLinkText(data.links.join("\n"));
      setReloadOpen(false);
      onReload();
    },
  });
  const conflict =
    draft.error instanceof PortalApiError && draft.error.status === 409;
  const submissionKey = useRef<{ fingerprint: string; key: string } | null>(
    null,
  );
  const submit = useMutation({
    mutationFn: async () => {
      const saved = await draft.save();
      const fingerprint = JSON.stringify([
        detail.assignmentVersionId,
        saved.version,
        draft.answer,
      ]);
      if (submissionKey.current?.fingerprint !== fingerprint)
        submissionKey.current = { fingerprint, key: crypto.randomUUID() };
      return portalLmsApi.submit(linkId, detail.id, {
        ...draft.answer,
        draftVersion: saved.version,
        assignmentVersionId: detail.assignmentVersionId,
        idempotencyKey: submissionKey.current!.key,
      });
    },
    onSuccess: () => {
      void invalidate();
      if (!mounted.current) return;
      setUnsaved(false);
      onClose();
    },
  });
  useEffect(() => {
    setUnsaved(draft.dirty || uploading);
    return () => setUnsaved(false);
  }, [draft.dirty, uploading, setUnsaved]);
  function send(event: FormEvent) {
    event.preventDefault();
    setValidation("");
    if (!draft.answer.links.every(safeHttps)) {
      setValidation(t("portalInvalidUrl"));
      document.getElementById("assignment-links")?.focus();
      return;
    }
    if (
      !draft.answer.text.trim() &&
      !draft.answer.links.length &&
      !draft.answer.fileIds.length
    ) {
      setValidation(t("portalAnswerRequired"));
      document.getElementById("assignment-text")?.focus();
      return;
    }
    submit.mutate();
  }
  return (
    <form
      className="space-y-4 rounded-xl border border-border/70 bg-card p-4"
      onSubmit={send}
    >
      <fieldset disabled={submit.isPending} className="min-w-0 space-y-4">
        <h3 className="font-semibold">{t("portalAnswer")}</h3>
        {detail.allowedAnswers.includes("text") && (
          <div className="space-y-2">
            <Label htmlFor="assignment-text">{t("portalAnswer")}</Label>
            <Textarea
              id="assignment-text"
              value={draft.answer.text}
              onChange={(event) =>
                draft.setAnswer((previous) => ({
                  ...previous,
                  text: event.target.value,
                }))
              }
              rows={5}
              disabled={submit.isPending}
            />
          </div>
        )}
        {detail.allowedAnswers.includes("links") && (
          <div className="space-y-2">
            <Label htmlFor="assignment-links">{t("portalLinks")}</Label>
            <Textarea
              id="assignment-links"
              value={linkText}
              onChange={(event) => {
                setLinkText(event.target.value);
                draft.setAnswer((previous) => ({
                  ...previous,
                  links: event.target.value
                    .split("\n")
                    .map((link) => link.trim())
                    .filter(Boolean),
                }));
              }}
              disabled={submit.isPending}
            />
          </div>
        )}
        {detail.allowedAnswers.includes("files") && (
          <PortalUploads
            ids={draft.answer.fileIds}
            onChange={(ids) =>
              draft.setAnswer((previous) => ({ ...previous, fileIds: ids }))
            }
            onBusyChange={setUploading}
          />
        )}
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {draft.error
            ? message(draft.error, "portalSaveError")
            : draft.saving
              ? t("portalSaving")
              : !draft.dirty
                ? t("portalSaved")
                : ""}
        </p>
        {(validation || submit.error) && (
          <p role="alert" className="text-sm text-destructive">
            {validation || message(submit.error, "portalSaveError")}
          </p>
        )}
        <DialogFooter className="border-t border-border/70 pt-4">
          <Button
            type="submit"
            disabled={submit.isPending || uploading || draft.saving}
          >
            {t("portalSubmit")}
          </Button>
          {Boolean(draft.error) && !conflict && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void draft.save().catch(() => {});
              }}
            >
              {t("portalRetry")}
            </Button>
          )}
          {conflict && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setReloadOpen(true)}
            >
              {t("lmsStaffReload")}
            </Button>
          )}
        </DialogFooter>
        <ConfirmAction
          open={reloadOpen}
          onOpenChange={setReloadOpen}
          titleKey="portalReloadDraftTitle"
          objectName={detail.title}
          description="portalReloadDraftDescription"
          action="lmsStaffReload"
          pending={reload.isPending}
          error={
            reload.error ? message(reload.error, "portalLoadError") : undefined
          }
          onConfirm={() => reload.mutate()}
        />
      </fieldset>
    </form>
  );
}
