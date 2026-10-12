import { useState, type ReactNode } from "react";
import type { LmsStaffRunDto } from "@shared/contracts/lms";
import { useTranslation } from "@/hooks/useTranslation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { lmsStaffApi } from "./api";
import { useStaffQuery, useStaffRuns } from "./queries";
import { CreateRun } from "./management";
import { StaffMaterials } from "./materials";
import { StaffAssignments } from "./assignments";
import { StaffQuizzes } from "./quizzes";
import { StaffReviews } from "./reviews";
import { StaffResults } from "./results";
import { StaffProgram } from "./program";
import { StaffDialog, StaffGroupSetup, StaffError, StaffLoading } from "./ui";

type GroupTab = "students" | "materials" | "assignments" | "results";
const allowed = (run: LmsStaffRunDto, permission: string) =>
  permission === "reviews.manage"
    ? Boolean(run.permissions?.includes(permission))
    : !run.permissions || run.permissions.includes(permission);

export function LearningGroupTabs({
  groupId,
  enabled = false,
  children,
}: {
  groupId: number;
  enabled?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<GroupTab>("students");
  const [formatOpen, setFormatOpen] = useState(false);
  const [programOpen, setProgramOpen] = useState(false);
  const runs = useStaffRuns(enabled);
  const run = runs.data?.find((item) => item.groupId === groupId);
  if (!enabled) return <>{children}</>;
  if (runs.isPending)
    return (
      <>
        {children}
        <StaffLoading />
      </>
    );
  if (runs.error)
    return (
      <>
        {children}
        <StaffError
          error={runs.error}
          retry={() => {
            void runs.refetch();
          }}
        />
      </>
    );
  if (!run) return <>{children}</>;
  const canAssignments =
    allowed(run, "assignments.manage") ||
    allowed(run, "quizzes.manage") ||
    allowed(run, "reviews.manage");
  const content = run.runId ? (
    <GroupLearningContent run={run} tab={tab} />
  ) : (
    <StaffGroupSetup
      run={run}
      retry={() => {
        void runs.refetch();
      }}
      onFormat={() => setFormatOpen(true)}
    />
  );
  return (
    <>
      {run.runId && run.setupStatus === "needs_program_review" && (
        <StaffGroupSetup run={run} onProgram={() => setProgramOpen(true)} />
      )}
      <Tabs value={tab} onValueChange={(value) => setTab(value as GroupTab)}>
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 min-[420px]:grid-cols-4">
          <TabsTrigger value="students" className="min-h-11 px-1">
            {t("lmsStaffStudents")}
          </TabsTrigger>
          {allowed(run, "content.manage") && (
            <TabsTrigger value="materials" className="min-h-11 px-1">
              {t("lmsStaffMaterials")}
            </TabsTrigger>
          )}
          {canAssignments && (
            <TabsTrigger value="assignments" className="min-h-11 px-1">
              {t("lmsStaffAssignments")}
            </TabsTrigger>
          )}
          {allowed(run, "results.manage") && (
            <TabsTrigger value="results" className="min-h-11 px-1">
              {t("lmsStaffResults")}
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="students">{children}</TabsContent>
        {tab !== "students" && <TabsContent value={tab}>{content}</TabsContent>}
      </Tabs>
      {formatOpen &&
        !run.runId &&
        run.setupStatus === "needs_format" &&
        run.permissions?.includes("content.manage") && (
          <CreateRun group={run} onClose={() => setFormatOpen(false)} />
        )}
      {programOpen &&
        run.runId &&
        run.courseId &&
        run.setupStatus === "needs_program_review" &&
        run.permissions?.includes("content.manage") && (
          <StaffDialog
            open
            onClose={() => setProgramOpen(false)}
            titleKey="lmsStaffProgram"
            description={run.groupName}
          >
            <StaffProgram
              runId={run.runId}
              courseId={run.courseId}
              administration={Boolean(run.canManageTemplates)}
              manageContent
              manageSchedule={allowed(run, "schedule.manage")}
            />
          </StaffDialog>
        )}
    </>
  );
}

function GroupLearningContent({
  run,
  tab,
}: {
  run: LmsStaffRunDto;
  tab: GroupTab;
}) {
  const { t } = useTranslation();
  const runId = run.runId!;
  const enrollments = useStaffQuery(
    "enrollments",
    tab === "materials" || tab === "assignments" ? runId : null,
    (signal) => lmsStaffApi.enrollments(runId, signal),
  );
  if (tab === "results") return <StaffResults runId={runId} />;
  if (tab === "students") return null;
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
  if (tab === "materials")
    return <StaffMaterials runId={runId} enrollments={enrollments.data} />;
  const features = [
    ["assignments", "lmsStaffAssignments", "assignments.manage"],
    ["quizzes", "lmsStaffQuizzes", "quizzes.manage"],
    ["reviews", "lmsStaffReviews", "reviews.manage"],
  ] as const;
  const available = features.filter(([, , permission]) =>
    allowed(run, permission),
  );
  return (
    <Tabs defaultValue={available[0]?.[0]}>
      <TabsList className="flex h-auto flex-wrap justify-start gap-1">
        {available.map(([value, key]) => (
          <TabsTrigger value={value} key={value} className="min-h-11">
            {t(key)}
          </TabsTrigger>
        ))}
      </TabsList>
      {allowed(run, "assignments.manage") && (
        <TabsContent value="assignments">
          <StaffAssignments
            runId={runId}
            enrollments={enrollments.data}
            canReview={allowed(run, "reviews.manage")}
          />
        </TabsContent>
      )}
      {allowed(run, "quizzes.manage") && (
        <TabsContent value="quizzes">
          <StaffQuizzes runId={runId} enrollments={enrollments.data} />
        </TabsContent>
      )}
      {allowed(run, "reviews.manage") && (
        <TabsContent value="reviews">
          <StaffReviews runId={runId} />
        </TabsContent>
      )}
    </Tabs>
  );
}
