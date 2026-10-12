import crypto from "node:crypto";
import bcrypt from "bcrypt";
import type { PortalCrypto } from "../application/ports";

const dummyHash =
  "$2b$12$Ym/j.BERoqvgwbLC.SesIe17BFmgEYDWgb.YpbLLWWwGp.Vevki2a";
export const createPortalCrypto = (encryptionKey?: string): PortalCrypto => ({
  randomToken: () => crypto.randomBytes(32).toString("base64url"),
  hashToken: (token) => crypto.createHash("sha256").update(token).digest("hex"),
  hashPassword: (password) => bcrypt.hash(password, 12),
  verifyPassword: (password, hash) =>
    bcrypt.compare(password, hash || dummyHash),
  encrypt: (payload) => {
    if (!encryptionKey || Buffer.from(encryptionKey, "base64").length !== 32)
      throw new Error(
        "portal.tokenEncryptionKey must be a base64 encoded 32-byte key",
      );
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
      "aes-256-gcm",
      Buffer.from(encryptionKey, "base64"),
      iv,
    );
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), "utf8"),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), ciphertext]
      .map((value) => value.toString("base64url"))
      .join(".");
  },
});
export const decryptPortalEnvelope = (
  envelope: string,
  encryptionKey: string,
): Record<string, unknown> => {
  const [iv, tag, ciphertext] = envelope
    .split(".")
    .map((value) => Buffer.from(value, "base64url"));
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(encryptionKey, "base64"),
    iv,
  );
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      "utf8",
    ),
  );
};
