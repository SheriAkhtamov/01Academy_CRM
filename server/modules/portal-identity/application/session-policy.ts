import { PortalError } from "../domain/access-policy";
import type { PortalAccount, PortalRepository, PortalSession } from "./ports";

/** Serialize sensitive commands with account blocking and credential revocation. */
export async function requireCurrentPortalSession(
  repository: PortalRepository,
  authenticated: { account: PortalAccount; session: PortalSession },
  now: number,
  reauthenticated = false,
) {
  const account = await repository.getAccount(authenticated.account.id, true);
  const session = await repository.getSession(authenticated.session.id, true);
  if (
    !account ||
    account.status !== "active" ||
    account.authVersion !== authenticated.account.authVersion ||
    !session ||
    session.accountId !== account.id ||
    session.authVersion !== account.authVersion ||
    session.absoluteExpiresAt <= now ||
    session.lastSeenAt + 24 * 60 * 60 * 1000 <= now
  )
    throw new PortalError("portalAuthenticationRequired", 401);
  if (
    reauthenticated &&
    (!session.reauthenticatedAt || session.reauthenticatedAt + 10 * 60_000 <= now)
  )
    throw new PortalError("portalReauthenticationRequired", 403);
  return account;
}
