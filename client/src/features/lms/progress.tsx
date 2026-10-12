import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  PortalProjectDto,
  PortalComparisonProjectDto,
} from "@shared/contracts/portal-resources";
import type { LmsAchievementDto, LmsReportDto } from "@shared/contracts/lms";
import type { TranslationKey } from "@/lib/i18n";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { portalLmsApi, PortalApiError } from "../portal-app/api";
import { portalResourcesApi } from "../portal-app/resources-api";
import {
  useSubjectQuery,
  useSubjectInfiniteQuery,
  usePortal,
  portalSubjectKey,
} from "../portal-app/context";
import {
  PortalDialogContent as DialogContent,
  PortalTitle,
  PortalLoading,
  PortalError,
  PortalEmpty,
  usePortalFormat,
  usePortalContent,
  usePortalError,
  safeHttps,
  ConfirmAction,
} from "../portal-app/ui";
import { PortalFiles } from "../portal-app/files";
import { PortalFeedback } from "./feedback";
import { ProgressCards } from "./overview";
import { usePortalViewState } from "../portal-app/view-state";

const historyLabels: Record<string, TranslationKey> = {
  submission_created: "portalSubmitted",
  assignment_submitted: "portalSubmitted",
  submission_submitted: "portalSubmitted",
  assignment_accepted: "portalAccepted",
  assignment_revision_required: "portalRevisionRequired",
  makeup_completed: "portalMakeupComplete",
  makeup_reopened: "lmsEventMakeupReopened",
  achievement_revoked: "portalAchievementRevoked",
  achievement_restored: "lmsEventAchievementRestored",
  course_reopened: "portalCourseReopened",
  review_accepted: "portalAccepted",
  accepted: "portalAccepted",
  revision_required: "portalRevisionRequired",
  quiz_passed: "portalPassed",
  quiz_finished: "portalTestResult",
  achievement_awarded: "portalAchievements",
  report_published: "portalReports",
  course_completed: "portalCompleted",
  material_read: "portalLearned",
  enrollment_started: "portalCourses",
  project_created: "portalPortfolio",
};
export function PortalProgress() {
  const { t } = useTranslation();
  const format = usePortalFormat();
  const content = usePortalContent();
  const { allowed } = usePortal();
  const [view, setView] = usePortalViewState("progress", {
    course: "",
    from: "",
    to: "",
  });
  const { course, from, to } = view;
  const setCourse = (value: string) =>
    setView((previous) => ({ ...previous, course: value }));
  const setFrom = (value: string) =>
    setView((previous) => ({ ...previous, from: value }));
  const setTo = (value: string) =>
    setView((previous) => ({ ...previous, to: value }));
  const invalidPeriod =
    Boolean(from) !== Boolean(to) ||
    Boolean(
      from &&
      to &&
      (from > to ||
        !Number.isFinite(Date.parse(`${from}T00:00:00+05:00`)) ||
        !Number.isFinite(Date.parse(`${to}T00:00:00+05:00`))),
    );
  const filter = {
    ...(course ? { runId: Number(course) } : {}),
    ...(from && to && !invalidPeriod
      ? {
          from: new Date(`${from}T00:00:00+05:00`).toISOString(),
          to: new Date(
            Date.parse(`${to}T00:00:00+05:00`) + 86400000,
          ).toISOString(),
        }
      : {}),
  };
  const parts = [course, from, to];
  const courses = useSubjectQuery("courses", portalLmsApi.courses);
  const progress = useSubjectQuery(
    "progress",
    (link, signal) => portalLmsApi.progress(link, signal, filter),
    parts,
    "learning.read",
    !invalidPeriod,
  );
  const achievements = useSubjectQuery(
    "achievements",
    (link, signal) => portalLmsApi.achievements(link, signal, filter),
    parts,
    "learning.read",
    !invalidPeriod,
  );
  const reports = useSubjectQuery(
    "reports",
    (link, signal) => portalLmsApi.reports(link, signal, filter),
    parts,
    "feedback.read",
    !invalidPeriod,
  );
  const history = useSubjectInfiniteQuery(
    "history",
    (link, signal, cursor) =>
      portalLmsApi.history(link, signal, filter, cursor),
    parts,
    "learning.read",
    !invalidPeriod,
  );
  const reviewId =
    Number(new URLSearchParams(window.location.search).get("review")) ||
    undefined;
  const [achievement, setAchievement] = useState<LmsAchievementDto | null>(
    null,
  );
  const [report, setReport] = useState<LmsReportDto | null>(null);
  const filters = (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-2">
        <Label htmlFor="progress-course">{t("portalCourses")}</Label>
        <select
          id="progress-course"
          className="min-h-11 w-full rounded-md border bg-background px-3"
          value={course}
          onChange={(event) => setCourse(event.target.value)}
        >
          <option value="">{t("portalAllCourses")}</option>
          {courses.data?.map((item) => (
            <option key={item.runId} value={item.runId}>
              {item.courseName} · {item.groupName}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="progress-from">{t("portalPeriodFrom")}</Label>
        <Input
          id="progress-from"
          type="date"
          value={from}
          max={to || undefined}
          onChange={(event) => setFrom(event.target.value)}
          className="min-h-11"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="progress-to">{t("portalPeriodTo")}</Label>
        <Input
          id="progress-to"
          type="date"
          value={to}
          min={from || undefined}
          onChange={(event) => setTo(event.target.value)}
          className="min-h-11"
        />
      </div>
    </div>
  );
  if (invalidPeriod)
    return (
      <>
        <PortalTitle labelKey="portalProgress" />
        {filters}
        <p role="alert" className="text-destructive">
          {t("portalPeriodInvalid")}
        </p>
      </>
    );
  return (
    <>
      <PortalTitle labelKey="portalProgress" />
      {filters}
      {allowed("learning.read") &&
        (progress.isPending ? (
          <PortalLoading />
        ) : progress.error ? (
          <PortalError
            error={progress.error}
            retry={() => {
              void progress.refetch();
            }}
          />
        ) : (
          <>
            <ProgressCards data={progress.data} />
            {allowed("attendance.read") &&
              progress.data.attendance.unmarked > 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("portalUnmarked")}: {progress.data.attendance.unmarked}
                </p>
              )}
          </>
        ))}
      <Tabs
        defaultValue={
          (reviewId && allowed("feedback.read")) || !allowed("learning.read")
            ? "feedback"
            : "history"
        }
      >
        <TabsList className="flex h-auto flex-wrap justify-start gap-1">
          {allowed("feedback.read") && (
            <TabsTrigger value="feedback" className="min-h-11">
              {t("portalFeedback")}
            </TabsTrigger>
          )}
          {allowed("learning.read") && (
            <TabsTrigger value="history" className="min-h-11">
              {t("portalGrowth")}
            </TabsTrigger>
          )}
          {allowed("learning.read") && (
            <TabsTrigger value="achievements" className="min-h-11">
              {t("portalAchievements")}
            </TabsTrigger>
          )}
          {allowed("feedback.read") && (
            <TabsTrigger value="reports" className="min-h-11">
              {t("portalReports")}
            </TabsTrigger>
          )}
          {allowed("learning.read") && (
            <TabsTrigger value="comparison" className="min-h-11">
              {t("portalComparison")}
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="feedback">
          {allowed("feedback.read") && <PortalFeedback initialId={reviewId} />}
        </TabsContent>
        <TabsContent value="history" className="space-y-3">
          {history.isPending ? (
            <PortalLoading />
          ) : history.error ? (
            <PortalError
              error={history.error}
              retry={() => {
                void history.refetch();
              }}
            />
          ) : !history.data.pages.flatMap((page) => page.items).length ? (
            <PortalEmpty labelKey="portalNoHistory" />
          ) : (
            history.data.pages
              .flatMap((page) => page.items)
              .map((item) => (
                <Card key={item.id}>
                  <CardContent className="flex items-center justify-between gap-3 p-4">
                    <span>
                      {typeof item.data.title === "string"
                        ? content(item.data.title)
                        : t(historyLabels[item.type] ?? "portalGrowth")}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {format.date(item.occurredAt)}
                    </span>
                  </CardContent>
                </Card>
              ))
          )}
          {history.hasNextPage && (
            <Button
              variant="outline"
              className="min-h-11"
              disabled={history.isFetchingNextPage}
              onClick={() => {
                void history.fetchNextPage();
              }}
            >
              {t("portalLoadMore")}
            </Button>
          )}
        </TabsContent>
        <TabsContent value="achievements">
          {achievements.isPending ? (
            <PortalLoading />
          ) : achievements.error ? (
            <PortalError
              error={achievements.error}
              retry={() => {
                void achievements.refetch();
              }}
            />
          ) : achievements.data.length === 0 ? (
            <PortalEmpty labelKey="portalNoAchievements" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {achievements.data.map((item) => (
                <Button
                  key={item.id}
                  variant="outline"
                  className="h-auto min-h-28 flex-col items-start gap-2 whitespace-normal p-4 text-left"
                  onClick={() => setAchievement(item)}
                >
                  <span className="font-semibold">{content(item.title)}</span>
                  <span className="text-sm text-muted-foreground">
                    {format.date(item.awardedAt)}
                  </span>
                  {item.revokedAt && (
                    <span>{t("portalAchievementRevoked")}</span>
                  )}
                </Button>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="reports" className="space-y-3">
          {reports.isPending ? (
            <PortalLoading />
          ) : reports.error ? (
            <PortalError
              error={reports.error}
              retry={() => {
                void reports.refetch();
              }}
            />
          ) : reports.data.length === 0 ? (
            <PortalEmpty labelKey="portalNoReports" />
          ) : (
            reports.data.map((item) => (
              <Button
                key={item.id}
                variant="outline"
                className="h-auto min-h-16 w-full justify-between gap-3 whitespace-normal p-4 text-left"
                onClick={() => setReport(item)}
              >
                <span>
                  {format.date(item.periodFrom)} – {format.date(item.periodTo)}
                </span>
                <span>{item.authorName}</span>
              </Button>
            ))
          )}
        </TabsContent>
        <TabsContent value="comparison">
          <ProjectComparison />
        </TabsContent>
      </Tabs>
      <Dialog
        open={Boolean(achievement)}
        onOpenChange={(open) => {
          if (!open) setAchievement(null);
        }}
      >
        <DialogContent className="portal-ui">
          <DialogTitle>{achievement && content(achievement.title)}</DialogTitle>
          <DialogDescription>
            {achievement && format.date(achievement.awardedAt)}
          </DialogDescription>
          <p className="whitespace-pre-wrap">
            {achievement && content(achievement.reason)}
          </p>
          {achievement?.revokedAt && (
            <>
              <p className="text-sm">
                {t("portalAchievementRevoked")} ·{" "}
                {format.date(achievement.revokedAt)}
              </p>
              <p>{achievement.revokeReason}</p>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(report)}
        onOpenChange={(open) => {
          if (!open) setReport(null);
        }}
      >
        <DialogContent className="portal-ui max-w-4xl">
          <DialogTitle>{t("portalReports")}</DialogTitle>
          <DialogDescription>
            {report &&
              `${format.date(report.periodFrom)} – ${format.date(report.periodTo)}`}
          </DialogDescription>
          {report && (
            <>
              <Button
                variant="outline"
                className="min-h-11 print:hidden"
                onClick={() => window.print()}
              >
                {t("portalPrint")}
              </Button>
              <article className="portal-print-report space-y-6">
                <h2 className="text-xl font-semibold">
                  {t("portalReports")} · {format.date(report.periodFrom)} –{" "}
                  {format.date(report.periodTo)}
                </h2>
                <p>
                  {report.authorName} · {format.date(report.publishedAt)}
                </p>
                <ProgressCards data={report.metrics} />
                {Boolean(report.bestProjects?.length) && (
                  <section className="space-y-4">
                    <h3 className="font-semibold">{t("portalBestProjects")}</h3>
                    {report.bestProjects?.map((project) => (
                      <div
                        key={project.id}
                        className="space-y-3 rounded-md border p-4"
                      >
                        <h4 className="font-semibold">{project.title}</h4>
                        {allowed("learning.read") && (
                          <p className="whitespace-pre-wrap">
                            {project.description}
                          </p>
                        )}
                        {allowed("learning.read") && (
                          <PortalFiles ids={project.fileIds} />
                        )}
                        {allowed("learning.read") &&
                          project.links.filter(safeHttps).map((link) => (
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
                        {project.review && (
                          <p className="whitespace-pre-wrap">
                            {project.review}
                          </p>
                        )}
                      </div>
                    ))}
                  </section>
                )}
                <div>
                  <h3 className="mb-2 font-semibold">{t("portalFeedback")}</h3>
                  <p className="whitespace-pre-wrap">{report.comment}</p>
                </div>
                <div>
                  <h3 className="mb-2 font-semibold">{t("portalNextSteps")}</h3>
                  <p className="whitespace-pre-wrap">{report.nextSteps}</p>
                </div>
              </article>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
export function ProjectComparison() {
  const { t } = useTranslation();
  const { guarded } = usePortal();
  const query = useSubjectQuery("projects", portalResourcesApi.projects);
  const [course, setCourse] = useState("");
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
  const courses = [
    ...new Map(
      query.data
        .filter((item) => item.runId !== null)
        .map((item) => [item.runId!, item.courseName ?? ""]),
    ).entries(),
  ];
  const courseId = course ? Number(course) : courses[0]?.[0];
  if (!courseId) return <PortalEmpty labelKey="portalNoProjects" />;
  return (
    <div className="space-y-4">
      <Label htmlFor="comparison-course">{t("portalCourses")}</Label>
      <select
        id="comparison-course"
        className="min-h-11 w-full rounded-md border bg-background px-3"
        value={courseId}
        onChange={(event) => guarded(() => setCourse(event.target.value))}
      >
        {courses.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
      <CourseComparison
        key={courseId}
        runId={courseId}
        projects={query.data
          .filter((item) => item.runId === courseId && !item.archivedAt)
          .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))}
      />
    </div>
  );
}
function CourseComparison({
  runId,
  projects,
}: {
  runId: number;
  projects: PortalProjectDto[];
}) {
  const { t } = useTranslation();
  const { account, subject, allowed, setUnsaved } = usePortal();
  const client = useQueryClient();
  const message = usePortalError();
  const format = usePortalFormat();
  const query = useSubjectQuery(
    "project-comparison",
    (link, signal) => portalResourcesApi.projectComparison(link, runId, signal),
    [runId],
  );
  const [draft, setDraft] = useState<{
    firstProject: PortalComparisonProjectDto;
    latestProject: PortalComparisonProjectDto;
    version: number;
  } | null>(null);
  const [reloadOpen, setReloadOpen] = useState(false);
  const canEdit = allowed("portfolio.edit", true);
  const firstWork: PortalComparisonProjectDto | undefined =
    draft?.firstProject ??
    query.data?.firstProject ??
    (canEdit ? projects[0] : undefined);
  const latestWork: PortalComparisonProjectDto | undefined =
    draft?.latestProject ??
    query.data?.latestProject ??
    (canEdit ? projects[projects.length - 1] : undefined);
  const dirty = draft !== null;
  const valid = firstWork && latestWork && firstWork.id !== latestWork.id;
  const action = useMutation({
    mutationFn: () =>
      portalResourcesApi.saveComparison(subject!.linkId, {
        runId,
        firstProjectId: firstWork!.id,
        latestProjectId: latestWork!.id,
        version: draft?.version ?? query.data?.version ?? 0,
      }),
    onSuccess: (data) => {
      client.setQueryData(
        portalSubjectKey(account!, subject!, "project-comparison", runId),
        data,
      );
      setDraft(null);
      setUnsaved(false);
      void query.refetch();
    },
  });
  const reload = useMutation({
    mutationFn: async () => {
      const result = await query.refetch();
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: () => {
      setDraft(null);
      setReloadOpen(false);
      action.reset();
      setUnsaved(false);
    },
  });
  const conflict =
    action.error instanceof PortalApiError && action.error.status === 409;
  useEffect(() => {
    setUnsaved(canEdit && dirty);
    return () => setUnsaved(false);
  }, [canEdit, dirty, setUnsaved]);
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
  if (!firstWork || !latestWork)
    return <PortalEmpty labelKey="portalComparisonNone" />;
  const work = (kind: "first" | "last") => {
    const value = kind === "first" ? firstWork : latestWork;
    const choices = projects.some((item) => item.id === value.id)
      ? projects
      : [value, ...projects];
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {t(kind === "first" ? "portalFirstWork" : "portalLatestWork")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {canEdit && (
            <div className="space-y-2">
              <Label htmlFor={`comparison-${kind}`}>
                {t(kind === "first" ? "portalFirstWork" : "portalLatestWork")}
              </Label>
              <select
                id={`comparison-${kind}`}
                className="min-h-11 w-full rounded-md border bg-background px-3"
                value={value.id}
                disabled={action.isPending}
                onChange={(event) => {
                  const selected = choices.find(
                    (item) => item.id === Number(event.target.value),
                  );
                  if (!selected) return;
                  setDraft((previous) => ({
                    firstProject:
                      kind === "first"
                        ? selected
                        : (previous?.firstProject ?? firstWork),
                    latestProject:
                      kind === "last"
                        ? selected
                        : (previous?.latestProject ?? latestWork),
                    version: previous?.version ?? query.data?.version ?? 0,
                  }));
                }}
              >
                {choices.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </div>
          )}
          <h3 className="font-semibold">{value.title}</h3>
          <p className="whitespace-pre-wrap">{value.description}</p>
          {value.coverFileId && (
            <img
              src={`/api/portal/files/${value.coverFileId}/download?linkId=${subject?.linkId}&preview=1`}
              alt={value.title}
              className="w-full rounded-md"
              loading="lazy"
            />
          )}
          <PortalFiles ids={value.files.map((file) => file.id)} />
          {value.links.filter(safeHttps).map((link) => (
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
          {allowed("feedback.read") && value.teacherReview && (
            <p className="whitespace-pre-wrap rounded-md bg-muted p-3">
              {value.teacherReview}
            </p>
          )}
        </CardContent>
      </Card>
    );
  };
  return (
    <div className="space-y-4">
      {query.data && !dirty && (
        <p className="text-sm text-muted-foreground">
          {t("portalComparisonSelectedBy").replace(
            "{name}",
            query.data.selectedByName,
          )}{" "}
          ·{" "}
          {t(
            query.data.selectedByRole === "student"
              ? "portalComparisonStudent"
              : query.data.selectedByRole === "teacher"
                ? "portalTeacher"
                : "portalComparisonStaff",
          )}{" "}
          · {format.date(query.data.updatedAt)}
        </p>
      )}
      <Tabs defaultValue="first">
        <TabsList className="md:hidden">
          <TabsTrigger value="first" className="min-h-11">
            {t("portalFirstWork")}
          </TabsTrigger>
          <TabsTrigger value="last" className="min-h-11">
            {t("portalLatestWork")}
          </TabsTrigger>
        </TabsList>
        <div className="grid gap-4 md:grid-cols-2">
          <TabsContent
            forceMount
            value="first"
            className="hidden data-[state=active]:block md:block"
          >
            {work("first")}
          </TabsContent>
          <TabsContent
            forceMount
            value="last"
            className="hidden data-[state=active]:block md:block"
          >
            {work("last")}
          </TabsContent>
        </div>
      </Tabs>
      {canEdit && !valid && (
        <p role="alert" className="text-sm text-muted-foreground">
          {t("portalComparisonDistinctProjects")}
        </p>
      )}
      {action.error && (
        <p role="alert" className="text-destructive">
          {message(action.error, "portalSaveError")}
        </p>
      )}
      {canEdit && (
        <Button
          className="min-h-11"
          disabled={
            !valid || action.isPending || (Boolean(query.data) && !dirty)
          }
          onClick={() => action.mutate()}
        >
          {t("portalComparisonSave")}
        </Button>
      )}
      {canEdit && conflict && (
        <Button
          variant="outline"
          className="min-h-11"
          onClick={() => setReloadOpen(true)}
        >
          {t("lmsStaffReload")}
        </Button>
      )}
      <ConfirmAction
        open={reloadOpen}
        onOpenChange={setReloadOpen}
        titleKey="portalReloadComparisonTitle"
        description="portalReloadComparisonDescription"
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
