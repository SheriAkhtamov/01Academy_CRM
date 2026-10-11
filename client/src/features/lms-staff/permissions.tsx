import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  LMS_STAFF_PERMISSIONS,
  type LmsStaffPermissionDto,
} from "@shared/contracts/lms";
import type { TranslationKey } from "@/lib/i18n";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { lmsStaffApi } from "./api";
import { useStaffQuery, useStaffInvalidate } from "./queries";
import {
  StaffDialog,
  StaffField,
  StaffLoading,
  StaffError,
  StaffEmpty,
  StaffConfirm,
  useStaffError,
} from "./ui";
const permissionLabels: Record<
  (typeof LMS_STAFF_PERMISSIONS)[number],
  TranslationKey
> = {
  "content.manage": "lmsStaffMaterials",
  "assignments.manage": "lmsStaffAssignments",
  "reviews.manage": "lmsStaffReviews",
  "quizzes.manage": "lmsStaffQuizzes",
  "results.manage": "lmsStaffResults",
  "communication.manage": "lmsStaffThreads",
  "announcements.manage": "lmsStaffAnnouncements",
  "schedule.manage": "portalSchedule",
  "access.manage": "lmsStaffAccess",
  "portfolio.moderate": "portalPortfolio",
};
export function StaffPermissions() {
  const { t } = useTranslation();
  const query = useStaffQuery("staff-permissions", 0, (signal) =>
    lmsStaffApi.staffPermissions(signal),
  );
  const [selected, setSelected] = useState<LmsStaffPermissionDto | null>(null);
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
      <h2 className="text-xl font-semibold">{t("lmsStaffPermissionsTitle")}</h2>
      {!query.data.length && <StaffEmpty />}
      {query.data.map((staff) => (
        <Card key={staff.userId}>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0 space-y-2">
              <h3 className="break-words font-semibold">{staff.fullName}</h3>
              <p className="text-sm text-muted-foreground">
                {staff.permissions
                  .map((permission) =>
                    t(
                      permissionLabels[
                        permission as keyof typeof permissionLabels
                      ] ?? "lmsStaffPermissions",
                    ),
                  )
                  .join(" · ")}
              </p>
            </div>
            <Button variant="outline" onClick={() => setSelected(staff)}>
              {t("lmsStaffEdit")}
            </Button>
          </CardContent>
        </Card>
      ))}
      {selected && (
        <PermissionEditor
          key={selected.userId}
          staff={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
function PermissionEditor({
  staff,
  onClose,
}: {
  staff: LmsStaffPermissionDto;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const message = useStaffError();
  const invalidate = useStaffInvalidate();
  const eligibleAccess = (staff.modules ?? [staff.module]).some((module) =>
    ["sales", "administration"].includes(module),
  );
  const [permissions, setPermissions] = useState(
    staff.permissions.filter(
      (permission) => permission !== "access.manage" || eligibleAccess,
    ),
  );
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const action = useMutation({
    mutationFn: () =>
      lmsStaffApi.changeStaffPermissions(staff.userId, { permissions, reason }),
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });
  return (
    <StaffDialog
      open
      onClose={onClose}
      titleKey="lmsStaffPermissionsTitle"
      description={staff.fullName}
      dirty={
        Boolean(reason) ||
        JSON.stringify(permissions) !== JSON.stringify(staff.permissions)
      }
      pending={action.isPending}
    >
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          setConfirm(true);
        }}
      >
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="mb-3 text-sm font-medium">
            {t("lmsStaffPermissions")}
          </legend>
          {LMS_STAFF_PERMISSIONS.filter(
            (permission) => permission !== "access.manage" || eligibleAccess,
          ).map((permission) => (
            <label
              key={permission}
              className="flex min-h-11 items-center gap-3 rounded-md border p-3"
            >
              <input
                type="checkbox"
                checked={permissions.includes(permission)}
                onChange={(event) =>
                  setPermissions(
                    event.target.checked
                      ? [...permissions, permission]
                      : permissions.filter((item) => item !== permission),
                  )
                }
              />
              {t(permissionLabels[permission])}
            </label>
          ))}
        </fieldset>
        <StaffField id="permissions-reason" labelKey="lmsStaffReason">
          <Textarea
            id="permissions-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
          />
        </StaffField>
        {action.error && (
          <p role="alert" className="text-sm text-destructive">
            {message(action.error)}
          </p>
        )}
        <Button disabled={action.isPending}>{t("lmsStaffSave")}</Button>
      </form>
      <StaffConfirm
        open={confirm}
        onOpenChange={setConfirm}
        titleKey="lmsStaffChangePermissionsTitle"
        description="lmsStaffChangePermissionsBody"
        action="lmsStaffSave"
        pending={action.isPending}
        error={action.error}
        onConfirm={() => action.mutate()}
      >
        <p className="font-medium">{staff.fullName}</p>
      </StaffConfirm>
    </StaffDialog>
  );
}
