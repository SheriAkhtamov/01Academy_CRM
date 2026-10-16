import { useEffect, useState } from "react";
import { usePortalLocation as useLocation } from "../portal-app/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { LmsScheduleDto } from "@shared/contracts/lms";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { portalLmsApi } from "../portal-app/api";
import {
  PortalFormScope,
  usePortalFormScope,
  usePortal,
  useSubjectQuery,
} from "../portal-app/context";
import {
  PortalDialogContent as DialogContent,
  PortalTitle,
  PortalLoading,
  PortalError,
  isPortalAccessError,
  PortalEmpty,
  PortalStatus,
  usePortalFormat,
  safeHttps,
} from "../portal-app/ui";
import { HelpDialog } from "./communication";
import { AssignmentDialog } from "./assignments";
import { usePortalViewState } from "../portal-app/view-state";
import {
  PortalActionRow,
  PortalSelect,
  PortalToolbar,
} from "../portal-app/controls";

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
  const lessonScope = usePortalFormScope();
  const { t } = useTranslation();
  const format = usePortalFormat();
  const { subject, allowed, guarded } = usePortal();
  const [, navigate] = useLocation();
  const [view, setView] = usePortalViewState("schedule", {
    offset: "0",
    course: "",
    courseName: "",
  });
  const offset = /^-?\d{1,4}$/.test(view.offset) ? Number(view.offset) : 0;
  const course = view.course;
  const setOffset = (value: number) =>
    setView((previous) => ({ ...previous, offset: String(value) }));
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
  const courseNames = new Map(
    (query.data ?? []).map((item) => [String(item.runId), item.courseName]),
  );
  const selectedCourseName = courseNames.get(course) || view.courseName;
  const unresolvedCourse = Boolean(course && !selectedCourseName);
  if (course && selectedCourseName && !courseNames.has(course)) {
    courseNames.set(course, selectedCourseName);
  }
  useEffect(() => {
    if (course && !selectedCourseName && query.isSuccess) {
      setView((previous) =>
        previous.course === course
          ? { ...previous, course: "", courseName: "" }
          : previous,
      );
      return;
    }
    if (
      !course ||
      !selectedCourseName ||
      view.courseName === selectedCourseName
    )
      return;
    setView((previous) =>
      previous.course === course
        ? { ...previous, courseName: selectedCourseName }
        : previous,
    );
  }, [course, selectedCourseName, view.courseName, query.isSuccess, setView]);
  const setCourse = (value: string) =>
    setView((previous) => ({
      ...previous,
      course: value,
      courseName: courseNames.get(value) ?? "",
    }));
  const items = (query.data ?? []).filter(
    (item) => !course || item.runId === Number(course),
  );
  if (isPortalAccessError(query.error))
    return (
      <PortalError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  return (
    <>
      <PortalTitle labelKey="portalSchedule" />
      <PortalToolbar className="items-center">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label={t("portalPreviousWeek")}
            onClick={() => setOffset(offset - 1)}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <Button variant="outline" onClick={() => setOffset(0)}>
            {t("portalTodayDate")}
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={t("portalNextWeek")}
            onClick={() => setOffset(offset + 1)}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <span className="text-sm font-medium">
          {format.date(range.from)} – {format.date(range.days[6])}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("portalTashkent")}
        </span>
        <PortalSelect
          className="w-full sm:ml-auto sm:w-56"
          aria-label={t("portalCourses")}
          value={unresolvedCourse ? "" : course}
          disabled={unresolvedCourse}
          onValueChange={setCourse}
          options={[
            { value: "", label: t("portalAllCourses") },
            ...Array.from(courseNames, ([id, name]) => ({
              value: id,
              label: name,
            })),
          ]}
        />
      </PortalToolbar>
      {query.isPending ? (
        <PortalLoading variant="section" />
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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-7">
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
                      <PortalActionRow
                        className="flex-col items-start justify-start gap-2 rounded-xl border-0 p-4"
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
                      </PortalActionRow>
                    </CardContent>
                  </Card>
                ))}
            </section>
          ))}
        </div>
      )}
      <PortalFormScope id={lessonScope.id}>
        <Dialog
          open={Boolean(selected)}
          onOpenChange={(open) => {
            if (!open)
              lessonScope.guarded(() => {
                setSelected(null);
                setHelp(false);
                setAssignmentId(null);
              });
          }}
        >
          <DialogContent className="portal-ui">
            <DialogHeader>
              <DialogTitle>
                {selected?.topic ||
                  selected?.courseName ||
                  t("portalLessonDetails")}
              </DialogTitle>
              <DialogDescription>{selected?.courseName}</DialogDescription>
            </DialogHeader>
            {selected && (
              <div className="space-y-4">
                <p>
                  {format.date(selected.scheduledAt)} ·{" "}
                  {format.time(selected.scheduledAt)}–
                  {format.time(selected.endsAt)} · {t("portalTashkent")}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <PortalStatus status={selected.status} />
                  {allowed("attendance.read") && (
                    <PortalStatus status={selected.attendance} />
                  )}
                </div>
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
                {allowed("learning.read") &&
                  Boolean(selected.materials?.length) && (
                    <section className="space-y-2">
                      <h2 className="font-semibold">{t("portalMaterial")}</h2>
                      {selected.materials?.map((material) =>
                        subject?.kind === "self" ? (
                          <PortalActionRow
                            key={material.publicationId}
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
                          </PortalActionRow>
                        ) : (
                          <p
                            key={material.publicationId}
                            className="rounded-lg border border-border/70 px-4 py-3 text-sm"
                          >
                            {material.title}
                          </p>
                        ),
                      )}
                    </section>
                  )}
                {allowed("learning.read") &&
                  Boolean(selected.assignments?.length) && (
                    <section className="space-y-2">
                      <h2 className="font-semibold">{t("portalAssignments")}</h2>
                      {selected.assignments?.map((assignment) => (
                        <PortalActionRow
                          key={assignment.recipientId}
                          onClick={() => setAssignmentId(assignment.recipientId)}
                        >
                          {assignment.title}
                          <PortalStatus status={assignment.status} />
                        </PortalActionRow>
                      ))}
                    </section>
                  )}
                <DialogFooter className="flex-wrap border-t border-border/70 pt-4">
                  {selected.meetingUrl &&
                    safeHttps(selected.meetingUrl) &&
                    selected.status !== "cancelled" && (
                      <Button asChild>
                        <a
                          href={selected.meetingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {t("portalJoin")}
                        </a>
                      </Button>
                    )}
                  {allowed("learning.read", true) && (
                    <Button
                      variant="outline"
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
                    <Button variant="outline" onClick={() => setHelp(true)}>
                      {t("portalNeedHelp")}
                    </Button>
                  )}
                </DialogFooter>
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
      </PortalFormScope>
    </>
  );
}
