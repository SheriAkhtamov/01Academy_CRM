import { enrollmentCourseHref, enrollmentMaterialHref, inEnrollmentPeriod } from "./enrollment-period";
import type { LmsEnrollmentPeriod } from "@shared/contracts/lms";
import { useState } from "react";
import { usePortalLocation as useLocation } from "../portal-app/navigation";
import { useMutation } from "@tanstack/react-query";
import { LearningText } from "@/features/learning-content/text";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ux/PageHeader";
import { portalLmsApi } from "../portal-app/api";
import {
  usePortal,
  useSubjectQuery,
  useInvalidateSubject,
} from "../portal-app/context";
import {
  PortalLoading,
  PortalError,
  isPortalAccessError,
  PortalEmpty,
  PortalTitle,
  PortalStatus,
  usePortalFormat,
  safeHttps,
  usePortalError,
  usePortalSuccess,
} from "../portal-app/ui";
import { PortalFiles } from "../portal-app/files";
import { PortalActionRow } from "../portal-app/controls";
import { PortalAssignments } from "./assignments";
import { PortalQuizzes } from "./quizzes";
import { PortalMakeup } from "./makeup";
import { HelpDialog } from "./communication";
import { PortalVideo } from "./video";
import { usePortalViewState } from "../portal-app/view-state";

export function PortalCourses() {
  const { t } = useTranslation();
  const { guarded } = usePortal();
  const [, navigate] = useLocation();
  const query = useSubjectQuery("courses", portalLmsApi.courses);
  const [view, setView] = usePortalViewState("courses", { tab: "current" });
  const tab = view.tab;
  const format = usePortalFormat();
  if (query.isPending) return <PortalLoading />;
  if (query.data === undefined || isPortalAccessError(query.error))
    return (
      <PortalError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  const items = query.data.filter((item) =>
    tab === "completed"
      ? Boolean(item.endedAt) ||
        ["completed", "finished", "archived"].includes(item.status)
      : !item.endedAt &&
        !["completed", "finished", "archived"].includes(item.status),
  );
  return (
    <>
      <PortalTitle labelKey="portalCourses" />
      {query.error && (
        <PortalError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      )}
      <Tabs value={tab} onValueChange={(value) => setView({ tab: value })}>
        <TabsList>
          <TabsTrigger value="current">{t("portalCurrent")}</TabsTrigger>
          <TabsTrigger value="completed">{t("portalCompleted")}</TabsTrigger>
        </TabsList>
      </Tabs>
      {items.length === 0 && <PortalEmpty labelKey="portalNoCourses" />}
      <div className="grid gap-4 md:grid-cols-2">
        {items.map((item) => (
          <Card key={item.enrollmentId}>
            <CardHeader className="p-4 pb-3">
              <CardTitle className="text-base">{item.courseName}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0 text-sm">
              <p className="font-medium">{item.groupName}</p>
              <p className="text-sm text-muted-foreground">
                {format.date(item.enrolledAt)}
                {item.endedAt && ` – ${format.date(item.endedAt)}`}
              </p>
              {item.teacherName && (
                <p className="text-sm text-muted-foreground">
                  {t("portalTeacher")}: {item.teacherName}
                </p>
              )}
              <p className="text-sm">
                {t("portalAssignments")}:{" "}
                {t("portalCompletedCount")
                  .replace("{done}", String(item.progress.completed))
                  .replace("{total}", String(item.progress.total))}
              </p>
              {item.nextLesson && (
                <p className="text-sm">
                  {t("portalUpcomingLesson")}:{" "}
                  {item.nextLesson.topic || item.nextLesson.courseName} ·{" "}
                  {format.date(item.nextLesson.scheduledAt)} ·{" "}
                  {format.time(item.nextLesson.scheduledAt)}
                </p>
              )}
              <Button
                onClick={() =>
                  guarded(() => navigate(enrollmentCourseHref(item.runId, item.enrollmentId)))
                }
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
export function PortalCourse({ id, enrollmentId }: { id: number; enrollmentId?: number }) {
  const { t } = useTranslation();
  const format = usePortalFormat();
  const { guarded, allowed } = usePortal();
  const [view, setView] = usePortalViewState(`course:${id}:${enrollmentId ?? "current"}`, {
    tab: "lessons",
  });
  const [, navigate] = useLocation();
  const query = useSubjectQuery(
    "course",
    (link, signal) => portalLmsApi.course(link, id, signal, enrollmentId),
    enrollmentId !== undefined ? [id, enrollmentId] : [id],
  );
  if (query.isPending) return <PortalLoading />;
  if (query.data === undefined || isPortalAccessError(query.error))
    return (
      <PortalError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  const course = query.data;
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
      <PageHeader
        title={course.courseName}
        subtitle={[course.groupName, course.teacherName]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <Button
            variant="outline"
            onClick={() => guarded(() => navigate("/learn/courses"))}
          >
            {t("portalBack")}
          </Button>
        }
      />
      {course.currentUnit && (
        <Card>
          <CardContent className="space-y-1 p-4 text-sm">
            <p className="text-xs font-medium text-muted-foreground">
              {t("portalCurrentTopic")}
            </p>
            <p className="font-medium">{course.currentUnit.title}</p>
          </CardContent>
        </Card>
      )}
      <Tabs value={view.tab} onValueChange={(value) => setView({ tab: value })}>
        <TabsList className="max-w-full">
          <TabsTrigger value="lessons">{t("portalLessons")}</TabsTrigger>
          <TabsTrigger value="assignments">
            {t("portalAssignments")}
          </TabsTrigger>
          {(allowed("feedback.read") || allowed("learning.read")) && (
            <TabsTrigger value="results">{t("portalResults")}</TabsTrigger>
          )}
          <TabsTrigger value="announcements">
            {t("portalAnnouncements")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="lessons" className="space-y-4 pt-2">
          <PortalMakeup embedded courseId={id} period={enrollmentId !== undefined ? course : undefined} />
          {course.units.map((unit, index) => (
            <section key={unit.id} className="space-y-3">
              {unit.sectionTitle &&
                unit.sectionTitle !== course.units[index - 1]?.sectionTitle && (
                  <h2 className="text-base font-semibold">
                    {unit.sectionTitle}
                  </h2>
                )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">{unit.title}</h3>
                {unit.status && <PortalStatus status={unit.status} />}
              </div>
              {unit.status === "soon" && unit.openAt && (
                <p className="text-sm text-muted-foreground">
                  {format.date(unit.openAt)}
                </p>
              )}
              {unit.materials.map((material) => (
                <PortalActionRow
                  key={material.publicationId}
                  disabled={unit.status === "soon"}
                  onClick={() =>
                    guarded(() =>
                      navigate(
                        enrollmentMaterialHref(id, material.publicationId, enrollmentId ?? material.enrollmentId),
                      ),
                    )
                  }
                >
                  <span className="min-w-0 break-words font-medium">
                    {material.title}
                  </span>
                  <PortalStatus
                    status={material.read ? "studied" : "available"}
                  />
                </PortalActionRow>
              ))}
            </section>
          ))}
          {course.materials
            .filter((material) => material.unitId === null)
            .map((material) => (
              <PortalActionRow
                key={material.publicationId}
                onClick={() =>
                  guarded(() =>
                    navigate(
                      enrollmentMaterialHref(id, material.publicationId, enrollmentId ?? material.enrollmentId),
                    ),
                  )
                }
              >
                <span className="min-w-0 break-words font-medium">
                  {material.title}
                </span>
                <PortalStatus
                  status={material.read ? "studied" : "available"}
                />
              </PortalActionRow>
            ))}
          {course.materials.length === 0 &&
            course.units.every((unit) => unit.materials.length === 0) && (
              <PortalEmpty labelKey="portalMaterialsEmpty" />
            )}
        </TabsContent>
        <TabsContent value="assignments">
          <PortalAssignments courseId={id} enrollmentId={enrollmentId} period={enrollmentId !== undefined ? course : undefined} />
        </TabsContent>
        <TabsContent value="results">
          <PortalQuizzes courseId={id} enrollmentId={enrollmentId} period={enrollmentId !== undefined ? course : undefined} embedded />
        </TabsContent>
        <TabsContent value="announcements">
          <CourseAnnouncements id={id} period={enrollmentId !== undefined ? course : undefined} />
        </TabsContent>
      </Tabs>
    </>
  );
}
export function PortalMaterial({
  courseId,
  id,
  enrollmentId,
}: {
  courseId: number;
  id: number;
  enrollmentId?: number;
}) {
  const { t } = useTranslation();
  const message = usePortalError();
  const notify = usePortalSuccess();
  const { subject, guarded, allowed } = usePortal();
  const [, navigate] = useLocation();
  const invalidate = useInvalidateSubject();
  const [help, setHelp] = useState(false);
  const format = usePortalFormat();
  const query = useSubjectQuery(
    "course",
    (link, signal) => portalLmsApi.course(link, courseId, signal, enrollmentId),
    enrollmentId !== undefined ? [courseId, enrollmentId] : [courseId],
  );
  const material =
    query.data &&
    [
      ...query.data.materials,
      ...query.data.units.flatMap((unit) => unit.materials),
    ].find((item) => item.publicationId === id);
  const mark = useMutation({
    mutationFn: () =>
      portalLmsApi.materialRead(subject!.linkId, id, !material?.read),
    onSuccess: () => {
      notify();
      void invalidate();
    },
  });
  if (query.isPending) return <PortalLoading />;
  if (query.data === undefined || isPortalAccessError(query.error))
    return (
      <PortalError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  if (!material) return <PortalEmpty labelKey="portalUnavailable" />;
  const category =
    material.category === "practice"
      ? "portalPractice"
      : material.category === "repeat"
        ? "portalRevision"
        : "portalForLesson";
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
      <article className="space-y-6">
        <nav
          aria-label={t("portalBreadcrumbs")}
          className="flex flex-wrap items-center gap-2 text-sm"
        >
          <Button
            variant="link"
            className="h-auto px-0 py-0 text-sm"
            onClick={() => guarded(() => navigate("/learn/courses"))}
          >
            {t("portalCourses")}
          </Button>
          <span aria-hidden="true">/</span>
          <Button
            variant="link"
            className="h-auto px-0 py-0 text-sm"
            onClick={() =>
              guarded(() => navigate(enrollmentCourseHref(courseId, enrollmentId ?? material.enrollmentId)))
            }
          >
            {query.data.courseName}
          </Button>
        </nav>
        <PageHeader
          title={material.title}
          titleAccessory={<Badge variant="secondary">{t(category)}</Badge>}
          subtitle={`${query.data.courseName} · ${format.date(material.publishedAt)}`}
          actions={
            <Button
              variant="outline"
              onClick={() =>
                guarded(() => navigate(enrollmentCourseHref(courseId, enrollmentId ?? material.enrollmentId)))
              }
            >
              {t("portalBack")}
            </Button>
          }
        />
        <Card>
          <CardContent className="space-y-4 p-4 text-sm sm:p-6">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
              {material.lessonAt && (
                <p className="text-sm">
                  {t("portalLessonDetails")}: {format.date(material.lessonAt)} ·{" "}
                  {format.time(material.lessonAt)}
                </p>
              )}
              {material.authorName && (
                <p className="text-sm text-muted-foreground">
                  {t("portalAuthor")}: {material.authorName}
                </p>
              )}
              {material.durationMinutes != null && (
                <p className="text-sm text-muted-foreground">
                  {t("portalDurationMinutes").replace(
                    "{minutes}",
                    String(material.durationMinutes),
                  )}
                </p>
              )}
            </div>
            <LearningText text={material.body} />
            {material.videoUrl && (
              <PortalVideo source={material.videoUrl} title={material.title} />
            )}
            {material.links.filter(safeHttps).map((link) => (
              <Button
                key={link}
                asChild
                variant="outline"
                className="max-w-full"
              >
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate"
                >
                  {link}
                </a>
              </Button>
            ))}
            <PortalFiles ids={material.fileIds} />
            {mark.error && (
              <p role="alert" className="text-destructive">
                {message(mark.error, "portalSaveError")}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/70 pt-4">
              {subject?.kind === "self" && (
                <Button loading={mark.isPending} disabled={mark.isPending} onClick={() => mark.mutate()}>
                  {t(
                    material.read ? "portalUnmarkLearned" : "portalMarkLearned",
                  )}
                </Button>
              )}
              {allowed("communication.create") && (
                <Button variant="outline" onClick={() => setHelp(true)}>
                  {t("portalNeedHelp")}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => guarded(() => navigate("/learn/assignments"))}
              >
                {t("portalAssignments")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </article>
      {material.unitId && (
        <PortalAssignments
          courseId={courseId}
          unitId={material.unitId}
          enrollmentId={enrollmentId ?? material.enrollmentId}
          period={enrollmentId !== undefined ? query.data : undefined}
          embedded
        />
      )}
      <HelpDialog
        open={help}
        onClose={() => setHelp(false)}
        runId={courseId}
        unitId={material.unitId ?? undefined}
      />
    </>
  );
}
function CourseAnnouncements({ id, period }: { id: number; period?: LmsEnrollmentPeriod }) {
  const { t } = useTranslation();
  const message = usePortalError();
  const notify = usePortalSuccess();
  const { subject } = usePortal();
  const query = useSubjectQuery("announcements", portalLmsApi.announcements);
  const format = usePortalFormat();
  const read = useMutation({
    mutationFn: (noticeId: number) =>
      portalLmsApi.readAnnouncement(subject!.linkId, noticeId),
    onSuccess: () => {
      notify("portalReadConfirmed");
      void query.refetch();
    },
  });
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
  const items = query.data.filter((item) => item.runId === id && inEnrollmentPeriod(item.publishAt, period));
  return (
    <div className="space-y-4">
      {query.error && (
        <PortalError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      )}
      {read.error && (
        <p role="alert" className="text-destructive">
          {message(read.error, "portalSaveError")}
        </p>
      )}
      {items.length === 0 && <PortalEmpty labelKey="portalNoAnnouncements" />}
      {items.map((item) => (
        <Card key={item.id}>
          <CardHeader className="p-4 pb-3">
            <CardTitle className="text-base">{item.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0 text-sm">
            <LearningText text={item.body} />
            <PortalFiles ids={item.fileIds} />
            <p className="text-sm text-muted-foreground">
              {format.date(item.publishAt)}
            </p>
            {!item.read && (
              <Button loading={read.isPending}
                variant="outline"
                disabled={read.isPending}
                onClick={() => read.mutate(item.id)}
              >
                {t("portalMarkRead")}
              </Button>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
