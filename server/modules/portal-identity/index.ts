export { PortalIdentityService } from "./application/identity-service";
export {
  createPostgresPortalRepository,
  PostgresPortalRepository,
} from "./infrastructure/postgres-repository";
export { createPortalCrypto, decryptPortalMail } from "./infrastructure/crypto";
export {
  createPortalIdentityRouter,
  requirePortalActor,
} from "./http/portal-router";
export { createPortalAccessRouter } from "./http/staff-access-router";
export { PortalError, assertPortalPermission } from "./domain/access-policy";
export type {
  PortalActorContext,
  PortalStaffActor,
} from "./domain/actor-context";
export type {
  PortalRepository,
  PortalCrypto,
  PortalSession,
} from "./application/ports";
export { PortalIdentityMailWorker } from "./infrastructure/mail-worker";
export type { PortalIdentityMailDelivery } from "./infrastructure/mail-worker";
export { PortalDirectoryRepository } from "./infrastructure/directory-repository";
export { createPortalAdminRouter } from "./http/admin-router";
