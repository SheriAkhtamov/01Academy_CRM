import type { PortalAccountDto } from "@shared/contracts/portal-identity";
import type { PortalAccount } from "./ports";
export const safeAccount = (account: PortalAccount): PortalAccountDto => ({
  id: account.id,
  login: account.login,
  fullName: account.fullName,
  email: account.emailVerifiedAt ? account.email : null,
  phone: account.phone,
  locale: account.locale,
  status: account.status,
});
