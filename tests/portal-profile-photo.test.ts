import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  portalAccountSchema,
  portalAvatarUrlSchema,
  portalProfileUpdateSchema,
} from "@shared/contracts/portal-identity";
import { PortalIdentityService } from "../server/modules/portal-identity/application/identity-service";
import type { PortalAccount, PortalSession } from "../server/modules/portal-identity/application/ports";
import { createPortalCrypto } from "../server/modules/portal-identity/infrastructure/crypto";
import { MemoryPortalRepository } from "./portal-identity-memory";

const now = Date.UTC(2026, 9, 16);
const originalPhoto = "/api/portal/me/photos/AAAAAAAAAAAAAAAAAAAAA";
const newPhoto = "/api/portal/me/photos/aB0_-1234567890123456";
const account = (id: number): PortalAccount => ({
  id, login: `account${id}`, fullName: `Account ${id}`, email: null, phone: null,
  locale: "ru", status: "active", passwordHash: "private-password-hash", authVersion: 1,
  avatarUrl: originalPhoto,
});
const session: PortalSession = {
  id: "photo-session", accountId: 1, authVersion: 1, csrfToken: "private-csrf",
  createdAt: now, lastSeenAt: now, absoluteExpiresAt: now + 60_000, reauthenticatedAt: null,
};
let repository: MemoryPortalRepository;
let service: PortalIdentityService;

beforeEach(() => {
  repository = new MemoryPortalRepository();
  repository.accounts.set(1, account(1));
  repository.accounts.set(2, account(2));
  repository.sessions.set(session.id, { ...session });
  service = new PortalIdentityService(repository, createPortalCrypto(randomBytes(32).toString("base64")), {
    appUrl: "https://academy.example", allowInvitations: false, now: () => now,
  });
});

describe("portal profile photo contract", () => {
  it("accepts a private server-issued photo URL and keeps old accounts compatible", () => {
    expect(portalAvatarUrlSchema.parse(newPhoto)).toBe(newPhoto);
    expect(portalAccountSchema.parse(account(1)).avatarUrl).toBe(originalPhoto);
    expect(portalAccountSchema.parse({ ...account(1), avatarUrl: null }).avatarUrl).toBeNull();
    expect(portalAccountSchema.parse({ ...account(1), avatarUrl: undefined }).avatarUrl).toBeUndefined();
  });

  it.each([
    "https://example.com/photo.png", "//example.com/photo.png", "data:image/png;base64,YQ==",
    "/api/users/1/photo", "/api/portal/me/photos/../secret", `${originalPhoto}?token=x`,
    `${originalPhoto}#photo`, "/api/portal/me/photos/short", `${originalPhoto}/extra`,
  ])("rejects a non-private or malformed photo URL: %s", (avatarUrl) => {
    expect(portalAvatarUrlSchema.safeParse(avatarUrl).success).toBe(false);
    expect(portalAccountSchema.safeParse({ ...account(1), avatarUrl }).success).toBe(false);
  });

  it("does not accept an avatar URL in the untrusted JSON profile command", () => {
    expect(portalProfileUpdateSchema.safeParse({ fullName: "Updated", avatarUrl: newPhoto }).success).toBe(false);
  });
});

describe("trusted portal profile photo changes", () => {
  it("updates only the authenticated account and returns the safe photo with no credential fields", async () => {
    const result = await service.updateProfile(session.id, { fullName: "Updated", phone: "+998900000000" }, newPhoto);
    expect(result).toMatchObject({ id: 1, fullName: "Updated", phone: "+998900000000", avatarUrl: newPhoto });
    expect(result).not.toHaveProperty("passwordHash");
    expect(result).not.toHaveProperty("authVersion");
    expect(await repository.getAccount(2)).toEqual(account(2));
    expect((await service.getSessionDto(session)).account?.avatarUrl).toBe(newPhoto);
    expect((await service.updateProfile(session.id, { locale: "en" })).avatarUrl).toBe(newPhoto);
  });

  it("ignores a runtime avatar property in ordinary changes and uses only the trusted argument", async () => {
    const changes = { fullName: "Updated", avatarUrl: newPhoto };
    expect((await service.updateProfile(session.id, changes)).avatarUrl).toBe(originalPhoto);
    expect((await repository.getAccount(1))?.fullName).toBe("Updated");
  });

  it("rejects an invalid trusted URL before changing either the profile or photo", async () => {
    await expect(service.updateProfile(session.id, { fullName: "Updated" }, "https://example.com/avatar"))
      .rejects.toMatchObject({ code: "portalInvalidData", status: 400 });
    expect(await repository.getAccount(1)).toEqual(account(1));
  });

  it("rolls back the photo together with profile fields if persistence fails after the account update", async () => {
    const update = repository.updateAccount.bind(repository);
    vi.spyOn(repository, "updateAccount").mockImplementationOnce(async (id, changes) => {
      await update(id, changes);
      throw new Error("contact persistence failed");
    });
    await expect(service.updateProfile(session.id, { fullName: "Updated" }, newPhoto)).rejects.toThrow("contact persistence failed");
    expect(await repository.getAccount(1)).toEqual(account(1));
  });

  it.each(["revoked-session", "changed-credentials", "suspended-account"] as const)(
    "rechecks %s before a trusted photo write", async (change) => {
      const transaction = repository.transaction.bind(repository);
      vi.spyOn(repository, "transaction").mockImplementationOnce(async (work) => {
        if (change === "revoked-session") repository.sessions.delete(session.id);
        else repository.accounts.set(1, { ...account(1), ...(change === "changed-credentials" ? { authVersion: 2 } : { status: "suspended" }) });
        return transaction(work);
      });
      await expect(service.updateProfile(session.id, { fullName: "Updated" }, newPhoto))
        .rejects.toMatchObject({ code: "portalAuthenticationRequired", status: 401 });
      expect(await repository.getAccount(1)).toMatchObject({ fullName: "Account 1", avatarUrl: originalPhoto });
      expect(await repository.getAccount(2)).toEqual(account(2));
    },
  );
});
