import {
  REPRESENTATIVE_PERMISSIONS,
  type PortalClassification,
  type PortalPermission,
} from "@shared/contracts/portal-identity";
import type { PortalActorContext, PortalStaffActor } from "./actor-context";

export class PortalError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
    public readonly retryAfter?: number,
  ) {
    super(code);
  }
}
export function assertStaffStudentAccess(actor: PortalStaffActor, managerId: number | null) {
  if (
    !actor.canManageAccess ||
    (!actor.modules.includes("administration") &&
      (!actor.modules.includes("sales") || managerId !== actor.staffId))
  ) {
    throw new PortalError("portalAccessDenied", 403);
  }
}
export function validateRepresentativePermissions(
  permissions: readonly PortalPermission[],
  classification: PortalClassification,
) {
  if (permissions.some((permission) => !REPRESENTATIVE_PERMISSIONS.includes(permission)))
    throw new PortalError("portalRepresentativeCannotSubmit");
  if (permissions.includes("child_credentials.manage") && classification !== "minor")
    throw new PortalError("portalChildIdentityUnverified");
}
export function selfPermissions(
  classification: PortalClassification,
  childFinanceVisible = false,
): PortalPermission[] {
  const permissions: PortalPermission[] = [
    "learning.read",
    "attendance.read",
    "feedback.read",
    "communication.create",
    "assignments.submit",
    "quizzes.attempt",
    "portfolio.edit",
  ];
  if (classification === "adult" || (classification === "minor" && childFinanceVisible))
    permissions.push("finance.read");
  return permissions;
}
export function assertPortalPermission(actor: PortalActorContext, permission: PortalPermission) {
  if (!actor.permissions.includes(permission)) throw new PortalError("portalAccessDenied", 403);
  if (
    (permission === "assignments.submit" ||
      permission === "quizzes.attempt" ||
      permission === "portfolio.edit") &&
    actor.kind !== "self"
  ) {
    throw new PortalError("portalAccessDenied", 403);
  }
}
