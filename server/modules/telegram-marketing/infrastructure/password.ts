import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
export async function hashMarketingPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 32) as Buffer;
  return `scrypt:${salt}:${hash.toString('hex')}`;
}

export async function verifyMarketingPassword(password: string, encoded: string) {
  if (password.length > 128 || !/^scrypt:[a-f0-9]{32}:[a-f0-9]{64}$/.test(encoded)) return false;
  const [, salt, hash] = encoded.split(':');
  const actual = await derive(password, salt, 32) as Buffer;
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}

export const marketingAccessVersion = (hash: string) => createHash('sha256').update(hash).digest('hex');
