import { apiRequest } from "@/lib/queryClient";
import { portalContactMatchesSchema, type PortalContactCheck } from "@shared/contracts/portal-contact-checks";
import type {
  PortalClassification,
  PortalInvitationCreateCommand,
  PortalInvitationResultDto,
  PortalPermission,
  PortalStudentAccessDto,
} from "@shared/contracts/portal-identity";

export type ExistingPortalAccount = {
  id: number;
  login: string;
  fullName: string;
  status: "pending" | "active" | "suspended" | "archived";
};
const path = (studentId: number) =>
  `/api/academy/students/${studentId}/portal-access`;
export const portalAccessApi = {
  get: (studentId: number) =>
    apiRequest("GET", path(studentId)) as Promise<PortalStudentAccessDto>,
  lookup: (studentId: number, login: string) =>
    apiRequest(
      "GET",
      `${path(studentId)}/accounts?login=${encodeURIComponent(login)}`,
    ) as Promise<ExistingPortalAccount | null>,
  checkContacts: async (studentId: number, input: PortalContactCheck) => portalContactMatchesSchema.parse(await apiRequest("POST", `${path(studentId)}/contact-matches`, input)),
  classify: (
    studentId: number,
    input: {
      classification: PortalClassification;
      verificationMethod: string;
      verifiedBirthDate?: string | null;
    },
  ) =>
    apiRequest(
      "POST",
      `${path(studentId)}/classification`,
      input,
    ) as Promise<PortalStudentAccessDto>,
  invite: (studentId: number, input: PortalInvitationCreateCommand) =>
    apiRequest(
      "POST",
      `${path(studentId)}/invitations`,
      input,
    ) as Promise<PortalInvitationResultDto>,
  revoke: (studentId: number, linkId: number) =>
    apiRequest(
      "POST",
      `${path(studentId)}/links/${linkId}/revoke`,
      {},
    ) as Promise<{ success: true }>,
  permissions: (
    studentId: number,
    linkId: number,
    input: {
      permissions: PortalPermission[];
      verificationMethod: string;
      verificationBasis: string;
      adultConsent?: { method: "in_person"; confirmed: true };
    },
  ) =>
    apiRequest(
      "PATCH",
      `${path(studentId)}/links/${linkId}/permissions`,
      input,
    ) as Promise<PortalStudentAccessDto>,
  accountStatus: (
    studentId: number,
    accountId: number,
    status: "active" | "suspended",
  ) =>
    apiRequest("POST", `${path(studentId)}/accounts/${accountId}/status`, {
      status,
    }) as Promise<PortalStudentAccessDto>,
  recover: (
    studentId: number,
    accountId: number,
    input: {
      password: string;
      verificationMethod: string;
      verificationBasis: string;
    },
  ) =>
    apiRequest(
      "POST",
      `${path(studentId)}/accounts/${accountId}/recovery`,
      input,
    ) as Promise<{ success: true }>,
};
