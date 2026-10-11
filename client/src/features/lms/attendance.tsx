import { useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { portalLmsApi } from "../portal-app/api";
import { useSubjectQuery } from "../portal-app/context";
import {
  PortalTitle,
  PortalLoading,
  PortalError,
  PortalEmpty,
  PortalStatus,
  usePortalFormat,
} from "../portal-app/ui";
import { ProgressMetric } from "./overview";
import { PortalMakeup } from "./makeup";

export function portalMonthRange(month: string) {
  const [year, number] = month.split("-").map(Number);
  const from = new Date(Date.UTC(year, number - 1, 1) - 5 * 3600000);
  const to = new Date(Date.UTC(year, number, 1) - 5 * 3600000);
  return { from: from.toISOString(), to: to.toISOString() };
}
function currentMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((item) => item.type === "year")?.value}-${parts.find((item) => item.type === "month")?.value}`;
}
export function PortalAttendance() {
  const { t } = useTranslation();
  const format = usePortalFormat();
  const [month, setMonth] = useState(currentMonth);
  const [course, setCourse] = useState("");
  const [status, setStatus] = useState("");
  const range = portalMonthRange(month);
  const query = useSubjectQuery(
    "attendance-month",
    (link, signal) => portalLmsApi.schedule(link, range.from, range.to, signal),
    [range.from, range.to],
    "attendance.read",
  );
  const conducted = (query.data ?? []).filter(
    (item) =>
      item.status === "conducted" && (!course || item.runId === Number(course)),
  );
  const present = conducted.filter(
    (item) => item.attendance === "present",
  ).length;
  const absent = conducted.filter(
    (item) => item.attendance === "absent",
  ).length;
  const unmarked = conducted.filter((item) => item.attendance === null).length;
  const total = present + absent;
  const courses = [
    ...new Map(
      (query.data ?? []).map((item) => [item.runId, item.courseName]),
    ).entries(),
  ];
  const items = conducted.filter(
    (item) =>
      !status ||
      (status === "unmarked"
        ? item.attendance === null
        : item.attendance === status),
  );
  return (
    <>
      <PortalTitle labelKey="portalAttendance" />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="attendance-month">{t("portalMonth")}</Label>
          <Input
            id="attendance-month"
            type="month"
            className="min-h-11"
            value={month}
            onChange={(event) => {
              if (/^\d{4}-\d{2}$/.test(event.target.value))
                setMonth(event.target.value);
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="attendance-course">{t("portalCourses")}</Label>
          <select
            id="attendance-course"
            className="min-h-11 w-full rounded-md border bg-background px-3"
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
        <div className="space-y-2">
          <Label htmlFor="attendance-status">{t("portalAttendance")}</Label>
          <select
            id="attendance-status"
            className="min-h-11 w-full rounded-md border bg-background px-3"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">{t("portalAllAttendance")}</option>
            <option value="present">{t("portalPresent")}</option>
            <option value="absent">{t("portalAbsent")}</option>
            <option value="unmarked">{t("portalUnmarked")}</option>
          </select>
        </div>
      </div>
      {query.isPending ? (
        <PortalLoading />
      ) : query.error ? (
        <PortalError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ProgressMetric
              labelKey="portalAttendance"
              emptyKey="portalNoLessons"
              metric={{
                completed: present,
                total,
                percent: total ? (present / total) * 100 : null,
              }}
            />
            {(
              [
                ["portalPresent", present],
                ["portalAbsent", absent],
                ["portalUnmarked", unmarked],
              ] as const
            ).map(([label, count]) => (
              <Card key={label}>
                <CardHeader>
                  <CardTitle className="text-base">{t(label)}</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold">
                  {count}
                </CardContent>
              </Card>
            ))}
          </div>
          {items.length === 0 ? (
            <PortalEmpty labelKey="portalNoLessons" />
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <Card key={`${item.runId}:${item.lessonId}`}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div>
                      <h2 className="font-semibold">
                        {item.topic || item.courseName}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {item.courseName} · {format.date(item.scheduledAt)} ·{" "}
                        {format.time(item.scheduledAt)}
                      </p>
                    </div>
                    <PortalStatus status={item.attendance} />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
      <PortalMakeup embedded courseId={course ? Number(course) : undefined} />
    </>
  );
}
