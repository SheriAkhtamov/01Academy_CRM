import type { PoolClient } from 'pg';
import type { AcademyPortalAccount } from '@shared/contracts/academy-portal-access';
import type { PortalCrypto } from '../application/ports';
import type { PortalStaffActor } from '../domain/actor-context';
import { PortalError } from '../domain/access-policy';
import { decryptPortalEnvelope } from './crypto';

export const INITIAL_PASSWORD_LIFETIME = 7 * 24 * 60 * 60 * 1000;
export type CredentialAccountRow = {
  id: number; login: string; full_name: string; status: AcademyPortalAccount['status']; auth_version: number;
  encrypted_password: string | null; expires_at: Date | null; initial_version: number | null;
};
export const credentialAccountColumns = `account.id,account.login,account.full_name,account.status,account.auth_version,
  initial.encrypted_password,initial.expires_at,initial.auth_version AS initial_version`;
export function credentialAccount(row: CredentialAccountRow, now: number): AcademyPortalAccount {
  return { id: row.id, login: row.login, fullName: row.full_name, status: row.status, version: row.auth_version,
    hasInitialPassword: Boolean(row.encrypted_password && row.initial_version === row.auth_version && row.expires_at && row.expires_at.getTime() > now) };
}
export function initialPortalPassword(row: CredentialAccountRow, encryptionKey: string, now: number): string | null {
  if (!credentialAccount(row, now).hasInitialPassword || !row.encrypted_password) return null;
  try {
    const payload = decryptPortalEnvelope(row.encrypted_password, encryptionKey);
    if (payload.accountId !== row.id || payload.version !== row.auth_version || typeof payload.password !== 'string') throw new Error('INVALID_INITIAL_CREDENTIAL_BINDING');
    return payload.password;
  } catch { throw new PortalError('academyAccessInitialUnavailable', 409); }
}
export async function credentialAudit(sql: PoolClient, actor: PortalStaffActor | null, studentId: number | null, action: string, details: Record<string, unknown>) {
  await sql.query('INSERT INTO portal_access_audit(actor_kind,staff_id,student_id,action,request_id,details) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
    [actor ? 'staff' : 'system', actor?.staffId ?? null, studentId, action, actor?.requestId ?? null, JSON.stringify(details)]);
}
export async function generatePortalLogin(sql: PoolClient, prefix: string, crypto: PortalCrypto, forceSuffix = false) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const login = attempt === 0 && !forceSuffix ? prefix : `${prefix}-${crypto.randomToken().replace(/[^a-z0-9]/gi, '').slice(0, 6).toLowerCase()}`;
    if (!(await sql.query('SELECT id FROM portal_accounts WHERE login=$1', [login])).rowCount) return login;
  }
  throw new PortalError('portalLoginUnavailable', 409);
}
export async function rememberInitialPassword(sql: PoolClient, accountId: number, version: number, password: string, crypto: PortalCrypto, now: number) {
  const encrypted = crypto.encrypt({ accountId, version, password });
  await sql.query(`INSERT INTO portal_initial_credentials(account_id,auth_version,encrypted_password,expires_at)
    VALUES($1,$2,$3,$4) ON CONFLICT(account_id) DO UPDATE SET auth_version=EXCLUDED.auth_version,
    encrypted_password=EXCLUDED.encrypted_password,expires_at=EXCLUDED.expires_at,issued_at=NULL`,
    [accountId, version, encrypted, new Date(now + INITIAL_PASSWORD_LIFETIME)]);
}
