import {
  parseGroupName,
  previewGroupCode,
  type GroupCodeCatalogue,
} from "@shared/academy-group-code";
import { normalizeWeeklySchedule } from "@shared/scheduling";
import {
  enrollmentGroupsKey,
  groupCodeCatalogueKey,
} from "@/features/groups/queries";
import {
  findRoomClashes,
  findTeacherConflict,
  type ScheduleClash,
} from "@/features/groups/editorInsights";
import {
  formatSlotTime,
  groupNameParts,
  summarizeSchedule,
} from "@/features/groups/presentation";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  CalendarDays,
  Globe,
  Play,
  Settings2,
  TriangleAlert,
  Users,
  UsersRound,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QuantityStepper } from "@/components/ui/quantity-stepper";
import { CompactModalSection } from "@/components/ux/CompactModalSection";
import { GroupStatusBadge } from "@/components/ux/teacher/TeacherStatusBadge";
import { WeekScheduleEditor } from "@/components/ux/WeekScheduleEditor";
import {
  useUnsavedChangesGuard,
  UnsavedChangesDialog,
} from "@/components/ux/UnsavedChangesGuard";
import { useTranslation } from "@/hooks/useTranslation";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  futureGroupInputSchema,
  type FutureGroup,
  type FutureGroupInput,
} from "@shared/contracts/future-groups";
import type { GroupConfiguration } from "@/features/groups/types";
import { futureGroupsApi, futureGroupsKey } from "./api";
import { FutureGroupMembers } from "./FutureGroupMembers";

const CAPACITY_PRESETS = [6, 8, 10, 12, 15] as const;
const DURATION_PRESETS = [60, 90, 120] as const;

function QuickNumberPresets({
  options,
  currentValue,
  unit,
  disabled,
  onSelect,
}: {
  options: readonly number[];
  currentValue: number;
  unit?: string;
  disabled?: boolean;
  onSelect: (value: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 pt-0.5">
      {options.map((preset) => {
        const active = Number(currentValue) === preset;
        return (
          <button
            key={preset}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(preset)}
            className={cn(
              "rounded-md border px-2 py-0.5 text-[11px] tabular-nums transition-colors disabled:opacity-50",
              active
                ? "border-primary/40 bg-primary/10 font-semibold text-primary"
                : "border-border/70 bg-muted/35 text-muted-foreground hover:bg-muted/70 hover:text-foreground",
            )}
          >
            {unit ? `${preset} ${unit}` : preset}
          </button>
        );
      })}
    </div>
  );
}

function Choice({
  id,
  label,
  value,
  options,
  onChange,
  disabled,
  optional,
  placeholder,
}: {
  id: string;
  label: string;
  value: number | null;
  options: Array<{ id: number; name: string; trailing?: string }>;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  optional?: boolean;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const emptyLabel = optional
    ? t("futureGroupUndecided")
    : (placeholder ?? t("futureGroupUndecided"));
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value ? String(value) : "none"}
        onValueChange={(v) => onChange(v === "none" ? null : Number(v))}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none" disabled={!optional}>
            {emptyLabel}
          </SelectItem>
          {options.map((o) => (
            <SelectItem
              key={o.id}
              value={String(o.id)}
              trailing={
                o.trailing ? (
                  <span className="tabular-nums text-muted-foreground">
                    {o.trailing}
                  </span>
                ) : undefined
              }
            >
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ClashNotice({
  title,
  clashes,
  shortDayNames,
}: {
  title: string;
  clashes: ScheduleClash[];
  shortDayNames: string[];
}) {
  return (
    <div
      role="status"
      className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-900 dark:text-amber-100"
    >
      <p className="flex items-center gap-2 font-medium">
        <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
        {title}
      </p>
      <ul className="mt-1.5 space-y-1 pl-6 text-xs">
        {clashes.slice(0, 3).map((clash) => (
          <li
            key={`${clash.group.id}-${clash.dayOfWeek}-${clash.startMinutes}`}
            className="tabular-nums"
          >
            {shortDayNames[clash.dayOfWeek - 1]} {formatSlotTime(clash)} ·{" "}
            {groupNameParts(clash.group.name).shortLabel}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FutureGroupDialog({
  group,
  configuration,
  onClose,
  onPrepare,
}: {
  group: FutureGroup | null;
  configuration: GroupConfiguration;
  onClose: () => void;
  onPrepare: (group: FutureGroup) => void;
}) {
  const { t, language } = useTranslation();
  const client = useQueryClient();
  const saveLock = useRef(false);
  const [initial] = useState<FutureGroupInput>(() => ({
    nameSuffix: group?.nameSuffix ?? "",
    courseId: group?.courseId ?? 0,
    schoolId: group?.schoolId ?? null,
    deliveryMode: group?.deliveryMode ?? "offline",
    maxStudents: group?.maxStudents ?? 12,
    startDate: group?.startDate ?? null,
    teacherId: group?.teacherId ?? null,
    roomId: group?.roomId ?? null,
    schedule: group?.schedule ?? [],
    lessonDurationMinutes: group?.lessonDurationMinutes ?? 120,
    ...(group
      ? { expectedUpdatedAt: new Date(group.updatedAt).toISOString() }
      : {}),
  }));
  const [form, setForm] = useState(initial);
  const [scheduleOpen, setScheduleOpen] = useState(() =>
    Boolean(
      !group ||
        group.startDate ||
        group.teacherId ||
        group.roomId ||
        group.schedule.length > 0,
    ),
  );
  const [error, setError] = useState("");
  const set = <K extends keyof FutureGroupInput>(
    key: K,
    value: FutureGroupInput[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const codeCatalogue = useQuery<GroupCodeCatalogue>({
    queryKey: groupCodeCatalogueKey,
    enabled: !group,
    staleTime: 0,
    retry: false,
  });

  const existingCode = parseGroupName(group?.name)?.code ?? "";
  const previewCode = useMemo(() => {
    if (existingCode) return existingCode;
    const cat = codeCatalogue.data;
    if (!cat?.courseCodes || !cat?.schoolCodes || !form.courseId) return "";
    return previewGroupCode(cat, {
      schoolId: form.schoolId ?? "",
      courseId: form.courseId,
      deliveryMode: form.deliveryMode,
      trainingType: "GRP",
    });
  }, [
    codeCatalogue.data,
    existingCode,
    form.courseId,
    form.deliveryMode,
    form.schoolId,
  ]);

  const handleCopyCode = async () => {
    if (!previewCode) return false;
    try {
      await navigator.clipboard.writeText(previewCode);
      toast({ title: t("groupCodeCopied"), description: previewCode });
    } catch {
      toast({ title: t("copyFailed"), variant: "destructive" });
      return false;
    }
  };

  const saving = useMutation({
    mutationFn: (input: FutureGroupInput) =>
      futureGroupsApi.save(input, group?.id),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: futureGroupsKey }),
        client.invalidateQueries({ queryKey: enrollmentGroupsKey }),
      ]);
      onClose();
    },
    onSettled: () => {
      saveLock.current = false;
    },
    onError: (e: Error & { rawMessage?: string }) => {
      const code = e.rawMessage ?? e.message;
      const knownError = [
        "futureGroupChanged",
        "futureGroupUnavailable",
        "groupCapacityBelowOccupancy",
        "groupCapacityExceedsRoom",
        "groupHasInactiveResources",
        "teacherNotFound",
        "groupCodeBranchMissing",
        "groupCodeCourseMissing",
        "groupCodeImmutable",
        "groupOnlineRequiresNewGroup",
        "groupNameTooLong",
        "groupNameAdditionInvalid",
        "accessDenied",
      ] as const;
      const key = knownError.find((key) => key === code || t(key) === code);
      setError(
        code === "invalidData"
          ? t("futureGroupRequiredFields")
          : key
            ? t(key)
            : t("futureGroupSaveFailed"),
      );
    },
  });
  const guard = useUnsavedChangesGuard({
    open: true,
    isDirty: JSON.stringify(form) !== JSON.stringify(initial),
    isPending: saving.isPending,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
  });
  const days = [
    t("monday"),
    t("tuesday"),
    t("wednesday"),
    t("thursday"),
    t("friday"),
    t("saturday"),
    t("sunday"),
  ];
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

  const availableCourses = useMemo(
    () =>
      configuration.courses.filter(
        (c) => c.isActive !== false || c.id === group?.courseId,
      ),
    [configuration.courses, group?.courseId],
  );
  const availableSchools = useMemo(
    () =>
      configuration.schools.filter(
        (s) => s.isActive !== false || s.id === group?.schoolId,
      ),
    [configuration.schools, group?.schoolId],
  );
  const availableRooms = useMemo(
    () =>
      configuration.rooms.filter(
        (room) =>
          room.schoolId === form.schoolId &&
          (room.isActive !== false || room.id === group?.roomId),
      ),
    [configuration.rooms, form.schoolId, group?.roomId],
  );
  const selectedRoom = useMemo(
    () => availableRooms.find((r) => r.id === form.roomId),
    [availableRooms, form.roomId],
  );
  const roomCapacityExceeded = Boolean(
    form.deliveryMode !== "online" &&
      selectedRoom &&
      selectedRoom.capacity > 0 &&
      form.maxStudents > selectedRoom.capacity,
  );

  const plannedContext = useMemo(
    () => ({
      schedule: form.schedule,
      startDate: form.startDate ?? "",
      endDate: "",
      editingGroupId: group?.id ?? null,
    }),
    [form.schedule, form.startDate, group?.id],
  );

  const roomClashes = useMemo(
    () =>
      form.deliveryMode !== "online" &&
      form.roomId &&
      form.schedule.length > 0 &&
      configuration.groups
        ? findRoomClashes(form.roomId, plannedContext, configuration.groups)
        : [],
    [
      configuration.groups,
      form.deliveryMode,
      form.roomId,
      form.schedule.length,
      plannedContext,
    ],
  );

  const teacherConflictLabel = useMemo(() => {
    if (!form.teacherId || form.schedule.length === 0 || !configuration.groups)
      return null;
    if (form.deliveryMode !== "online" && !form.schoolId) return null;
    const teacher = configuration.teachers.find((t) => t.id === form.teacherId);
    if (!teacher) return null;
    const conflict = findTeacherConflict(
      teacher,
      { ...plannedContext, schoolId: form.schoolId ?? 0 },
      configuration.groups,
    );
    if (conflict?.issue === "otherBranch") return t("groupTeacherOtherBranch");
    if (conflict?.issue === "offHours") return t("groupTeacherOffHours");
    if (conflict?.issue === "busy" && conflict.clash) {
      return t("groupScheduleOverlapsWith").replace(
        "{group}",
        groupNameParts(conflict.clash.group.name).shortLabel,
      );
    }
    return null;
  }, [
    configuration.groups,
    configuration.teachers,
    form.deliveryMode,
    form.schedule.length,
    form.schoolId,
    form.teacherId,
    plannedContext,
    t,
  ]);

  const scheduleSummary = useMemo(() => {
    const parts: string[] = [];
    if (form.startDate) {
      parts.push(
        new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-US", {
          day: "numeric",
          month: "short",
          timeZone: "UTC",
        }).format(new Date(`${form.startDate}T00:00:00Z`)),
      );
    }
    const teacherName =
      configuration.teachers.find((item) => item.id === form.teacherId)
        ?.fullName ??
      (form.teacherId === group?.teacherId ? group?.teacherName : null);
    if (teacherName) parts.push(teacherName);
    if (form.deliveryMode !== "online" && selectedRoom?.name) {
      parts.push(selectedRoom.name);
    }
    const normalized = normalizeWeeklySchedule(
      form.schedule,
      form.lessonDurationMinutes,
    );
    if (normalized.length > 0) {
      parts.push(
        summarizeSchedule(normalized, shortDayNames)
          .map((entry) => `${entry.days} ${entry.time}`)
          .join(" · "),
      );
    }
    return parts.join(" · ") || t("futureGroupUndecided");
  }, [
    configuration.teachers,
    form.deliveryMode,
    form.lessonDurationMinutes,
    form.schedule,
    form.startDate,
    form.teacherId,
    group?.teacherId,
    group?.teacherName,
    language,
    selectedRoom?.name,
    shortDayNames,
    t,
  ]);

  const occupied = group ? group.currentStudents + group.reservedStudents : 0;

  return (
    <>
      <Dialog open onOpenChange={guard.handleOpenChange}>
        <DialogContent
          aria-describedby={undefined}
          className="compact-modal flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl flex-col overflow-hidden p-0"
        >
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              if (event.target !== event.currentTarget) return;
              event.preventDefault();
              if (saveLock.current) return;
              const parsed = futureGroupInputSchema.safeParse(form);
              if (!parsed.success) {
                const hasScheduleIssue = parsed.error.issues.some(
                  (issue) => issue.path[0] === "schedule",
                );
                if (hasScheduleIssue) {
                  setScheduleOpen(true);
                }
                setError(t("futureGroupRequiredFields"));
                return;
              }
              setError("");
              saveLock.current = true;
              saving.mutate(parsed.data);
            }}
          >
            <DialogHeader
              className="compact-modal-header shrink-0 pr-12 text-left"
              data-topographic="header"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20"
                    aria-hidden="true"
                  >
                    <UsersRound className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <DialogTitle className="text-base font-semibold tracking-tight sm:text-lg">
                      {group ? t("futureGroupEdit") : t("futureGroupCreate")}
                    </DialogTitle>
                    {group ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {group.name}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {previewCode ? (
                    <CopyButton
                      type="button"
                      unstyled
                      onCopy={handleCopyCode}
                      resetKey={previewCode}
                      iconPosition="end"
                      iconClassName="size-3 opacity-75"
                      aria-label={t("copyGroupCode")}
                      className="inline-flex items-center gap-1.5 rounded-md border border-primary/25 bg-primary/8 px-2 py-0.5 font-mono text-xs font-semibold text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {previewCode}
                    </CopyButton>
                  ) : null}
                  <GroupStatusBadge status="planned" />
                </div>
              </div>
            </DialogHeader>
            <div className="compact-modal-body min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain">
              <CompactModalSection
                title={t("futureGroupParameters")}
                icon={Settings2}
                tone="sky"
                collapsible={false}
                contentClassName="space-y-3"
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <Choice
                    id="future-course"
                    label={t("course")}
                    value={form.courseId}
                    options={availableCourses}
                    placeholder={t("selectCourse")}
                    onChange={(value) => {
                      const nextCourseId = value ?? 0;
                      const course = configuration.courses.find(
                        (c) => c.id === nextCourseId,
                      );
                      setForm((prev) => ({
                        ...prev,
                        courseId: nextCourseId,
                        lessonDurationMinutes:
                          !group &&
                          course?.lessonDurationMinutes &&
                          prev.lessonDurationMinutes ===
                            initial.lessonDurationMinutes
                            ? course.lessonDurationMinutes
                            : prev.lessonDurationMinutes,
                      }));
                    }}
                    disabled={saving.isPending || Boolean(group)}
                  />
                  <Choice
                    id="future-school"
                    label={t("school")}
                    value={form.schoolId}
                    options={availableSchools}
                    placeholder={t("selectSchool")}
                    onChange={(value) =>
                      setForm((prev) => ({
                        ...prev,
                        schoolId: value,
                        roomId: null,
                      }))
                    }
                    optional={form.deliveryMode === "online"}
                    disabled={saving.isPending || Boolean(group)}
                  />
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="future-name">{t("groupName")}</Label>
                      {previewCode ? (
                        <span className="font-mono text-[11px] font-medium text-muted-foreground">
                          {previewCode}
                        </span>
                      ) : null}
                    </div>
                    <Input
                      id="future-name"
                      value={form.nameSuffix}
                      maxLength={120}
                      onChange={(e) => set("nameSuffix", e.target.value)}
                      disabled={saving.isPending}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="future-format">
                      {t("groupDeliveryFormat")}
                    </Label>
                    <Select
                      value={form.deliveryMode}
                      onValueChange={(v) =>
                        setForm((prev) => ({
                          ...prev,
                          deliveryMode: v as "offline" | "online",
                          // An online group never holds a room.
                          roomId: v === "online" ? null : prev.roomId,
                        }))
                      }
                      disabled={saving.isPending || Boolean(group)}
                    >
                      <SelectTrigger id="future-format" className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="offline">
                          <span className="inline-flex items-center gap-2">
                            <Building2
                              className="size-3.5 text-muted-foreground"
                              aria-hidden="true"
                            />
                            <span>{t("offline")}</span>
                          </span>
                        </SelectItem>
                        <SelectItem value="online">
                          <span className="inline-flex items-center gap-2">
                            <Globe
                              className="size-3.5 text-muted-foreground"
                              aria-hidden="true"
                            />
                            <span>{t("online")}</span>
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="future-capacity">{t("maxStudents")}</Label>
                    <QuantityStepper
                      id="future-capacity"
                      min={1}
                      max={200}
                      step={1}
                      required
                      value={form.maxStudents}
                      onChange={(e) =>
                        set("maxStudents", Number(e.target.value))
                      }
                      disabled={saving.isPending}
                    />
                    <QuickNumberPresets
                      options={CAPACITY_PRESETS}
                      currentValue={form.maxStudents}
                      disabled={saving.isPending}
                      onSelect={(preset) => set("maxStudents", preset)}
                    />
                  </div>
                </div>
              </CompactModalSection>

              <CompactModalSection
                title={t("schedule")}
                icon={CalendarDays}
                tone="amber"
                collapsible
                open={scheduleOpen}
                onOpenChange={setScheduleOpen}
                summary={scheduleSummary}
                contentClassName="space-y-3"
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="future-start">{t("startDate")}</Label>
                    <Input
                      id="future-start"
                      type="date"
                      value={form.startDate ?? ""}
                      onChange={(e) => set("startDate", e.target.value || null)}
                      disabled={saving.isPending}
                    />
                  </div>
                  <Choice
                    id="future-teacher"
                    label={t("teacher")}
                    value={form.teacherId}
                    options={configuration.teachers.map((teacher) => ({
                      id: teacher.id,
                      name: teacher.fullName,
                    }))}
                    onChange={(value) => set("teacherId", value)}
                    optional
                    disabled={saving.isPending}
                  />
                  {form.deliveryMode !== "online" ? (
                    <div className="space-y-1.5">
                      <Choice
                        id="future-room"
                        label={t("room")}
                        value={form.roomId}
                        options={availableRooms.map((room) => ({
                          id: room.id,
                          name: room.name,
                          trailing:
                            room.capacity > 0
                              ? t("groupRoomCapacity").replace(
                                  "{count}",
                                  String(room.capacity),
                                )
                              : undefined,
                        }))}
                        onChange={(value) => set("roomId", value)}
                        optional
                        disabled={saving.isPending}
                      />
                      {roomCapacityExceeded && selectedRoom ? (
                        <p
                          role="status"
                          className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-200"
                        >
                          <TriangleAlert
                            className="mt-0.5 size-3.5 shrink-0"
                            aria-hidden="true"
                          />
                          <span>
                            {t("groupRoomCapacityWarning")
                              .replace("{room}", String(selectedRoom.capacity))
                              .replace("{group}", String(form.maxStudents))}
                          </span>
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="space-y-1">
                    <Label htmlFor="future-duration">
                      {t("lessonDurationMinutes")}
                    </Label>
                    <QuantityStepper
                      id="future-duration"
                      min={15}
                      max={480}
                      value={form.lessonDurationMinutes}
                      onChange={(e) =>
                        set("lessonDurationMinutes", Number(e.target.value))
                      }
                      disabled={saving.isPending}
                    />
                    <QuickNumberPresets
                      options={DURATION_PRESETS}
                      currentValue={form.lessonDurationMinutes}
                      unit={t("minuteShort")}
                      disabled={saving.isPending}
                      onSelect={(preset) =>
                        set("lessonDurationMinutes", preset)
                      }
                    />
                  </div>
                </div>
                {teacherConflictLabel ? (
                  <p
                    role="status"
                    className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-200"
                  >
                    <TriangleAlert
                      className="mt-0.5 size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    <span>{teacherConflictLabel}</span>
                  </p>
                ) : null}
                <WeekScheduleEditor
                  value={form.schedule}
                  onChange={(value) => set("schedule", value)}
                  dayNames={days}
                  disabled={saving.isPending}
                  defaultDurationMinutes={form.lessonDurationMinutes}
                />
                {roomClashes.length > 0 ? (
                  <ClashNotice
                    title={t("roomOccupied")}
                    clashes={roomClashes}
                    shortDayNames={shortDayNames}
                  />
                ) : null}
              </CompactModalSection>

              {group && (
                <CompactModalSection
                  title={t("futureGroupMembers")}
                  icon={Users}
                  tone="teal"
                  count={occupied}
                  collapsible={false}
                >
                  <FutureGroupMembers
                    groupId={group.id}
                    maxStudents={form.maxStudents}
                    occupiedSeats={occupied}
                    paidMembersCount={group.paidMembers}
                    paidTotalUzs={group.paidAmountUzs}
                  />
                </CompactModalSection>
              )}

              {error && (
                <p
                  role="alert"
                  className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive"
                >
                  {error}
                </p>
              )}
            </div>
            <DialogFooter className="compact-modal-footer flex-wrap">
              {group && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={saving.isPending}
                  onClick={() => guard.requestAction(() => onPrepare(group))}
                >
                  <Play data-icon="inline-start" aria-hidden="true" />
                  {t("futureGroupLaunch")}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={saving.isPending}
                onClick={() => guard.handleOpenChange(false)}
              >
                {t("cancel")}
              </Button>
              <Button type="submit" loading={saving.isPending}>
                {group ? t("saveChanges") : t("futureGroupCreate")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <UnsavedChangesDialog
        open={guard.confirmationOpen}
        onOpenChange={guard.setConfirmationOpen}
        onDiscard={guard.discardChanges}
        isPending={saving.isPending}
      />
    </>
  );
}
