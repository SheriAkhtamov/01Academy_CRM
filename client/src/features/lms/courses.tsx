import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { LearningText } from "@/features/learning-content/text";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { portalLmsApi } from "../portal-app/api";
import {
  usePortal,
  useSubjectQuery,
  useInvalidateSubject,
} from "../portal-app/context";
import {
  PortalLoading,
  PortalError,
  PortalEmpty,
  PortalTitle,
  usePortalFormat,
  safeHttps,
  usePortalError,
  usePortalSuccess,
} from "../portal-app/ui";
import { PortalFiles } from "../portal-app/files";
import { PortalAssignments } from "./assignments";
import { PortalQuizzes } from "./quizzes";
import { PortalMakeup } from "./makeup";
import { HelpDialog } from "./communication";
import { PortalVideo } from "./video";
import {
  usePortalViewState,
  usePortalListScroll,
} from "../portal-app/view-state";

export function PortalCourses() {
  const { t } = useTranslation();
  const { guarded } = usePortal();
  const [, navigate] = useLocation();
  const query = useSubjectQuery("courses", portalLmsApi.courses);
  const [view, setView] = usePortalViewState("courses", { tab: "current" });
  const tab = view.tab;
  const format = usePortalFormat();
  usePortalListScroll("courses", Boolean(query.data));
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
      <Tabs value={tab} onValueChange={(value) => setView({ tab: value })}>
        <TabsList>
          <TabsTrigger value="current" className="min-h-11">
            {t("portalCurrent")}
          </TabsTrigger>
          <TabsTrigger value="completed" className="min-h-11">
            {t("portalCompleted")}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {items.length === 0 && <PortalEmpty labelKey="portalNoCourses" />}
      <div className="grid gap-4 md:grid-cols-2">
        {items.map((item) => (
          <Card key={item.enrollmentId}>
            <CardHeader>
              <CardTitle>{item.courseName}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p>{item.groupName}</p>
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
              {item.accessUntil && (
                <p className="text-sm text-muted-foreground">
                  {t("portalAccessUntil")}: {format.date(item.accessUntil)}
                </p>
              )}
              {item.nextLesson && (
                <p className="text-sm">
                  {t("portalUpcomingLesson")}:{" "}
                  {item.nextLesson.topic || item.nextLesson.courseName} ·{" "}
                  {format.date(item.nextLesson.scheduledAt)} ·{" "}
                  {format.time(item.nextLesson.scheduledAt)}
                </p>
              )}
              <Button
                className="min-h-11"
                onClick={() =>
                  guarded(() => navigate(`/learn/courses/${item.runId}`))
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
export function PortalCourse({ id }: { id: number }) {
  const { t } = useTranslation();
  const format = usePortalFormat();
  const { guarded, allowed } = usePortal();
  const [view, setView] = usePortalViewState(`course:${id}`, {
    tab: "lessons",
  });
  const [, navigate] = useLocation();
  const query = useSubjectQuery(
    "course",
    (link, signal) => portalLmsApi.course(link, id, signal),
    [id],
  );
  usePortalListScroll(`course:${id}`, Boolean(query.data));
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
  const course = query.data;
  return (
    <>
      <Button
        variant="ghost"
        className="min-h-11"
        onClick={() => guarded(() => navigate("/learn/courses"))}
      >
        {t("portalBack")}
      </Button>
      <div>
        <h1 className="text-2xl font-semibold">{course.courseName}</h1>
        <p className="mt-2 text-muted-foreground">
          {course.groupName} · {course.teacherName}
        </p>
        {course.currentUnit && (
          <p className="mt-3 font-medium">
            {t("portalCurrentTopic")}: {course.currentUnit.title}
          </p>
        )}
      </div>
      <Tabs value={view.tab} onValueChange={(value) => setView({ tab: value })}>
        <TabsList className="flex h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="lessons" className="min-h-11">
            {t("portalLessons")}
          </TabsTrigger>
          <TabsTrigger value="assignments" className="min-h-11">
            {t("portalAssignments")}
          </TabsTrigger>
          {(allowed("feedback.read") || allowed("learning.read")) && (
            <TabsTrigger value="results" className="min-h-11">
              {t("portalResults")}
            </TabsTrigger>
          )}
          <TabsTrigger value="announcements" className="min-h-11">
            {t("portalAnnouncements")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="lessons" className="space-y-5">
          <PortalMakeup embedded courseId={id} />
          {course.units.map((unit, index) => (
            <section key={unit.id} className="space-y-3">
              {unit.sectionTitle &&
                unit.sectionTitle !== course.units[index - 1]?.sectionTitle && (
                  <h2 className="text-xl font-semibold">{unit.sectionTitle}</h2>
                )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-semibold">{unit.title}</h3>
                {unit.status && (
                  <Badge variant="secondary">
                    {t(
                      unit.status === "soon"
                        ? "portalUpcoming"
                        : unit.status === "studied"
                          ? "portalLearned"
                          : "portalAvailable",
                    )}
                  </Badge>
                )}
              </div>
              {unit.status === "soon" && unit.openAt && (
                <p className="text-sm text-muted-foreground">
                  {format.date(unit.openAt)}
                </p>
              )}
              {unit.materials.map((material) => (
                <Button
                  key={material.publicationId}
                  className="h-auto min-h-16 w-full justify-between gap-4 whitespace-normal p-4 text-left"
                  variant="outline"
                  disabled={unit.status === "soon"}
                  onClick={() =>
                    guarded(() =>
                      navigate(
                        `/learn/courses/${id}/materials/${material.publicationId}`,
                      ),
                    )
                  }
                >
                  <span>{material.title}</span>
                  <Badge variant="secondary">
                    {t(material.read ? "portalLearned" : "portalAvailable")}
                  </Badge>
                </Button>
              ))}
            </section>
          ))}
          {course.materials
            .filter((material) => material.unitId === null)
            .map((material) => (
              <Button
                key={material.publicationId}
                className="h-auto min-h-16 w-full justify-between whitespace-normal p-4 text-left"
                variant="outline"
                onClick={() =>
                  guarded(() =>
                    navigate(
                      `/learn/courses/${id}/materials/${material.publicationId}`,
                    ),
                  )
                }
              >
                <span>{material.title}</span>
                <Badge variant="secondary">
                  {t(material.read ? "portalLearned" : "portalAvailable")}
                </Badge>
              </Button>
            ))}
          {course.materials.length === 0 &&
            course.units.every((unit) => unit.materials.length === 0) && (
              <PortalEmpty labelKey="portalNoLessons" />
            )}
        </TabsContent>
        <TabsContent value="assignments">
          <PortalAssignments courseId={id} />
        </TabsContent>
        <TabsContent value="results">
          <PortalQuizzes courseId={id} />
        </TabsContent>
        <TabsContent value="announcements">
          <CourseAnnouncements id={id} />
        </TabsContent>
      </Tabs>
    </>
  );
}
export function PortalMaterial({
  courseId,
  id,
}: {
  courseId: number;
  id: number;
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
    (link, signal) => portalLmsApi.course(link, courseId, signal),
    [courseId],
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
  if (query.error)
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
      <Button
        variant="ghost"
        className="min-h-11"
        onClick={() => guarded(() => navigate(`/learn/courses/${courseId}`))}
      >
        {t("portalBack")}
      </Button>
      <article className="space-y-6">
        <nav
          aria-label={t("portalBreadcrumbs")}
          className="flex flex-wrap items-center gap-2 text-sm"
        >
          <Button
            variant="link"
            className="min-h-11 px-0"
            onClick={() => guarded(() => navigate("/learn/courses"))}
          >
            {t("portalCourses")}
          </Button>
          <span aria-hidden="true">/</span>
          <Button
            variant="link"
            className="min-h-11 px-0"
            onClick={() =>
              guarded(() => navigate(`/learn/courses/${courseId}`))
            }
          >
            {query.data.courseName}
          </Button>
        </nav>
        <header className="space-y-3">
          <Badge variant="secondary">{t(category)}</Badge>
          <h1 className="text-2xl font-semibold md:text-3xl">
            {material.title}
          </h1>
          <p className="text-sm text-muted-foreground">
            {query.data.courseName} · {format.date(material.publishedAt)}
          </p>
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
        </header>
        <LearningText text={material.body} />
        {material.videoUrl && (
          <PortalVideo source={material.videoUrl} title={material.title} />
        )}
        {material.links.filter(safeHttps).map((link) => (
          <Button
            key={link}
            asChild
            variant="outline"
            className="min-h-11 max-w-full"
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
        <div className="flex flex-wrap gap-3">
          {subject?.kind === "self" && (
            <Button
              className="min-h-11"
              disabled={mark.isPending}
              onClick={() => mark.mutate()}
            >
              {t(material.read ? "portalUnmarkLearned" : "portalMarkLearned")}
            </Button>
          )}
          {allowed("communication.create") && (
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => setHelp(true)}
            >
              {t("portalNeedHelp")}
            </Button>
          )}
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => guarded(() => navigate("/learn/assignments"))}
          >
            {t("portalAssignments")}
          </Button>
        </div>
      </article>
      {material.unitId && (
        <PortalAssignments
          courseId={courseId}
          unitId={material.unitId}
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
function CourseAnnouncements({ id }: { id: number }) {
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
  const items = query.data.filter((item) => item.runId === id);
  return (
    <div className="space-y-4">
      {read.error && (
        <p role="alert" className="text-destructive">
          {message(read.error, "portalSaveError")}
        </p>
      )}
      {items.length === 0 && <PortalEmpty labelKey="portalNoAnnouncements" />}
      {items.map((item) => (
        <Card key={item.id}>
          <CardHeader>
            <CardTitle className="text-lg">{item.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <LearningText text={item.body} />
            <PortalFiles ids={item.fileIds} />
            <p className="text-sm text-muted-foreground">
              {format.date(item.publishAt)}
            </p>
            {!item.read && (
              <Button
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
