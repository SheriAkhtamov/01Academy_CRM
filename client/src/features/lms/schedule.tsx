import { useState } from "react";
import { useLocation } from "wouter";
import type { LmsScheduleDto } from "@shared/contracts/lms";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { portalLmsApi } from "../portal-app/api";
import { usePortal, useSubjectQuery } from "../portal-app/context";
import {
  PortalDialogContent as DialogContent,
  PortalTitle,
  PortalLoading,
  PortalError,
  PortalEmpty,
  PortalStatus,
  usePortalFormat,
  safeHttps,
} from "../portal-app/ui";
import { HelpDialog } from "./communication";
import { AssignmentDialog } from "./assignments";
import { usePortalViewState } from "../portal-app/view-state";

export function portalWeekRange(offset: number) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (key: string) => parts.find((item) => item.type === key)?.value;
  const day = new Date(
    `${part("year")}-${part("month")}-${part("day")}T00:00:00+05:00`,
  );
  const localWeekDay =
    (new Date(day.getTime() + 5 * 3600000).getUTCDay() + 6) % 7;
  day.setTime(day.getTime() + (offset * 7 - localWeekDay) * 86400000);
  return {
    from: day.toISOString(),
    to: new Date(day.getTime() + 7 * 86400000).toISOString(),
    days: Array.from({ length: 7 }, (_, index) =>
      new Date(day.getTime() + index * 86400000).toISOString(),
    ),
  };
}
export function PortalSchedule() {
  const { t } = useTranslation();
  const format = usePortalFormat();
  const { allowed, guarded } = usePortal();
  const [, navigate] = useLocation();
  const [view, setView] = usePortalViewState("schedule", {
    offset: "0",
    course: "",
  });
  const offset = /^-?\d{1,4}$/.test(view.offset) ? Number(view.offset) : 0;
  const course = view.course;
  const setOffset = (value: number) =>
    setView((previous) => ({ ...previous, offset: String(value) }));
  const setCourse = (value: string) =>
    setView((previous) => ({ ...previous, course: value }));
  const [selected, setSelected] = useState<LmsScheduleDto | null>(null);
  const [help, setHelp] = useState(false);
  const [assignmentId, setAssignmentId] = useState<number | null>(null);
  const range = portalWeekRange(offset);
  const query = useSubjectQuery(
    "schedule",
    (link, signal) => portalLmsApi.schedule(link, range.from, range.to, signal),
    [range.from, range.to],
    allowed("learning.read") ? "learning.read" : "attendance.read",
  );
  const courses = [
    ...new Map(
      (query.data ?? []).map((item) => [item.runId, item.courseName]),
    ).entries(),
  ];
  const items = (query.data ?? []).filter(
    (item) => !course || item.runId === Number(course),
  );
  return (
    <>
      <PortalTitle labelKey="portalSchedule" />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="min-h-11 min-w-11"
          aria-label={t("portalPreviousWeek")}
          onClick={() => setOffset(offset - 1)}
        >
          ←
        </Button>
        <Button
          variant="outline"
          className="min-h-11"
          onClick={() => setOffset(0)}
        >
          {t("portalTodayDate")}
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="min-h-11 min-w-11"
          aria-label={t("portalNextWeek")}
          onClick={() => setOffset(offset + 1)}
        >
          →
        </Button>
        <span className="text-sm">
          {format.date(range.from)} – {format.date(range.days[6])}
        </span>
        <select
          className="min-h-11 rounded-md border bg-background px-3"
          aria-label={t("portalCourses")}
          value={course}
          onChange={(event) => setCourse(event.target.value)}
        >
          <option value="">{t("portalAllCourses")}</option>
          {courses.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <p className="text-sm text-muted-foreground">{t("portalTashkent")}</p>
      {query.isPending ? (
        <PortalLoading />
      ) : query.error ? (
        <PortalError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      ) : items.length === 0 ? (
        <PortalEmpty labelKey="portalNoLessons" />
      ) : (
        <div className="grid gap-3 lg:grid-cols-7">
          {range.days.map((day) => (
            <section key={day} className="min-w-0 space-y-3">
              <h2 className="text-sm font-semibold">{format.date(day)}</h2>
              {items
                .filter(
                  (item) => format.date(item.scheduledAt) === format.date(day),
                )
                .map((item) => (
                  <Card key={item.lessonId}>
                    <CardContent className="p-0">
                      <Button
                        variant="ghost"
                        className="h-auto min-h-20 w-full flex-col items-start justify-start gap-2 whitespace-normal p-3 text-left"
                        onClick={() => setSelected(item)}
                      >
                        <span className="text-sm font-semibold">
                          {format.time(item.scheduledAt)}–
                          {format.time(item.endsAt)}
                        </span>
                        <span className="break-words font-medium">
                          {item.topic || item.courseName}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {item.courseName}
                        </span>
                        <PortalStatus status={item.status} />
                        {allowed("attendance.read") && (
                          <PortalStatus status={item.attendance} />
                        )}
                      </Button>
                    </CardContent>
                  </Card>
                ))}
            </section>
          ))}
        </div>
      )}
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open)
            guarded(() => {
              setSelected(null);
              setHelp(false);
              setAssignmentId(null);
            });
        }}
      >
        <DialogContent className="portal-ui">
          <DialogTitle>
            {selected?.topic ||
              selected?.courseName ||
              t("portalLessonDetails")}
          </DialogTitle>
          <DialogDescription>{selected?.courseName}</DialogDescription>
          {selected && (
            <div className="space-y-4">
              <p>
                {format.date(selected.scheduledAt)} ·{" "}
                {format.time(selected.scheduledAt)}–
                {format.time(selected.endsAt)} · {t("portalTashkent")}
              </p>
              <PortalStatus status={selected.status} />
              {allowed("attendance.read") && (
                <PortalStatus status={selected.attendance} />
              )}
              {selected.rescheduled && (
                <p className="text-sm text-muted-foreground">
                  {t("portalRescheduled")}
                  {selected.previousScheduledAt &&
                    ` · ${format.date(selected.previousScheduledAt)} · ${format.time(selected.previousScheduledAt)}`}
                </p>
              )}
              {selected.teacherName && (
                <p>
                  {t("portalTeacher")}: {selected.teacherName}
                </p>
              )}
              {selected.roomName && (
                <p>
                  {t("portalRoom")}: {selected.schoolName} · {selected.roomName}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {selected.meetingUrl &&
                  safeHttps(selected.meetingUrl) &&
                  selected.status !== "cancelled" && (
                    <Button asChild className="min-h-11">
                      <a
                        href={selected.meetingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t("portalJoin")}
                      </a>
                    </Button>
                  )}
                {allowed("learning.read") && (
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={() =>
                      guarded(() => {
                        setSelected(null);
                        navigate(`/learn/courses/${selected.runId}`);
                      })
                    }
                  >
                    {t("portalMaterial")}
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
              </div>
              {allowed("learning.read") &&
                Boolean(selected.materials?.length) && (
                  <section className="space-y-2">
                    <h2 className="font-semibold">{t("portalMaterial")}</h2>
                    {selected.materials?.map((material) => (
                      <Button
                        key={material.publicationId}
                        variant="outline"
                        className="min-h-11 w-full justify-start whitespace-normal text-left"
                        onClick={() =>
                          guarded(() => {
                            setSelected(null);
                            navigate(
                              `/learn/courses/${selected.runId}/materials/${material.publicationId}`,
                            );
                          })
                        }
                      >
                        {material.title}
                      </Button>
                    ))}
                  </section>
                )}
              {allowed("learning.read") &&
                Boolean(selected.assignments?.length) && (
                  <section className="space-y-2">
                    <h2 className="font-semibold">{t("portalAssignments")}</h2>
                    {selected.assignments?.map((assignment) => (
                      <Button
                        key={assignment.recipientId}
                        variant="outline"
                        className="min-h-11 w-full justify-between gap-3 whitespace-normal text-left"
                        onClick={() => setAssignmentId(assignment.recipientId)}
                      >
                        {assignment.title}
                        <PortalStatus status={assignment.status} />
                      </Button>
                    ))}
                  </section>
                )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      {selected && (
        <HelpDialog
          open={help}
          onClose={() => setHelp(false)}
          runId={selected.runId}
          unitId={selected.unitId ?? undefined}
        />
      )}
      <AssignmentDialog
        id={assignmentId}
        onClose={() => setAssignmentId(null)}
      />
    </>
  );
}
