import { DateTimeInput } from '@/components/ui/date-time-input';
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type {
  LmsStaffSummaryDto,
  LmsProgressMetric,
  LmsAchievementDto,
  LmsReportDto,
} from "@shared/contracts/lms";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LearningText } from "../learning-content/text";
import { StaffFiles } from "./files";
import { StaffComparison } from "./comparison";
import { StaffResultJournal } from "./result-journal";
import type { TranslationKey } from "@/lib/i18n";
import { lmsStaffApi } from "./api";
import { useStaffQuery, useStaffInvalidate } from "./queries";
import {
  StaffDialog,
  StaffField,
  StaffLoading,
  StaffError,
  StaffEmpty,
  StaffConfirm,
  staffDateInput,
  staffDateIso,
  useStaffError,
  useStaffFormat,
} from "./ui";
function Metric({
  labelKey,
  value,
}: {
  labelKey: TranslationKey;
  value: LmsProgressMetric;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 rounded-md bg-muted/40 p-3">
      <p className="text-sm font-medium">{t(labelKey)}</p>
      <p className="text-lg font-semibold">
        {value.percent === null ? "—" : `${value.percent}%`}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("portalCompletedCount")
          .replace("{done}", String(value.completed))
          .replace("{total}", String(value.total))}
      </p>
      {value.percent !== null && (
        <Progress value={value.percent} aria-label={t(labelKey)} />
      )}
    </div>
  );
}
export function StaffResults({ runId }: { runId: number }) {
  const { t } = useTranslation();
  const query = useStaffQuery("results", runId, (signal) =>
    lmsStaffApi.results(runId, signal),
  );
  const [selected, setSelected] = useState<{
    student: LmsStaffSummaryDto;
    mode: "report" | "award" | "complete" | "reopen";
  } | null>(null);
  const [history, setHistory] = useState<LmsStaffSummaryDto | null>(null);
  const [comparison, setComparison] = useState<LmsStaffSummaryDto | null>(null);
  const [detail, setDetail] = useState<LmsStaffSummaryDto | null>(null);
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
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">{t("lmsStaffResults")}</h2>
      {!query.data.length && <StaffEmpty />}
      <StaffResultJournal students={query.data} onSelect={setDetail} />
      {detail && (
        <StaffDialog
          open
          onClose={() => setDetail(null)}
          titleKey="lmsStaffResults"
          description={detail.studentName}
        >
          <Card key={detail.studentId}>
            <CardContent className="space-y-4 p-4">
              <h3 className="break-words text-lg font-semibold">
                {detail.studentName}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Metric
                  labelKey="portalAttendance"
                  value={detail.progress.attendance}
                />
                <Metric
                  labelKey="portalAssignments"
                  value={detail.progress.assignments}
                />
                <Metric
                  labelKey="portalTests"
                  value={detail.progress.quizzes}
                />
                <Metric
                  labelKey="portalMaterialsProgress"
                  value={detail.progress.materials}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    setSelected({ student: detail, mode: "report" })
                  }
                >
                  {t("lmsStaffPublishReport")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    setSelected({ student: detail, mode: "award" })
                  }
                >
                  {t("lmsStaffAward")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    setSelected({
                      student: detail,
                      mode: detail.completed ? "reopen" : "complete",
                    })
                  }
                >
                  {t(
                    detail.completed
                      ? "lmsStaffRestoreCourse"
                      : "lmsStaffCompleteCourse",
                  )}
                </Button>
                <Button variant="outline" onClick={() => setComparison(detail)}>
                  {t("portalComparison")}
                </Button>
                <Button variant="outline" onClick={() => setHistory(detail)}>
                  {t("lmsStaffResultHistory")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </StaffDialog>
      )}
      {selected && (
        <ResultEditor
          key={`${selected.student.studentId}:${selected.mode}`}
          student={selected.student}
          mode={selected.mode}
          onClose={() => setSelected(null)}
        />
      )}
      {history && (
        <ResultHistory student={history} onClose={() => setHistory(null)} />
      )}
      {comparison && (
        <StaffComparison
          student={comparison}
          onClose={() => setComparison(null)}
        />
      )}
    </div>
  );
}
function ResultHistory({
  student,
  onClose,
}: {
  student: LmsStaffSummaryDto;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const date = useStaffFormat();
  const invalidate = useStaffInvalidate();
  const awards = useStaffQuery("achievement-history", student.runId, (signal) =>
    lmsStaffApi.achievements(student.runId, signal),
  );
  const reports = useStaffQuery("report-history", student.runId, (signal) =>
    lmsStaffApi.reports(student.runId, signal),
  );
  const [detail, setDetail] = useState<LmsAchievementDto | LmsReportDto | null>(
    null,
  );
  const [revoke, setRevoke] = useState<LmsAchievementDto | null>(null);
  const [reason, setReason] = useState("");
  const action = useMutation({
    mutationFn: () => lmsStaffApi.revokeAchievement(revoke!.id, reason),
    onSuccess: () => {
      setRevoke(null);
      setReason("");
      void invalidate();
    },
  });
  return (
    <StaffDialog
      open
      onClose={onClose}
      titleKey="lmsStaffResultHistory"
      description={student.studentName}
      pending={action.isPending}
    >
      {awards.isPending || reports.isPending ? (
        <StaffLoading />
      ) : awards.error || reports.error ? (
        <StaffError
          error={awards.error ?? reports.error}
          retry={() => {
            void awards.refetch();
            void reports.refetch();
          }}
        />
      ) : (
        <Tabs defaultValue="reports">
          <TabsList className="flex h-auto flex-wrap">
            <TabsTrigger value="reports">
              {t("lmsStaffPublishReport")}
            </TabsTrigger>
            <TabsTrigger value="awards">{t("lmsStaffAward")}</TabsTrigger>
          </TabsList>
          <TabsContent value="reports" className="space-y-3">
            {reports.data
              ?.filter((report) => report.studentId === student.studentId)
              .map((report) => (
                <button
                  key={report.id}
                  onClick={() => setDetail(report)}
                  className="w-full rounded-xl border p-4 text-left"
                >
                  <p className="font-medium">
                    {date(report.periodFrom)} – {date(report.periodTo)}
                  </p>
                  <p className="line-clamp-2 text-sm">{report.comment}</p>
                </button>
              ))}
          </TabsContent>
          <TabsContent value="awards" className="space-y-3">
            {awards.data
              ?.filter((award) => award.studentId === student.studentId)
              .map((award) => (
                <div key={award.id} className="space-y-2 rounded-xl border p-4">
                  <button
                    onClick={() => setDetail(award)}
                    className="w-full text-left"
                  >
                    <p className="font-medium">{award.title}</p>
                    <p className="text-sm">{date(award.awardedAt)}</p>
                  </button>
                  {award.revokedAt ? (
                    <p className="text-sm text-muted-foreground">
                      {award.revokeReason}
                    </p>
                  ) : (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setRevoke(award);
                        setReason("");
                      }}
                    >
                      {t("lmsStaffRevokeAchievement")}
                    </Button>
                  )}
                </div>
              ))}
          </TabsContent>
        </Tabs>
      )}
      {detail && (
        <StaffDialog
          open
          onClose={() => setDetail(null)}
          titleKey={
            "title" in detail ? "lmsStaffAward" : "lmsStaffPublishReport"
          }
          description={"title" in detail ? detail.title : student.studentName}
        >
          {"title" in detail ? (
            <div className="space-y-3">
              <p>{date(detail.awardedAt)}</p>
              <LearningText text={detail.reason} />
              {detail.revokedAt && (
                <LearningText text={detail.revokeReason ?? ""} />
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <p>
                {date(detail.periodFrom)} – {date(detail.periodTo)}
              </p>
              <p>{detail.authorName}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Metric
                  labelKey="portalAttendance"
                  value={detail.metrics.attendance}
                />
                <Metric
                  labelKey="portalAssignments"
                  value={detail.metrics.assignments}
                />
                <Metric labelKey="portalTests" value={detail.metrics.quizzes} />
                <Metric
                  labelKey="portalMaterialsProgress"
                  value={detail.metrics.materials}
                />
              </div>
              <LearningText text={detail.comment} />
              <LearningText text={detail.nextSteps} />
              {Boolean(detail.bestProjects?.length) && (
                <section className="space-y-4">
                  <h3 className="font-semibold">{t("portalBestProjects")}</h3>
                  {detail.bestProjects?.map((project) => (
                    <div
                      key={project.id}
                      className="space-y-3 rounded-xl border p-4"
                    >
                      <h4 className="font-semibold">{project.title}</h4>
                      <LearningText text={project.description} />
                      <LearningText text={project.review} />
                      <StaffFiles runId={student.runId} ids={project.fileIds} />
                      {project.links
                        .filter((link) => {
                          try {
                            return new URL(link).protocol === "https:";
                          } catch {
                            return false;
                          }
                        })
                        .map((link) => (
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
                    </div>
                  ))}
                </section>
              )}
            </div>
          )}
        </StaffDialog>
      )}
      <StaffConfirm
        open={revoke !== null}
        onOpenChange={(open) => {
          if (!open) setRevoke(null);
        }}
        disabled={!reason.trim()}
        titleKey="lmsStaffRevokeAchievementTitle"
        description="lmsStaffRevokeAchievementBody"
        action="lmsStaffRevokeAchievement"
        pending={action.isPending}
        error={action.error}
        onConfirm={() => {
          if (reason.trim()) action.mutate();
        }}
      >
        <p className="font-medium">{revoke?.title}</p>
        <StaffField id="revoke-achievement-reason" labelKey="lmsStaffReason">
          <Textarea
            id="revoke-achievement-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            maxLength={2000}
          />
        </StaffField>
      </StaffConfirm>
    </StaffDialog>
  );
}
function ResultEditor({
  student,
  mode,
  onClose,
}: {
  student: LmsStaffSummaryDto;
  mode: "report" | "award" | "complete" | "reopen";
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const message = useStaffError();
  const invalidate = useStaffInvalidate();
  const now = new Date();
  const [from, setFrom] = useState(
    staffDateInput(
      new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
    ),
  );
  const [to, setTo] = useState(staffDateInput(new Date().toISOString()));
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");
  const [nextSteps, setNextSteps] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [validation, setValidation] = useState("");
  const [eventKey] = useState(crypto.randomUUID());
  const projects = useStaffQuery(
    "report-projects",
    mode === "report" ? student.runId : null,
    (signal) =>
      lmsStaffApi.reportProjects(student.runId, student.studentId, signal),
    [student.studentId],
  );
  const [bestProjectIds, setBestProjectIds] = useState<number[]>([]);
  const action = useMutation({
    mutationFn: () =>
      mode === "report"
        ? lmsStaffApi.report({
            idempotencyKey: eventKey,
            runId: student.runId,
            studentId: student.studentId,
            periodFrom: staffDateIso(from),
            periodTo: staffDateIso(to),
            comment,
            nextSteps,
            bestProjectIds,
          })
        : mode === "award"
          ? lmsStaffApi.award({
              runId: student.runId,
              studentId: student.studentId,
              title,
              reason: comment,
              eventKey,
            })
          : (mode === "reopen"
              ? lmsStaffApi.reopenCourse
              : lmsStaffApi.complete)({
              runId: student.runId,
              studentId: student.studentId,
              reason: comment,
            }),
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });
  const titleKey =
    mode === "report"
      ? "lmsStaffPublishReport"
      : mode === "award"
        ? "lmsStaffAward"
        : mode === "reopen"
          ? "lmsStaffRestoreCourse"
          : "lmsStaffCompleteCourse";
  return (
    <StaffDialog
      open
      onClose={onClose}
      titleKey={titleKey}
      description={student.studentName}
      dirty={Boolean(title || comment || nextSteps || bestProjectIds.length)}
      pending={action.isPending}
    >
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          setValidation("");
          if (mode === "report" && staffDateIso(from) >= staffDateIso(to)) {
            setValidation(t("portalInvalidData"));
            return;
          }
          if (mode === "complete" || mode === "reopen") setConfirm(true);
          else action.mutate();
        }}
      >
        {mode === "report" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <StaffField id="report-from" labelKey="lmsStaffPeriodFrom">
              <DateTimeInput
                id="report-from"
                value={from}
                onValueChange={(value) => setFrom(value)}
                required
              />
            </StaffField>
            <StaffField id="report-to" labelKey="lmsStaffPeriodTo">
              <DateTimeInput
                id="report-to"
                value={to}
                onValueChange={(value) => setTo(value)}
                required
              />
            </StaffField>
          </div>
        )}
        {mode === "report" && projects.data && projects.data.length > 0 && (
          <fieldset className="space-y-3">
            <legend className="font-medium">{t("portalBestProjects")}</legend>
            {projects.data.map((project) => (
              <label
                key={project.id}
                className="flex min-h-11 items-center gap-3 rounded-md border p-3"
              >
                <input
                  type="checkbox"
                  checked={bestProjectIds.includes(project.id)}
                  disabled={
                    !bestProjectIds.includes(project.id) &&
                    bestProjectIds.length >= 6
                  }
                  onChange={(event) =>
                    setBestProjectIds((ids) =>
                      event.target.checked
                        ? [...ids, project.id]
                        : ids.filter((id) => id !== project.id),
                    )
                  }
                />
                <span className="min-w-0 break-words">{project.title}</span>
              </label>
            ))}
          </fieldset>
        )}
        {mode === "report" && projects.error && (
          <StaffError
            error={projects.error}
            retry={() => {
              void projects.refetch();
            }}
          />
        )}
        {mode === "award" && (
          <StaffField id="award-title" labelKey="lmsStaffTitleField">
            <Input
              id="award-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </StaffField>
        )}
        <StaffField
          id="result-comment"
          labelKey={mode === "report" ? "lmsStaffComment" : "lmsStaffReason"}
        >
          <Textarea
            id="result-comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            required
            rows={5}
          />
        </StaffField>
        {mode === "report" && (
          <StaffField id="report-next" labelKey="lmsStaffNextSteps">
            <Textarea
              id="report-next"
              value={nextSteps}
              onChange={(event) => setNextSteps(event.target.value)}
              required
              rows={4}
            />
          </StaffField>
        )}
        {(validation || action.error) && (
          <p role="alert" className="text-sm text-destructive">
            {validation || message(action.error)}
          </p>
        )}
        <div className="flex justify-end">
          <Button disabled={action.isPending}>
            {t(
              mode === "complete" || mode === "reopen"
                ? mode === "reopen"
                  ? "lmsStaffRestoreCourse"
                  : "lmsStaffCompleteCourse"
                : "lmsStaffPublish",
            )}
          </Button>
        </div>
      </form>
      <StaffConfirm
        open={confirm}
        onOpenChange={setConfirm}
        titleKey={
          mode === "reopen"
            ? "lmsStaffRestoreCourseTitle"
            : "lmsStaffCompleteTitle"
        }
        description={
          mode === "reopen"
            ? "lmsStaffRestoreCourseBody"
            : "lmsStaffCompleteBody"
        }
        action={
          mode === "reopen" ? "lmsStaffRestoreCourse" : "lmsStaffCompleteCourse"
        }
        pending={action.isPending}
        error={action.error}
        onConfirm={() => action.mutate()}
      >
        <p className="font-medium">{student.studentName}</p>
      </StaffConfirm>
    </StaffDialog>
  );
}
