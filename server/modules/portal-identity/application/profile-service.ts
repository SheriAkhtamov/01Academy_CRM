import type {
  PortalDeviceSessionDto,
  PortalPermission,
  PortalSubjectDto,
} from "@shared/contracts/portal-identity";
import { PortalError } from "../domain/access-policy";
import type {
  PortalAccount,
  PortalCrypto,
  PortalIdentityOptions,
  PortalRepository,
  PortalSession,
} from "./ports";
import { safeAccount } from "./presenter";
import { requireCurrentPortalSession } from "./session-policy";
const MINUTE = 60_000,
  DAY = 24 * 60 * MINUTE;
type ProfileContext = {
  requireSession: (
    sessionId: string,
    reauthenticated?: boolean,
  ) => Promise<{ session: PortalSession; account: PortalAccount }>;
  listSubjects: (accountId: number) => Promise<PortalSubjectDto[]>;
  rotate: (
    repository: PortalRepository,
    account: PortalAccount,
    oldId?: string,
  ) => Promise<PortalSession>;
};
export class PortalProfileService {
  private readonly now: () => number;
  constructor(
    private readonly repository: PortalRepository,
    private readonly crypto: PortalCrypto,
    private readonly options: PortalIdentityOptions,
    private readonly context: ProfileContext,
  ) {
    this.now = options.now ?? Date.now;
  }
  async updateProfile(
    sessionId: string,
    changes: { fullName?: string; phone?: string | null; locale?: "ru" | "en" },
  ) {
    const authenticated = await this.context.requireSession(sessionId);
    return this.repository.transaction(async (repository) => {
      await requireCurrentPortalSession(repository, authenticated, this.now());
      return safeAccount(await repository.updateAccount(authenticated.account.id, changes));
    });
  }
  async getSessions(sessionId: string): Promise<PortalDeviceSessionDto[]> {
    const { account } = await this.context.requireSession(sessionId);
    return (await this.repository.listSessions(account.id))
      .filter(
        (session) =>
          session.absoluteExpiresAt > this.now() && session.lastSeenAt + DAY > this.now(),
      )
      .map((session) => ({
        id: session.id,
        createdAt: new Date(session.createdAt).toISOString(),
        lastSeenAt: new Date(session.lastSeenAt).toISOString(),
        expiresAt: new Date(session.absoluteExpiresAt).toISOString(),
        current: session.id === sessionId,
      }));
  }
  async revokeSessions(sessionId: string, targetId?: string) {
    const { account } = await this.context.requireSession(sessionId, true);
    if (targetId) {
      const target = await this.repository.getSession(targetId);
      if (target?.accountId !== account.id) throw new PortalError("portalAccessDenied", 403);
      await this.repository.deleteSession(targetId);
    } else await this.repository.revokeSessions(account.id, sessionId);
  }
  async ownRepresentatives(sessionId: string) {
    const subjects = await this.context.listSubjects(
      (await this.context.requireSession(sessionId)).account.id,
    );
    const self = subjects.find(
      (subject) => subject.kind === "self" && subject.studentClassification === "adult",
    );
    if (!self) return [];
    const results = [];
    for (const link of await this.repository.listLinks({
      studentId: self.studentId,
    })) {
      if (link.kind !== "representative" || link.status === "revoked") continue;
      const account = await this.repository.getAccount(link.accountId);
      if (account)
        results.push({
          linkId: link.id,
          fullName: account.fullName,
          relationship: link.relationship,
          permissions: link.permissions,
          status: link.status,
        });
    }
    return results;
  }
  async representativeConsent(
    sessionId: string,
    linkId: number,
    permissions: PortalPermission[],
    approved: boolean,
    requestId?: string,
  ) {
    const authenticated = await this.context.requireSession(sessionId, true);
    const { account } = authenticated;
    await this.repository.transaction(async (repository) => {
      const candidate = await repository.getLink(linkId);
      if (!candidate) throw new PortalError("portalLinkNotFound", 404);
      const student = await repository.getStudent(candidate.studentId, true);
      await requireCurrentPortalSession(repository, authenticated, this.now(), true);
      const link = await repository.getLink(linkId, true);
      if (!link || link.kind !== "representative" || link.status === "revoked")
        throw new PortalError("portalLinkNotFound", 404);
      const self = (await repository.listLinks({ studentId: link.studentId })).find(
        (item) => item.accountId === account.id && item.kind === "self" && item.status === "active",
      );
      if (!student || student.classification !== "adult" || !self)
        throw new PortalError("portalAccessDenied", 403);
      if (
        permissions.length !== link.permissions.length ||
        !permissions.every((permission) => link.permissions.includes(permission))
      )
        throw new PortalError("portalConsentPermissionsChanged", 409);
      await repository.revokeConsents(link.id, this.now());
      const invitationAccepted = (await repository.listInvitations(link.id)).some(
        (invitation) => invitation.status === "accepted",
      );
      if (approved)
        await repository.createConsent({
          linkId: link.id,
          permissions,
          subjectAccountId: account.id,
          staffId: null,
          method: "portal",
          revokedAt: null,
          createdAt: this.now(),
        });
      await repository.updateLink(link.id, {
        status: approved ? (invitationAccepted ? "active" : "pending") : "revoked",
      });
      if (!approved) await repository.revokeInvitations({ linkId }, this.now());
      await repository.audit({
        actorKind: "portal",
        accountId: account.id,
        staffId: null,
        studentId: link.studentId,
        action: approved ? "CONSENT_GRANTED" : "CONSENT_REVOKED",
        requestId,
        details: { linkId, permissions },
      });
    });
  }
}
