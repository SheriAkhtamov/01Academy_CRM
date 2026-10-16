import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Award,
  BookOpen,
  CalendarClock,
  CheckSquare,
  ClipboardList,
  FileText,
  GraduationCap,
  ListChecks,
  MapPin,
  Megaphone,
  MessageSquare,
  Settings2,
  Users,
  Video,
} from "lucide-react";
import type { LmsStaffRunDto } from "@shared/contracts/lms";
import { useTranslation } from "@/hooks/useTranslation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { lmsStaffApi } from "./api";
import { useStaffRuns, useStaffQuery, useStaffInvalidate } from "./queries";
import {
  StaffDialog,
  StaffField,
  StaffLoading,
  StaffError,
  StaffEmpty,
  StaffGroupSetup,
  useStaffError,
  safeStaffLink,
} from "./ui";
import { StaffMaterials } from "./materials";
import { StaffAssignments } from "./assignments";
import { StaffQuizzes } from "./quizzes";
import { StaffReviews } from "./reviews";
import { StaffThreads, StaffAnnouncements } from "./communication";
import { StaffResults } from "./results";
import { StaffProgram } from "./program";
import { StaffMakeup } from "./makeup";
import { RunSettings } from "./run-settings";
const tabs = [
  ["program", "lmsStaffProgram"],
  ["makeup", "portalMakeup"],
  ["materials", "lmsStaffMaterials"],
  ["assignments", "lmsStaffAssignments"],
  ["reviews", "lmsStaffReviews"],
  ["quizzes", "lmsStaffQuizzes"],
  ["threads", "lmsStaffThreads"],
  ["results", "lmsStaffResults"],
  ["announcements", "lmsStaffAnnouncements"],
] as const;
export type LearningManagementTab = (typeof tabs)[number][0];

const tabIcons: Record<LearningManagementTab, typeof BookOpen> = {
  program: BookOpen,
  makeup: CalendarClock,
  materials: FileText,
  assignments: ClipboardList,
  reviews: CheckSquare,
  quizzes: ListChecks,
  threads: MessageSquare,
  results: Award,
  announcements: Megaphone,
};

export function LearningManagement({
  administration = false,
  initialTab,
  autoSelectFirstGroup = false,
}: {
  administration?: boolean;
  initialTab?: LearningManagementTab;
  autoSelectFirstGroup?: boolean;
}) {
  const { t } = useTranslation();
  const runs = useStaffRuns();
  const [groupId, setGroupId] = useState("");
  const [formatGroup, setFormatGroup] = useState<number | null>(null);
  const [editRun, setEditRun] = useState(false);
  const [reviewQueue, setReviewQueue] = useState(false);
  const didAutoSelectRef = useRef(false);

  useEffect(() => {
    if (didAutoSelectRef.current || !runs.data || runs.data.length === 0) {
      return;
    }
    const searchGroup =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("group")
        : null;
    if (
      searchGroup &&
      runs.data.some((run) => String(run.groupId) === searchGroup)
    ) {
      didAutoSelectRef.current = true;
      setGroupId(searchGroup);
      return;
    }
    if (autoSelectFirstGroup) {
      didAutoSelectRef.current = true;
      const preferred =
        runs.data.find((run) => Boolean(run.runId)) ?? runs.data[0];
      if (preferred) {
        setGroupId(String(preferred.groupId));
      }
    }
  }, [autoSelectFirstGroup, runs.data]);

  const canReview = Boolean(
    runs.data?.some((run) => run.permissions?.includes("reviews.manage")),
  );
  const selected = runs.data?.find((run) => String(run.groupId) === groupId);
  const formatTarget = runs.data?.find(
    (run) =>
      run.groupId === formatGroup &&
      !run.runId &&
      run.setupStatus === "needs_format" &&
      run.permissions?.includes("content.manage"),
  );
  const canEditSelectedRun = Boolean(
    selected?.runId &&
      (administration ||
        !selected.permissions ||
        selected.permissions.includes("content.manage")),
  );

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <GraduationCap className="h-5 w-5" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {t("lmsStaffTitle")}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canReview && (
            <Button
              variant="outline"
              onClick={() => setReviewQueue(true)}
              className="gap-2"
            >
              <CheckSquare className="h-4 w-4 text-primary" aria-hidden="true" />
              {t("lmsStaffReviews")}
            </Button>
          )}
        </div>
      </div>
      {runs.isPending ? (
        <StaffLoading />
      ) : runs.error ? (
        <StaffError
          error={runs.error}
          retry={() => {
            void runs.refetch();
          }}
        />
      ) : runs.data?.length === 0 ? (
        <StaffEmpty />
      ) : (
        <>
          <Card className="overflow-hidden border-border/70 bg-gradient-to-br from-card via-card to-muted/20 shadow-sm">
            <CardContent className="space-y-4 p-4 sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="w-full max-w-xl">
                  <StaffField id="learning-group" labelKey="lmsStaffGroup">
                    <select
                      id="learning-group"
                      className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm font-medium shadow-xs transition-colors focus:border-primary focus:outline-none"
                      value={groupId}
                      onChange={(event) => {
                        didAutoSelectRef.current = true;
                        setGroupId(event.target.value);
                      }}
                    >
                      <option value="">{t("lmsStaffSelectGroup")}</option>
                      {runs.data?.map((run) => (
                        <option key={run.groupId} value={run.groupId}>
                          {run.groupName} ·{" "}
                          {run.courseName || t("lmsStaffCourseNotSelected")}
                        </option>
                      ))}
                    </select>
                  </StaffField>
                </div>

                {selected && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="secondary"
                      className="gap-1.5 px-2.5 py-1 text-xs font-medium"
                    >
                      <BookOpen className="h-3.5 w-3.5 text-primary" />
                      {selected.courseName || t("lmsStaffCourseNotSelected")}
                    </Badge>
                    {typeof selected.studentCount === "number" && (
                      <Badge
                        variant="outline"
                        className="gap-1.5 px-2.5 py-1 text-xs font-medium"
                      >
                        <Users className="h-3.5 w-3.5 text-muted-foreground" />
                        {selected.studentCount} {t("students").toLowerCase()}
                      </Badge>
                    )}
                    {selected.format && (
                      <Badge
                        variant="outline"
                        className={cn(
                          "gap-1.5 px-2.5 py-1 text-xs font-medium",
                          selected.format === "online"
                            ? "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                        )}
                      >
                        {selected.format === "online" ? (
                          <Video className="h-3.5 w-3.5" />
                        ) : (
                          <MapPin className="h-3.5 w-3.5" />
                        )}
                        {t(
                          selected.format === "online"
                            ? "lmsStaffOnline"
                            : "lmsStaffOffline",
                        )}
                      </Badge>
                    )}
                    {canEditSelectedRun && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditRun(true)}
                        className="gap-1.5"
                      >
                        <Settings2
                          className="h-3.5 w-3.5 text-muted-foreground"
                          aria-hidden="true"
                        />
                        {t("lmsStaffRunSettings")}
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {runs.data && runs.data.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-3">
                  {runs.data.map((run) => {
                    const isActive = String(run.groupId) === groupId;
                    return (
                      <button
                        key={run.groupId}
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => {
                          didAutoSelectRef.current = true;
                          setGroupId(String(run.groupId));
                        }}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                          isActive
                            ? "border-primary bg-primary text-primary-foreground shadow-xs"
                            : "border-border/60 bg-background/80 text-muted-foreground hover:border-primary/40 hover:bg-muted/50 hover:text-foreground",
                        )}
                      >
                        <span className="truncate max-w-[180px]">
                          {run.groupName}
                        </span>
                        {typeof run.studentCount === "number" && (
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.2 text-[10px] tabular-nums",
                              isActive
                                ? "bg-primary-foreground/20 text-primary-foreground"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {run.studentCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {!selected && runs.data && runs.data.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {runs.data.map((run) => (
                <Card
                  key={run.groupId}
                  className="border-border/70 transition-all hover:border-primary/40 hover:shadow-md"
                >
                  <CardContent className="p-0">
                    <button
                      type="button"
                      onClick={() => {
                        didAutoSelectRef.current = true;
                        setGroupId(String(run.groupId));
                      }}
                      className="group flex h-full w-full flex-col justify-between gap-4 rounded-xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <span className="block w-full space-y-2">
                        <span className="flex items-start justify-between gap-2">
                          <span className="font-semibold text-foreground group-hover:text-primary transition-colors">
                            {run.groupName}
                          </span>
                          {run.format && (
                            <span
                              className="inline-flex shrink-0 items-center rounded-full border border-border bg-background px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground"
                            >
                              {t(
                                run.format === "online"
                                  ? "lmsStaffOnline"
                                  : "lmsStaffOffline",
                              )}
                            </span>
                          )}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {run.courseName || t("lmsStaffCourseNotSelected")}
                        </span>
                      </span>
                      <span className="flex w-full items-center justify-between border-t border-border/50 pt-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5" />
                          {run.studentCount ?? 0} {t("students").toLowerCase()}
                        </span>
                        <span className="font-medium text-primary group-hover:underline">
                          {t("lmsStaffOpenGroupWorkspace")} →
                        </span>
                      </span>
                    </button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {selected && !selected.runId && (
            <StaffGroupSetup
              run={selected}
              retry={() => {
                void runs.refetch();
              }}
              onFormat={() => setFormatGroup(selected.groupId)}
            />
          )}
          {selected?.runId && (
            <LearningWorkspace
              key={`${selected.runId}:${initialTab ?? ""}`}
              runId={selected.runId}
              run={selected}
              courseId={selected.courseId ?? undefined}
              administration={administration}
              permissions={selected.permissions}
              canManageTemplates={selected.canManageTemplates}
              initialTab={initialTab}
            />
          )}
        </>
      )}
      {editRun && selected?.runId && (
        <RunSettings run={selected} onClose={() => setEditRun(false)} />
      )}
      {formatTarget && (
        <CreateRun group={formatTarget} onClose={() => setFormatGroup(null)} />
      )}
      {canReview && reviewQueue && (
        <StaffDialog
          open
          onClose={() => setReviewQueue(false)}
          titleKey="lmsStaffReviews"
        >
          <StaffReviews />
        </StaffDialog>
      )}
    </div>
  );
}
function LearningWorkspace({
  runId,
  run,
  courseId,
  administration,
  permissions,
  canManageTemplates,
  initialTab,
}: {
  runId: number;
  run: LmsStaffRunDto;
  courseId?: number;
  administration: boolean;
  permissions?: string[];
  canManageTemplates?: boolean;
  initialTab?: LearningManagementTab;
}) {
  const permissionForTab = {
    program: "content.manage",
    makeup: "assignments.manage",
    materials: "content.manage",
    assignments: "assignments.manage",
    reviews: "reviews.manage",
    quizzes: "quizzes.manage",
    threads: "communication.manage",
    results: "results.manage",
    announcements: "announcements.manage",
  } as const;
  const canReview = Boolean(permissions?.includes("reviews.manage"));
  const [tab, setTab] = useState(() =>
    initialTab &&
    (initialTab !== "program" || courseId !== undefined) &&
    (initialTab !== "reviews" || canReview) &&
    (!permissions ||
      permissions.includes(permissionForTab[initialTab]) ||
      (initialTab === "program" && permissions.includes("schedule.manage")))
      ? initialTab
      : !permissions || permissions.includes("content.manage")
        ? "materials"
        : permissions.includes("schedule.manage")
          ? "program"
          : permissions.includes("reviews.manage")
            ? "reviews"
            : permissions.includes("assignments.manage")
              ? "assignments"
              : permissions.includes("quizzes.manage")
                ? "quizzes"
                : permissions.includes("results.manage")
                  ? "results"
                  : permissions.includes("communication.manage")
                    ? "threads"
                    : "announcements",
  );
  const { t } = useTranslation();
  const enrollments = useStaffQuery("enrollments", runId, (signal) =>
    lmsStaffApi.enrollments(runId, signal),
  );
  if (enrollments.isPending) return <StaffLoading />;
  if (enrollments.error)
    return (
      <StaffError
        error={enrollments.error}
        retry={() => {
          void enrollments.refetch();
        }}
      />
    );
  return (
    <div className="space-y-5">
      {run.setupStatus === "needs_program_review" && (
        <StaffGroupSetup run={run} onProgram={() => setTab("program")} />
      )}
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as LearningManagementTab)}
        className="space-y-5"
      >
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1.5 rounded-xl border border-border/60 bg-muted/40 p-1.5">
          {tabs
            .filter(([value]) =>
              value === "program" && courseId === undefined
                ? false
                : value === "reviews"
                  ? canReview
                  : !permissions ||
                    (value === "program" &&
                      permissions.includes("schedule.manage")) ||
                    permissions.includes(permissionForTab[value]),
            )
            .map(([value, key]) => {
              const Icon = tabIcons[value];
              return (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="min-h-10 gap-2 rounded-lg px-3.5 py-2 text-xs sm:text-sm font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs"
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {t(key)}
                </TabsTrigger>
              );
            })}
        </TabsList>
        {courseId !== undefined && (
          <TabsContent value="program">
            <StaffProgram
              runId={runId}
              courseId={courseId}
              administration={administration || Boolean(canManageTemplates)}
              manageContent={
                !permissions || permissions.includes("content.manage")
              }
              manageSchedule={
                !permissions || permissions.includes("schedule.manage")
              }
            />
          </TabsContent>
        )}
        <TabsContent value="makeup">
          <StaffMakeup runId={runId} />
        </TabsContent>
        <TabsContent value="materials">
          <StaffMaterials runId={runId} enrollments={enrollments.data} />
        </TabsContent>
        <TabsContent value="assignments">
          <StaffAssignments
            runId={runId}
            enrollments={enrollments.data}
            canReview={canReview}
          />
        </TabsContent>
        {canReview && (
          <TabsContent value="reviews">
            <StaffReviews runId={runId} />
          </TabsContent>
        )}
        <TabsContent value="quizzes">
          <StaffQuizzes runId={runId} enrollments={enrollments.data} />
        </TabsContent>
        <TabsContent value="threads">
          <StaffThreads runId={runId} />
        </TabsContent>
        <TabsContent value="results">
          <StaffResults runId={runId} />
        </TabsContent>
        <TabsContent value="announcements">
          <StaffAnnouncements runId={runId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
export function CreateRun({
  group,
  onClose,
}: {
  group: LmsStaffRunDto;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const message = useStaffError();
  const invalidate = useStaffInvalidate();
  const [format, setFormat] = useState<"offline" | "online">("offline");
  const [meeting, setMeeting] = useState("");
  const [validation, setValidation] = useState("");
  const action = useMutation({
    mutationFn: () =>
      lmsStaffApi.createRun({
        groupId: group.groupId,
        format,
        meetingUrl: format === "online" ? meeting : null,
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
      titleKey="lmsStaffSelectFormat"
      description={`${group.groupName} · ${group.courseName || t("lmsStaffCourseNotSelected")}`}
      dirty={Boolean(meeting)}
      pending={action.isPending}
    >
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          setValidation("");
          if (format === "online" && !safeStaffLink(meeting)) {
            setValidation(t("portalInvalidUrl"));
            return;
          }
          action.mutate();
        }}
      >
        <StaffField id="run-format" labelKey="lmsStaffFormat">
          <select
            id="run-format"
            className="min-h-11 w-full rounded-md border bg-background px-3"
            value={format}
            onChange={(event) => setFormat(event.target.value as typeof format)}
          >
            <option value="offline">{t("lmsStaffOffline")}</option>
            <option value="online">{t("lmsStaffOnline")}</option>
          </select>
        </StaffField>
        {format === "online" && (
          <StaffField id="run-meeting" labelKey="lmsStaffMeeting">
            <Input
              id="run-meeting"
              type="url"
              value={meeting}
              onChange={(event) => setMeeting(event.target.value)}
              required
              placeholder={t("portalLinkPlaceholder")}
            />
          </StaffField>
        )}
        {(validation || action.error) && (
          <p role="alert" className="text-sm text-destructive">
            {validation || message(action.error)}
          </p>
        )}
        <Button disabled={action.isPending}>{t("lmsStaffSave")}</Button>
      </form>
    </StaffDialog>
  );
}
