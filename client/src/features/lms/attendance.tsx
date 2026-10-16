import { useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ux/DataTable";
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
import { PortalSelect, PortalToolbar } from "../portal-app/controls";

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
  const [courseChoice, setCourseChoice] = useState({ value: "", label: "" });
  const course = courseChoice.value;
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
  const courseNames = new Map(
    (query.data ?? []).map((item) => [String(item.runId), item.courseName]),
  );
  if (course && courseChoice.label && !courseNames.has(course)) {
    courseNames.set(course, courseChoice.label);
  }
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
      <PortalToolbar>
        <div className="w-full space-y-2 sm:w-48">
          <Label htmlFor="attendance-month">{t("portalMonth")}</Label>
          <Input
            id="attendance-month"
            type="month"
            value={month}
            onChange={(event) => {
              if (/^\d{4}-\d{2}$/.test(event.target.value))
                setMonth(event.target.value);
            }}
          />
        </div>
        <div className="w-full space-y-2 sm:min-w-48 sm:flex-1">
          <Label htmlFor="attendance-course">{t("portalCourses")}</Label>
          <PortalSelect
            id="attendance-course"
            value={course}
            onValueChange={(value) =>
              setCourseChoice({ value, label: courseNames.get(value) ?? "" })
            }
            options={[
              { value: "", label: t("portalAllCourses") },
              ...Array.from(courseNames, ([id, name]) => ({
                value: id,
                label: name,
              })),
            ]}
          />
        </div>
        <div className="w-full space-y-2 sm:w-56">
          <Label htmlFor="attendance-status">{t("portalAttendance")}</Label>
          <PortalSelect
            id="attendance-status"
            value={status}
            onValueChange={setStatus}
            options={[
              { value: "", label: t("portalAllAttendance") },
              { value: "present", label: t("portalPresent") },
              { value: "absent", label: t("portalAbsent") },
              { value: "unmarked", label: t("portalUnmarked") },
            ]}
          />
        </div>
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
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                <CardContent className="space-y-1 p-4">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t(label)}
                  </p>
                  <p className="text-xl font-bold tabular-nums tracking-tight">
                    {count}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
          <DataTable
            focusOnRowClick
            data={items}
            keyExtractor={(item) => `${item.runId}:${item.lessonId}`}
            rootClassName="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm"
            filterKey={`${month}:${course}:${status}`}
            emptyState={<PortalEmpty embedded labelKey="portalNoLessons" />}
            columns={[
              {
                key: "topic",
                header: t("portalLessons"),
                mobilePrimary: true,
                render: (item) => (
                  <span className="font-medium">
                    {item.topic || item.courseName}
                  </span>
                ),
              },
              { key: "courseName", header: t("portalCourses") },
              {
                key: "scheduledAt",
                header: t("portalDate"),
                render: (item) => (
                  <span>
                    {format.date(item.scheduledAt)} ·{" "}
                    {format.time(item.scheduledAt)}
                  </span>
                ),
              },
              {
                key: "attendance",
                header: t("portalAttendance"),
                render: (item) => <PortalStatus status={item.attendance} />,
              },
            ]}
          />
        </>
      )}
      <PortalMakeup embedded courseId={course ? Number(course) : undefined} />
    </>
  );
}
