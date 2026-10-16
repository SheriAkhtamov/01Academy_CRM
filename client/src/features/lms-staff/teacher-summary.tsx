import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LmsTeacherSummaryDto } from "@shared/contracts/lms";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { lmsStaffApi } from "./api";
import { lmsStaffKey, useStaffQuery } from "./queries";
import { StaffReviews } from "./reviews";
import { StaffThreads } from "./communication";
import { MaterialEditor } from "./materials";
import { StaffProgram } from "./program";
import {
  StaffDialog,
  StaffEmpty,
  StaffError,
  StaffField,
  StaffLoading,
  useStaffFormat,
} from "./ui";

type Mode = "pendingReviews" | "openHelp" | "unpreparedLessons";
type Run = LmsTeacherSummaryDto["runs"][number];
type Lesson = Run["unpreparedLessons"][number];
const titleKeys: Record<Mode, TranslationKey> = {
  pendingReviews: "lmsStaffTeacherPendingReviews",
  openHelp: "lmsStaffTeacherOpenHelp",
  unpreparedLessons: "lmsStaffTeacherUnpreparedLessons",
};
const count = (run: Run, mode: Mode) =>
  mode === "unpreparedLessons" ? run.unpreparedLessons.length : run[mode];

export function LearningTeacherSummary({
  enabled = false,
}: {
  enabled?: boolean;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode | null>(null);
  const [runId, setRunId] = useState<number | null>(null);
  const query = useQuery({
    queryKey: [...lmsStaffKey, "teacher-summary"],
    queryFn: ({ signal }) => lmsStaffApi.teacherSummary(signal),
    enabled,
    staleTime: 15000,
    refetchInterval: enabled ? 60000 : false,
  });
  if (!enabled) return null;
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
  const available = mode
    ? query.data.runs.filter((run) => count(run, mode) > 0)
    : [];
  const selected = available.find((run) => run.runId === runId) ?? available[0];
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        {(Object.keys(titleKeys) as Mode[]).map((key) => (
          <Card key={key}>
            <CardContent className="p-3">
              <Button
                variant="ghost"
                className="h-auto min-h-20 w-full flex-col gap-2 whitespace-normal py-3"
                disabled={query.data[key] === 0}
                onClick={() => {
                  setMode(key);
                  setRunId(null);
                }}
              >
                <span className="text-3xl font-semibold">
                  {query.data[key]}
                </span>
                <span>{t(titleKeys[key])}</span>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      {mode && (
        <StaffDialog
          open
          onClose={() => setMode(null)}
          titleKey={titleKeys[mode]}
        >
          <div className="space-y-5">
            {available.length > 0 && (
              <StaffField id="teacher-summary-group" labelKey="lmsStaffGroup">
                <select
                  id="teacher-summary-group"
                  value={selected?.runId ?? ""}
                  onChange={(event) => setRunId(Number(event.target.value))}
                  className="min-h-11 w-full rounded-md border bg-background px-3"
                >
                  {available.map((run) => (
                    <option key={run.runId} value={run.runId}>
                      {run.groupName} ({count(run, mode)})
                    </option>
                  ))}
                </select>
              </StaffField>
            )}
            {!selected && <StaffEmpty />}
            {selected && mode === "pendingReviews" && (
              <StaffReviews key={selected.runId} runId={selected.runId} />
            )}
            {selected && mode === "openHelp" && (
              <StaffThreads
                key={selected.runId}
                runId={selected.runId}
                onlyOpen
              />
            )}
            {selected && mode === "unpreparedLessons" && (
              <UnpreparedLessons key={selected.runId} run={selected} />
            )}
          </div>
        </StaffDialog>
      )}
    </>
  );
}

function UnpreparedLessons({ run }: { run: Run }) {
  const { t } = useTranslation();
  const date = useStaffFormat();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  return (
    <div className="space-y-3">
      {run.unpreparedLessons.map((item) => (
        <Card key={item.lessonId}>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0 space-y-1">
              <h3 className="break-words font-medium">{item.topic}</h3>
              <p className="text-sm text-muted-foreground">
                {date(item.scheduledAt)}
              </p>
            </div>
            <Button
              variant="outline"
              disabled={item.unitId === null && !run.canManageSchedule}
              onClick={() => setLesson(item)}
            >
              {t(
                item.unitId === null
                  ? "lmsStaffBindLesson"
                  : "lmsStaffAddMaterial",
              )}
            </Button>
          </CardContent>
        </Card>
      ))}
      {lesson &&
        (lesson.unitId === null ? (
          <StaffDialog
            open
            onClose={() => setLesson(null)}
            titleKey="lmsStaffBindLesson"
            description={lesson.topic}
          >
            <StaffProgram
              runId={run.runId}
              courseId={run.courseId}
              administration={false}
              manageContent={false}
              manageSchedule={run.canManageSchedule}
            />
          </StaffDialog>
        ) : (
          <LessonMaterial
            runId={run.runId}
            unitId={lesson.unitId}
            onClose={() => setLesson(null)}
          />
        ))}
    </div>
  );
}

function LessonMaterial({
  runId,
  unitId,
  onClose,
}: {
  runId: number;
  unitId: number;
  onClose: () => void;
}) {
  const enrollments = useStaffQuery("enrollments", runId, (signal) =>
    lmsStaffApi.enrollments(runId, signal),
  );
  if (enrollments.isPending)
    return (
      <StaffDialog open onClose={onClose} titleKey="lmsStaffAddMaterial">
        <StaffLoading />
      </StaffDialog>
    );
  if (enrollments.error)
    return (
      <StaffDialog open onClose={onClose} titleKey="lmsStaffAddMaterial">
        <StaffError
          error={enrollments.error}
          retry={() => {
            void enrollments.refetch();
          }}
        />
      </StaffDialog>
    );
  return (
    <MaterialEditor
      runId={runId}
      enrollments={enrollments.data}
      initialUnitId={unitId}
      onClose={onClose}
    />
  );
}
