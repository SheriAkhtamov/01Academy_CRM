import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_USER_PHOTO_BYTES } from "../shared/user-photo";
import { createPortalSessionMiddleware, portalCsrfProtection } from "../server/infrastructure/portal-session";
import { PortalIdentityService } from "../server/modules/portal-identity/application/identity-service";
import { createPortalCrypto } from "../server/modules/portal-identity/infrastructure/crypto";
import { createPortalProfilePhotos } from "../server/modules/portal-identity/infrastructure/profile-photos";
import { createPortalIdentityRouter } from "../server/modules/portal-identity/http/portal-router";
import { MemoryPortalRepository } from "./portal-identity-memory";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2nUAAAAASUVORK5CYII=", "base64");
const password = "Portal-photo-test-password";
const crypto = createPortalCrypto(randomBytes(32).toString("base64"));
let passwordHash: string;
let directory: string;
let repository: MemoryPortalRepository;
let service: PortalIdentityService;
let app: express.Express;
let photos: ReturnType<typeof createPortalProfilePhotos>;
let sequence = 0;

beforeAll(async () => { passwordHash = await crypto.hashPassword(password); });
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "academy-photo-http-"));
  repository = new MemoryPortalRepository();
  for (const id of [1, 2]) repository.accounts.set(id, {
    id, login: `photo${id}`, fullName: `Account ${id}`, email: null, phone: null,
    locale: "ru", status: "active", passwordHash, authVersion: 1, avatarUrl: null,
  });
  service = new PortalIdentityService(repository, crypto, { appUrl: "https://academy.example", allowInvitations: false });
  photos = createPortalProfilePhotos(directory);
  app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/api/portal", createPortalSessionMiddleware({
    secret: "portal-profile-photo-http-signing-secret", secure: false, service,
  }), portalCsrfProtection, createPortalIdentityRouter({ service, photos }));
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (!res.destroyed && !res.headersSent) res.status(500).json({ error: "internalError" });
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(directory, { recursive: true, force: true });
});

async function login(id = 1) {
  const agent = request.agent(app).set("X-Forwarded-For", `192.0.2.${++sequence}`);
  const initial = await agent.get("/api/portal/auth/session").expect(200);
  const signedIn = await agent.post("/api/portal/auth/login").set("X-Portal-CSRF", initial.body.csrfToken)
    .send({ identifier: `photo${id}`, password }).expect(200);
  return { agent, csrf: signedIn.body.csrfToken as string };
}
async function upload(client: Awaited<ReturnType<typeof login>>, profile: unknown = { fullName: "Photo owner" }) {
  return client.agent.patch("/api/portal/me").set("X-Portal-CSRF", client.csrf)
    .field("profile", JSON.stringify(profile)).attach("photo", png, "my-photo.png");
}
const emptyDirectory = () => vi.waitFor(async () => expect(await fs.readdir(directory)).toEqual([]));

describe("portal profile photo HTTP and private storage", () => {
  it("saves profile and photo together and returns it in the session after login again", async () => {
    const client = await login();
    const saved = await upload(client);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ id: 1, fullName: "Photo owner" });
    expect(saved.body.avatarUrl).toMatch(/^\/api\/portal\/me\/photos\/[A-Za-z0-9_-]{21}$/);
    expect(saved.body).not.toHaveProperty("passwordHash");
    expect((await repository.getAccount(2))?.avatarUrl).toBeNull();
    expect((await client.agent.get("/api/portal/auth/session")).body.account.avatarUrl).toBe(saved.body.avatarUrl);
    const bytes = await client.agent.get(saved.body.avatarUrl).expect(200);
    expect(bytes.body).toEqual(png);
    expect(bytes.headers["content-type"]).toContain("image/png");
    expect(bytes.headers["cache-control"]).toBe("private, no-store");
    expect(bytes.headers["x-content-type-options"]).toBe("nosniff");
    expect(bytes.headers["content-security-policy"]).toContain("sandbox");
    const noPhoto = await client.agent.patch("/api/portal/me").set("X-Portal-CSRF", client.csrf).send({ locale: "en" }).expect(200);
    expect(noPhoto.body.avatarUrl).toBe(saved.body.avatarUrl);
    await client.agent.post("/api/portal/auth/logout").set("X-Portal-CSRF", client.csrf).expect(200);
    const returned = await login();
    expect((await returned.agent.get("/api/portal/auth/session")).body.account.avatarUrl).toBe(saved.body.avatarUrl);
    expect(await fs.readdir(directory)).toHaveLength(1);
  });

  it("requires a live portal account and CSRF before storing upload bytes", async () => {
    const anonymous = request.agent(app);
    const session = await anonymous.get("/api/portal/auth/session");
    await anonymous.patch("/api/portal/me").set("X-Portal-CSRF", session.body.csrfToken)
      .field("profile", "{}").attach("photo", png, "anonymous.png").expect(401);
    const client = await login();
    await client.agent.patch("/api/portal/me").field("profile", "{}").attach("photo", png, "csrf.png").expect(403);
    await repository.revokeSessions(1);
    await client.agent.patch("/api/portal/me").set("X-Portal-CSRF", client.csrf)
      .field("profile", "{}").attach("photo", png, "revoked.png").expect(403);
    await emptyDirectory();
  });

  it("never serves another account, an old photo, an orphan, or an anonymous request", async () => {
    const owner = await login();
    const other = await login(2);
    const first = (await upload(owner)).body.avatarUrl as string;
    await other.agent.get(first).expect(404);
    await request(app).get(first).expect(401);
    await upload(owner);
    await owner.agent.get(first).expect(404);
    const orphan = "O".repeat(21);
    await fs.writeFile(path.join(directory, orphan), png);
    await owner.agent.get(`/api/portal/me/photos/${orphan}`).expect(404);
    await owner.agent.get("/api/portal/me/photos/short").expect(404);
    expect(await fs.readdir(directory)).toHaveLength(3);
  });

  it("rejects missing and corrupt stored bytes even for the current account URL", async () => {
    const owner = await login();
    const url = (await upload(owner)).body.avatarUrl as string;
    const file = path.join(directory, url.split("/").at(-1)!);
    await fs.writeFile(file, "<html>not an image</html>");
    await owner.agent.get(url).expect(404);
    await fs.unlink(file);
    await owner.agent.get(url).expect(404);
  });

  it.each(["<svg onload='alert(1)'>", "<html>fake image</html>", "%PDF-1.7"])(
    "checks bytes instead of accepting a supplied image MIME: %s", async (bytes) => {
      const client = await login();
      const response = await client.agent.patch("/api/portal/me").set("X-Portal-CSRF", client.csrf)
        .field("profile", "{}").attach("photo", Buffer.from(bytes), { filename: "fake.png", contentType: "image/png" });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe("profilePhotoTypeUnsupported");
      expect((await repository.getAccount(1))?.avatarUrl).toBeNull();
      await emptyDirectory();
    },
  );

  it.each(["{broken", "[]", JSON.stringify({ avatarUrl: "/api/portal/me/photos/AAAAAAAAAAAAAAAAAAAAA" }),
    JSON.stringify({ fullName: "Should not change", accountId: 2 })])("cleans a file when profile validation rejects %s", async (profile) => {
    const client = await login();
    await client.agent.patch("/api/portal/me").set("X-Portal-CSRF", client.csrf)
      .field("profile", profile).attach("photo", png, "invalid.png").expect(400);
    expect(await repository.getAccount(1)).toMatchObject({ fullName: "Account 1", avatarUrl: null });
    await emptyDirectory();
  });

  it("cleans partial data for oversized uploads and extra multipart fields", async () => {
    const client = await login();
    await client.agent.patch("/api/portal/me").set("X-Portal-CSRF", client.csrf).field("profile", "{}")
      .attach("photo", Buffer.alloc(MAX_USER_PHOTO_BYTES + 1), "large.png").expect(413);
    await emptyDirectory();
    await client.agent.patch("/api/portal/me").set("X-Portal-CSRF", client.csrf).field("profile", "{}")
      .field("accountId", "2").attach("photo", png, "extra.png").expect(400);
    await emptyDirectory();
    await client.agent.patch("/api/portal/me").set("X-Portal-CSRF", client.csrf).field("profile", "{}")
      .attach("photo", png, "first.png").attach("photo", png, "second.png").expect(400);
    await emptyDirectory();
  });

  it("rolls back profile and cleans its new file when persistence fails", async () => {
    const client = await login();
    const previous = (await upload(client)).body.avatarUrl as string;
    const originalFiles = await fs.readdir(directory);
    const update = repository.updateAccount.bind(repository);
    vi.spyOn(repository, "updateAccount").mockImplementationOnce(async (id, changes) => {
      await update(id, changes);
      throw new Error("write failed");
    });
    expect((await upload(client, { fullName: "Must roll back" })).status).toBe(500);
    expect(await repository.getAccount(1)).toMatchObject({ fullName: "Photo owner", avatarUrl: previous });
    await vi.waitFor(async () => expect(await fs.readdir(directory)).toEqual(originalFiles));
    await client.agent.get(previous).expect(200);
  });

  it("cleans a partially written upload after the client disconnects", async () => {
    const client = await login();
    const session = [...repository.sessions.values()].find((entry) => entry.accountId === 1)!;
    // Obtain the signed cookie through the normal session endpoint.
    const cookie = (await client.agent.get("/api/portal/auth/session")).headers["set-cookie"]![0].split(";")[0];
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const port = (server.address() as import("node:net").AddressInfo).port;
    try {
      const body = "--photo-boundary\r\nContent-Disposition: form-data; name=\"profile\"\r\n\r\n{}\r\n" +
        "--photo-boundary\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"partial.png\"\r\nContent-Type: image/png\r\n\r\n";
      const pending = http.request({ host: "127.0.0.1", port, method: "PATCH", path: "/api/portal/me", headers: {
        Cookie: cookie, "X-Portal-CSRF": session.csrfToken, "Content-Type": "multipart/form-data; boundary=photo-boundary",
        "Content-Length": MAX_USER_PHOTO_BYTES,
      } });
      pending.on("error", () => {});
      pending.write(body);
      pending.write(png);
      await vi.waitFor(async () => expect(await fs.readdir(directory)).toHaveLength(1));
      pending.destroy();
      await emptyDirectory();
      expect((await repository.getAccount(1))?.avatarUrl).toBeNull();
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it.each([true, false])("keeps a committed file after response disconnect, or cleans a failed commit (commit=%s)", async (commit) => {
    const client = await login();
    const cookie = (await client.agent.get("/api/portal/auth/session")).headers["set-cookie"]![0].split(";")[0];
    const transaction = repository.transaction.bind(repository);
    let resume = () => {};
    let reached = () => {};
    const proceed = new Promise<void>((resolve) => { resume = resolve; });
    const transactionStarted = new Promise<void>((resolve) => { reached = resolve; });
    vi.spyOn(repository, "transaction").mockImplementationOnce(async (work) => {
      reached();
      await proceed;
      if (!commit) throw new Error("commit failed");
      return transaction(work);
    });
    const retained = vi.spyOn(photos, "retain");
    const cleaned = vi.spyOn(photos, "cleanup");
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const port = (server.address() as import("node:net").AddressInfo).port;
    try {
      const body = Buffer.concat([Buffer.from("--photo-boundary\r\nContent-Disposition: form-data; name=\"profile\"\r\n\r\n{}\r\n" +
        "--photo-boundary\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"photo.png\"\r\nContent-Type: image/png\r\n\r\n"),
      png, Buffer.from("\r\n--photo-boundary--\r\n")]);
      const pending = http.request({ host: "127.0.0.1", port, method: "PATCH", path: "/api/portal/me", headers: {
        Cookie: cookie, "X-Portal-CSRF": client.csrf, "Content-Type": "multipart/form-data; boundary=photo-boundary",
        "Content-Length": body.length,
      } });
      pending.on("error", () => {});
      pending.end(body);
      await transactionStarted;
      pending.destroy();
      resume();
      await vi.waitFor(() => expect(cleaned).toHaveBeenCalledOnce());
      if (commit) {
        expect(retained).toHaveBeenCalledOnce();
        expect(await fs.readdir(directory)).toHaveLength(1);
        const url = (await repository.getAccount(1))!.avatarUrl!;
        await client.agent.get(url).expect(200);
      } else {
        expect(retained).not.toHaveBeenCalled();
        expect((await repository.getAccount(1))?.avatarUrl).toBeNull();
        await emptyDirectory();
      }
    } finally {
      resume();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
