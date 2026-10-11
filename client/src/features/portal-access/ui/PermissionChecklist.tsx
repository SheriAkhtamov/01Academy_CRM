import {
  REPRESENTATIVE_PERMISSIONS,
  type PortalClassification,
  type PortalPermission,
} from "@shared/contracts/portal-identity";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/lib/i18n";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export const permissionLabels: Record<PortalPermission, TranslationKey> = {
  "learning.read": "lmsStaffPermissionLearning",
  "attendance.read": "lmsStaffPermissionAttendance",
  "feedback.read": "lmsStaffPermissionFeedback",
  "finance.read": "lmsStaffPermissionFinance",
  "communication.create": "lmsStaffPermissionCommunication",
  "portfolio.approve": "lmsStaffPermissionPortfolio",
  "child_credentials.manage": "lmsStaffPermissionCredentials",
  "assignments.submit": "lmsStaffAssignments",
  "quizzes.attempt": "lmsStaffQuizzes",
  "portfolio.edit": "portfolio",
};
export function PermissionChecklist({
  value,
  onChange,
  classification,
  disabled = false,
  idPrefix = "portal-permission",
}: {
  value: PortalPermission[];
  onChange: (value: PortalPermission[]) => void;
  classification: PortalClassification;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      {REPRESENTATIVE_PERMISSIONS.filter(
        (permission) =>
          permission !== "child_credentials.manage" ||
          classification === "minor",
      ).map((permission) => (
        <div key={permission} className="flex items-center gap-3">
          <Checkbox
            id={`${idPrefix}-${permission}`}
            checked={value.includes(permission)}
            disabled={disabled}
            onCheckedChange={(checked) =>
              onChange(
                checked
                  ? [...value, permission]
                  : value.filter((item) => item !== permission),
              )
            }
          />
          <Label
            htmlFor={`${idPrefix}-${permission}`}
            className="cursor-pointer text-sm leading-5"
          >
            {t(permissionLabels[permission])}
          </Label>
        </div>
      ))}
    </div>
  );
}
