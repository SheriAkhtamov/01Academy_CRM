import crypto from 'node:crypto';
import { appConfig } from '../config';

const TOKEN_PATTERN = /^Bearer (wsl_[A-Za-z0-9_-]{43})$/;

export const createWebsiteLeadToken = () => `wsl_${crypto.randomBytes(32).toString('base64url')}`;

export const hashWebsiteLeadToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');

export const authenticateWebsiteLeadToken = (authorization: string | undefined): string | null => {
  const token = TOKEN_PATTERN.exec(authorization ?? '')?.[1];
  if (!token) return null;

  const suppliedHash = Buffer.from(hashWebsiteLeadToken(token), 'hex');
  const credentials = appConfig.integrations?.website?.apiTokens ?? {};
  let domain: string | null = null;
  for (const [candidateDomain, credential] of Object.entries(credentials)) {
    if (!/^[a-f0-9]{64}$/.test(credential.hash)) continue;
    const expectedHash = Buffer.from(credential.hash, 'hex');
    if (crypto.timingSafeEqual(suppliedHash, expectedHash)) domain = candidateDomain;
  }
  return domain;
};
