import type {
  AcademyPortalQuery, AcademyPortalPage, AcademyPortalLeadRole,
  AcademyPortalCredentialChange, AcademyPortalCredentialResult,
} from '@shared/contracts/academy-portal-access';
import type { PortalStaffActor } from '../domain/actor-context';
import { PortalError } from '../domain/access-policy';

export interface AcademyPortalAccessRepository {
  directory(query: AcademyPortalQuery): Promise<AcademyPortalPage>;
  chooseLeadRole(actor: PortalStaffActor, leadId: number, command: AcademyPortalLeadRole): Promise<AcademyPortalCredentialResult>;
  showCredentials(actor: PortalStaffActor, leadId: number, accountId: number, version: number): Promise<AcademyPortalCredentialResult>;
  changeCredentials(actor: PortalStaffActor, leadId: number, accountId: number, command: AcademyPortalCredentialChange): Promise<AcademyPortalCredentialResult>;
}

export class AcademyPortalAccessService {
  constructor(private readonly repository: AcademyPortalAccessRepository, private readonly enabled: () => boolean) {}
  private authorize(actor: PortalStaffActor) {
    if (!actor.canManageAccess || !actor.modules.includes('administration')) throw new PortalError('portalAccessDenied', 403);
    if (!this.enabled()) throw new PortalError('portalInvitationsDisabled', 403);
  }
  async directory(actor: PortalStaffActor, query: AcademyPortalQuery) {
    this.authorize(actor);
    return this.repository.directory(query);
  }
  async chooseLeadRole(actor: PortalStaffActor, leadId: number, command: AcademyPortalLeadRole) {
    this.authorize(actor);
    if (command.role === 'representative') {
      if (new Set(command.students.map(student => student.studentId)).size !== command.students.length) throw new PortalError('portalInvalidData');
      if (command.students.some(student => student.classification === 'adult' && !student.adultConsent)) throw new PortalError('portalAdultConsentRequired');
    }
    return this.repository.chooseLeadRole(actor, leadId, command);
  }
  async showCredentials(actor: PortalStaffActor, leadId: number, accountId: number, version: number) {
    this.authorize(actor);
    return this.repository.showCredentials(actor, leadId, accountId, version);
  }
  async changeCredentials(actor: PortalStaffActor, leadId: number, accountId: number, command: AcademyPortalCredentialChange) {
    this.authorize(actor);
    return this.repository.changeCredentials(actor, leadId, accountId, command);
  }
}
