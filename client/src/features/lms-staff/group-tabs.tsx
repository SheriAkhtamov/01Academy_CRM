import { useState, type ReactNode } from "react";
import {
  Award,
  CheckSquare,
  ClipboardList,
  FileText,
  ListChecks,
  Users,
} from "lucide-react";
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
    <div className="space-y-4">
      {run.runId && run.setupStatus === "needs_program_review" && (
        <StaffGroupSetup run={run} onProgram={() => setProgramOpen(true)} />
      )}
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as GroupTab)}
        className="space-y-4"
      >
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1.5 rounded-xl border border-border/60 bg-muted/40 p-1.5 min-[420px]:grid-cols-4">
          <TabsTrigger
            value="students"
            className="min-h-10 gap-1.5 rounded-lg px-2 text-xs sm:text-sm font-medium"
          >
            <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("lmsStaffStudents")}
          </TabsTrigger>
          {allowed(run, "content.manage") && (
            <TabsTrigger
              value="materials"
              className="min-h-10 gap-1.5 rounded-lg px-2 text-xs sm:text-sm font-medium"
            >
              <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t("lmsStaffMaterials")}
            </TabsTrigger>
          )}
          {canAssignments && (
            <TabsTrigger
              value="assignments"
              className="min-h-10 gap-1.5 rounded-lg px-2 text-xs sm:text-sm font-medium"
            >
              <ClipboardList
                className="h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
              {t("lmsStaffAssignments")}
            </TabsTrigger>
          )}
          {allowed(run, "results.manage") && (
            <TabsTrigger
              value="results"
              className="min-h-10 gap-1.5 rounded-lg px-2 text-xs sm:text-sm font-medium"
            >
              <Award className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
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
    </div>
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
    ["assignments", "lmsStaffAssignments", "assignments.manage", ClipboardList],
    ["quizzes", "lmsStaffQuizzes", "quizzes.manage", ListChecks],
    ["reviews", "lmsStaffReviews", "reviews.manage", CheckSquare],
  ] as const;
  const available = features.filter(([, , permission]) =>
    allowed(run, permission),
  );
  return (
    <Tabs defaultValue={available[0]?.[0]} className="space-y-4">
      <TabsList className="flex h-auto flex-wrap justify-start gap-1.5 rounded-xl border border-border/60 bg-muted/30 p-1">
        {available.map(([value, key, , Icon]) => (
          <TabsTrigger
            value={value}
            key={value}
            className="min-h-9 gap-1.5 rounded-lg px-3 text-xs font-medium"
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
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
