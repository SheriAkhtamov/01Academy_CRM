import type {
  PortalClassification,
  PortalInvitationCreateCommand,
  PortalInvitationResultDto,
  PortalPermission,
  PortalStudentAccessDto,
  PortalSubjectDto,
} from "@shared/contracts/portal-identity";
import { portalPasswordSchema } from "@shared/contracts/portal-identity";
import type { PortalActorContext, PortalStaffActor } from "../domain/actor-context";
import {
  assertPortalPermission,
  assertStaffStudentAccess,
  PortalError,
  selfPermissions,
  validateRepresentativePermissions,
} from "../domain/access-policy";
import type {
  PortalAccount,
  PortalActorSnapshot,
  PortalCrypto,
  PortalIdentityOptions,
  PortalRepository,
  PortalSession,
} from "./ports";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

import { PortalProfileService } from "./profile-service";
import { safeAccount } from "./presenter";
import { requireCurrentPortalSession } from "./session-policy";

export class PortalIdentityService {
  private readonly profile: PortalProfileService;
  private readonly now: () => number;
  constructor(
    readonly repository: PortalRepository,
    private readonly crypto: PortalCrypto,
    private readonly options: PortalIdentityOptions,
  ) {
    this.now = options.now ?? Date.now;
    this.profile = new PortalProfileService(repository, crypto, options, {
      requireSession: (id, reauthenticated) => this.requireSession(id, reauthenticated),
      listSubjects: (accountId) => this.listSubjects(accountId),
      rotate: (repository, account, oldId) => this.rotate(repository, account, oldId),
    });
  }

  private async invitationsEnabled(studentId: number, repository: PortalRepository = this.repository) {
    return (
      this.options.allowInvitations &&
      (!this.options.invitationsEnabledForStudent ||
        (await this.options.invitationsEnabledForStudent(studentId, repository)))
    );
  }

  async createAnonymousSession(): Promise<PortalSession> {
    const now = this.now();
    const session: PortalSession = {
      id: this.crypto.randomToken(),
      accountId: null,
      authVersion: 0,
      createdAt: now,
      lastSeenAt: now,
      absoluteExpiresAt: now + HOUR,
      csrfToken: this.crypto.randomToken(),
      reauthenticatedAt: null,
    };
    await this.repository.saveSession(session);
    return session;
  }
  async resolveSession(id: string): Promise<PortalSession | null> {
    if (this.repository.resolveActiveSession)
      return this.repository.resolveActiveSession(id, this.now());
    const session = await this.repository.getSession(id);
    if (!session) return null;
    const now = this.now();
    if (session.absoluteExpiresAt <= now || session.lastSeenAt + DAY <= now) {
      await this.repository.deleteSession(id);
      return null;
    }
    if (session.accountId) {
      const account = await this.repository.getAccount(session.accountId);
      if (!account || account.status !== "active" || account.authVersion !== session.authVersion) {
        await this.repository.deleteSession(id);
        return null;
      }
    }
    session.lastSeenAt = now;
    if (!(await this.repository.touchSession(session))) return null;
    return session;
  }
  async getSessionDto(session: PortalSession) {
    const account = session.accountId ? await this.repository.getAccount(session.accountId) : null;
    return {
      account: account && account.status === "active" ? safeAccount(account) : null,
      subjects: account && account.status === "active" ? await this.listSubjects(account.id) : [],
      csrfToken: session.csrfToken,
    };
  }
  private async requireSession(
    id: string,
    reauthenticated = false,
  ): Promise<{ session: PortalSession; account: PortalAccount }> {
    const session = await this.resolveSession(id);
    if (!session?.accountId) throw new PortalError("portalAuthenticationRequired", 401);
    const account = await this.repository.getAccount(session.accountId);
    if (!account) throw new PortalError("portalAuthenticationRequired", 401);
    if (
      reauthenticated &&
      (!session.reauthenticatedAt || session.reauthenticatedAt + 10 * MINUTE <= this.now())
    )
      throw new PortalError("portalReauthenticationRequired", 403);
    return { session, account };
  }
  private async rotate(
    repository: PortalRepository,
    account: PortalAccount,
    oldId?: string,
  ): Promise<PortalSession> {
    if (oldId) await repository.deleteSession(oldId);
    const now = this.now();
    const session: PortalSession = {
      id: this.crypto.randomToken(),
      accountId: account.id,
      authVersion: account.authVersion,
      createdAt: now,
      lastSeenAt: now,
      absoluteExpiresAt: now + 7 * DAY,
      csrfToken: this.crypto.randomToken(),
      reauthenticatedAt: now,
    };
    await repository.saveSession(session);
    return session;
  }
  private limitKey(prefix: string, value: string) {
    return `${prefix}:${this.crypto.hashToken(value.toLowerCase())}`;
  }
  async login(
    identifier: string,
    password: string,
    ip: string,
    oldId?: string,
    requestId?: string,
  ): Promise<PortalSession> {
    const normalized = identifier.trim().toLowerCase();
    const account = await this.repository.findAccount(normalized);
    const keys = [
      this.limitKey("login-ip", ip),
      this.limitKey("login-account", account ? `account-${account.id}` : normalized),
    ];
    const now = this.now();
    for (let index = 0; index < keys.length; index++) {
      const retry = await this.repository.rateLimit(keys[index], index ? 5 : 30, 15 * MINUTE, now);
      if (retry !== null) throw new PortalError("portalTooManyRequests", 429, retry);
    }
    const passwordWithinLimit = Buffer.byteLength(password, "utf8") <= 72;
    const valid = await this.crypto.verifyPassword(
      passwordWithinLimit ? password : "",
      account?.passwordHash ?? null,
    );
    if (!valid || !passwordWithinLimit || account?.status !== "active")
      throw new PortalError("portalInvalidCredentials", 401);
    for (const key of keys) await this.repository.releaseRateLimit(key, now);
    return this.repository.transaction(async (repository) => {
      const current = await repository.getAccount(account.id, true);
      if (!current || current.status !== "active" || current.authVersion !== account.authVersion)
        throw new PortalError("portalInvalidCredentials", 401);
      const session = await this.rotate(repository, current, oldId);
      await repository.audit({
        actorKind: "portal",
        accountId: account.id,
        staffId: null,
        studentId: null,
        action: "LOGIN",
        requestId,
        details: {},
      });
      return session;
    });
  }
  async logout(id: string) {
    await this.repository.deleteSession(id);
  }
  private async effectivePermissions(
    repository: PortalRepository,
    link: NonNullable<PortalActorSnapshot["link"]>,
    student: NonNullable<PortalActorSnapshot["student"]>,
    snapshotConsents?: PortalActorSnapshot["consents"],
  ): Promise<PortalPermission[]> {
    if (
      link.status !== "active" ||
      !link.verifiedAt ||
      (link.expiresAt !== null && link.expiresAt <= this.now())
    )
      return [];
    if (link.kind === "self")
      return selfPermissions(student.classification);
    if (student.classification === "unverified") return [];
    if (student.classification === "adult") {
      const consents = snapshotConsents ?? await repository.getConsents(link.id);
      const consent = consents.find(
        (record) =>
          !record.revokedAt &&
          (record.method === "in_person" || record.method === "portal") &&
          link.permissions.every((permission) => record.permissions.includes(permission)),
      );
      if (!consent) return [];
    }
    return link.permissions.filter(
      (permission) =>
        !["assignments.submit", "quizzes.attempt", "portfolio.edit"].includes(permission) &&
        (permission !== "child_credentials.manage" || student.classification === "minor"),
    );
  }
  async listSubjects(accountId: number): Promise<PortalSubjectDto[]> {
    const account = await this.repository.getAccount(accountId);
    if (!account || account.status !== "active") return [];
    const links = await this.repository.listLinks({ accountId });
    const subjects: PortalSubjectDto[] = [];
    for (const link of links) {
      const student = await this.repository.getStudent(link.studentId);
      if (!student) continue;
      const permissions = await this.effectivePermissions(this.repository, link, student);
      if (!permissions.length) continue;
      subjects.push({
        linkId: link.id,
        studentId: student.id,
        studentName: student.studentName,
        kind: link.kind,
        relationship: link.relationship,
        permissions,
        status: "active",
        studentClassification: student.classification,
      });
    }
    return subjects;
  }
  async resolveActor(
    sessionId: string,
    linkId: number,
    permission?: PortalPermission,
  ): Promise<PortalActorContext> {
    const { account } = await this.requireSession(sessionId);
    return this.resolveAccountActor(account.id, linkId, permission, sessionId);
  }
  async resolveAccountActor(
    accountId: number,
    linkId: number,
    permission?: PortalPermission,
    sessionId = "",
  ): Promise<PortalActorContext> {
    const snapshot = this.repository.readActorSnapshot
      ? await this.repository.readActorSnapshot(accountId, linkId)
      : null;
    const account = snapshot ? snapshot.account : await this.repository.getAccount(accountId);
    if (!account || account.status !== "active")
      throw new PortalError("portalAuthenticationRequired", 401);
    const link = snapshot ? snapshot.link : await this.repository.getLink(linkId);
    if (!link || link.accountId !== account.id) throw new PortalError("portalAccessDenied", 403);
    const student = snapshot ? snapshot.student : await this.repository.getStudent(link.studentId);
    const permissions = student
      ? await this.effectivePermissions(this.repository, link, student, snapshot?.consents)
      : [];
    if (!student || !permissions.length) throw new PortalError("portalAccessDenied", 403);
    const actor: PortalActorContext = {
      portalAccountId: account.id,
      sessionId,
      linkId,
      studentId: link.studentId,
      kind: link.kind,
      permissions,
      studentClassification: student.classification,
    };
    if (permission) assertPortalPermission(actor, permission);
    return actor;
  }
  private async staffStudent(
    repository: PortalRepository,
    actor: PortalStaffActor,
    studentId: number,
    lock = false,
  ) {
    const student = await repository.getStudent(studentId, lock);
    if (!student) throw new PortalError("portalStudentNotFound", 404);
    assertStaffStudentAccess(actor, student.managerId);
    return student;
  }
  async lookupAccount(actor: PortalStaffActor, studentId: number, login: string) {
    await this.staffStudent(this.repository, actor, studentId);
    const account = await this.repository.findAccount(login.trim().toLowerCase());
    if (!account || ["archived", "suspended"].includes(account.status)) return null;
    return {
      id: account.id,
      login: account.login,
      fullName: account.fullName,
      status: account.status,
    };
  }
  async checkContacts(actor: PortalStaffActor, studentId: number, contact: { email?: string | null; phone?: string | null }) {
    await this.staffStudent(this.repository, actor, studentId);
    const email = contact.email?.trim().toLowerCase() || null;
    const digits = contact.phone?.replace(/\D/g, "") ?? "";
    const phone = digits.length >= 7 && digits.length <= 15 ? digits : null;
    if (!email && !phone) return { items: [], additionalMatches: false };
    return this.repository.findContactMatches({ email, phone }, { staffId: actor.staffId, administration: actor.modules.includes("administration") });
  }
  async getStudentAccess(
    actor: PortalStaffActor,
    studentId: number,
  ): Promise<PortalStudentAccessDto> {
    const student = await this.staffStudent(this.repository, actor, studentId);
    const links = await this.repository.listLinks({ studentId });
    const results: PortalStudentAccessDto["links"] = [];
    for (const link of links) {
      const account = await this.repository.getAccount(link.accountId);
      if (!account) continue;
      const invitation = (await this.repository.listInvitations(link.id)).sort(
        (a, b) => b.id - a.id,
      )[0];
      results.push({
        id: link.id,
        account: safeAccount(account),
        kind: link.kind,
        relationship: link.relationship,
        permissions: link.permissions,
        status: link.status,
        verifiedAt: link.verifiedAt ? new Date(link.verifiedAt).toISOString() : null,
        invitation: invitation
          ? {
              id: invitation.id,
              status:
                invitation.expiresAt <= this.now() &&
                ["created", "sent", "delivery_failed"].includes(invitation.status)
                  ? "expired"
                  : invitation.status,
              expiresAt: new Date(invitation.expiresAt).toISOString(),
              channel: invitation.channel,
            }
          : null,
      });
    }
    return {
      studentId,
      studentName: student.studentName,
      classification: student.classification,
      links: results,
    };
  }
  async classifyStudent(
    actor: PortalStaffActor,
    studentId: number,
    classification: PortalClassification,
    method: string,
    birthDate: string | null,
  ) {
    if (
      birthDate &&
      birthDate >
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Tashkent",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(this.now()))
    )
      throw new PortalError("portalBirthDateInvalid");
    await this.repository.transaction(async (repository) => {
      const student = await this.staffStudent(repository, actor, studentId, true);
      await repository.updateStudentIdentity(
        studentId,
        classification,
        birthDate,
        actor.staffId,
        method,
      );
      if (student.classification !== classification) {
        for (const link of await repository.listLinks({ studentId })) {
          if (link.kind === "self" && link.status !== "revoked")
            await repository.updateLink(link.id, {
              permissions: selfPermissions(
                classification,
              ),
            });
          if (link.kind === "representative" && link.status !== "revoked") {
            await repository.updateLink(link.id, { status: "suspended" });
            await repository.revokeConsents(link.id, this.now());
            await repository.revokeInvitations({ linkId: link.id }, this.now());
          }
        }
      }
      await repository.audit({
        actorKind: "staff",
        staffId: actor.staffId,
        accountId: null,
        studentId,
        action: "CLASSIFICATION_VERIFIED",
        requestId: actor.requestId,
        details: { classification, method },
      });
    });
    return this.getStudentAccess(actor, studentId);
  }
  async createInvitation(
    actor: PortalStaffActor,
    studentId: number,
    command: PortalInvitationCreateCommand,
  ): Promise<PortalInvitationResultDto> {
    if (!this.options.allowInvitations) throw new PortalError("portalInvitationsDisabled", 403);
    const token = this.crypto.randomToken();
    const now = this.now();
    return this.repository.transaction(async (repository) => {
      const student = await this.staffStudent(repository, actor, studentId, true);
      if (!(await this.invitationsEnabled(studentId, repository)))
        throw new PortalError("portalInvitationsDisabled", 403);
      const replay = await repository.getInvitationByKey(command.idempotencyKey);
      if (replay) {
        const replayLink = await repository.getLink(replay.linkId);
        if (
          replay.createdBy !== actor.staffId ||
          replayLink?.studentId !== studentId ||
          replay.requestHash !== this.crypto.hashToken(JSON.stringify(command))
        )
          throw new PortalError("portalIdempotencyConflict", 409);
        return {
          invitationId: replay.id,
          accountId: replay.accountId,
          linkId: replay.linkId,
          expiresAt: new Date(replay.expiresAt).toISOString(),
          activationUrl: null,
          status: replay.status === "sent" ? "sent" : "created",
          replayed: true,
        };
      }
      if (command.kind === "representative") {
        if (!command.relationship || student.classification === "unverified")
          throw new PortalError("portalRelationshipVerificationRequired");
        validateRepresentativePermissions(command.permissions, student.classification);
        if (!command.permissions.length) throw new PortalError("portalPermissionsRequired");
      }
      let account: PortalAccount | null = null;
      if (command.accountId) account = await repository.getAccount(command.accountId, true);
      else if (command.account) {
        if (await repository.findAccount(command.account.login))
          throw new PortalError("portalLoginUnavailable", 409);
        if (command.account.email && (await repository.findAccount(command.account.email)))
          throw new PortalError("portalEmailUnavailable", 409);
        account = await repository.createAccount({
          ...command.account,
          email: command.account.email ?? null,
          phone: command.account.phone ?? null,
          status: "pending",
          passwordHash: null,
          authVersion: 1,
        });
      }
      if (!account || ["suspended", "archived"].includes(account.status))
        throw new PortalError("portalAccountUnavailable", 409);
      const links = await repository.listLinks({ studentId });
      let link = links.find((item) => item.accountId === account!.id && item.status !== "revoked");
      if (link && (link.kind !== command.kind || link.status === "active"))
        throw new PortalError("portalLinkAlreadyExists", 409);
      if (command.kind === "self") {
        if (
          links.some(
            (item) =>
              item.kind === "self" && item.status !== "revoked" && item.accountId !== account!.id,
          ) ||
          (await repository.listLinks({ accountId: account.id })).some(
            (item) =>
              item.kind === "self" && item.status !== "revoked" && item.studentId !== studentId,
          )
        )
          throw new PortalError("portalSelfLinkAlreadyExists", 409);
      }
      const permissions =
        command.kind === "self"
          ? selfPermissions(student.classification)
          : [...new Set(command.permissions)];
      const fields = {
        accountId: account.id,
        studentId,
        kind: command.kind,
        relationship: command.kind === "self" ? null : (command.relationship ?? null),
        permissions,
        status: "pending" as const,
        verifiedAt: now,
        verifiedBy: actor.staffId,
        expiresAt: null,
      };
      link = link
        ? await repository.updateLink(link.id, fields)
        : await repository.createLink(fields);
      await repository.revokeConsents(link.id, now);
      if (
        command.kind === "representative" &&
        student.classification === "adult" &&
        command.adultConsent?.confirmed &&
        command.adultConsent.method === "in_person"
      ) {
        await repository.createConsent({
          linkId: link.id,
          permissions,
          subjectAccountId: null,
          staffId: actor.staffId,
          method: "in_person",
          revokedAt: null,
          createdAt: now,
        });
      }
      if (command.kind === "representative" && student.classification === "minor")
        await repository.createConsent({
          linkId: link.id,
          permissions,
          subjectAccountId: null,
          staffId: actor.staffId,
          method: "staff_verification",
          revokedAt: null,
          createdAt: now,
        });
      await repository.revokeInvitations({ linkId: link.id }, now);
      const invitation = await repository.createInvitation({
        accountId: account.id,
        linkId: link.id,
        tokenHash: this.crypto.hashToken(token),
        expiresAt: now + 72 * HOUR,
        status: "created",
        channel: command.channel,
        createdBy: actor.staffId,
        idempotencyKey: command.idempotencyKey,
        requestHash: this.crypto.hashToken(JSON.stringify(command)),
        acceptedAt: null,
        acceptedAccountId: null,
      });
      const activationUrl = `${this.options.appUrl.replace(/\/$/, "")}/activate#token=${encodeURIComponent(token)}`;
      await repository.audit({
        actorKind: "staff",
        staffId: actor.staffId,
        accountId: null,
        studentId,
        action: "INVITATION_CREATED",
        requestId: actor.requestId,
        details: {
          linkId: link.id,
          accountId: account.id,
          permissions,
          verificationMethod: command.verificationMethod,
          verificationBasis: command.verificationBasis,
        },
      });
      return {
        invitationId: invitation.id,
        accountId: account.id,
        linkId: link.id,
        expiresAt: new Date(invitation.expiresAt).toISOString(),
        activationUrl,
        status: "created",
        replayed: false,
      };
    });
  }
  async acceptInvitation(
    token: string,
    password: string | undefined,
    fullName: string | undefined,
    currentSession: PortalSession | null,
    requestId?: string,
  ) {
    return this.repository.transaction(async (repository) => {
      const candidate = await repository.getInvitationByHash(this.crypto.hashToken(token));
      const candidateLink = candidate ? await repository.getLink(candidate.linkId) : null;
      if (!candidate || !candidateLink) throw new PortalError("portalInvitationInvalid", 400);
      const student = await repository.getStudent(candidateLink.studentId, true);
      const account = await repository.getAccount(candidate.accountId, true);
      const link = await repository.getLink(candidate.linkId, true);
      const invitation = await repository.getInvitationByHash(this.crypto.hashToken(token), true);
      if (
        !invitation ||
        invitation.expiresAt <= this.now() ||
        !["created", "sent", "delivery_failed"].includes(invitation.status)
      )
        throw new PortalError("portalInvitationInvalid", 400);
      if (!account || !link || !student || link.status !== "pending")
        throw new PortalError("portalInvitationInvalid", 400);
      if (currentSession?.accountId && currentSession.accountId !== account.id)
        throw new PortalError("portalInvitationAccountMismatch", 403);
      if (account.status === "active") {
        if (
          currentSession?.accountId !== account.id ||
          currentSession.authVersion !== account.authVersion
        )
          throw new PortalError("portalExistingAccountLoginRequired", 401);
      } else if (account.status === "pending") {
        if (!password || !portalPasswordSchema.safeParse(password).success)
          throw new PortalError("portalPasswordInvalid");
      } else throw new PortalError("portalInvitationInvalid", 400);
      let current = account;
      if (account.status === "pending")
        current = await repository.updateAccount(account.id, {
          status: "active",
          passwordHash: await this.crypto.hashPassword(password!),
          fullName: fullName ?? account.fullName,
        });
      const consented =
        link.kind === "self" ||
        student.classification === "minor" ||
        (await repository.getConsents(link.id)).some(
          (consent) =>
            !consent.revokedAt &&
            (consent.method === "in_person" || consent.method === "portal") &&
            link.permissions.every((permission) => consent.permissions.includes(permission)),
        );
      await repository.updateLink(link.id, {
        status: consented ? "active" : "suspended",
      });
      await repository.updateInvitation(invitation.id, {
        status: "accepted",
        acceptedAt: this.now(),
        acceptedAccountId: account.id,
      });
      await repository.audit({
        actorKind: "portal",
        accountId: account.id,
        staffId: null,
        studentId: link.studentId,
        action: "INVITATION_ACCEPTED",
        requestId,
        details: { linkId: link.id },
      });
      return this.rotate(repository, current, currentSession?.id);
    });
  }
  private async resetAccount(
    repository: PortalRepository,
    account: PortalAccount,
    password: string,
  ) {
    const updated = await repository.updateAccount(account.id, {
      passwordHash: await this.crypto.hashPassword(password),
      authVersion: account.authVersion + 1,
      status: "active",
    });
    await repository.revokeSessions(account.id);

    await repository.revokeInvitations({ accountId: account.id }, this.now());
    return updated;
  }
  updateProfile(
    sessionId: string,
    changes: { fullName?: string; phone?: string | null; locale?: "ru" | "en" },
  ) {
    return this.profile.updateProfile(sessionId, changes);
  }
  private async verifySensitivePassword(account: PortalAccount, password: string) {
    const key = this.limitKey("login-account", `account-${account.id}`);
    const now = this.now();
    const retry = await this.repository.rateLimit(key, 5, 15 * MINUTE, now);
    if (retry !== null) throw new PortalError("portalTooManyRequests", 429, retry);
    if (
      Buffer.byteLength(password, "utf8") > 72 ||
      !(await this.crypto.verifyPassword(password, account.passwordHash))
    )
      throw new PortalError("portalInvalidCredentials", 401);
    await this.repository.releaseRateLimit(key, now);
  }
  async reauthenticate(sessionId: string, password: string) {
    const { session, account } = await this.requireSession(sessionId);
    await this.verifySensitivePassword(account, password);
    session.reauthenticatedAt = this.now();
    if (!(await this.repository.touchSession(session)))
      throw new PortalError("portalAuthenticationRequired", 401);
  }
  async changePassword(sessionId: string, password: string, newPassword: string, requestId?: string) {
    const { account } = await this.requireSession(sessionId);
    await this.verifySensitivePassword(account, password);
    return this.repository.transaction(async (repository) => {
      const current = await repository.getAccount(account.id, true);
      if (!current || current.authVersion !== account.authVersion)
        throw new PortalError("portalAuthenticationRequired", 401);
      const updated = await this.resetAccount(repository, current, newPassword);
      await repository.audit({
        actorKind: "portal",
        accountId: account.id,
        staffId: null,
        studentId: null,
        action: "PASSWORD_CHANGED",
        requestId,
        details: {},
      });
      return this.rotate(repository, updated);
    });
  }
  getSessions(sessionId: string) {
    return this.profile.getSessions(sessionId);
  }
  revokeSessions(sessionId: string, targetId?: string) {
    return this.profile.revokeSessions(sessionId, targetId);
  }
  async childCredentials(sessionId: string, linkId: number, password: string, login?: string, requestId?: string) {
    const authenticated = await this.requireSession(sessionId, true);
    const actor = await this.resolveActor(sessionId, linkId, "child_credentials.manage");
    if (actor.kind !== "representative" || actor.studentClassification !== "minor")
      throw new PortalError("portalAccessDenied", 403);
    await this.repository.transaction(async (repository) => {
      const student = await repository.getStudent(actor.studentId, true);
      const link = await repository.getLink(linkId, true);
      await requireCurrentPortalSession(repository, authenticated, this.now(), true);
      if (
        !link ||
        !student ||
        student.classification !== "minor" ||
        !(await this.effectivePermissions(repository, link, student)).includes(
          "child_credentials.manage",
        )
      )
        throw new PortalError("portalAccessDenied", 403);
      let self = (await repository.listLinks({ studentId: student.id })).find(
        (item) => item.kind === "self" && item.status !== "revoked",
      );
      let account = self ? await repository.getAccount(self.accountId, true) : null;
      if (
        login &&
        (await repository.findAccount(login))?.id !== account?.id &&
        (await repository.findAccount(login))
      )
        throw new PortalError("portalLoginUnavailable", 409);
      if (!account) {
        if (!(await this.invitationsEnabled(student.id, repository)))
          throw new PortalError("portalInvitationsDisabled", 403);
        if (!login) throw new PortalError("portalLoginRequired");
        account = await repository.createAccount({
          login,
          fullName: student.studentName,
          email: null,
          phone: null,
          locale: "ru",
          status: "pending",
          passwordHash: null,
          authVersion: 1,
        });
      }
      if (["suspended", "archived"].includes(account.status))
        throw new PortalError("portalAccountUnavailable", 409);
      await this.resetAccount(repository, account, password);
      if (login) await repository.updateAccount(account.id, { login });
      if (!self)
        self = await repository.createLink({
          accountId: account.id,
          studentId: student.id,
          kind: "self",
          relationship: null,
          permissions: selfPermissions("minor"),
          status: "active",
          verifiedAt: this.now(),
          verifiedBy: null,
          expiresAt: null,
        });
      else
        await repository.updateLink(self.id, {
          status: "active",
          verifiedAt: this.now(),
        });
      await repository.audit({
        actorKind: "portal",
        accountId: actor.portalAccountId,
        staffId: null,
        studentId: student.id,
        action: "CHILD_CREDENTIALS_RESET",
        requestId,
        details: { subjectAccountId: account.id },
      });
    });
  }
  async staffReset(
    actor: PortalStaffActor,
    studentId: number,
    accountId: number,
    password: string,
    method: string,
    basis: string,
  ) {
    await this.repository.transaction(async (repository) => {
      const student = await this.staffStudent(repository, actor, studentId, true);
      const link = (await repository.listLinks({ studentId })).find(
        (item) => item.accountId === accountId && item.status !== "revoked",
      );
      const account = await repository.getAccount(accountId, true);
      if (!link || !account || ["archived", "suspended"].includes(account.status))
        throw new PortalError("portalAccountUnavailable", 409);
      if (account.status === "pending" && !(await this.invitationsEnabled(studentId, repository)))
        throw new PortalError("portalInvitationsDisabled", 403);
      await this.resetAccount(repository, account, password);
      if (account.status === "pending" && link.status === "pending") {
        const consented =
          link.kind === "self" ||
          student.classification === "minor" ||
          (await repository.getConsents(link.id)).some(
            (consent) =>
              !consent.revokedAt &&
              (consent.method === "in_person" || consent.method === "portal") &&
              link.permissions.every((permission) => consent.permissions.includes(permission)),
          );
        await repository.updateLink(link.id, {
          status: consented ? "active" : "suspended",
        });
      }
      await repository.audit({
        actorKind: "staff",
        staffId: actor.staffId,
        accountId: null,
        studentId,
        action: "STAFF_CREDENTIALS_RESET",
        requestId: actor.requestId,
        details: {
          subjectAccountId: accountId,
          verificationMethod: method,
          verificationBasis: basis,
        },
      });
    });
  }
  async setAccountStatus(
    actor: PortalStaffActor,
    studentId: number,
    accountId: number,
    status: "active" | "suspended",
  ) {
    if (!actor.modules.includes("administration")) throw new PortalError("portalAccessDenied", 403);
    await this.repository.transaction(async (repository) => {
      await this.staffStudent(repository, actor, studentId, true);
      if (!(await repository.listLinks({ studentId })).some((link) => link.accountId === accountId))
        throw new PortalError("portalAccountUnavailable", 404);
      const account = await repository.getAccount(accountId, true);
      if (!account || account.status === "archived")
        throw new PortalError("portalAccountUnavailable", 409);
      await repository.updateAccount(accountId, {
        status: status === "active" && !account.passwordHash ? "pending" : status,
        authVersion: account.authVersion + 1,
      });
      await repository.revokeSessions(accountId);

      await repository.revokeInvitations({ accountId }, this.now());
      await repository.audit({
        actorKind: "staff",
        staffId: actor.staffId,
        accountId: null,
        studentId,
        action: status === "suspended" ? "ACCOUNT_SUSPENDED" : "ACCOUNT_RESUMED",
        requestId: actor.requestId,
        details: { subjectAccountId: accountId },
      });
    });
  }
  async revokeLink(actor: PortalStaffActor, studentId: number, linkId: number) {
    await this.repository.transaction(async (repository) => {
      await this.staffStudent(repository, actor, studentId, true);
      const link = await repository.getLink(linkId, true);
      if (!link || link.studentId !== studentId) throw new PortalError("portalLinkNotFound", 404);
      await repository.updateLink(link.id, { status: "revoked" });
      await repository.revokeConsents(link.id, this.now());
      await repository.revokeInvitations({ linkId }, this.now());
      await repository.audit({
        actorKind: "staff",
        staffId: actor.staffId,
        accountId: null,
        studentId,
        action: "LINK_REVOKED",
        requestId: actor.requestId,
        details: { linkId },
      });
    });
  }
  async updatePermissions(
    actor: PortalStaffActor,
    studentId: number,
    linkId: number,
    permissions: PortalPermission[],
    method: string,
    basis: string,
    adultConsent: boolean,
  ) {
    await this.repository.transaction(async (repository) => {
      const student = await this.staffStudent(repository, actor, studentId, true);
      const link = await repository.getLink(linkId, true);
      if (
        !link ||
        link.studentId !== studentId ||
        link.kind !== "representative" ||
        link.status === "revoked"
      )
        throw new PortalError("portalLinkNotFound", 404);
      validateRepresentativePermissions(permissions, student.classification);
      if (!permissions.length || student.classification === "unverified")
        throw new PortalError("portalPermissionsRequired");
      await repository.revokeConsents(linkId, this.now());
      if (student.classification === "minor" || adultConsent)
        await repository.createConsent({
          linkId,
          permissions,
          subjectAccountId: null,
          staffId: actor.staffId,
          method: student.classification === "minor" ? "staff_verification" : "in_person",
          revokedAt: null,
          createdAt: this.now(),
        });
      const account = await repository.getAccount(link.accountId);
      await repository.updateLink(linkId, {
        permissions: [...new Set(permissions)],
        status:
          account?.status === "active" && (student.classification === "minor" || adultConsent)
            ? "active"
            : "suspended",
        verifiedAt: this.now(),
        verifiedBy: actor.staffId,
      });
      await repository.audit({
        actorKind: "staff",
        staffId: actor.staffId,
        accountId: null,
        studentId,
        action: "LINK_PERMISSIONS_CHANGED",
        requestId: actor.requestId,
        details: {
          linkId,
          permissions,
          verificationMethod: method,
          verificationBasis: basis,
        },
      });
    });
  }
  ownRepresentatives(sessionId: string) {
    return this.profile.ownRepresentatives(sessionId);
  }
  representativeConsent(
    sessionId: string,
    linkId: number,
    permissions: PortalPermission[],
    approved: boolean,
    requestId?: string,
  ) {
    return this.profile.representativeConsent(sessionId, linkId, permissions, approved, requestId);
  }
}
