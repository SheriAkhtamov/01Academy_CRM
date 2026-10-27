import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { LmsStaffRunDto, LmsRunUpdateInput } from "@shared/contracts/lms";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { lmsStaffApi } from "./api";
import { useStaffInvalidate } from "./queries";
import {
  StaffDialog,
  StaffField,
  StaffConfirm,
  useStaffError,
  safeStaffLink,
} from "./ui";
export function RunSettings({
  run,
  onClose,
}: {
  run: LmsStaffRunDto;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const message = useStaffError();
  const invalidate = useStaffInvalidate();
  const [format, setFormat] = useState<"offline" | "online">(
    run.format ?? "offline",
  );
  const [meeting, setMeeting] = useState(run.meetingUrl ?? "");
  const [status, setStatus] = useState<"active" | "completed" | "archived">(
    ["active", "completed", "archived"].includes(run.status)
      ? (run.status as "active" | "completed" | "archived")
      : "active",
  );
  const [reason, setReason] = useState("");
  const [validation, setValidation] = useState("");
  const [confirm, setConfirm] = useState<LmsRunUpdateInput | null>(null);
  const action = useMutation({
    mutationFn: (input: LmsRunUpdateInput) =>
      lmsStaffApi.updateRun(run.runId!, input),
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });
  const payload = (): LmsRunUpdateInput => ({
    version: run.version ?? 1,
    format,
    meetingUrl: format === "online" ? meeting : null,
    status,
    reason,
  });
  return (
    <StaffDialog
      open
      onClose={onClose}
      titleKey="lmsStaffRunSettings"
      description={`${run.groupName} · ${run.courseName || t("lmsStaffCourseNotSelected")}`}
      dirty={
        Boolean(reason) ||
        format !== (run.format ?? "offline") ||
        meeting !== (run.meetingUrl ?? "") ||
        status !== run.status
      }
      pending={action.isPending}
    >
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          setValidation("");
          if (format === "online" && !safeStaffLink(meeting)) {
            setValidation(t("portalInvalidUrl"));
            return;
          }
          const input = payload();
          if (status === "archived") setConfirm(input);
          else action.mutate(input);
        }}
      >
        <StaffField id="run-setting-format" labelKey="lmsStaffFormat">
          <select
            id="run-setting-format"
            className="min-h-11 w-full rounded-md border bg-background px-3"
            value={format}
            onChange={(event) => setFormat(event.target.value as typeof format)}
          >
            <option value="offline">{t("lmsStaffOffline")}</option>
            <option value="online">{t("lmsStaffOnline")}</option>
          </select>
        </StaffField>
        {format === "online" && (
          <StaffField id="run-setting-meeting" labelKey="lmsStaffMeeting">
            <Input
              id="run-setting-meeting"
              type="url"
              value={meeting}
              onChange={(event) => setMeeting(event.target.value)}
              required
            />
          </StaffField>
        )}
        <StaffField id="run-setting-status" labelKey="lmsStaffRunSettings">
          <select
            id="run-setting-status"
            className="min-h-11 w-full rounded-md border bg-background px-3"
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="active">{t("lmsStaffActive")}</option>
            <option value="completed">{t("portalCompleted")}</option>
            <option value="archived">{t("lmsStaffArchiveRunTitle")}</option>
          </select>
        </StaffField>
        <StaffField id="run-setting-reason" labelKey="lmsStaffReason">
          <Textarea
            id="run-setting-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
          />
        </StaffField>
        {(validation || action.error) && (
          <p role="alert" className="text-sm text-destructive">
            {validation || message(action.error)}
          </p>
        )}
        <Button loading={action.isPending} disabled={action.isPending}>{t("lmsStaffSave")}</Button>
      </form>
      <StaffConfirm
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        titleKey={
          status === "archived"
            ? "lmsStaffArchiveRunTitle"
            : "lmsStaffAccessChangeTitle"
        }
        description={
          status === "archived"
            ? "lmsStaffArchiveRunBody"
            : "lmsStaffAccessChangeBody"
        }
        action="lmsStaffSave"
        pending={action.isPending}
        error={action.error}
        onConfirm={() => {
          if (confirm) action.mutate(confirm);
        }}
      >
        <p className="font-medium">{run.groupName}</p>
      </StaffConfirm>
    </StaffDialog>
  );
}
