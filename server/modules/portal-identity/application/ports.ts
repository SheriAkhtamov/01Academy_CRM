import type {
  PortalAccountDto,
  PortalClassification,
  PortalPermission,
} from "@shared/contracts/portal-identity";
import type { PortalContactMatches } from "@shared/contracts/portal-contact-checks";

export type PortalAccount = PortalAccountDto & {
  passwordHash: string | null;
  authVersion: number;
  emailVerifiedAt: number | null;
  pendingEmail: string | null;
};
export type PortalStudent = {
  id: number;
  studentName: string;
  managerId: number | null;
  classification: PortalClassification;
  verifiedBirthDate: string | null;
};
export type PortalLink = {
  id: number;
  accountId: number;
  studentId: number;
  kind: "self" | "representative";
  relationship: "parent" | "guardian" | "payer" | "other" | null;
  permissions: PortalPermission[];
  status: "pending" | "active" | "suspended" | "revoked";
  verifiedAt: number | null;
  verifiedBy: number | null;
  expiresAt: number | null;
};
export type PortalConsent = {
  id: number;
  linkId: number;
  permissions: PortalPermission[];
  subjectAccountId: number | null;
  method: "in_person" | "portal" | "staff_verification";
  staffId: number | null;
  revokedAt: number | null;
  createdAt: number;
};
export type PortalInvitation = {
  id: number;
  accountId: number;
  linkId: number;
  tokenHash: string;
  expiresAt: number;
  status: "created" | "sent" | "delivery_failed" | "accepted" | "expired" | "revoked";
  channel: "manual" | "email";
  createdBy: number;
  idempotencyKey: string;
  requestHash: string;
  acceptedAt: number | null;
  acceptedAccountId: number | null;
};
export type PortalRecoveryToken = {
  id: number;
  accountId: number;
  purpose: "recovery" | "email";
  tokenHash: string;
  expiresAt: number;
  consumedAt: number | null;
  payload: string | null;
};
export type PortalSession = {
  id: string;
  accountId: number | null;
  authVersion: number;
  createdAt: number;
  lastSeenAt: number;
  absoluteExpiresAt: number;
  csrfToken: string;
  reauthenticatedAt: number | null;
};
export type PortalActorSnapshot = {
  account: Pick<PortalAccount, "id" | "status"> | null;
  link: Pick<PortalLink, "id" | "accountId" | "studentId" | "kind" | "permissions" | "status" | "verifiedAt" | "expiresAt"> | null;
  student: Pick<PortalStudent, "id" | "classification"> | null;
  consents: Pick<PortalConsent, "permissions" | "method" | "revokedAt">[];
};
export type PortalAudit = {
  actorKind: "staff" | "portal" | "anonymous";
  staffId: number | null;
  accountId: number | null;
  studentId: number | null;
  action: string;
  requestId?: string;
  details: Record<string, unknown>;
};
export type PortalMail = {
  accountId: number;
  recipient: string;
  template: "invitation" | "recovery" | "email_change" | "email_changed";
  encryptedPayload: string;
  expiresAt: number;
  invitationId?: number;
  dedupeKey: string;
};

export interface PortalRepository {
  transaction<T>(work: (repository: PortalRepository) => Promise<T>): Promise<T>;
  findAccount(identifier: string, lock?: boolean): Promise<PortalAccount | null>;
  findContactMatches(contact: { email: string | null; phone: string | null }, staff: { staffId: number; administration: boolean }): Promise<PortalContactMatches>;
  getAccount(id: number, lock?: boolean): Promise<PortalAccount | null>;
  createAccount(account: Omit<PortalAccount, "id">): Promise<PortalAccount>;
  updateAccount(id: number, changes: Partial<Omit<PortalAccount, "id">>): Promise<PortalAccount>;
  getStudent(id: number, lock?: boolean): Promise<PortalStudent | null>;
  getStudentEnrollmentGroupIds(studentId: number): Promise<number[]>;
  updateStudentIdentity(
    id: number,
    classification: PortalClassification,
    birthDate: string | null,
    staffId: number,
    method: string,
  ): Promise<void>;
  getLink(id: number, lock?: boolean): Promise<PortalLink | null>;
  listLinks(filter: { accountId?: number; studentId?: number }): Promise<PortalLink[]>;
  createLink(link: Omit<PortalLink, "id">): Promise<PortalLink>;
  updateLink(id: number, changes: Partial<Omit<PortalLink, "id">>): Promise<PortalLink>;
  getConsents(linkId: number): Promise<PortalConsent[]>;
  createConsent(consent: Omit<PortalConsent, "id">): Promise<PortalConsent>;
  revokeConsents(linkId: number, at: number): Promise<void>;
  getInvitationByHash(hash: string, lock?: boolean): Promise<PortalInvitation | null>;
  getInvitationByKey(key: string): Promise<PortalInvitation | null>;
  listInvitations(linkId: number): Promise<PortalInvitation[]>;
  createInvitation(invitation: Omit<PortalInvitation, "id">): Promise<PortalInvitation>;
  updateInvitation(
    id: number,
    changes: Partial<Omit<PortalInvitation, "id">>,
  ): Promise<PortalInvitation>;
  revokeInvitations(filter: { accountId?: number; linkId?: number }, at: number): Promise<void>;
  getToken(hash: string, lock?: boolean): Promise<PortalRecoveryToken | null>;
  createToken(token: Omit<PortalRecoveryToken, "id">): Promise<PortalRecoveryToken>;
  consumeToken(id: number, at: number): Promise<void>;
  revokeTokens(accountId: number, at: number): Promise<void>;
  getSession(id: string, lock?: boolean): Promise<PortalSession | null>;
  resolveActiveSession?(id: string, now: number): Promise<PortalSession | null>;
  readActorSnapshot?(accountId: number, linkId: number): Promise<PortalActorSnapshot>;
  saveSession(session: PortalSession): Promise<void>;
  touchSession(session: PortalSession): Promise<boolean>;
  listSessions(accountId: number): Promise<PortalSession[]>;
  revokeSessions(accountId: number, exceptId?: string): Promise<void>;
  deleteSession(id: string): Promise<void>;
  rateLimit(key: string, limit: number, windowMs: number, now: number): Promise<number | null>;
  releaseRateLimit(key: string, now: number): Promise<void>;
  audit(event: PortalAudit): Promise<void>;
  queueMail(mail: PortalMail): Promise<void>;
}
export interface PortalCrypto {
  randomToken(): string;
  hashToken(token: string): string;
  hashPassword(password: string): Promise<string>;
  verifyPassword(password: string, hash: string | null): Promise<boolean>;
  encrypt(payload: Record<string, unknown>): string;
}
export type PortalIdentityOptions = {
  appUrl: string;
  emailEnabled: boolean;
  allowInvitations: boolean;
  now?: () => number;
  invitationsEnabledForStudent?: (studentId: number, repository: PortalRepository) => boolean | Promise<boolean>;
  childFinanceVisible?: () => boolean;
  emailEnabledForAccount?: (accountId: number, repository: PortalRepository) => boolean | Promise<boolean>;
};
