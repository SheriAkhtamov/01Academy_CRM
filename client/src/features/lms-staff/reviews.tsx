import { DateTimeInput } from '@/components/ui/date-time-input';
import { PortalSheetContent as SheetContent } from "../learning-content/modal-content";
import { useEffect, useRef, useState, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  lmsReviewSchema,
  type LmsStaffReviewDetailDto,
  type LmsReviewQueueDto,
} from "@shared/contracts/lms";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DataTable, type DataTableColumn } from "@/components/ux/DataTable";
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LearningText } from "../learning-content/text";
import { lmsStaffApi, LmsStaffApiError } from "./api";
import { useStaffQuery, useStaffInvalidate } from "./queries";
import {
  StaffField,
  StaffLoading,
  StaffError,
  StaffEmpty,
  StaffConfirm,
  StaffStatus,
  useStaffError,
  useStaffFormat,
  staffDateInput,
  staffDateIso,
  safeStaffLink,
} from "./ui";
import { StaffFiles } from "./files";
export function StaffReviews({ runId }: { runId?: number }) {
  const { t } = useTranslation();
  const date = useStaffFormat();
  const query = useStaffQuery("reviews", runId ?? 0, (signal) =>
    lmsStaffApi.reviews(runId, signal),
  );
  const [selected, setSelected] = useState<number | null>(null);
  const [course, setCourse] = useState("");
  const [group, setGroup] = useState("");
  const [assignment, setAssignment] = useState("");
  const filtered = (query.data ?? []).filter(
    (item) =>
      (!course || item.courseName === course) &&
      (!group || String(item.runId) === group) &&
      (!assignment || String(item.assignmentVersionId) === assignment),
  );
  const next = (current: number) => {
    const list = [...filtered].sort(
      (left, right) =>
        +new Date(left.submittedAt) - +new Date(right.submittedAt) ||
        left.submissionId - right.submissionId,
    );
    const index = list.findIndex((item) => item.submissionId === current);
    setSelected(
      list[index + 1]?.submissionId ??
        list.find((item) => item.submissionId !== current)?.submissionId ??
        null,
    );
  };
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
  const courses = [
    ...new Set(query.data.map((item) => item.courseName)),
  ].sort();
  const courseItems = query.data.filter(
    (item) => !course || item.courseName === course,
  );
  const groups = [
    ...new Map(
      courseItems.map((item) => [item.runId, item.groupName]),
    ).entries(),
  ];
  const assignments = [
    ...new Map(
      courseItems
        .filter((item) => !group || String(item.runId) === group)
        .map((item) => [item.assignmentVersionId, item.title]),
    ).entries(),
  ];
  const columns: DataTableColumn<LmsReviewQueueDto>[] = [
    {
      key: "student",
      header: t("lmsStaffStudents"),
      accessor: (item) => item.studentName,
      render: (item) => (
        <span className="break-words font-medium">{item.studentName}</span>
      ),
      mobilePrimary: true,
    },
    {
      key: "group",
      header: t("lmsStaffGroup"),
      render: (item) => (
        <div className="space-y-1">
          <p className="break-words">{item.groupName}</p>
          <p className="break-words text-xs text-muted-foreground">
            {item.courseName}
          </p>
        </div>
      ),
    },
    {
      key: "assignment",
      header: t("lmsStaffAssignments"),
      render: (item) => <span className="break-words">{item.title}</span>,
    },
    {
      key: "attempt",
      header: t("portalAttempt"),
      accessor: (item) => item.attemptNumber,
    },
    {
      key: "submittedAt",
      header: t("portalDate"),
      accessor: (item) => +new Date(item.submittedAt),
      render: (item) => date(item.submittedAt),
      sortable: true,
    },
    {
      key: "state",
      header: t("status"),
      render: (item) => (
        <div className="space-y-1">
          <p>
            {t(
              item.reviewStartedBy
                ? "lmsStaffBeingReviewed"
                : "portalSubmitted",
            )}
          </p>
          {item.reviewStartedName && (
            <p className="break-words text-xs text-muted-foreground">
              {item.reviewStartedName}
            </p>
          )}
          {item.late && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {t("portalOverdue")}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "actions",
      header: t("actions"),
      render: (item) => (
        <Button onClick={() => setSelected(item.submissionId)}>
          {t("portalOpen")}
        </Button>
      ),
    },
  ];
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">{t("lmsStaffReviews")}</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <StaffField id="review-course" labelKey="course">
          <select
            id="review-course"
            className="min-h-11 w-full rounded-md border bg-background px-3"
            value={course}
            onChange={(event) => {
              setCourse(event.target.value);
              setGroup("");
              setAssignment("");
            }}
          >
            <option value="">{t("lmsStaffReviewAllCourses")}</option>
            {courses.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </StaffField>
        <StaffField id="review-group" labelKey="lmsStaffGroup">
          <select
            id="review-group"
            className="min-h-11 w-full rounded-md border bg-background px-3"
            value={group}
            onChange={(event) => {
              setGroup(event.target.value);
              setAssignment("");
            }}
          >
            <option value="">{t("lmsStaffAnalyticsAllGroups")}</option>
            {groups.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </StaffField>
        <StaffField id="review-assignment" labelKey="lmsStaffAssignments">
          <select
            id="review-assignment"
            className="min-h-11 w-full rounded-md border bg-background px-3"
            value={assignment}
            onChange={(event) => setAssignment(event.target.value)}
          >
            <option value="">{t("lmsStaffReviewAllAssignments")}</option>
            {assignments.map(([id, title]) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </select>
        </StaffField>
      </div>
      <DataTable
        columns={columns}
        data={filtered}
        keyExtractor={(item) => String(item.submissionId)}
        defaultSortKey="submittedAt"
        defaultSortDirection="asc"
        filterKey={`${course}:${group}:${assignment}`}
        emptyState={<StaffEmpty />}
      />
      {selected !== null && (
        <ReviewSheet
          key={selected}
          id={selected}
          onClose={() => setSelected(null)}
          onNext={() => next(selected)}
        />
      )}
    </div>
  );
}
export function ReviewSheet({
  id,
  onClose,
  onNext,
}: {
  id: number;
  onClose: () => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const query = useStaffQuery("review", id, (signal) =>
    lmsStaffApi.review(id, signal),
  );
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  return (
    <>
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) {
            if (dirty) setDiscard(true);
            else onClose();
          }
        }}
      >
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-5xl"
        >
          <SheetHeader>
            <SheetTitle>
              {query.data?.studentName ?? t("lmsStaffReviews")}
            </SheetTitle>
            <SheetDescription>
              {query.data
                ? `${query.data.groupName} · ${query.data.title}`
                : t("lmsStaffReviews")}
            </SheetDescription>
          </SheetHeader>
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
              <ReviewContent
                detail={query.data}
                onClose={onClose}
                onNext={onNext}
                onDirtyChange={setDirty}
                reload={() => {
                  void query.refetch();
                }}
              />
            )
          )}
        </SheetContent>
      </Sheet>
      <StaffConfirm
        open={discard}
        onOpenChange={setDiscard}
        titleKey="portalUnsavedTitle"
        description="portalUnsavedDescription"
        action="portalLeave"
        onConfirm={() => {
          setDiscard(false);
          onClose();
        }}
      />
    </>
  );
}
export function ReviewContent({
  detail,
  onClose,
  onNext,
  onDirtyChange,
  reload,
}: {
  detail: LmsStaffReviewDetailDto;
  onClose: () => void;
  onNext: () => void;
  onDirtyChange: (dirty: boolean) => void;
  reload: () => void;
}) {
  const { t } = useTranslation();
  const large = useMediaQuery("(min-width: 1024px)");
  const date = useStaffFormat();
  const errorText = useStaffError();
  const invalidate = useStaffInvalidate();
  const previousReview =
    detail.status === "submitted"
      ? null
      : (detail.submissions.find((item) => item.id === detail.submissionId)
          ?.review ?? null);
  const initialCriteria = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(previousReview?.criterionScores ?? {}).map(
          ([id, value]) => [id, String(value)],
        ),
      ),
    [previousReview],
  );
  const [tab, setTab] = useState("work");
  const [comment, setComment] = useState(previousReview?.comment ?? "");
  const [reason, setReason] = useState("");
  const [due, setDue] = useState(staffDateInput(detail.dueAt));
  const [correctDecision, setCorrectDecision] = useState<
    "accepted" | "revision_required" | null
  >(null);
  const [score, setScore] = useState(
    previousReview?.score === null || previousReview?.score === undefined
      ? ""
      : String(previousReview.score),
  );
  const [criteria, setCriteria] =
    useState<Record<string, string>>(initialCriteria);
  const [validation, setValidation] = useState("");
  const [commentText, setCommentText] = useState("");
  const [reviewKey] = useState(() => crypto.randomUUID());
  const [commentKey, setCommentKey] = useState(() => crypto.randomUUID());
  const [audience, setAudience] = useState<string>("family_teacher");
  const [saveNext, setSaveNext] = useState(false);
  const [nextDecision, setNextDecision] = useState<
    "accepted" | "revision_required"
  >("accepted");
  const startRef = useRef<number | null>(null);
  const [version, setVersion] = useState(detail.version);
  const submission = detail.submissions.find(
    (item) => item.id === detail.submissionId,
  );
  const start = useMutation({
    mutationFn: () =>
      lmsStaffApi.startReview(detail.submissionId, detail.version),
    onSuccess: (result) => setVersion(result.version),
    onError: (error) => {
      if (error instanceof LmsStaffApiError && error.status === 409) reload();
    },
  });
  const startMutate = start.mutate;
  const review = useMutation({
    mutationFn: (decision: "accepted" | "revision_required") => {
      const criterionScores = Object.fromEntries(
        Object.entries(criteria).map(([id, value]) => [id, Number(value)]),
      );
      const numeric =
        detail.criteria.length && detail.gradingMode === "points"
          ? Object.values(criterionScores).reduce(
              (sum, value) => sum + value,
              0,
            )
          : Number(score);
      const parsed = lmsReviewSchema.parse({
        idempotencyKey: reviewKey,
        version,
        decision,
        comment,
        score: detail.gradingMode === "points" ? numeric : undefined,
        criterionScores,
        reason: detail.status !== "submitted" ? reason : undefined,
        dueAt:
          due !== staffDateInput(detail.dueAt)
            ? due
              ? staffDateIso(due)
              : null
            : undefined,
      });
      return lmsStaffApi.decision(detail.submissionId, parsed);
    },
    onSuccess: () => {
      onDirtyChange(false);
      void invalidate();
      if (saveNext) onNext();
      else onClose();
    },
    onError: (error) => {
      if (error instanceof LmsStaffApiError && error.status === 409) reload();
    },
  });
  const addComment = useMutation({
    mutationFn: () =>
      lmsStaffApi.assignmentComment(detail.recipientId, {
        idempotencyKey: commentKey,
        body: commentText,
        audience: audience.startsWith("representative:")
          ? "representative_teacher"
          : (audience as "student_teacher" | "family_teacher" | "staff"),
        ...(audience.startsWith("representative:")
          ? { audienceAccountId: Number(audience.split(":")[1]) }
          : {}),
        fileIds: [],
      }),
    onSuccess: () => {
      setCommentText("");
      setCommentKey(crypto.randomUUID());
      reload();
    },
    onError: (error) => {
      if (error instanceof LmsStaffApiError && error.status === 409) reload();
    },
  });
  const dirty = Boolean(
    comment !== (previousReview?.comment ?? "") ||
    score !==
      (previousReview?.score === null || previousReview?.score === undefined
        ? ""
        : String(previousReview.score)) ||
    commentText ||
    reason ||
    due !== staffDateInput(detail.dueAt) ||
    JSON.stringify(criteria) !== JSON.stringify(initialCriteria),
  );
  useEffect(() => {
    if (!dirty && !review.isPending) setVersion(detail.version);
  }, [detail.version, dirty, review.isPending]);
  useEffect(() => {
    if (
      startRef.current === detail.submissionId ||
      detail.status !== "submitted"
    )
      return;
    startRef.current = detail.submissionId;
    startMutate();
  }, [detail.submissionId, detail.status, startMutate]);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  function decide(decision: "accepted" | "revision_required", next = false) {
    setValidation("");
    if (decision === "revision_required" && !comment.trim()) {
      setValidation(t("lmsStaffReviewRequired"));
      setTab("review");
      return;
    }
    if (
      detail.gradingMode === "points" &&
      ((!detail.criteria.length && !score.trim()) ||
        detail.criteria.some((item) => !criteria[item.id]?.trim()))
    ) {
      setValidation(t("portalInvalidData"));
      setTab("review");
      return;
    }
    setSaveNext(next);
    if (detail.status !== "submitted") {
      if (!reason.trim()) {
        setValidation(t("lmsReasonRequired"));
        setTab("review");
        return;
      }
      setCorrectDecision(decision);
      return;
    }
    review.mutate(decision);
  }
  const work = (
    <div className="space-y-4">
      <h3 className="font-semibold">{t("lmsStaffSubmission")}</h3>
      {submission && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>
              {t("portalAttempt")} {submission.attemptNumber}
            </span>
            <span>{date(submission.submittedAt)}</span>
            {submission.late && <span>{t("portalOverdue")}</span>}
          </div>
          <LearningText text={submission.text} />
          {submission.links.filter(safeStaffLink).map((link) => (
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
          <StaffFiles runId={detail.runId} ids={submission.fileIds} />
        </>
      )}
      <h3 className="font-semibold">{t("lmsStaffAssignments")}</h3>
      <LearningText text={detail.body} />
    </div>
  );
  const grading = (
    <div className="space-y-4">
      <h3 className="font-semibold">{t("lmsStaffGradingMode")}</h3>
      {detail.criteria.map((item) => (
        <div key={item.id} className="space-y-2 rounded-md border p-3">
          <p className="font-medium">
            {item.title} · {item.weight}%
          </p>
          {detail.gradingMode === "points" && (
            <StaffField
              id={`review-criterion-${item.id}`}
              labelKey="lmsStaffScore"
            >
              <Input
                id={`review-criterion-${item.id}`}
                type="number"
                min={0}
                max={((detail.maxScore ?? 0) * item.weight) / 100}
                step="0.1"
                value={criteria[item.id] ?? ""}
                onChange={(event) =>
                  setCriteria((previous) => ({
                    ...previous,
                    [item.id]: event.target.value,
                  }))
                }
              />
            </StaffField>
          )}
        </div>
      ))}
      {detail.gradingMode === "points" && !detail.criteria.length && (
        <StaffField id="review-score" labelKey="lmsStaffScore">
          <Input
            id="review-score"
            type="number"
            min={0}
            max={detail.maxScore ?? undefined}
            step="0.1"
            value={score}
            onChange={(event) => setScore(event.target.value)}
          />
        </StaffField>
      )}
      <StaffField id="review-comment" labelKey="lmsStaffComment">
        <Textarea
          id="review-comment"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={6}
        />
      </StaffField>
      <StaffField id="review-new-due" labelKey="lmsStaffDueAt">
        <DateTimeInput
          id="review-new-due"
          value={due}
          onValueChange={(value) => setDue(value)}
        />
      </StaffField>
      {detail.status !== "submitted" && (
        <StaffField id="review-change-reason" labelKey="lmsStaffReason">
          <Textarea
            id="review-change-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            maxLength={2000}
          />
        </StaffField>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={start.isPending || review.isPending || Boolean(start.error)}
          onClick={() => decide("accepted")}
        >
          {t("lmsStaffAccept")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={start.isPending || review.isPending || Boolean(start.error)}
          onClick={() => decide("revision_required")}
        >
          {t("lmsStaffReturn")}
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <select
          aria-label={t("lmsStaffGradingMode")}
          className="min-h-11 w-full rounded-md border bg-background px-3"
          value={nextDecision}
          onChange={(event) =>
            setNextDecision(event.target.value as typeof nextDecision)
          }
        >
          <option value="accepted">{t("lmsStaffAccept")}</option>
          <option value="revision_required">{t("lmsStaffReturn")}</option>
        </select>
        <Button
          type="button"
          variant="secondary"
          disabled={start.isPending || review.isPending || Boolean(start.error)}
          onClick={() => decide(nextDecision, true)}
        >
          {t("lmsStaffNext")}
        </Button>
      </div>
      {(validation || review.error || start.error) && (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>{validation || errorText(review.error ?? start.error)}</p>
          {(review.error || start.error) && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                start.reset();
                review.reset();
                reload();
              }}
            >
              {t("lmsStaffReload")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
  const history = (
    <div className="space-y-4">
      <h3 className="font-semibold">{t("lmsStaffAttempts")}</h3>
      {detail.submissions.map((item) => (
        <div key={item.id} className="space-y-3 rounded-md border p-3">
          <p className="font-medium">
            {t("portalAttempt")} {item.attemptNumber} · {date(item.submittedAt)}
          </p>
          <LearningText text={item.text} />
          {(item.reviewHistory ?? (item.review ? [item.review] : [])).map(
            (pastReview) => (
              <div key={pastReview.id} className="space-y-2">
                <StaffStatus state={pastReview.decision} />
                <LearningText text={pastReview.comment} />
                <p className="text-sm text-muted-foreground">
                  {pastReview.reviewerName} · {date(pastReview.createdAt)}
                </p>
                {pastReview.reason && <LearningText text={pastReview.reason} />}
              </div>
            ),
          )}
        </div>
      ))}
      <h3 className="font-semibold">{t("portalFeedback")}</h3>
      {detail.comments.map((item) => (
        <div key={item.id} className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">
            {item.authorName} · {date(item.createdAt)}
          </p>
          <LearningText text={item.body} />
        </div>
      ))}
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (commentText.trim()) addComment.mutate();
        }}
      >
        <StaffField id="review-public-comment" labelKey="lmsStaffComment">
          <Textarea
            id="review-public-comment"
            value={commentText}
            onChange={(event) => setCommentText(event.target.value)}
            required
          />
        </StaffField>
        <select
          aria-label={t("lmsStaffAudience")}
          className="min-h-11 w-full rounded-md border bg-background px-3"
          value={audience}
          onChange={(event) =>
            setAudience(event.target.value as typeof audience)
          }
        >
          <option value="family_teacher">{t("lmsStaffEveryone")}</option>
          <option value="student_teacher">{t("lmsStaffStudents")}</option>
          <option value="staff">{t("lmsStaffStaffOnly")}</option>
          {Array.from(
            new Map(
              detail.comments
                .filter(
                  (item) =>
                    item.audience === "representative_teacher" &&
                    item.authorAccountId,
                )
                .map((item) => [item.authorAccountId!, item.authorName]),
            ).entries(),
          ).map(([accountId, name]) => (
            <option key={accountId} value={`representative:${accountId}`}>
              {t("lmsStaffForRepresentative")}: {name}
            </option>
          ))}
        </select>
        {addComment.error && (
          <p role="alert" className="text-sm text-destructive">
            {errorText(addComment.error)}
          </p>
        )}
        <Button disabled={addComment.isPending || !commentText.trim()}>
          {t("lmsStaffAnswer")}
        </Button>
      </form>
    </div>
  );
  return (
    <>
      {large ? (
        <>
          <div className="grid min-w-0 gap-6 lg:grid-cols-2">
            <div className="min-w-0">{work}</div>
            <div className="min-w-0">{grading}</div>
          </div>
          <div className="min-w-0 border-t pt-6">{history}</div>
        </>
      ) : (
        <Tabs value={tab} onValueChange={setTab} className="min-w-0">
          <TabsList className="flex h-auto flex-wrap gap-1">
            <TabsTrigger value="work">{t("lmsStaffSubmission")}</TabsTrigger>
            <TabsTrigger value="review">{t("lmsStaffGradingMode")}</TabsTrigger>
            <TabsTrigger value="history">{t("portalHistory")}</TabsTrigger>
          </TabsList>
          <TabsContent value="work">{work}</TabsContent>
          <TabsContent value="review">{grading}</TabsContent>
          <TabsContent value="history">{history}</TabsContent>
        </Tabs>
      )}
      <StaffConfirm
        open={correctDecision !== null}
        onOpenChange={(open) => {
          if (!open) setCorrectDecision(null);
        }}
        titleKey="lmsStaffCorrectReviewTitle"
        description="lmsStaffCorrectReviewBody"
        action="lmsStaffSave"
        pending={review.isPending}
        error={review.error}
        disabled={!reason.trim()}
        onConfirm={() => {
          if (correctDecision) review.mutate(correctDecision);
        }}
      >
        <p className="font-medium">
          {detail.studentName} · {detail.title}
        </p>
      </StaffConfirm>
    </>
  );
}
