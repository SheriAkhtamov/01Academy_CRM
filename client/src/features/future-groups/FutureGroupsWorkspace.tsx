import { parseGroupName } from "@shared/academy-group-code";
import { flattenCourseCurriculum } from "@shared/contracts/course-curriculum";
import {
  getMinimumGroupEndDate,
  normalizeWeeklySchedule,
} from "@shared/scheduling";
import {
  enrollmentGroupsKey,
  groupConfigurationKey,
} from "@/features/groups/queries";
import { GroupEditorDialog } from "@/features/groups/GroupEditorDialog";
import { GroupSeatMeter } from "@/features/groups/GroupSeatMeter";
import {
  summarizeSchedule,
  type GroupSeats,
} from "@/features/groups/presentation";
import { normalizeSchedule } from "@/features/groups/schedule";
import type { Group, GroupConfiguration } from "@/features/groups/types";
import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CalendarDays,
  CreditCard,
  Pencil,
  Play,
  Plus,
  Sparkles,
  UserCheck,
  UsersRound,
  UserX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingRegion } from "@/components/ui/loading-region";
import { DataTable, type DataTableColumn } from "@/components/ux/DataTable";
import { EmployeeIdentity } from "@/components/ux/EmployeeIdentity";
import { PageHeader } from "@/components/ux/PageHeader";
import { EmptyState } from "@/components/ux/EmptyState";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useTranslation } from "@/hooks/useTranslation";
import { academyDateInputValue } from "@/lib/localeFormat";
import { cn } from "@/lib/utils";
import type { FutureGroup } from "@shared/contracts/future-groups";
import { futureGroupsApi, futureGroupsKey } from "./api";
import { FutureGroupDialog } from "./FutureGroupDialog";

function buildSeats(group: FutureGroup): GroupSeats {
  const current = Math.max(0, Number(group.currentStudents || 0));
  const reserved = Math.max(0, Number(group.reservedStudents || 0));
  const occupied = current + reserved;
  const max = Math.max(0, Number(group.maxStudents || 0));
  const free = Math.max(0, max - occupied);
  const tone =
    free === 0 ? "full" : free <= 2 && max > 2 ? "few" : "available";
  return {
    current,
    reserved,
    occupied,
    max,
    free,
    sellable: true,
    tone,
  };
}

export function FutureGroupsWorkspace() {
  const { t, language } = useTranslation();
  const client = useQueryClient();
  const [editing, setEditing] = useState<{ group: FutureGroup | null } | null>(
    null,
  );
  const [preparing, setPreparing] = useState<FutureGroup | null>(null);
  const [archiving, setArchiving] = useState<FutureGroup | null>(null);
  const [error, setError] = useState("");
  const configuration = useQuery<GroupConfiguration>({
    queryKey: groupConfigurationKey,
  });
  const groups = useQuery({
    queryKey: futureGroupsKey,
    queryFn: futureGroupsApi.list,
  });
  const listedGroups = useMemo(() => groups.data ?? [], [groups.data]);
  const archive = useMutation({
    mutationFn: (id: number) => futureGroupsApi.archive(id),
    onSuccess: async () => {
      setArchiving(null);
      await Promise.all([
        client.invalidateQueries({ queryKey: futureGroupsKey }),
        client.invalidateQueries({ queryKey: enrollmentGroupsKey }),
      ]);
    },
    onError: (e: Error & { rawMessage?: string }) => {
      const code = e.rawMessage ?? e.message;
      setError(
        code.includes("futureGroupHasMembers") ||
          e.message === t("futureGroupHasMembers")
          ? t("futureGroupHasMembers")
          : code.includes("futureGroupUnavailable") ||
              e.message === t("futureGroupUnavailable")
            ? t("futureGroupUnavailable")
            : t("futureGroupSaveFailed"),
      );
    },
  });

  const formatDate = useCallback(
    (value: string | null) =>
      value
        ? new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-US", {
            day: "numeric",
            month: "short",
            timeZone: "UTC",
          }).format(new Date(`${value}T00:00:00Z`))
        : t("futureGroupUndecided"),
    [language, t],
  );

  const money = useCallback(
    (amount: number) =>
      new Intl.NumberFormat(language === "ru" ? "ru-RU" : "en-US").format(
        amount,
      ),
    [language],
  );

  const shortDayNames = useMemo(
    () => [
      t("mondayShort"),
      t("tuesdayShort"),
      t("wednesdayShort"),
      t("thursdayShort"),
      t("fridayShort"),
      t("saturdayShort"),
      t("sundayShort"),
    ],
    [t],
  );

  const teacherUserMap = useMemo(() => {
    const map = new Map<number, number | undefined>();
    for (const teacher of configuration.data?.teachers ?? []) {
      map.set(teacher.id, teacher.userId ?? undefined);
    }
    return map;
  }, [configuration.data?.teachers]);

  const totals = useMemo(() => {
    let occupied = 0;
    let capacity = 0;
    let free = 0;
    let paidMembers = 0;
    let paidAmountUzs = 0;
    for (const g of listedGroups) {
      const groupOccupied = g.currentStudents + g.reservedStudents;
      occupied += groupOccupied;
      capacity += g.maxStudents;
      free += Math.max(0, g.maxStudents - groupOccupied);
      paidMembers += g.paidMembers;
      paidAmountUzs += g.paidAmountUzs;
    }
    return { occupied, capacity, free, paidMembers, paidAmountUzs };
  }, [listedGroups]);

  const loading = groups.isPending || configuration.isPending;
  const failed = groups.isError || configuration.isError;

  const prepared = useMemo<Group | null>(() => {
    if (!preparing) return null;
    const course = configuration.data?.courses.find(
      (c) => c.id === preparing.courseId,
    );
    const curriculumIds = flattenCourseCurriculum(course?.program).map(
      (lesson) => lesson.id,
    );
    const lessonCount =
      curriculumIds.length > 0
        ? curriculumIds.length
        : Number(course?.lessonCount) > 0
          ? Number(course?.lessonCount)
          : 10;
    const durationMinutes =
      preparing.lessonDurationMinutes ||
      Number(course?.lessonDurationMinutes) ||
      120;
    const normalizedSchedule = normalizeSchedule(
      preparing.schedule,
      durationMinutes,
    );
    const startDate = academyDateInputValue(preparing.startDate);
    const autoEndDate =
      startDate && normalizedSchedule.length > 0
        ? getMinimumGroupEndDate({
            startDate,
            lessonCount,
            schedule: normalizedSchedule,
          })
        : null;
    return {
      ...preparing,
      roomId: preparing.roomId ?? null,
      roomName: preparing.roomName ?? undefined,
      lessonCount,
      lessonDurationMinutes: durationMinutes,
      selectedCourseLessonIds:
        curriculumIds.length > 0 ? curriculumIds : null,
      durationDays: 0,
      status: "in_progress",
      endDate: autoEndDate || null,
    };
  }, [configuration.data?.courses, preparing]);

  const columns = useMemo<DataTableColumn<FutureGroup>[]>(
    () => [
      {
        key: "name",
        header: t("group"),
        sortable: true,
        mobilePrimary: true,
        accessor: (row) => row.name,
        render: (row) => {
          const parsed = parseGroupName(row.name);
          const teacherUserId = row.teacherId
            ? teacherUserMap.get(row.teacherId)
            : undefined;
          return (
            <div className="min-w-0 max-w-80 space-y-1">
              <p className="break-words font-semibold text-foreground">
                {row.name}
              </p>
              {parsed?.code && parsed.addition ? (
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {parsed.code}
                </p>
              ) : null}
              {row.teacherName ? (
                <EmployeeIdentity
                  userId={teacherUserId}
                  name={row.teacherName}
                  className="text-xs text-muted-foreground"
                  avatarClassName="size-5"
                />
              ) : (
                <p className="flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                  <UserX className="size-3.5 shrink-0" aria-hidden="true" />
                  {t("futureGroupUndecided")}
                </p>
              )}
            </div>
          );
        },
      },
      {
        key: "courseAndSchool",
        header: t("courseAndSchool"),
        sortable: true,
        accessor: (row) => `${row.courseName} ${row.schoolName ?? ""}`,
        render: (row) => (
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium text-foreground">{row.courseName}</p>
            <p className="text-xs text-muted-foreground">
              {[
                row.deliveryMode === "online" ? t("online") : "",
                row.schoolName,
                row.roomName,
              ]
                .filter(Boolean)
                .join(" · ") || t("futureGroupUndecided")}
            </p>
          </div>
        ),
      },
      {
        key: "schedule",
        header: t("schedule"),
        sortable: true,
        accessor: (row) => row.startDate ?? "9999-99-99",
        render: (row) => {
          const slots = normalizeWeeklySchedule(
            row.schedule,
            row.lessonDurationMinutes,
          );
          const lines = summarizeSchedule(slots, shortDayNames);
          return (
            <div className="min-w-36 space-y-1">
              <p className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-foreground">
                <CalendarDays
                  className="size-3.5 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <span>{formatDate(row.startDate)}</span>
              </p>
              {lines.length > 0 ? (
                <ul className="space-y-0.5 text-xs">
                  {lines.slice(0, 2).map((line) => (
                    <li
                      key={`${line.days}-${line.time}`}
                      className="whitespace-nowrap"
                    >
                      <span className="font-medium text-foreground">
                        {line.days}
                      </span>{" "}
                      <span className="tabular-nums text-muted-foreground">
                        {line.time}
                      </span>
                    </li>
                  ))}
                  {lines.length > 2 ? (
                    <li className="text-muted-foreground">
                      +{lines.length - 2}
                    </li>
                  ) : null}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t("futureGroupUndecided")}
                </p>
              )}
            </div>
          );
        },
      },
      {
        key: "capacity",
        header: t("groupCapacity"),
        sortable: true,
        accessor: (row) => row.currentStudents + row.reservedStudents,
        render: (row) => {
          const seats = buildSeats(row);
          return (
            <div className="flex min-w-36 max-w-48 flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="font-semibold tabular-nums text-foreground">
                  {seats.occupied} / {seats.max}
                </span>
                <span
                  className={cn(
                    "font-medium tabular-nums",
                    seats.tone === "full"
                      ? "text-rose-700 dark:text-rose-300"
                      : seats.tone === "few"
                        ? "text-amber-700 dark:text-amber-300"
                        : "text-emerald-700 dark:text-emerald-300",
                  )}
                >
                  {seats.free > 0
                    ? `${t("futureGroupFree")}: ${seats.free}`
                    : t("groupsSeatsFullShort")}
                </span>
              </div>
              <GroupSeatMeter seats={seats} />
            </div>
          );
        },
      },
      {
        key: "paid",
        header: t("futureGroupPaid"),
        sortable: true,
        accessor: (row) => row.paidAmountUzs,
        render: (row) => {
          const occupied = row.currentStudents + row.reservedStudents;
          const hasPaid = row.paidMembers > 0 || row.paidAmountUzs > 0;
          return (
            <div className="min-w-28 space-y-0.5 tabular-nums">
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold",
                    hasPaid
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "border-border/70 bg-muted/40 text-muted-foreground",
                  )}
                >
                  {row.paidMembers}
                  {occupied > 0 ? ` / ${occupied}` : ""}
                </span>
              </div>
              {row.paidAmountUzs > 0 ? (
                <p className="text-xs font-medium text-muted-foreground">
                  {money(row.paidAmountUzs)} {t("currencyUzs")}
                </p>
              ) : null}
            </div>
          );
        },
      },
      {
        key: "actions",
        header: t("actions"),
        render: (row) => (
          <div className="flex flex-wrap justify-end gap-1.5">
            <Button size="sm" onClick={() => setPreparing(row)}>
              <Play data-icon="inline-start" aria-hidden="true" />
              {t("futureGroupLaunch")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing({ group: row })}
            >
              <Pencil data-icon="inline-start" aria-hidden="true" />
              {t("edit")}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label={t("archiveGroup")}
              disabled={archive.isPending}
              onClick={() => {
                setError("");
                setArchiving(row);
              }}
            >
              <Archive aria-hidden="true" />
            </Button>
          </div>
        ),
      },
    ],
    [archive.isPending, formatDate, money, shortDayNames, t, teacherUserMap],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageHeader
        title={t("futureGroupsTitle")}
        actions={
          <Button
            onClick={() => setEditing({ group: null })}
            disabled={loading || failed}
          >
            <Plus data-icon="inline-start" />
            {t("futureGroupCreate")}
          </Button>
        }
      />
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive"
        >
          {error}
        </p>
      )}
      {!loading && !failed && listedGroups.length > 0 ? (
        <ul
          aria-label={t("futureGroupsTitle")}
          className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4"
        >
          <li className="flex items-center gap-3 rounded-xl border bg-card px-3.5 py-2.5 shadow-2xs">
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
              aria-hidden="true"
            >
              <Sparkles className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">
                {t("futureGroupsTitle")}
              </p>
              <p className="text-base font-bold tabular-nums text-foreground">
                {listedGroups.length}
              </p>
            </div>
          </li>
          <li className="flex items-center gap-3 rounded-xl border bg-card px-3.5 py-2.5 shadow-2xs">
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-700 dark:text-sky-300"
              aria-hidden="true"
            >
              <UsersRound className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">
                {t("futureGroupOccupied")}
              </p>
              <p className="text-base font-bold tabular-nums text-foreground">
                {totals.occupied}{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  / {totals.capacity}
                </span>
              </p>
            </div>
          </li>
          <li className="flex items-center gap-3 rounded-xl border bg-card px-3.5 py-2.5 shadow-2xs">
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300"
              aria-hidden="true"
            >
              <UserCheck className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">
                {t("futureGroupFree")}
              </p>
              <p className="text-base font-bold tabular-nums text-foreground">
                {totals.free}
              </p>
            </div>
          </li>
          <li className="flex items-center gap-3 rounded-xl border bg-card px-3.5 py-2.5 shadow-2xs">
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              aria-hidden="true"
            >
              <CreditCard className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">
                {t("futureGroupPaid")}
              </p>
              <p className="truncate text-base font-bold tabular-nums text-foreground">
                {totals.paidMembers}
                {totals.paidAmountUzs > 0 ? (
                  <span className="ml-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                    · {money(totals.paidAmountUzs)} {t("currencyUzs")}
                  </span>
                ) : null}
              </p>
            </div>
          </li>
        </ul>
      ) : null}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          {loading ? (
            <LoadingRegion aria-label={t("loading")} className="space-y-3 p-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </LoadingRegion>
          ) : failed ? (
            <div className="flex flex-col items-start gap-3 p-4">
              <p role="alert" className="text-sm text-destructive">
                {t("failedToLoadData")}
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  void groups.refetch();
                  void configuration.refetch();
                }}
              >
                {t("retry")}
              </Button>
            </div>
          ) : listedGroups.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title={t("futureGroupsEmpty")}
              action={
                <Button onClick={() => setEditing({ group: null })}>
                  {t("futureGroupCreate")}
                </Button>
              }
            />
          ) : (
            <DataTable
              columns={columns}
              data={listedGroups}
              keyExtractor={(group) => `future-group-${group.id}`}
              onRowClick={(group) => setEditing({ group })}
              rootClassName="flex min-h-0 flex-1 flex-col"
              className="min-h-0 flex-1 overflow-y-auto"
              showPagination={listedGroups.length > 25}
            />
          )}
        </CardContent>
      </Card>
      {editing && configuration.data && (
        <FutureGroupDialog
          key={editing.group?.id ?? "new"}
          group={editing.group}
          configuration={configuration.data}
          onClose={() => setEditing(null)}
          onPrepare={(group) => {
            setEditing(null);
            setPreparing(group);
          }}
        />
      )}
      {prepared && configuration.data && (
        <GroupEditorDialog
          open
          launchingFutureGroup
          group={prepared}
          configuration={configuration.data}
          onClose={() => {
            setPreparing(null);
            void client.invalidateQueries({ queryKey: futureGroupsKey });
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(archiving)}
        onOpenChange={(open) => {
          if (!open && !archive.isPending) setArchiving(null);
        }}
        title={t("archiveGroupTitle")}
        description={archiving?.name ?? ""}
        confirmLabel={t("archiveGroup")}
        variant="destructive"
        keepOpenOnConfirm
        isPending={archive.isPending}
        error={error}
        onConfirm={() => {
          if (archiving) archive.mutate(archiving.id);
        }}
      />
    </div>
  );
}
