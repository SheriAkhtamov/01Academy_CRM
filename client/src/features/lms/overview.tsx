import { useState } from "react";
import { useLocation } from "wouter";
import { useQueries, useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  ListChecks,
  MessageSquare,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { LearningText } from "@/features/learning-content/text";
import type {
  LmsAssignmentDto,
  LmsProgressDto,
  LmsProgressMetric,
} from "@shared/contracts/lms";
import type { TranslationKey } from "@/lib/i18n";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { portalLmsApi } from "../portal-app/api";
import {
  portalSubjectKey,
  usePortal,
  useSubjectQuery,
  portalGrantFingerprint,
} from "../portal-app/context";
import {
  PortalDialogContent as DialogContent,
  PortalTitle,
  PortalError,
  PortalLoading,
  PortalEmpty,
  PortalStatus,
  usePortalFormat,
  usePortalContent,
  usePortalError,
  usePortalSuccess,
} from "../portal-app/ui";
import { PortalFiles } from "../portal-app/files";
import { portalResourcesApi } from "../portal-app/resources-api";
import { PortalActionRow } from "../portal-app/controls";
import { PortalPaymentSummary } from "../portal-app/payments";
import { MakeupDialog, MakeupStatus } from "./makeup";
import type { LmsMakeupDto } from "@shared/contracts/lms";
import { AssignmentDialog } from "./assignments";

export function ProgressMetric({
  metric,
  labelKey,
  emptyKey,
  icon: Icon = CalendarDays,
}: {
  metric: LmsProgressMetric;
  labelKey: TranslationKey;
  emptyKey: TranslationKey;
  icon?: LucideIcon;
}) {
  const { t } = useTranslation();
  return (
    <Card className="h-full">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">
              {t(labelKey)}
            </p>
            <p className="mt-1 text-[26px] font-bold tabular-nums tracking-tight">
              {metric.percent === null || metric.total === 0
                ? "—"
                : `${Math.round(metric.percent)}%`}
            </p>
          </div>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Icon className="size-4" aria-hidden="true" />
          </span>
        </div>
        {metric.total === 0 ? (
          <p className="text-sm text-muted-foreground">{t(emptyKey)}</p>
        ) : (
          <div className="space-y-2">
            <Progress
              className="h-1.5"
              value={metric.percent ?? 0}
              aria-label={t(labelKey)}
            />
            <p className="text-xs tabular-nums text-muted-foreground">
              {t("portalCompletedCount")
                .replace("{done}", String(metric.completed))
                .replace("{total}", String(metric.total))}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
export function ProgressCards({ data }: { data: LmsProgressDto }) {
  const { allowed } = usePortal();
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {allowed("attendance.read") && (
        <ProgressMetric
          metric={data.attendance}
          labelKey="portalAttendance"
          emptyKey="portalNoLessons"
        />
      )}
      <ProgressMetric
        metric={data.assignments}
        labelKey="portalAssignments"
        emptyKey="portalNoAssignments"
        icon={ClipboardCheck}
      />
      <ProgressMetric
        metric={data.quizzes}
        labelKey="portalTests"
        emptyKey="portalNoTests"
        icon={ListChecks}
      />
      <ProgressMetric
        metric={data.materials}
        labelKey="portalMaterialsProgress"
        emptyKey="portalMaterialsEmpty"
        icon={BookOpen}
      />
    </div>
  );
}
export function priorityAssignment(assignments: LmsAssignmentDto[]) {
  const available = assignments.filter((item) =>
    ["assigned", "revision_required"].includes(item.status),
  );
  return (
    [...available].sort((a, b) => {
      const rank = (item: LmsAssignmentDto) =>
        item.overdue && item.status === "revision_required"
          ? 0
          : item.overdue
            ? 1
            : 2;
      return (
        rank(a) - rank(b) ||
        +new Date(a.dueAt ?? "9999-01-01") - +new Date(b.dueAt ?? "9999-01-01")
      );
    })[0] ?? null
  );
}
export function PortalDay() {
  const { t } = useTranslation();
  const format = usePortalFormat();
  const content = usePortalContent();
  const message = usePortalError();
  const notify = usePortalSuccess();
  const { subject, guarded, account, subjects, allowed } = usePortal();
  const [, navigate] = useLocation();
  const query = useSubjectQuery("dashboard", portalLmsApi.dashboard);
  const notifications = useQuery({
    queryKey: [
      "portal-account",
      account?.id,
      "day-notifications",
      portalGrantFingerprint(subjects),
    ],
    queryFn: ({ signal }) => portalResourcesApi.allNotifications(signal),
    enabled: Boolean(account),
    staleTime: 20_000,
  });
  const markNotification = useMutation({
    mutationFn: portalResourcesApi.readNotification,
    onSuccess: () => {
      void notifications.refetch();
    },
  });
  const [assignmentId, setAssignmentId] = useState<number | null>(null);
  const [makeupPlan, setMakeupPlan] = useState<LmsMakeupDto | null>(null);
  const [announcement, setAnnouncement] = useState<number | null>(null);
  const readAnnouncement = useMutation({
    mutationFn: (id: number) =>
      portalLmsApi.readAnnouncement(subject!.linkId, id),
    onSuccess: () => {
      notify("portalReadConfirmed");
      void query.refetch();
    },
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
  const data = query.data;
  const action = priorityAssignment(data.assignments);
  const next = data.nextLesson;
  const reply = notifications.data?.items.find(
    (item) =>
      item.linkId === subject?.linkId &&
      !item.readAt &&
      [
        "portalNoticeAssignmentAccepted",
        "portalNoticeAssignmentRevision",
        "portalNoticeThreadAnswered",
        "portalNoticeFeedback",
      ].includes(item.code),
  );
  let replyTitle = reply ? content(reply.code) : "";
  if (reply)
    Object.entries(reply.params).forEach(([key, value]) => {
      replyTitle = replyTitle.split(`{${key}}`).join(String(value));
    });
  const nextMaterial = data.nextMaterial;
  const feedback = allowed("feedback.read")
    ? (data.feedback ?? []).slice(0, 3)
    : [];
  const replies =
    notifications.data?.items
      .filter(
        (item) =>
          item.linkId === subject?.linkId &&
          !item.readAt &&
          item.code === "portalNoticeThreadAnswered",
      )
      .slice(0, 3) ?? [];
  const notice = data.announcements.find((item) => item.id === announcement);
  return (
    <>
      <PortalTitle
        labelKey={
          subject?.kind === "self" ? "portalMyDay" : "portalFamilyOverview"
        }
      >
        <p className="text-sm text-muted-foreground">
          {format.date(new Date())}
        </p>
      </PortalTitle>
      <ProgressCards data={data.progress} />
      <div className={`grid gap-4${next ? " xl:grid-cols-2" : ""}`}>
        {next && (
          <Card className="flex min-w-0 flex-col">
            <CardHeader className="p-4 pb-0">
              <CardTitle className="flex items-center gap-2 text-sm">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <CalendarDays className="size-4" aria-hidden="true" />
                </span>
                {t("portalUpcomingLesson")}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-wrap items-center justify-between gap-4 p-4">
              <div className="min-w-0 space-y-1">
                <h2 className="break-words text-lg font-semibold tracking-tight">
                  {next.topic || next.courseName}
                </h2>
                <p className="text-sm text-muted-foreground">{next.courseName}</p>
                <p className="text-sm">
                  {format.date(next.scheduledAt)} ·{" "}
                  {format.time(next.scheduledAt)} · {t("portalTashkent")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {next.teacherName} {next.roomName ? `· ${next.roomName}` : ""}
                </p>
              </div>
              {next.meetingUrl && (
                <Button asChild>
                  <a
                    href={next.meetingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("portalJoin")}
                  </a>
                </Button>
              )}
            </CardContent>
          </Card>
        )}
        <Card className="flex min-w-0 flex-col">
          <CardHeader className="p-4 pb-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                {action ? (
                  <ClipboardCheck className="size-4" aria-hidden="true" />
                ) : reply ? (
                  <MessageSquare className="size-4" aria-hidden="true" />
                ) : (
                  <BookOpen className="size-4" aria-hidden="true" />
                )}
              </span>
              {t(
                action
                  ? "portalAssignments"
                  : reply
                    ? "portalFeedback"
                    : "portalCourses",
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1 flex-wrap items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <h2 className="break-words text-lg font-semibold tracking-tight">
                {action?.title ??
                  (reply
                    ? replyTitle
                    : (nextMaterial?.title ?? t("portalContinue")))}
              </h2>
              {action && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {action.courseName}
                  {action.dueAt && ` · ${format.date(action.dueAt)}`}
                </p>
              )}
            </div>
            <Button
              className="gap-2"
              onClick={() =>
                action
                  ? setAssignmentId(action.id)
                  : guarded(() => {
                      if (reply?.href?.startsWith("/learn")) {
                        markNotification.mutate(reply.id);
                        navigate(reply.href);
                      } else if (nextMaterial)
                        navigate(
                          `/learn/courses/${nextMaterial.runId}/materials/${nextMaterial.publicationId}`,
                        );
                      else navigate("/learn/courses");
                    })
              }
            >
              {t(
                action || reply || subject?.kind !== "self"
                  ? "portalOpen"
                  : "portalContinue",
              )}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </CardContent>
        </Card>
      </div>
      {data.assignments.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">{t("portalAssignments")}</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => guarded(() => navigate("/learn/assignments"))}
            >
              {t("portalOpen")}
            </Button>
          </div>
          {data.assignments
            .filter(
              (item) =>
                !["accepted", "cancelled", "excused"].includes(item.status),
            )
            .slice(0, 3)
            .map((item) => (
              <PortalActionRow
                key={item.id}
                onClick={() => setAssignmentId(item.id)}
              >
                <span>
                  <span className="block font-medium">{item.title}</span>
                  <span className="block text-sm text-muted-foreground">
                    {item.courseName}
                  </span>
                </span>
                <PortalStatus status={item.status} />
              </PortalActionRow>
            ))}
        </section>
      )}
      {(feedback.length > 0 || replies.length > 0) && (
        <section className="space-y-3" aria-labelledby="portal-day-feedback">
          <h2 id="portal-day-feedback" className="text-base font-semibold">
            {t("portalRecentFeedback")}
          </h2>
          {feedback.map((item) => (
            <PortalActionRow
              key={`feedback-${item.id}`}
              onClick={() =>
                guarded(() =>
                  navigate(
                    `/learn/feedback?review=${item.id}&linkId=${subject?.linkId}`,
                  ),
                )
              }
            >
              <span className="min-w-0 space-y-1">
                <span className="block font-semibold">
                  {item.assignmentTitle}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {item.courseName} · {item.reviewerName} ·{" "}
                  {format.date(item.createdAt)}
                </span>
                <span className="block line-clamp-2 font-normal">
                  {item.comment}
                </span>
              </span>
              <PortalStatus status={item.decision} />
            </PortalActionRow>
          ))}
          {replies.map((item) => {
            let title = content(item.code);
            Object.entries(item.params).forEach(([key, value]) => {
              title = title.split(`{${key}}`).join(String(value));
            });
            return (
              <PortalActionRow
                key={`reply-${item.id}`}
                onClick={() =>
                  guarded(() => {
                    if (item.href?.startsWith("/learn")) {
                      markNotification.mutate(item.id);
                      navigate(item.href);
                    }
                  })
                }
              >
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-sm text-muted-foreground">
                    {format.date(item.createdAt)}
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
              </PortalActionRow>
            );
          })}
        </section>
      )}
      {subject?.kind === "representative" &&
        subject.permissions.includes("finance.read") && (
          <PortalPaymentSummary />
        )}
      {data.latestAchievement && (
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <Trophy className="h-8 w-8 text-primary" />
            <div>
              <h2 className="font-semibold">
                {content(data.latestAchievement.title)}
              </h2>
              <p className="text-sm text-muted-foreground">
                {content(data.latestAchievement.reason)}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
      {data.makeup.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">{t("portalMakeup")}</h2>
          {data.makeup
            .filter((item) => item.status !== "not_required")
            .map((item) => (
              <Card key={item.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <p className="font-medium">{item.topic}</p>
                    <p className="text-sm text-muted-foreground">
                      {format.date(item.scheduledAt)}
                    </p>
                  </div>
                  <MakeupStatus status={item.status} />
                  <Button variant="outline" onClick={() => setMakeupPlan(item)}>
                    {t("portalOpen")}
                  </Button>
                </CardContent>
              </Card>
            ))}
        </section>
      )}
      {data.announcements.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">{t("portalAnnouncements")}</h2>
          {data.announcements.map((item) => (
            <PortalActionRow
              key={item.id}
              onClick={() => {
                readAnnouncement.reset();
                setAnnouncement(item.id);
              }}
            >
              {item.title}
            </PortalActionRow>
          ))}
        </section>
      )}
      <MakeupDialog plan={makeupPlan} onClose={() => setMakeupPlan(null)} />
      <AssignmentDialog
        id={assignmentId}
        onClose={() => setAssignmentId(null)}
      />
      <Dialog
        open={Boolean(notice)}
        onOpenChange={(open) => {
          if (!open) setAnnouncement(null);
        }}
      >
        <DialogContent className="portal-ui">
          <DialogTitle>{notice?.title}</DialogTitle>
          <DialogDescription>
            {notice && format.date(notice.publishAt)}
          </DialogDescription>
          {notice && (
            <div className="space-y-4">
              <LearningText text={notice.body} />
              <PortalFiles ids={notice.fileIds} />
              {readAnnouncement.error && (
                <p role="alert" className="text-destructive">
                  {message(readAnnouncement.error, "portalSaveError")}
                </p>
              )}
              {!notice.read && (
                <Button
                  variant="outline"
                  disabled={readAnnouncement.isPending}
                  onClick={() => readAnnouncement.mutate(notice.id)}
                >
                  {t("portalMarkRead")}
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
export function FamilyOverview() {
  const { t } = useTranslation();
  const format = usePortalFormat();
  const { account, subjects, selectSubject } = usePortal();
  const representatives = subjects.filter(
    (item) => item.kind === "representative",
  );
  const queries = useQueries({
    queries: representatives.map((subject) => ({
      queryKey: account
        ? portalSubjectKey(account, subject, "dashboard")
        : ["portal-family-unavailable"],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        portalLmsApi.dashboard(subject.linkId, signal),
      enabled: Boolean(
        account &&
        subject.permissions.some((permission) =>
          ["learning.read", "attendance.read"].includes(permission),
        ),
      ),
      staleTime: 20_000,
    })),
  });
  const finance = useQueries({
    queries: representatives.map((subject) => ({
      queryKey: account
        ? portalSubjectKey(account, subject, "payments")
        : ["portal-family-unavailable"],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        portalResourcesApi.payments(subject.linkId, signal),
      enabled: Boolean(account && subject.permissions.includes("finance.read")),
      staleTime: 20_000,
    })),
  });
  const notices = useQuery({
    queryKey: [
      "portal-account",
      account?.id,
      "day-notifications",
      portalGrantFingerprint(subjects),
    ],
    queryFn: ({ signal }) => portalResourcesApi.allNotifications(signal),
    enabled: Boolean(
      account &&
      representatives.some((link) =>
        link.permissions.includes("feedback.read"),
      ),
    ),
    staleTime: 20_000,
  });
  return (
    <>
      <PortalTitle labelKey="portalFamilyOverview" />
      {representatives.length === 0 && (
        <PortalEmpty labelKey="portalNoAccess" />
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {representatives.map((subject, index) => (
          <Card key={subject.linkId}>
            <CardHeader className="p-4 pb-3">
              <CardTitle>{subject.studentName}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-4 pt-0">
              {queries[index].isFetching ? (
                <PortalLoading />
              ) : queries[index].error ? (
                <PortalError
                  error={queries[index].error}
                  retry={() => {
                    void queries[index].refetch();
                  }}
                />
              ) : (
                queries[index].data && (
                  <>
                    {subject.permissions.includes("learning.read") && (
                      <p>
                        {t("portalAssignments")}:{" "}
                        {
                          queries[index].data?.assignments.filter(
                            (item) =>
                              item.status === "assigned" ||
                              item.status === "revision_required",
                          ).length
                        }
                      </p>
                    )}
                    {queries[index].data?.nextLesson && (
                      <p>
                        {queries[index].data?.nextLesson?.courseName} ·{" "}
                        {format.date(
                          queries[index].data!.nextLesson!.scheduledAt,
                        )}{" "}
                        ·{" "}
                        {format.time(
                          queries[index].data!.nextLesson!.scheduledAt,
                        )}
                      </p>
                    )}
                    {subject.permissions.includes("attendance.read") &&
                    queries[index].data?.makeup.length ? (
                      <p>
                        {t("portalMakeupNeeded")}:{" "}
                        {queries[index].data!.makeup.length}
                      </p>
                    ) : null}
                  </>
                )
              )}
              {subject.permissions.includes("feedback.read") &&
                (notices.isPending ? (
                  <PortalLoading />
                ) : notices.error ? (
                  <PortalError
                    error={notices.error}
                    retry={() => {
                      void notices.refetch();
                    }}
                  />
                ) : (
                  <p>
                    {t("portalUnreadFeedback")}:{" "}
                    {notices.data?.items.filter(
                      (notice) =>
                        notice.linkId === subject.linkId &&
                        notice.category === "feedback" &&
                        !notice.readAt,
                    ).length ?? 0}
                  </p>
                ))}
              {subject.permissions.includes("finance.read") &&
                (finance[index].isPending ? (
                  <PortalLoading />
                ) : finance[index].error ? (
                  <PortalError
                    error={finance[index].error}
                    retry={() => {
                      void finance[index].refetch();
                    }}
                  />
                ) : finance[index].data?.state === "needs_review" ? (
                  <p>{t("portalPaymentNeedsReview")}</p>
                ) : finance[index].data?.summary ? (
                  <div className="space-y-1">
                    <p>
                      {t("portalDueAmount")}:{" "}
                      {format.money(finance[index].data!.summary!.dueUzs)}
                    </p>
                    {finance[index].data?.summary?.paidUntil && (
                      <p>
                        {t("portalPaidUntil")}:{" "}
                        {format.date(finance[index].data!.summary!.paidUntil!)}
                      </p>
                    )}
                  </div>
                ) : null)}
              <Button
                onClick={() => selectSubject(subject.linkId)}
              >
                {t("portalOpen")}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

export function PortalLimitedOverview() {
  const { allowed, subject } = usePortal();
  return (
    <>
      <PortalTitle
        labelKey={
          subject?.kind === "representative"
            ? "portalFamilyOverview"
            : "portalMyDay"
        }
      />
      {allowed("finance.read") && <PortalPaymentSummary />}
      {allowed("attendance.read") && <AttendanceOverview />}
      {allowed("feedback.read") && <FeedbackOverview />}
    </>
  );
}
function AttendanceOverview() {
  const { t } = useTranslation();
  const format = usePortalFormat();
  const { guarded } = usePortal();
  const [, navigate] = useLocation();
  const [from] = useState(() => new Date().toISOString());
  const [to] = useState(() =>
    new Date(Date.now() + 8 * 86400000).toISOString(),
  );
  const query = useSubjectQuery(
    "schedule-overview",
    (link, signal) => portalLmsApi.schedule(link, from, to, signal),
    [from, to],
    "attendance.read",
  );
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
  const next = query.data.find((lesson) => lesson.status !== "cancelled");
  return (
    <Card>
      <CardHeader className="p-4 pb-3">
        <CardTitle className="text-lg">{t("portalUpcomingLesson")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0">
        {next ? (
          <>
            <p className="font-semibold">{next.topic || next.courseName}</p>
            <p>
              {format.date(next.scheduledAt)} · {format.time(next.scheduledAt)}{" "}
              · {t("portalTashkent")}
            </p>
          </>
        ) : (
          <p className="text-muted-foreground">{t("portalNoLessons")}</p>
        )}
        <Button
          variant="outline"
          onClick={() => guarded(() => navigate("/learn/schedule"))}
        >
          {t("portalSchedule")}
        </Button>
      </CardContent>
    </Card>
  );
}
function FeedbackOverview() {
  const { t } = useTranslation();
  const format = usePortalFormat();
  const { guarded } = usePortal();
  const [, navigate] = useLocation();
  const query = useSubjectQuery(
    "reports",
    portalLmsApi.reports,
    [],
    "feedback.read",
  );
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
  const report = query.data[0];
  return (
    <Card>
      <CardHeader className="p-4 pb-3">
        <CardTitle className="text-lg">{t("portalReports")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0">
        {report ? (
          <>
            <p className="text-sm text-muted-foreground">
              {format.date(report.periodFrom)} – {format.date(report.periodTo)}
            </p>
            <p className="line-clamp-4 whitespace-pre-wrap">{report.comment}</p>
            <p className="text-sm text-muted-foreground">{report.authorName}</p>
            <Button
              variant="outline"
                  onClick={() => guarded(() => navigate("/learn/progress"))}
            >
              {t("portalOpen")}
            </Button>
          </>
        ) : (
          <p className="text-muted-foreground">{t("portalNoReports")}</p>
        )}
      </CardContent>
    </Card>
  );
}
