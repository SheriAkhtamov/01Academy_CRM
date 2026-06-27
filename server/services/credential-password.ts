import crypto from 'crypto';
import { appConfig } from '../config';
import { logger } from '../lib/logger';

const algorithm = 'aes-256-gcm';

const getKey = () =>
  crypto
    .createHash('sha256')
    .update(appConfig.session.secret)
    .digest();

export function encryptCredentialPassword(password: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(password, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    'v1',
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

export function decryptCredentialPassword(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) return null;

  try {
    const [version, ivValue, authTagValue, encryptedValue] = ciphertext.split(':');
    if (version !== 'v1' || !ivValue || !authTagValue || !encryptedValue) {
      return null;
    }

    const decipher = crypto.createDecipheriv(
      algorithm,
      getKey(),
      Buffer.from(ivValue, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(authTagValue, 'base64url'));

    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    logger.error('Failed to decrypt credential password', { error });
    return null;
  }
}
