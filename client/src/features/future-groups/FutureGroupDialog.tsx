import { enrollmentGroupsKey } from "@/features/groups/queries";
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Settings2, Users } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QuantityStepper } from "@/components/ui/quantity-stepper";
import { CompactModalSection } from "@/components/ux/CompactModalSection";
import { WeekScheduleEditor } from "@/components/ux/WeekScheduleEditor";
import {
  useUnsavedChangesGuard,
  UnsavedChangesDialog,
} from "@/components/ux/UnsavedChangesGuard";
import { useTranslation } from "@/hooks/useTranslation";
import {
  futureGroupInputSchema,
  type FutureGroup,
  type FutureGroupInput,
} from "@shared/contracts/future-groups";
import type { GroupConfiguration } from "@/features/groups/types";
import { futureGroupsApi, futureGroupsKey } from "./api";
import { FutureGroupMembers } from "./FutureGroupMembers";

function Choice({
  id,
  label,
  value,
  options,
  onChange,
  disabled,
  optional,
}: {
  id: string;
  label: string;
  value: number | null;
  options: Array<{ id: number; name: string }>;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  optional?: boolean;
}) {
  const { t } = useTranslation();
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
            {t("futureGroupUndecided")}
          </SelectItem>
          {options.map((o) => (
            <SelectItem key={o.id} value={String(o.id)}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
  const { t } = useTranslation();
  const client = useQueryClient();
  const saveLock = useRef(false);
  const [initial] = useState<FutureGroupInput>(() => ({
    nameSuffix: group?.nameSuffix ?? "",
    courseId: group?.courseId ?? 0,
    schoolId: group?.schoolId ?? 0,
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
  const [error, setError] = useState("");
  const set = <K extends keyof FutureGroupInput>(
    key: K,
    value: FutureGroupInput[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }));
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
    onError: (e: Error) =>
      setError(
        e.message.includes("futureGroupChanged")
          ? t("futureGroupChanged")
          : e.message.includes("groupCapacityBelowOccupancy")
            ? t("groupCapacityBelowOccupancy")
            : t("futureGroupSaveFailed"),
      ),
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
  return (
    <>
      <Dialog open onOpenChange={guard.handleOpenChange}>
        <DialogContent className="compact-modal flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl flex-col overflow-hidden p-0">
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              if (event.target !== event.currentTarget) return;
              event.preventDefault();
              if (saveLock.current) return;
              const parsed = futureGroupInputSchema.safeParse(form);
              if (!parsed.success) {
                setError(t("futureGroupRequiredFields"));
                return;
              }
              setError("");
              saveLock.current = true;
              saving.mutate(parsed.data);
            }}
          >
            <DialogHeader
              className="compact-modal-header"
              data-topographic="header"
            >
              <DialogTitle>
                {group ? t("futureGroupEdit") : t("futureGroupCreate")}
              </DialogTitle>
            </DialogHeader>
            <div className="compact-modal-body min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain">
              {group && (
                <p className="break-words text-sm font-semibold">
                  {group.name}
                </p>
              )}
              <CompactModalSection
                title={t("futureGroupParameters")}
                icon={Settings2}
                tone="sky"
                collapsible={false}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <Choice
                    id="future-course"
                    label={t("course")}
                    value={form.courseId}
                    options={configuration.courses.filter(
                      (c) => c.isActive !== false,
                    )}
                    onChange={(value) => set("courseId", value ?? 0)}
                    disabled={saving.isPending || Boolean(group)}
                  />
                  <Choice
                    id="future-school"
                    label={t("school")}
                    value={form.schoolId}
                    options={configuration.schools.filter(
                      (s) => s.isActive !== false,
                    )}
                    onChange={(value) =>
                      setForm((prev) => ({
                        ...prev,
                        schoolId: value ?? 0,
                        roomId: null,
                      }))
                    }
                    disabled={saving.isPending || Boolean(group)}
                  />
                  <div className="space-y-1">
                    <Label htmlFor="future-name">{t("groupName")}</Label>
                    <Input
                      id="future-name"
                      value={form.nameSuffix}
                      maxLength={120}
                      onChange={(e) => set("nameSuffix", e.target.value)}
                      disabled={saving.isPending}
                    />
                  </div>
                  <div className="space-y-1">
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
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="future-format">
                      {t("groupDeliveryFormat")}
                    </Label>
                    <Select
                      value={form.deliveryMode}
                      onValueChange={(v) =>
                        set("deliveryMode", v as "offline" | "online")
                      }
                      disabled={saving.isPending || Boolean(group)}
                    >
                      <SelectTrigger id="future-format" className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="offline">{t("offline")}</SelectItem>
                        <SelectItem value="online">{t("online")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CompactModalSection>
              <CompactModalSection
                title={t("schedule")}
                icon={CalendarDays}
                tone="amber"
                collapsible
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
                  <Choice
                    id="future-room"
                    label={t("room")}
                    value={form.roomId}
                    options={configuration.rooms.filter(
                      (room) =>
                        room.schoolId === form.schoolId &&
                        room.isActive !== false,
                    )}
                    onChange={(value) => set("roomId", value)}
                    optional
                    disabled={saving.isPending}
                  />
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
                  </div>
                </div>
                <WeekScheduleEditor
                  value={form.schedule}
                  onChange={(value) => set("schedule", value)}
                  dayNames={days}
                  disabled={saving.isPending}
                  defaultDurationMinutes={form.lessonDurationMinutes}
                />
              </CompactModalSection>
              {group && (
                <CompactModalSection
                  title={t("futureGroupMembers")}
                  icon={Users}
                  tone="teal"
                  collapsible={false}
                >
                  <FutureGroupMembers groupId={group.id} />
                </CompactModalSection>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
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
