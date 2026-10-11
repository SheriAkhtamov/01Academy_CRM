import type { PortalActorContext } from '../../portal-identity/domain/actor-context';
import type { PortalPermission } from '@shared/contracts/portal-identity';

export class PortalResourceError extends Error {
  constructor(public readonly code: string, public readonly statusCode = 400) { super(code); }
}
export type ResourceStaffActor = { userId: number; modules: readonly string[]; isLeadership: boolean;requestId?:string };
export const requireResourcePermission = (actor: PortalActorContext, permission: PortalPermission, selfOnly = false) => {
  if (!actor.permissions.includes(permission) || (selfOnly && actor.kind !== 'self')) {
    throw new PortalResourceError('portalAccessDenied', 403);
  }
};
export const requireFinanceRead = (actor: PortalActorContext) => {
  requireResourcePermission(actor, 'finance.read');
  if (actor.kind === 'self' && actor.studentClassification === 'unverified') throw new PortalResourceError('portalAccessDenied', 403);
};
export const requireShareCreation = (actor: PortalActorContext) => {
  requireResourcePermission(actor, 'portfolio.edit', true);
  if (actor.studentClassification === 'unverified') throw new PortalResourceError('portalClassificationRequired', 409);
};
export const requireResourceVersion = (actual: number, expected: number) => {
  if (actual !== expected) throw new PortalResourceError('portalVersionConflict', 409);
};
