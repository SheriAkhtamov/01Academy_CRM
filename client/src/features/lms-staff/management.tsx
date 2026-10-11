import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { LmsStaffRunDto } from "@shared/contracts/lms";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { lmsStaffApi } from "./api";
import { useStaffRuns, useStaffQuery, useStaffInvalidate } from "./queries";
import {
  StaffDialog,
  StaffField,
  StaffLoading,
  StaffError,
  StaffEmpty,
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
import { StaffPermissions } from "./permissions";
import { RunSettings } from "./run-settings";
import { StaffAnalytics } from "./analytics";
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
export function LearningManagement({
  administration = false,
  initialTab,
}: {
  administration?: boolean;
  initialTab?: LearningManagementTab;
}) {
  const { t } = useTranslation();
  const runs = useStaffRuns();
  const [groupId, setGroupId] = useState("");
  const [create, setCreate] = useState(false);
  const [editRun, setEditRun] = useState(false);
  const [reviewQueue, setReviewQueue] = useState(false);
  const selected = runs.data?.find((run) => String(run.groupId) === groupId);
  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("lmsStaffTitle")}
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {t(administration ? "administration" : "teacher")}
          </span>
          {runs.data?.some(
            (run) =>
              !run.permissions || run.permissions.includes("reviews.manage"),
          ) && (
            <Button variant="outline" onClick={() => setReviewQueue(true)}>
              {t("lmsStaffReviews")}
            </Button>
          )}
        </div>
      </div>
      {administration && (
        <StaffAnalytics
          runId={selected?.runId ?? undefined}
          groupName={selected?.runId ? selected.groupName : undefined}
        />
      )}
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
          <StaffField id="learning-group" labelKey="lmsStaffGroup">
            <select
              id="learning-group"
              className="min-h-11 w-full rounded-md border bg-background px-3 sm:max-w-lg"
              value={groupId}
              onChange={(event) => {
                setGroupId(event.target.value);
                setCreate(false);
              }}
            >
              <option value="">{t("lmsStaffSelectGroup")}</option>
              {runs.data?.map((run) => (
                <option key={run.groupId} value={run.groupId}>
                  {run.groupName} · {run.courseName}
                </option>
              ))}
            </select>
          </StaffField>
          {selected && !selected.runId && (
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
                <div className="min-w-0 space-y-1">
                  <h2 className="break-words font-semibold">
                    {selected.groupName}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {selected.courseName}
                  </p>
                </div>
                <Button onClick={() => setCreate(true)}>
                  {t("lmsStaffCreateRun")}
                </Button>
              </CardContent>
            </Card>
          )}
          {selected?.runId &&
            (administration ||
              !selected.permissions ||
              selected.permissions.includes("content.manage")) && (
              <Button variant="outline" onClick={() => setEditRun(true)}>
                {t("lmsStaffRunSettings")}
              </Button>
            )}
          {selected?.runId && (
            <LearningWorkspace
              key={`${selected.runId}:${initialTab ?? ""}`}
              runId={selected.runId}
              courseId={selected.courseId}
              administration={administration}
              permissions={selected.permissions}
              canManageTemplates={selected.canManageTemplates}
              initialTab={initialTab}
            />
          )}
        </>
      )}
      {administration && (
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer font-medium">
            {t("lmsStaffPermissionsTitle")}
          </summary>
          <div className="mt-4">
            <StaffPermissions />
          </div>
        </details>
      )}
      {editRun && selected?.runId && (
        <RunSettings run={selected} onClose={() => setEditRun(false)} />
      )}
      {create && selected && (
        <CreateRun group={selected} onClose={() => setCreate(false)} />
      )}
      {reviewQueue && (
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
  courseId,
  administration,
  permissions,
  canManageTemplates,
  initialTab,
}: {
  runId: number;
  courseId: number;
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
  const [tab, setTab] = useState(() =>
    initialTab &&
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
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as LearningManagementTab)}
    >
      <TabsList className="flex h-auto flex-wrap justify-start gap-1">
        {tabs
          .filter(
            ([value]) =>
              !permissions ||
              (value === "program" &&
                permissions.includes("schedule.manage")) ||
              permissions.includes(
                (
                  {
                    program: "content.manage",
                    makeup: "assignments.manage",
                    materials: "content.manage",
                    assignments: "assignments.manage",
                    reviews: "reviews.manage",
                    quizzes: "quizzes.manage",
                    threads: "communication.manage",
                    results: "results.manage",
                    announcements: "announcements.manage",
                  } as Record<string, string>
                )[value],
              ),
          )
          .map(([value, key]) => (
            <TabsTrigger key={value} value={value} className="min-h-11">
              {t(key)}
            </TabsTrigger>
          ))}
      </TabsList>
      <TabsContent value="program">
        <StaffProgram
          runId={runId}
          courseId={courseId}
          administration={administration || Boolean(canManageTemplates)}
          manageContent={!permissions || permissions.includes("content.manage")}
          manageSchedule={
            !permissions || permissions.includes("schedule.manage")
          }
        />
      </TabsContent>
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
          canReview={!permissions || permissions.includes("reviews.manage")}
        />
      </TabsContent>
      <TabsContent value="reviews">
        <StaffReviews runId={runId} />
      </TabsContent>
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
      titleKey="lmsStaffCreateRun"
      description={`${group.groupName} · ${group.courseName}`}
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
        <StaffField id="run-format" labelKey="lmsStaffGroup">
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
        <Button disabled={action.isPending}>{t("lmsStaffCreateRun")}</Button>
      </form>
    </StaffDialog>
  );
}
