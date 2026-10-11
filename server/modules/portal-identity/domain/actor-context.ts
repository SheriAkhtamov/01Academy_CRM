import type {
  PortalClassification,
  PortalPermission,
} from "@shared/contracts/portal-identity";

export type PortalActorContext = {
  portalAccountId: number;
  sessionId: string;
  linkId: number;
  studentId: number;
  kind: "self" | "representative";
  permissions: PortalPermission[];
  studentClassification: PortalClassification;
  requestId?: string;
};
export type PortalStaffActor = {
  staffId: number;
  modules: readonly string[];
  canManageAccess: boolean;
  requestId?: string;
};
