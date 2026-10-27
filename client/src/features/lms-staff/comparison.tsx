import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { LmsStaffSummaryDto } from "@shared/contracts/lms";
import type {
  PortalProjectDto,
  PortalProjectComparisonDto,
} from "@shared/contracts/portal-resources";
import { useTranslation } from "@/hooks/useTranslation";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LearningText } from "../learning-content/text";
import { lmsStaffApi, LmsStaffApiError } from "./api";
import { useStaffQuery, useStaffInvalidate } from "./queries";
import {
  StaffDialog,
  StaffField,
  StaffLoading,
  StaffError,
  StaffEmpty,
  useStaffError,
  safeStaffLink,
} from "./ui";
import { StaffFiles } from "./files";
export function StaffComparison({
  student,
  onClose,
}: {
  student: LmsStaffSummaryDto;
  onClose: () => void;
}) {
  const projects = useStaffQuery(
    "comparison-projects",
    student.runId,
    (signal) => lmsStaffApi.projects(student.runId, student.studentId, signal),
    [student.studentId],
  );
  const comparison = useStaffQuery(
    "comparison",
    student.runId,
    (signal) =>
      lmsStaffApi.comparison(student.runId, student.studentId, signal),
    [student.studentId],
  );
  if (projects.data && comparison.data !== undefined)
    return (
      <ComparisonEditor
        student={student}
        projects={projects.data}
        initial={comparison.data}
        reload={() => {
          void comparison.refetch();
        }}
        onClose={onClose}
      />
    );
  return (
    <StaffDialog
      open
      onClose={onClose}
      titleKey="portalComparison"
      description={student.studentName}
    >
      {projects.error || comparison.error ? (
        <StaffError
          error={projects.error ?? comparison.error}
          retry={() => {
            void projects.refetch();
            void comparison.refetch();
          }}
        />
      ) : (
        <StaffLoading />
      )}
    </StaffDialog>
  );
}
function ComparisonEditor({
  student,
  projects,
  initial,
  reload,
  onClose,
}: {
  student: LmsStaffSummaryDto;
  projects: PortalProjectDto[];
  initial: PortalProjectComparisonDto | null;
  reload: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const large = useMediaQuery("(min-width:768px)");
  const message = useStaffError();
  const invalidate = useStaffInvalidate();
  const [baseline] = useState(() => ({
    first: String(initial?.firstProjectId ?? projects.at(-1)?.id ?? ""),
    latest: String(initial?.latestProjectId ?? projects[0]?.id ?? ""),
    version: initial?.version ?? 0,
    selectedByName: initial?.selectedByName,
  }));
  const [first, setFirst] = useState(baseline.first);
  const [latest, setLatest] = useState(baseline.latest);
  const action = useMutation({
    mutationFn: () =>
      lmsStaffApi.saveComparison({
        studentId: student.studentId,
        runId: student.runId,
        firstProjectId: Number(first),
        latestProjectId: Number(latest),
        version: baseline.version,
      }),
    onSuccess: () => {
      void invalidate();
      onClose();
    },
    onError: (error) => {
      if (error instanceof LmsStaffApiError && error.status === 409) reload();
    },
  });
  const selections: Record<
    "first" | "latest",
    {
      value: string;
      set: (id: string) => void;
      labelKey: "portalFirstWork" | "portalLatestWork";
    }
  > = {
    first: { value: first, set: setFirst, labelKey: "portalFirstWork" },
    latest: { value: latest, set: setLatest, labelKey: "portalLatestWork" },
  };
  const card = (side: "first" | "latest") => {
    const selection = selections[side];
    const project = projects.find(
      (item) => String(item.id) === selection.value,
    );
    return (
      <div className="min-w-0 space-y-4 rounded-xl border p-4">
        <StaffField id={`comparison-${side}`} labelKey={selection.labelKey}>
          <select
            id={`comparison-${side}`}
            className="min-h-11 w-full rounded-md border bg-background px-3"
            value={selection.value}
            onChange={(event) => selection.set(event.target.value)}
          >
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </StaffField>
        {project && (
          <>
            <LearningText text={project.description} />
            <StaffFiles
              runId={student.runId}
              ids={project.files.map((file) => file.id)}
            />
            {project.teacherReview && (
              <LearningText text={project.teacherReview} />
            )}
            {project.links.filter(safeStaffLink).map((link) => (
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
          </>
        )}
      </div>
    );
  };
  return (
    <StaffDialog
      open
      onClose={onClose}
      titleKey="portalComparison"
      description={student.studentName}
      dirty={first !== baseline.first || latest !== baseline.latest}
      pending={action.isPending}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (first && latest && first !== latest) action.mutate();
        }}
      >
        {baseline.selectedByName && (
          <p className="text-sm text-muted-foreground">
            {t("portalComparisonSelectedBy").replace(
              "{name}",
              baseline.selectedByName,
            )}
          </p>
        )}
        {projects.length < 2 ? (
          <StaffEmpty />
        ) : large ? (
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            {card("first")}
            {card("latest")}
          </div>
        ) : (
          <Tabs defaultValue="first">
            <TabsList className="flex h-auto flex-wrap">
              <TabsTrigger value="first">{t("portalFirstWork")}</TabsTrigger>
              <TabsTrigger value="latest">{t("portalLatestWork")}</TabsTrigger>
            </TabsList>
            <TabsContent value="first">{card("first")}</TabsContent>
            <TabsContent value="latest">{card("latest")}</TabsContent>
          </Tabs>
        )}
        {first === latest && projects.length >= 2 && (
          <p role="alert" className="text-sm text-destructive">
            {t("portalComparisonDistinctProjects")}
          </p>
        )}
        {action.error && (
          <p role="alert" className="text-sm text-destructive">
            {message(action.error)}
          </p>
        )}
        <Button loading={action.isPending}
          disabled={
            action.isPending ||
            projects.length < 2 ||
            !first ||
            !latest ||
            first === latest
          }
        >
          {t("portalComparisonSave")}
        </Button>
      </form>
    </StaffDialog>
  );
}
