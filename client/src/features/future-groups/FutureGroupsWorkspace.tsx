import { enrollmentGroupsKey } from "@/features/groups/queries";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, CalendarDays, Pencil, Play, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ux/PageHeader";
import { EmptyState } from "@/components/ux/EmptyState";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useTranslation } from "@/hooks/useTranslation";
import { GroupEditorDialog } from "@/features/groups/GroupEditorDialog";
import { groupConfigurationKey } from "@/features/groups/queries";
import type { Group, GroupConfiguration } from "@/features/groups/types";
import type { FutureGroup } from "@shared/contracts/future-groups";
import { futureGroupsApi, futureGroupsKey } from "./api";
import { FutureGroupDialog } from "./FutureGroupDialog";

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
  const listedGroups = groups.data ?? [];
  const archive = useMutation({
    mutationFn: (id: number) => futureGroupsApi.archive(id),
    onSuccess: async () => {
      setArchiving(null);
      await Promise.all([
        client.invalidateQueries({ queryKey: futureGroupsKey }),
        client.invalidateQueries({ queryKey: enrollmentGroupsKey }),
      ]);
    },
    onError: (e: Error) =>
      setError(
        e.message.includes("futureGroupHasMembers")
          ? t("futureGroupHasMembers")
          : t("futureGroupSaveFailed"),
      ),
  });
  const formatDate = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-US", {
          day: "numeric",
          month: "long",
          timeZone: "UTC",
        }).format(new Date(`${value}T00:00:00Z`))
      : t("futureGroupUndecided");
  const formatSchedule = (group: FutureGroup) =>
    group.schedule
      .map((slot) => {
        const day = new Intl.DateTimeFormat(
          language === "ru" ? "ru-RU" : "en-US",
          { weekday: "short", timeZone: "UTC" },
        ).format(new Date(Date.UTC(2026, 10, 1 + slot.dayOfWeek)));
        return `${day} ${slot.startTime}–${slot.endTime}`;
      })
      .join(" · ");
  const loading = groups.isPending || configuration.isPending;
  const failed = groups.isError || configuration.isError;
  const prepared = useMemo<Group | null>(
    () =>
      preparing
        ? {
            ...preparing,
            roomId: preparing.roomId ?? 0,
            roomName: preparing.roomName ?? undefined,
            lessonCount: 0,
            selectedCourseLessonIds: [],
            durationDays: 0,
            status: "in_progress",
            endDate: null,
          }
        : null,
    [preparing],
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
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-card">
        {loading ? (
          <LoadingRegion aria-label={t("loading")} className="space-y-3 p-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </LoadingRegion>
        ) : failed ? (
          <div className="p-4">
            <p role="alert">{t("failedToLoadData")}</p>
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
          <ul className="divide-y" aria-label={t("futureGroupsTitle")}>
            {listedGroups.map((group) => {
              const occupied = group.currentStudents + group.reservedStudents;
              return (
                <li
                  key={group.id}
                  className="flex flex-wrap items-center gap-4 p-4"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setEditing({ group })}
                  >
                    <span className="block break-words text-base font-semibold">
                      {group.name}
                    </span>
                    <span className="mt-1 block break-words text-sm">
                      {group.courseName} · {group.schoolName}
                    </span>
                    <span className="mt-2 block text-sm">
                      {t("startDate")}: {formatDate(group.startDate)}
                    </span>
                    <span className="block text-sm">
                      {t("schedule")}:{" "}
                      {formatSchedule(group) || t("futureGroupUndecided")}
                    </span>
                    <span className="block text-sm">
                      {t("teacher")}:{" "}
                      {group.teacherName || t("futureGroupUndecided")}
                    </span>
                  </button>
                  <div className="flex flex-wrap gap-4 text-sm tabular-nums">
                    <div>
                      <span className="block">{t("futureGroupOccupied")}</span>
                      <strong>
                        {occupied} / {group.maxStudents}
                      </strong>
                    </div>
                    <div>
                      <span className="block">{t("futureGroupFree")}</span>
                      <strong>
                        {Math.max(0, group.maxStudents - occupied)}
                      </strong>
                    </div>
                    <div>
                      <span className="block">{t("futureGroupPaid")}</span>
                      <strong>{group.paidMembers}</strong>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" onClick={() => setPreparing(group)}>
                      <Play aria-hidden />
                      {t("futureGroupLaunch")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing({ group })}
                    >
                      <Pencil data-icon="inline-start" />
                      {t("edit")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("archiveGroup")}
                      disabled={archive.isPending}
                      onClick={() => {
                        setError("");
                        setArchiving(group);
                      }}
                    >
                      <Archive aria-hidden />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
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
