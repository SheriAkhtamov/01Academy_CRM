import crypto from "node:crypto";
import bcrypt from "bcrypt";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import {
  portalClassificationCommandSchema,
  portalInvitationCreateSchema,
  portalLoginSchema,
  portalPasswordSchema,
} from "@shared/contracts/portal-identity";
import { PortalIdentityService } from "../server/modules/portal-identity/application/identity-service";
import {
  createPortalCrypto,
  decryptPortalMail,
} from "../server/modules/portal-identity/infrastructure/crypto";
import { createPortalIdentityRouter } from "../server/modules/portal-identity/http/portal-router";
import { createPortalAccessRouter } from "../server/modules/portal-identity/http/staff-access-router";
import {
  createPortalSessionMiddleware,
  portalCsrfProtection,
} from "../server/infrastructure/portal-session";
import { MemoryPortalRepository } from "./portal-identity-memory";
import { requestContextMiddleware } from "../server/middleware/errorHandler";
import type {
  PortalInvitationCreateCommand,
  PortalPermission,
} from "@shared/contracts/portal-identity";

const key = crypto.randomBytes(32).toString("base64");
const staff = { staffId: 1, modules: ["sales"], canManageAccess: true };
const password = "ValidPassword123!";
let now = Date.now();
let repository: MemoryPortalRepository;
let service: PortalIdentityService;
const command = (
  login: string,
  kind: "self" | "representative" = "self",
  permissions: PortalPermission[] = [],
): PortalInvitationCreateCommand =>
  portalInvitationCreateSchema.parse({
    account: { login, fullName: login, phone: "+998900000000" },
    kind,
    relationship: kind === "representative" ? "parent" : null,
    permissions,
    verificationMethod: "in_person",
    verificationBasis: "Verified directly with recipient",
    channel: "manual",
    idempotencyKey: crypto.randomUUID(),
  });
const tokenFrom = (url: string | null) =>
  new URLSearchParams(new URL(url!).hash.slice(1)).get("token")!;
const invite = async (
  login: string,
  studentId = 1,
  kind: "self" | "representative" = "self",
  permissions: PortalPermission[] = [],
) => {
  const result = await service.createInvitation(
    staff,
    studentId,
    command(login, kind, permissions),
  );
  const session = await service.acceptInvitation(
    tokenFrom(result.activationUrl),
    password,
    undefined,
    null,
  );
  return { result, session };
};
const app = () => {
  const server = express();
  server.use(requestContextMiddleware);
  server.use(express.json());
  server.use(
    "/api/portal",
    createPortalSessionMiddleware({
      secret: "isolated-portal-secret-for-unit-tests-12345",
      secure: false,
      service,
    }),
    portalCsrfProtection,
    createPortalIdentityRouter({ service }),
  );
  server.use(
    "/api/academy/students/:studentId/portal-access",
    createPortalAccessRouter({ service, resolveStaffActor: () => staff }),
  );
  return server;
};

beforeEach(() => {
  now = Date.now();
  repository = new MemoryPortalRepository();
  repository.students.set(1, {
    id: 1,
    studentName: "Adult Student",
    managerId: 1,
    classification: "adult",
    verifiedBirthDate: null,
  });
  repository.students.set(2, {
    id: 2,
    studentName: "Child One",
    managerId: 1,
    classification: "minor",
    verifiedBirthDate: null,
  });
  repository.students.set(3, {
    id: 3,
    studentName: "Child Two",
    managerId: 2,
    classification: "minor",
    verifiedBirthDate: null,
  });
  const codec = createPortalCrypto(key);
  service = new PortalIdentityService(
    repository,
    { ...codec, hashPassword: (value) => bcrypt.hash(value, 1) },
    {
      appUrl: "https://academy.example",
      emailEnabled: true,
      allowInvitations: true,
      now: () => now,
    },
  );
});

describe("portal identity security and explicit relationships", () => {
  it("enforces distinct normalized logins and bcrypt byte limits", () => {
    expect(portalLoginSchema.parse("  Adult.Student  ")).toBe("adult.student");
    expect(portalLoginSchema.safeParse("family@example.com").success).toBe(
      false,
    );
    expect(portalPasswordSchema.safeParse("😀".repeat(19)).success).toBe(false);
    expect(portalPasswordSchema.safeParse(password).success).toBe(true);
  });
  it("gives an adult a self context without creating any representative", async () => {
    const { session } = await invite("adult.student");
    const subjects = await service.listSubjects(session.accountId!);
    expect(subjects).toHaveLength(1);
    expect(subjects[0].kind).toBe("self");
    expect(subjects[0].permissions).toContain("assignments.submit");
    expect(subjects[0].permissions).toContain("finance.read");
    expect((await service.getSessionDto(session)).account).not.toHaveProperty(
      "passwordHash",
    );
    expect(repository.links.size).toBe(1);
  });
  it("allows repeated family phones with independent parent and child logins", async () => {
    const { session: child } = await invite("child.login", 2);
    const { session: parent } = await invite(
      "parent.login",
      2,
      "representative",
      ["learning.read", "finance.read"],
    );
    expect(child.accountId).not.toBe(parent.accountId);
    expect(
      (
        await service.resolveActor(
          parent.id,
          (await service.listSubjects(parent.accountId!))[0].linkId,
        )
      ).permissions,
    ).not.toContain("assignments.submit");
    expect(
      (await service.listSubjects(child.accountId!))[0].permissions,
    ).not.toContain("finance.read");
    expect(
      [...repository.accounts.values()].every(
        (account) => account.phone === "+998900000000",
      ),
    ).toBe(true);
  });
  it("shares one parent account across children only through new independently verified links", async () => {
    const { session } = await invite("parent.login", 2, "representative", [
      "attendance.read",
    ]);
    const result = await service.createInvitation(
      { ...staff, modules: ["administration"] },
      3,
      portalInvitationCreateSchema.parse({
        ...command("unused", "representative", ["finance.read"]),
        account: undefined,
        accountId: session.accountId,
      }),
    );
    const accepted = await service.acceptInvitation(
      tokenFrom(result.activationUrl),
      undefined,
      undefined,
      session,
    );
    expect(
      (await service.listSubjects(accepted.accountId!)).map(
        (subject) => subject.studentId,
      ),
    ).toEqual([2, 3]);
    await expect(
      service.resolveActor(accepted.id, result.linkId, "learning.read"),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("denies representatives submission privileges at invitation and object policy", async () => {
    await expect(
      service.createInvitation(
        staff,
        2,
        command("parent.login", "representative", ["assignments.submit"]),
      ),
    ).rejects.toMatchObject({ code: "portalRepresentativeCannotSubmit" });
    const { result, session } = await invite(
      "payer.login",
      2,
      "representative",
      ["finance.read"],
    );
    await expect(
      service.resolveActor(session.id, result.linkId, "learning.read"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.resolveActor(session.id, result.linkId, "assignments.submit"),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("withholds adult representative data until the adult accepts the exact permissions", async () => {
    const { session: self } = await invite("adult.login");
    const { session: parent, result } = await invite(
      "relative.login",
      1,
      "representative",
      ["finance.read"],
    );
    expect(await service.listSubjects(parent.accountId!)).toEqual([]);
    await expect(
      service.representativeConsent(
        self.id,
        result.linkId,
        ["learning.read"],
        true,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await service.representativeConsent(
      self.id,
      result.linkId,
      ["finance.read"],
      true,
    );
    expect(
      (await service.listSubjects(parent.accountId!))[0].permissions,
    ).toEqual(["finance.read"]);
    await service.representativeConsent(
      self.id,
      result.linkId,
      ["finance.read"],
      false,
    );
    await expect(
      service.resolveActor(parent.id, result.linkId, "finance.read"),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("suspends prior parental permissions when minor status changes to adult", async () => {
    const { session, result } = await invite(
      "parent.login",
      2,
      "representative",
      ["learning.read"],
    );
    await service.classifyStudent(staff, 2, "adult", "in_person", null);
    await expect(
      service.resolveActor(session.id, result.linkId),
    ).rejects.toMatchObject({ status: 403 });
    expect(repository.links.get(result.linkId)?.status).toBe("suspended");
  });
  it("does not infer student identity or access from old age or contact information", async () => {
    repository.students.get(2)!.classification = "unverified";
    await expect(
      service.createInvitation(
        staff,
        2,
        command("parent.login", "representative", ["learning.read"]),
      ),
    ).rejects.toMatchObject({ code: "portalRelationshipVerificationRequired" });
    expect(repository.accounts.size).toBe(0);
  });
  it("validates confirmed birth dates without inferring adult status from legacy age", async () => {
    expect(
      portalClassificationCommandSchema.safeParse({
        classification: "minor",
        verificationMethod: "in_person",
        verifiedBirthDate: "2026-02-31",
      }).success,
    ).toBe(false);
    await expect(
      service.classifyStudent(staff, 2, "minor", "in_person", "2999-01-01"),
    ).rejects.toMatchObject({ code: "portalBirthDateInvalid" });
  });
  it("allows administrators to block all account sessions while managers can only revoke their own links", async () => {
    const { session, result } = await invite(
      "parent.login",
      2,
      "representative",
      ["learning.read"],
    );
    await expect(
      service.setAccountStatus(staff, 2, session.accountId!, "suspended"),
    ).rejects.toMatchObject({ status: 403 });
    await service.setAccountStatus(
      { ...staff, modules: ["administration"] },
      2,
      session.accountId!,
      "suspended",
    );
    expect(await service.resolveSession(session.id)).toBeNull();
    await expect(
      service.login("parent.login", password, "ip"),
    ).rejects.toMatchObject({ status: 401 });
    await service.setAccountStatus(
      { ...staff, modules: ["administration"] },
      2,
      session.accountId!,
      "active",
    );
    const resumed = await service.login("parent.login", password, "ip");
    expect(
      (await service.resolveActor(resumed.id, result.linkId)).studentId,
    ).toBe(2);
  });
  it("supports verified manual initial credentials without leaving a pending self link unusable", async () => {
    const invitation = await service.createInvitation(
      staff,
      1,
      command("adult.login"),
    );
    await service.staffReset(
      staff,
      1,
      invitation.accountId,
      password,
      "in_person",
      "Identity confirmed",
    );
    const session = await service.login("adult.login", password, "ip");
    expect((await service.listSubjects(session.accountId!))[0].kind).toBe(
      "self",
    );
    await expect(
      service.acceptInvitation(
        tokenFrom(invitation.activationUrl),
        password,
        undefined,
        null,
      ),
    ).rejects.toMatchObject({ code: "portalInvitationInvalid" });
  });
  it("restricts staff lookup and invitation commands to managed students", async () => {
    await expect(service.getStudentAccess(staff, 3)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      service.lookupAccount(staff, 3, "parent.login"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.createInvitation(
        { ...staff, canManageAccess: false },
        2,
        command("parent.login"),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("stores only token hashes, supports idempotency and consumes activation once", async () => {
    const cmd = command("adult.login");
    const result = await service.createInvitation(staff, 1, cmd);
    const token = tokenFrom(result.activationUrl);
    const replay = await service.createInvitation(staff, 1, cmd);
    expect(replay.invitationId).toBe(result.invitationId);
    expect(replay.activationUrl).toBeNull();
    expect(repository.invitations.size).toBe(1);
    expect(JSON.stringify([...repository.invitations.values()])).not.toContain(
      token,
    );
    await service.acceptInvitation(token, password, undefined, null);
    await expect(
      service.acceptInvitation(token, password, undefined, null),
    ).rejects.toMatchObject({ code: "portalInvitationInvalid" });
  });
  it("expires and revokes invitations without returning personal details", async () => {
    const cmd = command("adult.login");
    const first = await service.createInvitation(staff, 1, cmd);
    const second = await service.createInvitation(staff, 1, {
      ...cmd,
      account: undefined,
      accountId: first.accountId,
      idempotencyKey: crypto.randomUUID(),
    });
    await expect(
      service.acceptInvitation(
        tokenFrom(first.activationUrl),
        password,
        undefined,
        null,
      ),
    ).rejects.toMatchObject({ code: "portalInvitationInvalid" });
    now += 73 * 60 * 60 * 1000;
    await expect(
      service.acceptInvitation(
        tokenFrom(second.activationUrl),
        password,
        undefined,
        null,
      ),
    ).rejects.toMatchObject({ code: "portalInvitationInvalid" });
  });
  it("enforces runtime invitation and email cohorts before creating accounts or mail", async () => {
    const codec = createPortalCrypto(key);
    const gated = new PortalIdentityService(repository, codec, {
      appUrl: "https://academy.example",
      emailEnabled: true,
      allowInvitations: true,
      now: () => now,
      invitationsEnabledForStudent: async () => false,
      emailEnabledForAccount: async () => false,
    });
    await expect(
      gated.createInvitation(staff, 1, command("adult.login")),
    ).rejects.toMatchObject({ code: "portalInvitationsDisabled" });
    expect(repository.accounts.size).toBe(0);
    const { session } = await invite("adult.login");
    await repository.updateAccount(session.accountId!, {
      email: "adult@example.com",
      emailVerifiedAt: now,
    });
    await gated.requestRecovery("adult.login", "ip");
    expect(repository.mail).toHaveLength(0);
    await expect(
      gated.requestEmailChange(session.id, "new@example.com"),
    ).rejects.toMatchObject({ code: "portalEmailUnavailable" });
    expect(repository.mail).toHaveLength(0);
  });
  it("requires the intended existing account to login before accepting another child", async () => {
    const { session } = await invite("parent.login", 2, "representative", [
      "learning.read",
    ]);
    const { session: other } = await invite("other.login");
    const result = await service.createInvitation(
      { ...staff, modules: ["administration"] },
      3,
      portalInvitationCreateSchema.parse({
        ...command("unused", "representative", ["learning.read"]),
        account: undefined,
        accountId: session.accountId,
      }),
    );
    await expect(
      service.acceptInvitation(
        tokenFrom(result.activationUrl),
        password,
        undefined,
        null,
      ),
    ).rejects.toMatchObject({ code: "portalExistingAccountLoginRequired" });
    await expect(
      service.acceptInvitation(
        tokenFrom(result.activationUrl),
        password,
        undefined,
        other,
      ),
    ).rejects.toMatchObject({ code: "portalInvitationAccountMismatch" });
  });
  it("rechecks object rights immediately after link revocation", async () => {
    const { session, result } = await invite("adult.login");
    await service.revokeLink(staff, 1, result.linkId);
    await expect(
      service.resolveActor(session.id, result.linkId),
    ).rejects.toMatchObject({ status: 403 });
    expect(await service.listSubjects(session.accountId!)).toEqual([]);
  });
  it("enforces shared failure limits and lets temporary limits expire", async () => {
    await invite("adult.login");
    for (let index = 0; index < 5; index++)
      await expect(
        service.login("adult.login", "bad", "127.0.0.1"),
      ).rejects.toMatchObject({ status: 401 });
    await expect(
      service.login("ADULT.LOGIN", password, "127.0.0.2"),
    ).rejects.toMatchObject({ status: 429, retryAfter: 900 });
    now += 16 * 60 * 1000;
    expect(
      (await service.login("adult.login", password, "127.0.0.2")).accountId,
    ).toBeTruthy();
  });
  it("shares account throttles across login and verified email aliases", async () => {
    const { session } = await invite("adult.login");
    await repository.updateAccount(session.accountId!, {
      email: "adult@example.com",
      emailVerifiedAt: now,
    });
    for (let index = 0; index < 5; index++)
      await expect(
        service.login(
          index % 2 ? "adult.login" : "adult@example.com",
          "bad",
          "ip",
        ),
      ).rejects.toMatchObject({ status: 401 });
    await expect(
      service.login("adult@example.com", password, "different-ip"),
    ).rejects.toMatchObject({ status: 429 });
  });
  it("rejects different invitation commands reusing an idempotency key", async () => {
    const cmd = command("adult.login");
    await service.createInvitation(staff, 1, cmd);
    await expect(
      service.createInvitation(staff, 1, {
        ...cmd,
        verificationBasis: "Different recipient evidence",
      }),
    ).rejects.toMatchObject({ code: "portalIdempotencyConflict", status: 409 });
  });
  it("uses verified email only for login and encrypted single-use recovery tokens", async () => {
    const { session } = await invite("adult.login");
    await repository.updateAccount(session.accountId!, {
      email: "adult@example.com",
      emailVerifiedAt: now,
    });
    expect(
      (await service.login(" Adult@Example.com ", password, "ip")).accountId,
    ).toBe(session.accountId);
    await service.requestRecovery("adult@example.com", "ip");
    const mail = repository.mail[0];
    const payload = decryptPortalMail(mail.encryptedPayload, key);
    expect(mail.encryptedPayload).not.toContain(String(payload.token));
    await service.completeRecovery(String(payload.token), "NewPassword123!");
    expect(await service.resolveSession(session.id)).toBeNull();
    await expect(
      service.completeRecovery(String(payload.token), "NewPassword123!"),
    ).rejects.toMatchObject({ code: "portalRecoveryInvalid" });
    expect(
      (await service.login("adult.login", "NewPassword123!", "ip")).accountId,
    ).toBe(session.accountId);
  });
  it("returns neutral recovery responses for unknown and unverified accounts", async () => {
    const { session } = await invite("adult.login");
    await repository.updateAccount(session.accountId!, {
      email: "adult@example.com",
    });
    await service.requestRecovery("adult.login", "ip");
    await service.requestRecovery("missing.login", "ip");
    expect(repository.mail).toHaveLength(0);
  });
  it("allows delegated credentials only for a verified minor, records the real actor, and never exposes passwords", async () => {
    const { session: parent, result } = await invite(
      "parent.login",
      2,
      "representative",
      ["child_credentials.manage"],
    );
    await service.childCredentials(
      parent.id,
      result.linkId,
      password,
      "child.login",
    );
    const child = [...repository.accounts.values()].find(
      (account) => account.login === "child.login",
    )!;
    expect(child.passwordHash).not.toBe(password);
    expect(await bcrypt.compare(password, child.passwordHash!)).toBe(true);
    expect(repository.audits.at(-1)).toMatchObject({
      accountId: parent.accountId,
      details: { subjectAccountId: child.id },
    });
    expect((await service.listSubjects(child.id))[0].kind).toBe("self");
    now += 11 * 60 * 1000;
    await expect(
      service.childCredentials(parent.id, result.linkId, password),
    ).rejects.toMatchObject({ code: "portalReauthenticationRequired" });
    await service.reauthenticate(parent.id, password);
    await service.childCredentials(
      parent.id,
      result.linkId,
      "ChangedPassword123!",
    );
    await service.classifyStudent(staff, 2, "adult", "verified", null);
    await expect(
      service.childCredentials(parent.id, result.linkId, password),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("rotates session identity after password changes and revokes old devices", async () => {
    const { session } = await invite("adult.login");
    const second = await service.login("adult.login", password, "ip");
    const rotated = await service.changePassword(
      session.id,
      password,
      "ChangedPassword123!",
    );
    expect(rotated.id).not.toBe(session.id);
    expect(await service.resolveSession(session.id)).toBeNull();
    expect(await service.resolveSession(second.id)).toBeNull();
    expect(await service.resolveSession(rotated.id)).not.toBeNull();
  });
  it("expires sessions after inactivity and absolute lifetime without resurrecting revoked sessions", async () => {
    const { session } = await invite("adult.login");
    now += 25 * 60 * 60 * 1000;
    expect(await service.resolveSession(session.id)).toBeNull();
    const again = await service.login("adult.login", password, "ip");
    for (let day = 0; day < 7; day++) {
      now += 23 * 60 * 60 * 1000;
      await service.resolveSession(again.id);
    }
    now += 8 * 60 * 60 * 1000;
    expect(await service.resolveSession(again.id)).toBeNull();
    expect(await repository.touchSession(again)).toBe(false);
  });
});

describe("portal HTTP isolation and CSRF", () => {
  it("correlates identity mutation audits with their HTTP request without retaining credentials or activation tokens", async () => {
    const server = app();
    const adult = request.agent(server);
    const activation = await service.createInvitation(staff, 1, command("trace.adult"));
    const expected = new Map<string, string>();
    const trace = (action: string) => { const id = crypto.randomUUID(); expected.set(action, id); return id; };
    const bootstrap = await adult.get("/api/portal/auth/session").expect(200);
    let response = await adult.post("/api/portal/auth/invitations/accept")
      .set("X-Portal-CSRF", bootstrap.body.csrfToken).set("X-Request-ID", trace("INVITATION_ACCEPTED"))
      .send({ token: tokenFrom(activation.activationUrl), password }).expect(200);
    let csrf = response.body.csrfToken as string;
    const changedPassword = "TraceChangedPassword123!";
    response = await adult.post("/api/portal/me/password")
      .set("X-Portal-CSRF", csrf).set("X-Request-ID", trace("PASSWORD_CHANGED"))
      .send({ password, newPassword: changedPassword }).expect(200);
    csrf = response.body.csrfToken;
    await adult.post("/api/portal/me/email").set("X-Portal-CSRF", csrf)
      .send({ email: "trace.updated@example.invalid" }).expect(200);
    const emailMail = [...repository.mail].reverse().find(mail => mail.template === "email_change")!;
    const emailToken = String(decryptPortalMail(emailMail.encryptedPayload, key).token);
    response = await adult.post("/api/portal/me/email/verify")
      .set("X-Portal-CSRF", csrf).set("X-Request-ID", trace("EMAIL_CHANGED"))
      .send({ token: emailToken }).expect(200);
    csrf = response.body.csrfToken;
    const relative = await invite("trace.relative", 1, "representative", ["finance.read"]);
    for (const approved of [true, false]) await adult.post("/api/portal/me/representatives/consent")
      .set("X-Portal-CSRF", csrf).set("X-Request-ID", trace(approved ? "CONSENT_GRANTED" : "CONSENT_REVOKED"))
      .send({ linkId: relative.result.linkId, permissions: ["finance.read"], approved }).expect(200);
    const recovery = request.agent(server);
    const recoveryBootstrap = await recovery.get("/api/portal/auth/session").expect(200);
    await recovery.post("/api/portal/auth/recovery/request").set("X-Portal-CSRF", recoveryBootstrap.body.csrfToken)
      .send({ identifier: "trace.adult" }).expect(200);
    const recoveryMail = [...repository.mail].reverse().find(mail => mail.template === "recovery")!;
    const recoveryToken = String(decryptPortalMail(recoveryMail.encryptedPayload, key).token);
    const recoveredPassword = "TraceRecoveredPassword123!";
    await recovery.post("/api/portal/auth/recovery/complete")
      .set("X-Portal-CSRF", recoveryBootstrap.body.csrfToken).set("X-Request-ID", trace("RECOVERY_COMPLETED"))
      .send({ token: recoveryToken, password: recoveredPassword }).expect(200);
    const parentFixture = await invite("trace.parent", 2, "representative", ["child_credentials.manage"]);
    const parent = request.agent(server);
    const parentBootstrap = await parent.get("/api/portal/auth/session").expect(200);
    const adultAgain = request.agent(server);
    const adultAgainBootstrap = await adultAgain.get("/api/portal/auth/session").expect(200);
    const parentLoginId = trace("LOGIN_PARENT");
    const adultLoginId = trace("LOGIN_ADULT");
    const [parentLogin] = await Promise.all([
      parent.post("/api/portal/auth/login").set("X-Portal-CSRF", parentBootstrap.body.csrfToken).set("X-Request-ID", parentLoginId)
        .send({ identifier: "trace.parent", password }).expect(200),
      adultAgain.post("/api/portal/auth/login").set("X-Portal-CSRF", adultAgainBootstrap.body.csrfToken).set("X-Request-ID", adultLoginId)
        .send({ identifier: "trace.adult", password: recoveredPassword }).expect(200),
    ]);
    await parent.post(`/api/portal/subjects/${parentFixture.result.linkId}/credentials`)
      .set("X-Portal-CSRF", parentLogin.body.csrfToken).set("X-Request-ID", trace("CHILD_CREDENTIALS_RESET"))
      .send({ login: "trace.child", password: changedPassword }).expect(200);
    for (const [action, requestId] of expected) {
      const entry = repository.audits.find(audit => audit.requestId === requestId);
      expect(entry).toMatchObject({ action: action.startsWith("LOGIN_") ? "LOGIN" : action, requestId });
      expect(entry!.details).not.toHaveProperty("requestId");
    }
    expect(repository.audits.find(audit => audit.requestId === parentLoginId)?.accountId).toBe(parentFixture.session.accountId);
    expect(repository.audits.find(audit => audit.requestId === adultLoginId)?.accountId).toBe(activation.accountId);
    const serialized = JSON.stringify(repository.audits);
    for (const secret of [password, changedPassword, recoveredPassword, tokenFrom(activation.activationUrl), emailToken, recoveryToken]) expect(serialized).not.toContain(secret);
  });
  it("requires anonymous CSRF bootstrap before login and maintains independent cookies", async () => {
    await invite("adult.login");
    const agent = request.agent(app());
    expect(
      (
        await agent
          .post("/api/portal/auth/login")
          .send({ identifier: "adult.login", password })
      ).status,
    ).toBe(403);
    const bootstrap = await agent.get("/api/portal/auth/session");
    expect(bootstrap.body.account).toBeNull();
    const login = await agent
      .post("/api/portal/auth/login")
      .set("X-Portal-CSRF", bootstrap.body.csrfToken)
      .send({ identifier: "adult.login", password });
    expect(login.status).toBe(200);
    expect(login.body.account.login).toBe("adult.login");
    expect(login.headers["set-cookie"][0]).toContain("academy.portal.sid=");
    expect(login.headers["set-cookie"][0]).not.toContain("academy.sid=");
    expect(
      (
        await agent
          .post("/api/portal/auth/logout")
          .set("X-Portal-CSRF", bootstrap.body.csrfToken)
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (
        await agent
          .post("/api/portal/auth/logout")
          .set("X-Portal-CSRF", login.body.csrfToken)
          .send({})
      ).status,
    ).toBe(200);
    expect(
      (await agent.get("/api/portal/auth/session")).body.account,
    ).toBeNull();
  });
  it("does not accept the staff cookie or forged portal cookie for authenticated endpoints", async () => {
    const server = app();
    expect(
      (
        await request(server)
          .get("/api/portal/me")
          .set("Cookie", "academy.sid=staff-session")
      ).status,
    ).toBe(401);
    expect(
      (
        await request(server)
          .get("/api/portal/me")
          .set(
            "Cookie",
            `academy.portal.sid=${"a".repeat(43)}.${"b".repeat(43)}`,
          )
      ).status,
    ).toBe(401);
  });
  it("hides portal routes when feature disabled and protects staff student scope", async () => {
    const server = express();
    server.use(
      "/api/portal",
      createPortalIdentityRouter({ service, enabled: false }),
    );
    expect((await request(server).get("/api/portal/auth/session")).status).toBe(
      404,
    );
    expect(
      (await request(app()).get("/api/academy/students/3/portal-access"))
        .status,
    ).toBe(403);
    const response = await request(app())
      .post("/api/academy/students/2/portal-access/invitations")
      .send(command("parent.login", "representative", ["learning.read"]));
    expect(response.status).toBe(201);
    expect(response.body.activationUrl).toContain("#token=");
  });
});
